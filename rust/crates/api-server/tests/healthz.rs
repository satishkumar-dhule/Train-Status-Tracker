//! Integration tests for the `tt-api-server` HTTP surface, driven through
//! `build_app` via `tower::ServiceExt::oneshot` (no port binding).
//!
//! The assertions mirror the TypeScript `app.test.ts` expectations and the
//! byte layout captured from the reference server's `/api/healthz`.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::body::Body;
use axum::http::header;
use axum::http::{HeaderMap, Method, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

use tt_api_server::build_app;
use tt_config::Config;
use tt_contract::{HealthStatus, HealthStatusRedis};

/// Byte-exact `/api/healthz` payload captured from the TypeScript reference
/// server's `routes/health.ts` shape (fixed uptime + timestamp).
const GOLDEN_HEALTH: &str = r#"{"status":"ok","redis":"disabled","uptime_seconds":12,"version":null,"timestamp":"2026-08-06T10:35:00.000Z"}"#;

fn config(env: &[(&str, &str)]) -> Config {
    let mut map = BTreeMap::new();
    for (key, value) in env {
        map.insert(key.to_string(), value.to_string());
    }
    Config::parse(&map)
}

fn app(env: &[(&str, &str)]) -> Router {
    let config = config(env);
    let telemetry = Arc::new(tt_telemetry::init(&config));
    build_app(config, telemetry)
}

/// Sends `method uri` with the given `Origin` header (when `Some`) and returns
/// the response.
async fn send(
    app: &Router,
    method: Method,
    uri: &str,
    origin: Option<&str>,
) -> (StatusCode, HeaderMap, String) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(origin) = origin {
        builder = builder.header("Origin", origin);
    }
    let request = builder.body(Body::empty()).unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = String::from_utf8(bytes.to_vec()).unwrap();
    (status, headers, body)
}

#[tokio::test]
async fn healthz_returns_ok_payload_with_no_store() {
    let app = app(&[]);
    let (status, headers, body) = send(&app, Method::GET, "/api/healthz", None).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers.get(header::CACHE_CONTROL).unwrap(), "no-store");

    let value: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["status"], "ok");
    assert_eq!(value["redis"], "disabled");
    assert!(value["uptime_seconds"].is_i64());
    assert!(value["uptime_seconds"].as_i64().unwrap() >= 0);
    assert_eq!(value["version"], Value::Null);
    assert!(chrono::DateTime::parse_from_rfc3339(value["timestamp"].as_str().unwrap()).is_ok());
}

