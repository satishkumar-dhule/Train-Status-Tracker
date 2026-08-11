//! `GET /api/trains/providers` — per-provider QoS stats for train status
//! upstreams, ported from `routes/providers-status.ts`: request counts,
//! outcomes, latency (avg/p95), error rate, circuit-breaker state and the
//! last failure. The ops endpoint for watching each source independently
//! during failover; snapshots come from the shared QoS registry the
//! orchestrator records into.

use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::Json;

use tt_qos::QosSnapshot;

use crate::app::AppState;

#[derive(serde::Serialize)]
struct ProvidersStatus {
    providers: Vec<QosSnapshot>,
}

pub(crate) async fn providers_status(
    State(state): State<AppState>,
) -> impl axum::response::IntoResponse {
    let enabled = state.config.providers_enabled();
    let names: Vec<&str> = enabled.iter().map(String::as_str).collect();
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0);
    let providers = state.qos.snapshot_for(&names, now_ms);
    Json(ProvidersStatus { providers })
}
