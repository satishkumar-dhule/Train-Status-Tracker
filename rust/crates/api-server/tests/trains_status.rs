//! Integration tests for `GET /api/trains/status`, driven through
//! `build_app_with_status` with a `MockTransport`-backed Paytm provider via
//! `tower::ServiceExt::oneshot` (no port binding).
//!
//! Ports the `routes/trains.test.ts` cases that do not depend on caching or
//! provider failover (later slices): validation, error taxonomy, and the wire
//! response shape.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

use tt_api_server::build_app_with_status;
use tt_config::Config;
use tt_provider_http::MockTransport;

const TRAIN_NUMBER: &str = "22943";
const DEPARTURE_DATE: &str = "20260802";
const STATUS_PATH: &str = "/api/trains/v1/train/status";

/// The `happyRaw` fixture from `routes/trains.test.ts` (3 stations).
fn happy_raw() -> Value {
    serde_json::json!({
        "status": { "result": "success" },
        "body": {
            "stations": [
                {
                    "stnSerialNumber": 1,
                    "stationCode": "ADI",
                    "stationName": "Ahmedabad Jn",
                    "arrivalTime": "22:40",
                    "departureTime": "23:00",
                    "dayCount": 1,
                    "distance": 0,
                    "expected_platform": 1,
                    "haltTime": 20,
                },
                {
                    "stnSerialNumber": 2,
                    "stationCode": "NDLS",
                    "stationName": "New Delhi",
                    "arrivalTime": "08:05",
                    "departureTime": "08:15",
                    "dayCount": 2,
                    "actual_arrival_time": "08:40",
                    "actual_departure_time": null,
                    "distance": 938,
                    "expected_platform": "3",
                    "haltTime": 10,
                },
                {
                    "stnSerialNumber": 3,
                    "stationCode": "CNB",
                    "stationName": "Kanpur Central",
                    "arrivalTime": "10:50",
                    "departureTime": "10:55",
                    "dayCount": 2,
                    "distance": 1256,
                    "expected_platform": 2,
                    "haltTime": 5,
                },
            ],
            "current_station": "NDLS",
            "train_status_message": "<b>Running on time</b>",
            "server_timestamp": "2026-08-02T08:20:00+05:30",
        },
    })
}

/// The same shape with no `train_status_message` / `server_timestamp`, so the
/// wire response must emit explicit `null` for those fields.
fn no_status_message_raw() -> Value {
    let mut raw = happy_raw();
    raw["body"]
        .as_object_mut()
        .expect("body is an object")
        .remove("train_status_message");
    raw["body"]
        .as_object_mut()
        .expect("body is an object")
        .remove("server_timestamp");
    raw
}

fn config() -> Config {
    Config::parse(&BTreeMap::new())
}

/// Build an app whose status provider serves `body` for any request. Returns
/// the app plus the mock so tests can assert the upstream request log.
fn app_serving(body: Value) -> (Router, Arc<MockTransport>) {
    let mut mock = MockTransport::new();
    mock.push_json(STATUS_PATH, &body);
    let mock = Arc::new(mock);

    let telemetry = Arc::new(tt_telemetry::init(&config()));
    let provider = tt_provider_paytm::create_paytm_provider(mock.clone());
    let app = build_app_with_status(config(), telemetry, Arc::new(provider));
    (app, mock)
}