#[tokio::test]
async fn healthz_body_matches_ts_key_order() {
    let app = app(&[]);
    let (_status, _headers, body) = send(&app, Method::GET, "/api/healthz", None).await;

    // Static fields come first, in the exact order of `routes/health.ts` /
    // the OpenAPI `HealthStatus` schema; only uptime_seconds + timestamp vary.
    let prefix = r#"{"status":"ok","redis":"disabled","uptime_seconds":"#;
    assert!(
        body.starts_with(prefix),
        "healthz body did not start with the TS shape: {body}"
    );

    let rest = &body[prefix.len()..];
    let (uptime, rest) = rest.split_once(',').expect("uptime_seconds present");
    assert!(
        uptime.chars().all(|c| c.is_ascii_digit()),
        "uptime_seconds must be a bare integer, got {uptime}"
    );

    let rest = rest
        .strip_prefix(r##""version":null,"timestamp":""##)
        .expect("version null then timestamp follow");
    let timestamp = rest.strip_suffix(r#""}"#).expect("closing quote-brace");
    assert!(
        timestamp.ends_with('Z') && chrono::DateTime::parse_from_rfc3339(timestamp).is_ok(),
        "timestamp not a Z-suffixed ISO-8601 value: {timestamp}"
    );
}

#[test]
fn healthz_golden_fixture_matches_literal() {
    let timestamp = chrono::DateTime::parse_from_rfc3339("2026-08-06T10:35:00.000Z")
        .unwrap()
        .with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    assert_eq!(timestamp, "2026-08-06T10:35:00.000Z");

    let health = HealthStatus {
        status: "ok".to_string(),
        redis: Some(HealthStatusRedis::Disabled),
        uptime_seconds: Some(12),
        version: None,
        timestamp: Some(timestamp),
    };

    let serialized = serde_json::to_string(&health).unwrap();
    assert_eq!(serialized, GOLDEN_HEALTH);
}

#[tokio::test]
async fn healthz_reports_service_version_from_env() {
    let app = app(&[("SERVICE_VERSION", "1.2.3")]);
    let (status, _headers, body) = send(&app, Method::GET, "/api/healthz", None).await;

    assert_eq!(status, StatusCode::OK);
    let value: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(value["version"], "1.2.3");
}

#[tokio::test]
async fn unknown_route_returns_ts_not_found_shape() {
    let app = app(&[]);
    let (status, headers, body) = send(&app, Method::GET, "/api/nope", None).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(headers.get(header::CACHE_CONTROL).unwrap(), "no-store");
    assert_eq!(body, r#"{"error":"Not found"}"#);
}

#[tokio::test]
async fn security_headers_present_on_data_responses() {
    let app = app(&[]);
    let (_status, headers, _body) = send(&app, Method::GET, "/api/healthz", None).await;

    assert_eq!(
        headers.get(header::X_CONTENT_TYPE_OPTIONS).unwrap(),
        "nosniff"
    );
    assert_eq!(headers.get(header::X_FRAME_OPTIONS).unwrap(), "DENY");
    assert_eq!(headers.get(header::REFERRER_POLICY).unwrap(), "no-referrer");
    assert_eq!(
        headers.get(header::STRICT_TRANSPORT_SECURITY).unwrap(),
        "max-age=63072000"
    );
}

#[tokio::test]
async fn security_headers_present_on_error_responses() {
    let app = app(&[]);
    let (_status, headers, _body) = send(&app, Method::GET, "/api/nope", None).await;

    assert_eq!(
        headers.get(header::X_CONTENT_TYPE_OPTIONS).unwrap(),
        "nosniff"
    );
    assert_eq!(headers.get(header::X_FRAME_OPTIONS).unwrap(), "DENY");
    assert_eq!(headers.get(header::REFERRER_POLICY).unwrap(), "no-referrer");
    assert_eq!(
        headers.get(header::STRICT_TRANSPORT_SECURITY).unwrap(),
        "max-age=63072000"
    );
}

#[tokio::test]
async fn cors_reflects_an_allowed_origin() {
    let app = app(&[("CORS_ORIGIN", "https://app.example.com")]);
    let (status, headers, _body) = send(
        &app,
        Method::GET,
        "/api/healthz",
        Some("https://app.example.com"),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers.get("access-control-allow-origin").unwrap(),
        "https://app.example.com"
    );
}

#[tokio::test]
async fn cors_omits_header_for_a_disallowed_origin() {
    let app = app(&[("CORS_ORIGIN", "https://app.example.com")]);
    let (status, headers, _body) = send(
        &app,
        Method::GET,
        "/api/healthz",
        Some("https://evil.example.net"),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(headers.get("access-control-allow-origin").is_none());
}

#[tokio::test]
async fn cors_allows_any_origin_when_unset() {
    let app = app(&[]);
    let (_status, headers, _body) = send(
        &app,
        Method::GET,
        "/api/healthz",
        Some("http://localhost:5173"),
    )
    .await;

    assert_eq!(headers.get("access-control-allow-origin").unwrap(), "*");
}

#[tokio::test]
async fn cors_never_grants_credentials() {
    let app = app(&[("CORS_ORIGIN", "https://app.example.com")]);
    let (_status, headers, _body) = send(
        &app,
        Method::GET,
        "/api/healthz",
        Some("https://app.example.com"),
    )
    .await;

    assert_eq!(
        headers.get("access-control-allow-origin").unwrap(),
        "https://app.example.com"
    );
    assert!(headers.get("access-control-allow-credentials").is_none());
}

#[tokio::test]
async fn cors_preflight_allows_get_from_allowed_origin() {
    let app = app(&[("CORS_ORIGIN", "https://app.example.com")]);
    let (status, headers, _body) = send(
        &app,
        Method::OPTIONS,
        "/api/healthz",
        Some("https://app.example.com"),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers.get("access-control-allow-methods").unwrap(), "GET");
    assert_eq!(
        headers.get("access-control-allow-origin").unwrap(),
        "https://app.example.com"
    );
}

#[test]
fn config_without_cors_origin_reports_none() {
    assert_eq!(config(&[]).cors_origin, None);
    assert_eq!(
        config(&[("CORS_ORIGIN", "https://a.example, https://b.example")]).cors_origin,
        Some(vec![
            "https://a.example".to_string(),
            "https://b.example".to_string()
        ])
    );
}
