//! Integration tests for the status-route cache layer (L1 `TtlCache` +
//! L2 `RedisTtlCache`), driven through `build_app_with_cache` with a
//! `MockTransport`-backed Paytm provider and the cache crate's `testkit`
//! `InMemoryStore` — no Redis server, no port binding.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

use tt_api_server::build_app_with_cache;
use tt_cache::{InMemoryStore, NOT_FOUND_MARKER};
use tt_config::Config;
use tt_mapper::{MappedStation, MappedStatus};
use tt_provider_core::TrainStatusProvider;
use tt_provider_http::{HttpTransport, MockTransport};
use tt_provider_paytm::create_paytm_provider;
use tt_qos::QosRegistry;

const TRAIN_NUMBER: &str = "22943";
const DEPARTURE_DATE: &str = "20260802";
const STATUS_PATH: &str = "/api/trains/v1/train/status";

/// The L2 Redis key the route writes: `{prefix}:{train_number}:{date}`.
const REDIS_KEY: &str = "tt:22943:20260802";

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

fn not_found_raw() -> Value {
    serde_json::json!({
        "error": true,
        "status": { "result": "failure" },
    })
}

/// A config whose L1 TTL is 1 ms, so the in-memory cache expires between
/// back-to-back requests and the L2 layer is actually consulted.
fn config_with_tiny_l1_ttl() -> Config {
    Config::parse(&BTreeMap::from([(
        "STATUS_CACHE_L1_TTL_MS".to_string(),
        "1".to_string(),
    )]))
}

fn config() -> Config {
    Config::parse(&BTreeMap::new())
}

fn mock_serving_json(body: &Value) -> Arc<MockTransport> {
    let mut mock = MockTransport::new();
    mock.push_json(STATUS_PATH, body);
    Arc::new(mock)
}

fn mock_serving_status(status: u16) -> Arc<MockTransport> {
    let mut mock = MockTransport::new();
    mock.push(STATUS_PATH, status, "boom");
    Arc::new(mock)
}

fn build_app(
    config: Config,
    store: Option<Arc<InMemoryStore>>,
    mock: Arc<MockTransport>,
) -> Router {
    let telemetry = Arc::new(tt_telemetry::init(&config));
    let provider: Arc<dyn TrainStatusProvider> = Arc::new(create_paytm_provider(mock.clone()));
    let transport: Arc<dyn HttpTransport> = mock;
    let qos = Arc::new(QosRegistry::default());
    let store: Option<Arc<dyn tt_cache::RedisStore>> =
        store.map(|store| store as Arc<dyn tt_cache::RedisStore>);
    build_app_with_cache(
        config,
        telemetry,
        vec![provider],
        transport,
        qos,
        store,
        None,
        noop_catalog_transport(),
    )
}

/// A train-data transport that can never be hit: these tests exercise the
/// status cache layer, which never touches the catalog fetcher.
fn noop_catalog_transport() -> Arc<dyn tt_trains_data::HttpTransport> {
    Arc::new(tt_trains_data::UreqTransport::new(
        std::time::Duration::from_secs(1),
        1024,
    ))
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

fn status_uri() -> String {
    format!("/api/trains/status?train_number={TRAIN_NUMBER}&departure_date={DEPARTURE_DATE}")
}

/// A `MappedStatus` matching what the Paytm fixture maps to, so its serde
/// round-trip through the L2 store yields the same wire response.
fn mapped_fixture() -> MappedStatus {
    MappedStatus {
        train_number: TRAIN_NUMBER.to_string(),
        train_name: "Indore Intercity SF Express".to_string(),
        departure_date: DEPARTURE_DATE.to_string(),
        source_station_code: "ADI".to_string(),
        source_station_name: "Ahmedabad Jn".to_string(),
        destination_station_code: "CNB".to_string(),
        destination_station_name: "Kanpur Central".to_string(),
        current_station_code: Some("NDLS".to_string()),
        current_station_name: Some("New Delhi".to_string()),
        current_delay_minutes: Some(35),
        status_message: Some("Running on time".to_string()),
        last_updated: Some("2026-08-02T08:20:00+05:30".to_string()),
        provider: "paytm".to_string(),
        stations: vec![MappedStation {
            station_code: "ADI".to_string(),
            station_name: "Ahmedabad Jn".to_string(),
            scheduled_arrival: Some("22:40".to_string()),
            actual_arrival: Some("22:40".to_string()),
            scheduled_departure: Some("23:00".to_string()),
            actual_departure: Some("23:00".to_string()),
            delay_minutes: Some(0),
            distance_from_source: Some(0),
            platform: Some("1".to_string()),
            halt_minutes: Some(20),
            has_departed: true,
            is_current: false,
            day: 1,
        }],
    }
}

#[tokio::test]
async fn l1_serves_repeat_requests_without_consulting_upstream() {
    let (app, mock) = {
        let mock = mock_serving_json(&happy_raw());
        let app = build_app(config(), None, mock.clone());
        (app, mock)
    };

    let (first_status, first_body) = send(&app, &status_uri()).await;
    let (second_status, second_body) = send(&app, &status_uri()).await;

    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(second_status, StatusCode::OK);
    assert_eq!(mock.requests().len(), 1, "second request must be an L1 hit");
    assert_eq!(first_body, second_body);
}

#[tokio::test]
async fn l1_caches_a_not_found_verdict() {
    let (app, mock) = {
        let mock = mock_serving_json(&not_found_raw());
        let app = build_app(config(), None, mock.clone());
        (app, mock)
    };

    let (first_status, first_body) = send(&app, &status_uri()).await;
    let (second_status, second_body) = send(&app, &status_uri()).await;

    assert_eq!(first_status, StatusCode::NOT_FOUND);
    assert_eq!(second_status, StatusCode::NOT_FOUND);
    assert_eq!(mock.requests().len(), 1, "not-found must be cached too");
    assert_eq!(first_body, second_body);
    assert_eq!(
        first_body,
        r#"{"error":"Train not found or no data available"}"#
    );
}

#[tokio::test]
async fn upstream_failures_are_never_cached() {
    let (app, mock) = {
        let mock = mock_serving_status(500);
        let app = build_app(config(), None, mock.clone());
        (app, mock)
    };

    let (first_status, first_body) = send(&app, &status_uri()).await;
    let (second_status, second_body) = send(&app, &status_uri()).await;

    assert_eq!(first_status, StatusCode::BAD_GATEWAY);
    assert_eq!(second_status, StatusCode::BAD_GATEWAY);
    assert_eq!(mock.requests().len(), 2, "failures must not be cached");
    assert_eq!(first_body, second_body);
}

#[tokio::test]
async fn l2_hit_serves_the_value_without_the_upstream() {
    let store = InMemoryStore::new();
    store.seed(REDIS_KEY, serde_json::to_vec(&mapped_fixture()).unwrap());
    let (app, mock) = {
        let mock = mock_serving_json(&happy_raw());
        let app = build_app(config(), Some(store), mock.clone());
        (app, mock)
    };

    let (status, body) = send(&app, &status_uri()).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        mock.requests().len(),
        0,
        "L2 hit must not reach the upstream"
    );
    let value: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["train_number"], TRAIN_NUMBER);
    assert_eq!(value["current_station_name"], "New Delhi");
    assert_eq!(value["status_message"], "Running on time");
}

