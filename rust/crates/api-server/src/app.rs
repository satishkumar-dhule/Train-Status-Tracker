//! App wiring: state, route mounting, and the middleware stack.
//!
//! Mirrors `app.ts` in the TypeScript reference server. Middleware is applied
//! with `Router::layer`, where each later call wraps the previous layer, so the
//! stack below runs outermost-first in the same order as the Express `use`s:
//! request logging, CORS, security headers, RED metrics, panic handling.

use std::sync::Arc;
use std::time::Instant;

use axum::http::{header, HeaderName, HeaderValue, Method};
use axum::middleware::{self, from_fn_with_state};
use axum::{routing, Router};
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

use tt_config::Config;
use tt_telemetry::Telemetry;

use crate::middleware::{
    metrics, panic_to_error_response, security_headers, FailureLog, RequestLog, RequestSpan,
    ResponseLog,
};
use crate::routes::{healthz, not_found, train_status};

/// Shared, cloneable state handed to handlers and middleware.
#[derive(Clone)]
pub struct AppState {
    /// Parsed environment configuration.
    pub config: Config,
    /// Telemetry handles; inert when disabled.
    pub telemetry: Arc<Telemetry>,
    /// Process start marker, used for `uptime_seconds` on `/api/healthz`.
    pub started: Instant,
    /// The train-status upstream used by `GET /api/trains/status`.
    pub status_provider: Arc<dyn tt_provider_core::TrainStatusProvider>,
}

/// Builds the fully-wired application router with the default train-status
/// provider (the Paytm adapter over the production reqwest transport).
/// Testable without binding a port.
pub fn build_app(config: Config, telemetry: Arc<Telemetry>) -> Router {
    let status_provider: Arc<dyn tt_provider_core::TrainStatusProvider> =
        Arc::new(tt_provider_paytm::create_paytm_provider(Arc::new(
            tt_provider_http::ReqwestTransport::new(),
        )));
    build_app_with_status(config, telemetry, status_provider)
}

/// Builds the fully-wired application router over an injected train-status
/// provider. Route tests substitute a `MockTransport`-backed provider here so
/// the whole HTTP surface stays hermetic.
pub fn build_app_with_status(
    config: Config,
    telemetry: Arc<Telemetry>,
    status_provider: Arc<dyn tt_provider_core::TrainStatusProvider>,
) -> Router {
    let state = AppState {
        config: config.clone(),
        telemetry,
        started: Instant::now(),
        status_provider,
    };

    Router::new()
        .route("/api/healthz", routing::get(healthz))
        .route("/api/trains/status", routing::get(train_status))
        .fallback(not_found)
        .layer(CatchPanicLayer::custom(panic_to_error_response))
        .layer(from_fn_with_state(state.clone(), metrics))
        .layer(middleware::from_fn(security_headers))
        .layer(build_cors(&config))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(RequestSpan)
                .on_request(RequestLog)
                .on_response(ResponseLog)
                .on_failure(FailureLog),
        )
        .with_state(state)
}

/// CORS policy, mirroring `buildCorsOptions` in `app.ts`: `CORS_ORIGIN` is a
/// comma-separated allowlist; when unset, every cross-origin request is allowed
/// (`*`). Credentials are never granted.
fn build_cors(config: &Config) -> CorsLayer {
    let origins: Vec<HeaderValue> = config
        .cors_origin
        .iter()
        .flatten()
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect();

    let origin = if origins.is_empty() {
        AllowOrigin::any()
    } else {
        AllowOrigin::list(origins)
    };

    let cors_headers = [
        header::CONTENT_TYPE,
        HeaderName::from_static("x-request-id"),
        HeaderName::from_static("traceparent"),
        HeaderName::from_static("tracestate"),
        HeaderName::from_static("baggage"),
    ];

    CorsLayer::new()
        .allow_origin(origin)
        .allow_methods([Method::GET])
        .allow_headers(cors_headers)
        .expose_headers([HeaderName::from_static("x-request-id")])
        .max_age(std::time::Duration::from_secs(86_400))
}
