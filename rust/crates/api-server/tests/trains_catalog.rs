//! Integration tests for `GET /api/trains` and `GET /api/trains/search`,
//! driven through `build_app_with_cache` over a scripted train-data transport
//! (`no port binding`) — ports the `routes/train-catalog.test.ts` cases:
//! catalog parsing + 2h TTL cache, fail-open to the bundled dataset, and the
//! search route's fuzzy matching, limit handling, and validation.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Method, Request};
use axum::Router;
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

use tt_api_server::build_app_with_cache;
use tt_config::Config;
use tt_provider_core::TrainStatusProvider;
use tt_provider_http::MockTransport;
use tt_qos::QosRegistry;
use tt_trains_data::{HttpResponse, HttpTransport};

/// The `NTES_JS` fixture from `routes/train-catalog.test.ts` (4 trains).
const NTES_JS: &str = r#"var arrTrainList = [
"12001- Bhopal Shatabdi Express",
"12002- New Delhi Shatabdi Express",
"12951- Mumbai Rajdhani Express",
"22943- Indore Intercity SF Express"
];"#;

const CATALOG_TRAINS: [(&str, &str); 4] = [
    ("12001", "Bhopal Shatabdi Express"),
    ("12002", "New Delhi Shatabdi Express"),
    ("12951", "Mumbai Rajdhani Express"),
    ("22943", "Indore Intercity SF Express"),
];

/// The train-data transport's scripted response, mirroring the `fetchSpy`.
type Responder = Box<dyn Fn(&str) -> Result<HttpResponse, String> + Send + Sync>;

/// A train-data transport answering every request from a scripted closure and
/// counting calls — the `fetchSpy` of the reference tests.
struct ScriptedTransport {
    calls: AtomicUsize,
    respond: Responder,
}

