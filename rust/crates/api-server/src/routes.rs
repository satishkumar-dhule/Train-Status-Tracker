//! Route handlers.
//!
//! `healthz` mirrors `routes/health.ts`, `not_found` mirrors the catch-all
//! `app.use((_req, res) => ... 404)` in `app.ts`.

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Json};
use chrono::{SecondsFormat, Utc};

use tt_contract::{ErrorResponse, HealthStatus, HealthStatusRedis};

use crate::app::AppState;

/// `GET /api/healthz` — process liveness plus per-dependency checks.
pub(crate) async fn healthz(State(state): State<AppState>) -> impl IntoResponse {
    let health = HealthStatus {
        status: "ok".to_string(),
        // TODO(Slice 12): report real Redis reachability instead of `disabled`.
        redis: Some(HealthStatusRedis::Disabled),
        uptime_seconds: Some(state.started.elapsed().as_secs() as i64),
        version: state.config.service_version.clone(),
        timestamp: Some(Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)),
    };
    ([(header::CACHE_CONTROL, "no-store")], Json(health))
}

/// Catch-all: unmatched paths become a `{ "error": "Not found" }` 404, matching
/// the TypeScript server's response body and `Cache-Control: no-store`.
pub(crate) async fn not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        [(header::CACHE_CONTROL, "no-store")],
        Json(ErrorResponse {
            error: "Not found".to_string(),
        }),
    )
}
