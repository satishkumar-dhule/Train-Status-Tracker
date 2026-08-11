//! Integration tests for `GET /api/trains/runs`, driven through
//! `build_app_with_providers` with a per-date stub transport via
//! `tower::ServiceExt::oneshot` (no port binding).
//!
//! Ports `routes/train-runs.test.ts`: probe-inference over the 21-day window,
//! L1 caching across repeated requests, the not-found and upstream-error
//! verdicts, schedule-note rescue, and the query validation rules. Expected
//! run dates are computed with the same `tt_runs::compute_run_dates` the
//! route uses against the real clock, matching the reference suite's frozen
//! date (the fixture dates there were baked for 2026-08-05).

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use axum::Router;
use chrono::Datelike;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

use tt_api_server::build_app_with_providers;
use tt_config::Config;
use tt_provider_http::{HttpTransport, Request as ProbeRequest, Response, TransportError};
use tt_qos::QosRegistry;
use tt_runs::{compute_run_dates, RUN_WINDOW_DAYS};
use tt_trains_data::LocalDate;

const TRAIN_NUMBER: &str = "22943";

/// The reference's `stubRunsOn` helper: a transport that answers the probe
/// per its `departure_date` query parameter.
enum StubMode {
    /// A run on `weekdays`, `error: true` on others (`stubRunsOn`).
    RunsOn(Vec<usize>),
    /// A "runs only on MON,FRI" schedule note on `note_weekdays`, an upstream
    /// failure everywhere else (the schedule-rescue test).
    ScheduleNoteElsewhereUpstream(Vec<usize>),
    /// Every probe is a positive not-found (`{ error: true }`).
    AlwaysNotFound,
    /// Every probe fails upstream (non-2xx).
    AlwaysUpstream,
}

/// A `weekdayOf`-style day-of-week: Sunday = 0, matching the probe's own
/// conventions (and the JS `Date.prototype.getDay`).
fn weekday_of(date: LocalDate) -> usize {
    chrono::NaiveDate::from_ymd_opt(date.year, date.month, date.day)
        .expect("probe dates are valid")
        .weekday()
        .num_days_from_sunday() as usize
}

/// Parses `departure_date` out of a probe URL; `None` when malformed.
fn probe_date_of(request: &ProbeRequest) -> Option<LocalDate> {
    let api_date = request
        .url
        .split("departure_date=")
        .nth(1)?
        .split('&')
        .next()?;
    let (y, m, d) = (
        api_date[0..4].parse().ok()?,
        api_date[4..6].parse().ok()?,
        api_date[6..8].parse().ok()?,
    );
    LocalDate::new(y, m, d)
}

/// A per-date probe transport; `MockTransport` matches by path only and
/// cannot vary responses per probe date, so this one parses the query.
struct RunsStub {
    mode: StubMode,
    calls: AtomicUsize,
}

impl RunsStub {
    fn new(mode: StubMode) -> Arc<RunsStub> {
        Arc::new(RunsStub {
            mode,
            calls: AtomicUsize::new(0),
        })
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

#[async_trait::async_trait]
impl HttpTransport for RunsStub {
    async fn execute(&self, request: ProbeRequest) -> Result<Response, TransportError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let date = probe_date_of(&request).expect("probe requests carry a departure_date");
        let weekday = weekday_of(date);
        let payload = match &self.mode {
            StubMode::RunsOn(weekdays) => {
                if weekdays.contains(&weekday) {
                    json!({
                        "status": { "result": "success" },
                        "body": { "stations": [], "current_station": null },
                    })
                } else {
                    not_found_payload()
                }
            }
            StubMode::ScheduleNoteElsewhereUpstream(note_weekdays) => {
                if note_weekdays.contains(&weekday) {
                    json!({
                        "status": { "result": "success" },
                        "body": {
                            "stations": [],
                            "current_station": null,
                            "train_status_message": "This train runs only on MON,FRI",
                        },
                    })
                } else {
                    return Err(TransportError::Status { status: 500 });
                }
            }
            StubMode::AlwaysNotFound => not_found_payload(),
            StubMode::AlwaysUpstream => {
                return Err(TransportError::Status { status: 500 });
            }
        };
        Ok(Response::new(
            200,
            serde_json::to_vec(&payload).expect("json is valid"),
        ))
    }
}

/// The reference's `notFoundPayload`: a positive 200 with `error: true`.
fn not_found_payload() -> Value {
    json!({ "error": true, "status": { "result": "failure" } })
}

fn config() -> Config {
    Config::parse(&BTreeMap::new())
}

/// Build an app probing through `stub`; the runs transport and the (unused)
/// providers share it so nothing touches the network.
fn app_with_stub(stub: Arc<RunsStub>) -> Router {
    let config = config();
    let telemetry = Arc::new(tt_telemetry::init(&config));
    let transport: Arc<dyn HttpTransport> = stub;
    let qos = Arc::new(QosRegistry::default());
    build_app_with_providers(config, telemetry, Vec::new(), transport, qos)
}

/// Sends `GET uri` and returns the status plus the raw response body.
async fn send(app: &Router, uri: &str) -> (StatusCode, String) {
    let request = Request::builder()
        .method(Method::GET)
        .uri(uri)
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, String::from_utf8(bytes.to_vec()).unwrap())
}