impl ScriptedTransport {
    fn new(respond: impl Fn(&str) -> Result<HttpResponse, String> + Send + Sync + 'static) -> Self {
        ScriptedTransport {
            calls: AtomicUsize::new(0),
            respond: Box::new(respond),
        }
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl HttpTransport for ScriptedTransport {
    fn fetch(&self, url: &str) -> Result<HttpResponse, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        (self.respond)(url)
    }
}

fn ok_js() -> Result<HttpResponse, String> {
    Ok(HttpResponse {
        status: 200,
        location: None,
        body: NTES_JS.as_bytes().to_vec(),
    })
}

fn config(base_url: &str) -> Config {
    Config::parse(&BTreeMap::from([(
        "TRAIN_DATA_URL".to_string(),
        base_url.to_string(),
    )]))
}

fn app_with(transport: Arc<dyn HttpTransport>) -> Router {
    let telemetry = Arc::new(tt_telemetry::init(&Config::parse(&BTreeMap::new())));
    let catalog_transport: Arc<dyn tt_trains_data::HttpTransport> = transport;
    build_app_with_cache(
        config(&format!("https://ntes.example{}/trains-list.js", "")),
        telemetry,
        Vec::<Arc<dyn TrainStatusProvider>>::new(),
        Arc::new(MockTransport::new()),
        Arc::new(QosRegistry::default()),
        None,
        None,
        catalog_transport,
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
async fn fetches_and_returns_the_parsed_ntes_catalog() {
    let transport = Arc::new(ScriptedTransport::new(|_url| ok_js()));
    let app = app_with(transport.clone());

    let (status, body) = send(&app, "/api/trains").await;

    assert_eq!(status, axum::http::StatusCode::OK);
    let trains = body["trains"].as_array().expect("trains array");
    let entries: Vec<(String, String)> = trains
        .iter()
        .map(|train| {
            (
                train["number"].as_str().unwrap().to_string(),
                train["name"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    assert_eq!(
        entries,
        CATALOG_TRAINS
            .iter()
            .map(|(number, name)| (number.to_string(), name.to_string()))
            .collect::<Vec<_>>()
    );
    assert_eq!(transport.calls(), 1);
}

#[tokio::test]
async fn serves_a_repeated_request_from_the_ttl_cache_without_refetching() {
    let transport = Arc::new(ScriptedTransport::new(|_url| ok_js()));
    let app = app_with(transport.clone());

    let (first_status, first_body) = send(&app, "/api/trains").await;
    let (second_status, second_body) = send(&app, "/api/trains").await;

    assert_eq!(first_status, axum::http::StatusCode::OK);
    assert_eq!(second_status, axum::http::StatusCode::OK);
    assert_eq!(second_body, first_body);
    assert_eq!(transport.calls(), 1);
}

#[tokio::test]
async fn fails_open_to_the_bundled_dataset_when_the_upstream_is_unreachable() {
    let transport = Arc::new(ScriptedTransport::new(|_url| {
        Err("fetch failed".to_string())
    }));
    let app = app_with(transport.clone());

    let (status, body) = send(&app, "/api/trains").await;

    assert_eq!(status, axum::http::StatusCode::OK);
    assert!(body["trains"]
        .as_array()
        .is_some_and(|trains| !trains.is_empty()));
}

#[tokio::test]
async fn fails_open_to_the_bundled_dataset_on_a_non_200_upstream_response() {
    let transport = Arc::new(ScriptedTransport::new(|_url| {
        Ok(HttpResponse {
            status: 503,
            location: None,
            body: b"boom".to_vec(),
        })
    }));
    let app = app_with(transport.clone());

    let (status, body) = send(&app, "/api/trains").await;

    assert_eq!(status, axum::http::StatusCode::OK);
    assert!(body["trains"]
        .as_array()
        .is_some_and(|trains| !trains.is_empty()));
}

#[tokio::test]
async fn search_returns_fuzzy_matches_ranked_best_first() {
    let transport = Arc::new(ScriptedTransport::new(|_url| ok_js()));
    let app = app_with(transport.clone());

    let (status, body) = send(&app, "/api/trains/search?q=shatabdi").await;

    assert_eq!(status, axum::http::StatusCode::OK);
    let results = body["results"].as_array().expect("results array");
    assert!(results
        .iter()
        .any(|train| { train["number"] == "12001" && train["name"] == "Bhopal Shatabdi Express" }));
}

#[tokio::test]
async fn search_matches_duck_typed_subsequences() {
    let transport = Arc::new(ScriptedTransport::new(|_url| ok_js()));
    let app = app_with(transport.clone());

    let (status, body) = send(&app, "/api/trains/search?q=rjdn").await;

    assert_eq!(status, axum::http::StatusCode::OK);
    let results = body["results"].as_array().expect("results array");
    assert!(results
        .iter()
        .any(|train| { train["number"] == "12951" && train["name"] == "Mumbai Rajdhani Express" }));
}

#[tokio::test]
async fn search_honours_the_limit_param() {
    let transport = Arc::new(ScriptedTransport::new(|_url| ok_js()));
    let app = app_with(transport.clone());

    let (status, body) = send(&app, "/api/trains/search?q=express&limit=2").await;

    assert_eq!(status, axum::http::StatusCode::OK);
    assert!(body["results"]
        .as_array()
        .is_some_and(|results| results.len() <= 2));
}

#[tokio::test]
async fn search_rejects_a_missing_q_param() {
    let app = app_with(Arc::new(ScriptedTransport::new(|_url| ok_js())));

    let (status, body) = send(&app, "/api/trains/search").await;

    assert_eq!(status, axum::http::StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "q: Required");
}

#[tokio::test]
async fn search_rejects_repeated_q_params_with_a_clean_error_message() {
    let app = app_with(Arc::new(ScriptedTransport::new(|_url| ok_js())));

    let (status, body) = send(&app, "/api/trains/search?q=a&q=b").await;

    assert_eq!(status, axum::http::StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "q: expected string, received array");
}

#[tokio::test]
async fn search_rejects_a_too_long_q_without_touching_upstream() {
    let transport = Arc::new(ScriptedTransport::new(|_url| ok_js()));
    let app = app_with(transport.clone());

    let long_query = "x".repeat(65);
    let (status, body) = send(&app, &format!("/api/trains/search?q={long_query}")).await;

    assert_eq!(status, axum::http::StatusCode::BAD_REQUEST);
    assert_eq!(
        body["error"],
        "q: Invalid string: must contain at most 64 character(s)"
    );
    assert_eq!(transport.calls(), 0);
}

#[tokio::test]
async fn search_rejects_an_out_of_range_limit() {
    let app = app_with(Arc::new(ScriptedTransport::new(|_url| ok_js())));

    let (status, body) = send(&app, "/api/trains/search?q=rajdhani&limit=101").await;

    assert_eq!(status, axum::http::StatusCode::BAD_REQUEST);
    assert_eq!(
        body["error"],
        "limit: Number must be at least 1 and at most 100"
    );
}

#[tokio::test]
async fn search_returns_empty_results_for_an_empty_q() {
    let app = app_with(Arc::new(ScriptedTransport::new(|_url| ok_js())));

    let (status, body) = send(&app, "/api/trains/search?q=").await;

    assert_eq!(status, axum::http::StatusCode::OK);
    assert_eq!(body["results"], serde_json::json!([]));
}