/// Build an app whose status provider fails every request with the given
/// canned status (e.g. 500), mirroring a non-2xx upstream.
fn app_serving_status(status: u16) -> Router {
    let mut mock = MockTransport::new();
    mock.push(STATUS_PATH, status, "boom");
    let telemetry = Arc::new(tt_telemetry::init(&config()));
    let provider = tt_provider_paytm::create_paytm_provider(Arc::new(mock));
    build_app_with_status(config(), telemetry, Arc::new(provider))
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

#[tokio::test]
async fn returns_the_mapped_status_on_success() {
    let (app, _mock) = app_serving(happy_raw());
    let (status, body) = send(
        &app,
        &format!("/api/trains/status?train_number={TRAIN_NUMBER}&departure_date={DEPARTURE_DATE}"),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let value: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["train_number"], TRAIN_NUMBER);
    // The name comes from the `TRAINS` dataset lookup, not the upstream.
    assert_eq!(value["train_name"], "Indore Intercity SF Express");
    assert_eq!(value["stations"].as_array().unwrap().len(), 3);
    assert_eq!(value["stations"][1]["station_code"], "NDLS");
    assert_eq!(value["stations"][1]["delay_minutes"], 35);
    assert_eq!(value["stations"][1]["is_current"], true);
    assert_eq!(value["current_station_name"], "New Delhi");
    assert_eq!(value["status_message"], "Running on time");
}

#[tokio::test]
async fn wire_compat_uses_camel_case_with_explicit_nulls() {
    let (app, _mock) = app_serving(happy_raw());
    let (status, body) = send(
        &app,
        &format!("/api/trains/status?train_number={TRAIN_NUMBER}&departure_date={DEPARTURE_DATE}"),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    for key in [
        "train_number",
        "train_name",
        "departure_date",
        "source_station_code",
        "source_station_name",
        "destination_station_code",
        "destination_station_name",
        "current_station_code",
        "current_station_name",
        "current_delay_minutes",
        "status_message",
        "last_updated",
        "stations",
    ] {
        assert!(
            body.contains(&format!("\"{key}\":")),
            "missing camelCase field {key} in {body}"
        );
    }
    let value: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["source_station_code"], "ADI");
    assert_eq!(value["source_station_name"], "Ahmedabad Jn");
    assert_eq!(value["destination_station_code"], "CNB");
    assert_eq!(value["destination_station_name"], "Kanpur Central");
    // `last_updated` is preserved verbatim as the fixture's ISO-8601 string.
    assert_eq!(value["last_updated"], "2026-08-02T08:20:00+05:30");
    // stations[0] has no actual_departure_time -> explicit JSON null.
    assert!(value["stations"][0]["actual_departure"].is_null());
    assert!(body.contains("\"actual_departure\":null"));
}

#[tokio::test]
async fn wire_compat_emits_null_for_missing_status_message() {
    let (app, _mock) = app_serving(no_status_message_raw());
    let (status, body) = send(
        &app,
        &format!("/api/trains/status?train_number={TRAIN_NUMBER}&departure_date={DEPARTURE_DATE}"),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let value: Value = serde_json::from_str(&body).unwrap();
    assert!(value["status_message"].is_null());
    assert!(value["last_updated"].is_null());
    assert!(body.contains("\"status_message\":null"));
    assert!(body.contains("\"last_updated\":null"));
}

#[tokio::test]
async fn rejects_missing_required_fields() {
    let (app, _mock) = app_serving(happy_raw());

    let (status, body) = send(
        &app,
        &format!("/api/trains/status?train_number={TRAIN_NUMBER}"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, r#"{"error":"departure_date: Required"}"#);

    let (status, body) = send(
        &app,
        &format!("/api/trains/status?departure_date={DEPARTURE_DATE}"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let value: Value = serde_json::from_str(&body).unwrap();
    assert!(value["error"].is_string());
}

#[tokio::test]
async fn rejects_a_repeated_train_number_with_a_clean_error() {
    let (app, _mock) = app_serving(happy_raw());
    let (status, body) = send(
        &app,
        "/api/trains/status?train_number=1&train_number=2&departure_date=20260810",
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("expected string, received array"));
    assert!(!body.contains("["));
}

#[tokio::test]
async fn rejects_a_non_calendar_departure_date() {
    let (app, _mock) = app_serving(happy_raw());
    let (status, body) = send(
        &app,
        &format!("/api/trains/status?train_number={TRAIN_NUMBER}&departure_date=20261399"),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        r#"{"error":"departure_date must be a valid date in YYYYMMDD format"}"#
    );
}

#[tokio::test]
async fn rejects_a_malformed_departure_date_shape() {
    let (app, _mock) = app_serving(happy_raw());
    let (status, body) = send(
        &app,
        &format!("/api/trains/status?train_number={TRAIN_NUMBER}&departure_date=2026-0802"),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        r#"{"error":"departure_date: Invalid input: must match ^\\d{8}$"}"#
    );
}

#[tokio::test]
async fn rejects_a_non_5_digit_train_number_without_touching_upstream() {
    let (app, mock) = app_serving(happy_raw());
    let (status, body) = send(
        &app,
        &format!("/api/trains/status?train_number={TRAIN_NUMBER}:{DEPARTURE_DATE}&departure_date={DEPARTURE_DATE}"),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        r#"{"error":"train_number: Invalid input: must match ^\\d{5}$"}"#
    );
    assert!(
        mock.requests().is_empty(),
        "validation must short-circuit before any upstream call"
    );
}

#[tokio::test]
async fn returns_404_for_a_confirmed_not_found() {
    let (app, _mock) = app_serving(serde_json::json!({
        "error": true,
        "status": { "result": "failure" },
    }));
    let (status, body) = send(
        &app,
        &format!("/api/trains/status?train_number={TRAIN_NUMBER}&departure_date={DEPARTURE_DATE}"),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, r#"{"error":"Train not found or no data available"}"#);
}

#[tokio::test]
async fn returns_502_when_the_upstream_responds_non_200() {
    let app = app_serving_status(500);
    let (status, body) = send(
        &app,
        &format!("/api/trains/status?train_number={TRAIN_NUMBER}&departure_date={DEPARTURE_DATE}"),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(body, r#"{"error":"Could not reach train data provider"}"#);
}

#[tokio::test]
async fn does_not_special_case_a_404_upstream_status() {
    let app = app_serving_status(404);
    let (status, body) = send(
        &app,
        &format!("/api/trains/status?train_number={TRAIN_NUMBER}&departure_date={DEPARTURE_DATE}"),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(body, r#"{"error":"Could not reach train data provider"}"#);
}