/// The run dates the route should produce for `weekdays` (same computation).
fn expected_runs(weekdays: &[usize]) -> Vec<String> {
    compute_run_dates(weekdays, LocalDate::today(), RUN_WINDOW_DAYS)
}

/// The 21-day probe window is inclusive of today (`windowDays + 1` dates).
fn probe_count() -> usize {
    RUN_WINDOW_DAYS as usize + 1
}

async fn get_runs(app: &Router, train_number: &str) -> (StatusCode, Value) {
    let (status, body) = send(
        app,
        &format!("/api/trains/runs?train_number={train_number}"),
    )
    .await;
    (status, serde_json::from_str(&body).unwrap_or(Value::Null))
}
#[tokio::test]
async fn returns_the_last_3_runs_plus_the_next_run_for_a_twice_weekly_train() {
    let stub = RunsStub::new(StubMode::RunsOn(vec![1, 4]));
    let app = app_with_stub(stub.clone());

    let (status, body) = get_runs(&app, TRAIN_NUMBER).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["train_number"], TRAIN_NUMBER);
    assert_eq!(body["runs"], json!(expected_runs(&[1, 4])));
    assert_eq!(stub.calls(), probe_count());
}

#[tokio::test]
async fn returns_the_last_3_runs_plus_the_next_run_for_a_weekly_train() {
    let stub = RunsStub::new(StubMode::RunsOn(vec![3]));
    let app = app_with_stub(stub.clone());

    let (status, body) = get_runs(&app, "12951").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["train_number"], "12951");
    assert_eq!(body["runs"], json!(expected_runs(&[3])));
}

#[tokio::test]
async fn serves_a_repeated_request_from_cache_without_reprobing() {
    let stub = RunsStub::new(StubMode::RunsOn(vec![3]));
    let app = app_with_stub(stub.clone());

    let (first_status, first) = get_runs(&app, "12301").await;
    let (second_status, second) = get_runs(&app, "12301").await;

    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(second_status, StatusCode::OK);
    assert_eq!(second, first);
    // One full probe window for the first request; the second is an L1 hit.
    assert_eq!(stub.calls(), probe_count());
}

#[tokio::test]
async fn returns_empty_runs_when_the_train_ran_on_no_probed_date() {
    let stub = RunsStub::new(StubMode::AlwaysNotFound);
    let app = app_with_stub(stub.clone());

    let (status, body) = get_runs(&app, "88888").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "train_number": "88888", "runs": [] }));
}

#[tokio::test]
async fn returns_502_when_every_probe_fails_upstream() {
    let stub = RunsStub::new(StubMode::AlwaysUpstream);
    let app = app_with_stub(stub.clone());

    let (status, body) = get_runs(&app, "99999").await;

    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(
        body,
        json!({ "error": "Could not reach train data provider" })
    );
}

#[tokio::test]
async fn serves_schedule_derived_runs_even_when_date_probes_fail_upstream() {
    // TUE/WED/SAT probes carry the "runs only on MON,FRI" note; the rest fail.
    let stub = RunsStub::new(StubMode::ScheduleNoteElsewhereUpstream(vec![2, 3, 6]));
    let app = app_with_stub(stub.clone());

    let (status, body) = get_runs(&app, "12435").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["train_number"], "12435");
    assert_eq!(body["runs"], json!(expected_runs(&[1, 5])));
}

#[tokio::test]
async fn rejects_a_missing_train_number() {
    let stub = RunsStub::new(StubMode::AlwaysNotFound);
    let app = app_with_stub(stub.clone());

    let (status, body) = send(&app, "/api/trains/runs").await;
    let body: Value = serde_json::from_str(&body).unwrap_or(Value::Null);

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "train_number: Required");
    assert_eq!(stub.calls(), 0);
}

#[tokio::test]
async fn rejects_a_repeated_train_number() {
    let stub = RunsStub::new(StubMode::AlwaysNotFound);
    let app = app_with_stub(stub.clone());

    let (status, body) = send(&app, "/api/trains/runs?train_number=1&train_number=2").await;
    let body: Value = serde_json::from_str(&body).unwrap_or(Value::Null);

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].is_string());
    assert_eq!(stub.calls(), 0);
}

#[tokio::test]
async fn rejects_a_non_5_digit_train_number_without_probing_upstream() {
    let stub = RunsStub::new(StubMode::RunsOn(vec![1, 4]));
    let app = app_with_stub(stub.clone());

    let (status, body) = send(&app, "/api/trains/runs?train_number=22943:20260802").await;
    let body: Value = serde_json::from_str(&body).unwrap_or(Value::Null);

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].is_string());
    assert_eq!(stub.calls(), 0);
}
