//! Integration tests for the `/api/trains/runs` per-IP rate limit, porting
//! `routes/train-runs.ratelimit.test.ts`.
//!
//! `RUNS_RATE_LIMIT_PER_MIN` is stubbed to 3. `oneshot` requests carry no
//! `ConnectInfo` extension here, so every request shares the `"unknown"` key
//! — the same identity the reference's `req.ip ?? "unknown"` collapses to for
//! a same-client sequence.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use serde_json::json;
use tower::ServiceExt;

use tt_api_server::build_app_with_providers;
use tt_config::Config;
use tt_provider_http::{HttpTransport, Request as ProbeRequest, Response, TransportError};
use tt_qos::QosRegistry;

const TRAIN_NUMBER: &str = "12345";

/// Not-found for every probe; the limiter keys on the client IP, so the
/// probe verdict is irrelevant to the assertions.
struct NotFoundStub;

#[async_trait::async_trait]
impl HttpTransport for NotFoundStub {
    async fn execute(&self, _request: ProbeRequest) -> Result<Response, TransportError> {
        Ok(Response::new(
            200,
            serde_json::to_vec(&json!({
                "error": true,
                "status": { "result": "failure" },
            }))
            .expect("json is valid"),
        ))
    }
}

/// `RUNS_RATE_LIMIT_PER_MIN: 3` — the reference suite's stub env.
fn config() -> Config {
    Config::parse(&BTreeMap::from([(
        "RUNS_RATE_LIMIT_PER_MIN".to_string(),
        "3".to_string(),
    )]))
}

fn app() -> Router {
    let config = config();
    let telemetry = Arc::new(tt_telemetry::init(&config));
    let transport: Arc<dyn HttpTransport> = Arc::new(NotFoundStub);
    let qos = Arc::new(QosRegistry::default());
    build_app_with_providers(config, telemetry, Vec::new(), transport, qos)
}

/// Sends `GET /api/trains/runs?train_number=12345`.
async fn send(app: &Router) -> (StatusCode, String, axum::http::HeaderMap) {
    let request = Request::builder()
        .method(Method::GET)
        .uri(format!("/api/trains/runs?train_number={TRAIN_NUMBER}"))
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, String::from_utf8(bytes.to_vec()).unwrap(), headers)
}

#[tokio::test]
async fn allows_requests_up_to_the_per_ip_limit() {
    let app = app();
    for _ in 0..3 {
        let (status, _, _) = send(&app).await;
        assert_eq!(status, StatusCode::OK);
    }
}

#[tokio::test]
async fn returns_429_with_retry_after_and_no_store_beyond_the_limit() {
    let app = app();
    for _ in 0..3 {
        send(&app).await;
    }

    let (status, body, headers) = send(&app).await;

    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        headers.get("retry-after").map(|v| v.to_str().unwrap()),
        Some("60")
    );
    assert_eq!(
        headers.get("cache-control").map(|v| v.to_str().unwrap()),
        Some("no-store")
    );
    let body: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
    assert_eq!(body, json!({ "error": "Too many requests" }));
}
