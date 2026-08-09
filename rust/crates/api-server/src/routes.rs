//! Route handlers.
//!
//! `healthz` mirrors `routes/health.ts` (reporting the Redis health
//! controller's `up`/`down`/`disabled` state), `not_found` mirrors the
//! catch-all `app.use((_req, res) => ... 404)` in `app.ts`, and
//! [`train_status`] (in the private [`status`] submodule) mirrors
//! `routes/trains.ts`.

mod status;

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Json};
use chrono::{SecondsFormat, Utc};

use tt_contract::{ErrorResponse, HealthStatus, HealthStatusRedis};

use crate::app::AppState;

pub(crate) use status::{train_status, CachedStatus};

/// `GET /api/healthz` — process liveness plus per-dependency checks. The
/// `redis` field is `disabled` without a Redis client (mirroring
/// `getRedisHealthState` when no store was ever created), else `up`/`down`
/// from the shared health controller.
pub(crate) async fn healthz(State(state): State<AppState>) -> impl IntoResponse {
    let redis = match &state.redis_health {
        Some(health) if health.is_healthy() => HealthStatusRedis::Up,
        Some(_) => HealthStatusRedis::Down,
        None => HealthStatusRedis::Disabled,
    };
    let health = HealthStatus {
        status: "ok".to_string(),
        redis: Some(redis),
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