#[tokio::test]
async fn l2_negative_marker_serves_a_404_without_the_upstream() {
    let store = InMemoryStore::new();
    store.seed(REDIS_KEY, NOT_FOUND_MARKER.as_bytes().to_vec());
    let (app, mock) = {
        let mock = mock_serving_json(&not_found_raw());
        let app = build_app(config(), Some(store), mock.clone());
        (app, mock)
    };

    let (status, body) = send(&app, &status_uri()).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        mock.requests().len(),
        0,
        "negative marker must not reach the upstream"
    );
    assert_eq!(body, r#"{"error":"Train not found or no data available"}"#);
}

#[tokio::test]
async fn upstream_success_writes_a_positive_into_l2() {
    let store = InMemoryStore::new();
    let (app, _mock) = {
        let mock = mock_serving_json(&happy_raw());
        let app = build_app(config(), Some(store.clone()), mock.clone());
        (app, mock)
    };

    let (status, _body) = send(&app, &status_uri()).await;
    assert_eq!(status, StatusCode::OK);

    let writes = store.writes();
    assert_eq!(writes.len(), 1);
    assert_eq!(writes[0].0, REDIS_KEY);
    assert_ne!(
        writes[0].1.as_slice(),
        NOT_FOUND_MARKER.as_bytes(),
        "a positive result must not store the negative marker"
    );
}

#[tokio::test]
async fn not_found_writes_a_negative_marker_into_l2() {
    let store = InMemoryStore::new();
    let (app, _mock) = {
        let mock = mock_serving_json(&not_found_raw());
        let app = build_app(config(), Some(store.clone()), mock.clone());
        (app, mock)
    };

    let (status, _body) = send(&app, &status_uri()).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let writes = store.writes();
    assert_eq!(writes.len(), 1);
    assert_eq!(writes[0].0, REDIS_KEY);
    assert_eq!(writes[0].1.as_slice(), NOT_FOUND_MARKER.as_bytes());
}

#[tokio::test]
async fn l2_unavailable_store_falls_back_to_the_upstream() {
    let store = InMemoryStore::new();
    store.set_available(false);
    let (app, mock) = {
        let mock = mock_serving_json(&happy_raw());
        let app = build_app(config(), Some(store), mock.clone());
        (app, mock)
    };

    let (status, _body) = send(&app, &status_uri()).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        mock.requests().len(),
        1,
        "an unavailable L2 must fail open to the upstream"
    );
}

#[tokio::test]
async fn l2_serves_after_the_l1_entry_expires() {
    let store = InMemoryStore::new();
    let (app, mock) = {
        let mock = mock_serving_json(&happy_raw());
        let app = build_app(config_with_tiny_l1_ttl(), Some(store), mock.clone());
        (app, mock)
    };

    let (first_status, first_body) = send(&app, &status_uri()).await;
    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(mock.requests().len(), 1);

    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    let (second_status, second_body) = send(&app, &status_uri()).await;

    assert_eq!(second_status, StatusCode::OK);
    assert_eq!(
        mock.requests().len(),
        1,
        "expired L1 must be refilled from L2"
    );
    assert_eq!(first_body, second_body);
}
