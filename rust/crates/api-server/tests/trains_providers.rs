//! Integration tests for `GET /api/trains/providers`, driven through
//! `build_app_with_providers` with an injected QoS registry — ports the
//! `routes/providers-status.test.ts` cases: a fresh snapshot for every
//! enabled provider (camelCase wire keys), and recorded activity reflected
//! in the snapshot.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Method, Request};
use axum::Router;
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

use tt_api_server::build_app_with_providers;
use tt_config::Config;
use tt_provider_http::MockTransport;
use tt_qos::{QosOutcome, QosRecord, QosRegistry};

const PROVIDERS_PATH: &str = "/api/trains/providers";

fn app_with(qos: Arc<QosRegistry>) -> Router {
    let config = Config::parse(&BTreeMap::new());
    let telemetry = Arc::new(tt_telemetry::init(&config));
    build_app_with_providers(
        config,
        telemetry,
        Vec::new(),
        Arc::new(MockTransport::new()),
        qos,
    )
}

/// Sends `GET uri` and returns the status plus the raw response body.
async fn send(app: &Router, uri: &str) -> (axum::http::StatusCode, Value) {
    let request = Request::builder()
        .method(Method::GET)
        .uri(uri)
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn returns_a_qos_snapshot_for_every_enabled_provider() {
    let app = app_with(Arc::new(QosRegistry::default()));

    let (status, body) = send(&app, PROVIDERS_PATH).await;

    assert_eq!(status, axum::http::StatusCode::OK);
    let providers = body["providers"].as_array().expect("providers array");
    assert!(!providers.is_empty());

    let names: Vec<&str> = providers
        .iter()
        .map(|provider| provider["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"paytm"));
    assert!(names.contains(&"goibibo"));

    for provider in providers {
        assert_eq!(provider["requests"], 0);
        assert_eq!(provider["successes"], 0);
        assert_eq!(provider["notFound"], 0);
        assert_eq!(provider["upstreamErrors"], 0);
        assert_eq!(provider["timeouts"], 0);
        assert_eq!(provider["consecutiveFailures"], 0);
        assert_eq!(provider["status"], "ok");
        assert_eq!(provider["available"], true);
        assert!(provider["errorRate"].is_number());
        assert!(provider["avgLatencyMs"].is_number());
        assert!(provider["p95LatencyMs"].is_null());
        assert!(provider["lastSuccessAt"].is_null());
        assert!(provider["lastError"].is_null());
        assert!(provider["lastErrorAt"].is_null());
    }
}

#[tokio::test]
async fn reflects_recorded_provider_activity_in_the_snapshot() {
    let qos = Arc::new(QosRegistry::default());
    qos.record(
        "paytm",
        &QosRecord {
            outcome: QosOutcome::UpstreamError,
            latency_ms: 1200.0,
            timeout: true,
            error: None,
        },
    );
    let app = app_with(qos);

    let (status, body) = send(&app, PROVIDERS_PATH).await;

    assert_eq!(status, axum::http::StatusCode::OK);
    let paytm = body["providers"]
        .as_array()
        .expect("providers array")
        .iter()
        .find(|provider| provider["name"] == "paytm")
        .expect("paytm snapshot");
    assert_eq!(paytm["requests"], 1);
    assert_eq!(paytm["upstreamErrors"], 1);
    assert_eq!(paytm["timeouts"], 1);
    assert_eq!(paytm["consecutiveFailures"], 1);
}
