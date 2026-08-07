//! Middleware: request logging, security headers, RED metrics, panic handling.
//!
//! Ports of `app.ts`: `pino-http` (request logging), the hard-coded security
//! headers, the app-level RED-metrics middleware, and the terminal error
//! handler.

use std::any::Any;
use std::time::Duration;

use axum::body::Body;
use axum::extract::{MatchedPath, Request, State};
use axum::http::header;
use axum::http::{HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use tower_http::classify::ServerErrorsFailureClass;
use tower_http::trace::{MakeSpan, OnFailure, OnRequest, OnResponse};
use tracing::Span;

use tt_contract::ErrorResponse;

use crate::app::AppState;

/// Per-request span: method plus the matched route pattern (or the raw path
/// for unmatched requests, e.g. 404s).
#[derive(Clone)]
pub(crate) struct RequestSpan;

impl<B> MakeSpan<B> for RequestSpan {
    fn make_span(&mut self, request: &http::Request<B>) -> Span {
        let method = request.method().to_string();
        let path = matched_path(request).unwrap_or_else(|| request.uri().path().to_string());
        tracing::info_span!(
            "http.request",
            method = %method,
            path = %path,
            status = tracing::field::Empty,
            latency_ms = tracing::field::Empty,
            providers_consulted = tracing::field::Empty,
        )
    }
}

/// Logs a `request started` event for every request.
#[derive(Clone)]
pub(crate) struct RequestLog;

impl<B> OnRequest<B> for RequestLog {
    fn on_request(&mut self, _request: &http::Request<B>, span: &Span) {
        tracing::info!(parent: span, "request started");
    }
}

/// Logs `request completed` with status and latency, recording both onto the
/// span so the closing span record carries them too.
#[derive(Clone)]
pub(crate) struct ResponseLog;

impl<B> OnResponse<B> for ResponseLog {
    fn on_response(self, response: &http::Response<B>, latency: Duration, span: &Span) {
        let status = response.status().as_u16();
        let latency_ms = latency.as_secs_f64() * 1000.0;
        span.record("status", u64::from(status));
        span.record("latency_ms", latency_ms);
        tracing::info!(
            parent: span,
            status,
            latency_ms,
            "request completed"
        );
    }
}

/// Logs `request errored` when the inner service fails (never for axum routes,
/// whose errors are `Infallible`).
#[derive(Clone)]
pub(crate) struct FailureLog;

impl OnFailure<ServerErrorsFailureClass> for FailureLog {
    fn on_failure(&mut self, failure: ServerErrorsFailureClass, latency: Duration, span: &Span) {
        let latency_ms = latency.as_secs_f64() * 1000.0;
        span.record("latency_ms", latency_ms);
        tracing::error!(
            parent: span,
            latency_ms,
            failure = %failure,
            "request errored"
        );
    }
}

/// The hard-coded security headers from `app.ts`.
pub(crate) async fn security_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::STRICT_TRANSPORT_SECURITY,
        HeaderValue::from_static("max-age=63072000"),
    );
    response
}

/// App-level RED metrics, mirroring the `observeRequestCompletion` middleware:
/// request duration by route (resolved from the matched path, `unmatched` for
/// fallback/404 paths) plus the method and status code.
pub(crate) async fn metrics(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let start = std::time::Instant::now();
    let method = request.method().to_string();
    let route = matched_path(&request).unwrap_or_else(|| "unmatched".to_string());
    let response = next.run(request).await;
    let status = response.status().as_u16();
    let latency_ms = start.elapsed().as_secs_f64() * 1000.0;
    state
        .telemetry
        .http_metrics()
        .record(status, latency_ms, &method, &route);
    response
}

/// Terminal error handler: a panicked handler becomes a `500` with the spec
/// error shape (`{ "error": string }`) and `Cache-Control: no-store`, mirroring
/// `app.ts`'s `errorMessage(500) === "Internal server error"`.
pub(crate) fn panic_to_error_response(_err: Box<dyn Any + Send + 'static>) -> Response<Body> {
    tracing::error!("panic caught in request handler");
    let body = serde_json::to_vec(&ErrorResponse {
        error: "Internal server error".to_string(),
    })
    .expect("serializing ErrorResponse cannot fail");
    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(body))
        .expect("building the panic response cannot fail")
}

/// The matched route pattern, set by the router before layered middleware runs.
fn matched_path<B>(request: &http::Request<B>) -> Option<String> {
    request
        .extensions()
        .get::<MatchedPath>()
        .map(|path| path.as_str().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;

    #[tokio::test]
    async fn panic_becomes_json_500_with_no_store() {
        let response = panic_to_error_response(Box::new("boom"));

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json"
        );
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );

        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(bytes.as_ref(), br#"{"error":"Internal server error"}"#);
    }
}
