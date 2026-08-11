//! `GET /api/trains/runs` — run-date discovery, ported from
//! `routes/train-runs.ts` including the per-IP rate limit and the L1/L2
//! caching layers.
//!
//! The rate limit runs first (as the Express middleware does), keyed by the
//! client IP, then the `train_number` shape is validated over the raw query
//! (missing and repeated params are rejected up front so arrays can never be
//! silently stringified). The probe result is served from the L1
//! `TtlCache` (single-flight); misses consult the L2 `RedisTtlCache`, then
//! probe the provider and write the L2 back. A verdict where every probe
//! failed upstream and no schedule note was seen maps to 502; the probe
//! itself never fails, mirroring the reference.

use std::convert::Infallible;
use std::net::{IpAddr, SocketAddr};

use axum::extract::{FromRequestParts, RawQuery, State};
use axum::http::{header, request::Parts, StatusCode};
use axum::response::{IntoResponse, Json};

use tt_cache::CacheResult;
use tt_contract::{is_valid_train_number, ErrorResponse};
use tt_runs::{compute_run_dates, probe_train_runs, ProbeTrainRunsOptions};
use tt_trains_data::LocalDate;

use crate::app::AppState;

pub(crate) use tt_contract::TrainRunsResponse;

const TRAIN_NUMBER_REGEX_MESSAGE: &str = "train_number: Invalid input: must match ^\\d{5}$";
const UPSTREAM_MESSAGE: &str = "Could not reach train data provider";
const INTERNAL_ERROR_MESSAGE: &str = "Internal server error";
const TOO_MANY_REQUESTS_MESSAGE: &str = "Too many requests";

/// The route label recorded on rate-limit decisions, matching the reference's
/// `createRateLimitMiddleware(..., "trains.runs")`.
const RATE_LIMIT_ROUTE: &str = "trains.runs";

/// Client identity for the rate limiter: the peer IP when the server is
/// served with `into_make_service_with_connect_info`, else `None` — the
/// mirror of `req.ip ?? "unknown"` in the reference middleware. Infallible so
/// a missing socket extension (e.g. `oneshot` tests) never rejects the
/// request.
pub(crate) struct PeerIp(Option<IpAddr>);

impl<S: Send + Sync> FromRequestParts<S> for PeerIp {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let ip = parts
            .extensions
            .get::<axum::extract::ConnectInfo<SocketAddr>>()
            .map(|connect_info| connect_info.0.ip());
        Ok(PeerIp(ip))
    }
}

pub(crate) async fn train_runs(
    State(state): State<AppState>,
    RawQuery(raw_query): RawQuery,
    PeerIp(ip): PeerIp,
) -> axum::response::Response {
    let limiter_key = ip
        .map(|addr| addr.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let decision = state.runs_limiter.check(&limiter_key);
    state.telemetry.rate_limit_metrics().record_decision(
        if decision.allowed {
            "allowed"
        } else {
            "denied"
        },
        Some(RATE_LIMIT_ROUTE),
    );
    if !decision.allowed {
        tracing::warn!(
            retry_after_ms = decision.retry_after_ms,
            "Rate limit exceeded"
        );
        let retry_after_seconds = ((decision.retry_after_ms as f64) / 1000.0).ceil() as u64;
        let mut response = (
            StatusCode::TOO_MANY_REQUESTS,
            Json(ErrorResponse {
                error: TOO_MANY_REQUESTS_MESSAGE.to_string(),
            }),
        )
            .into_response();
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("no-store"),
        );
        response.headers_mut().insert(
            header::RETRY_AFTER,
            header::HeaderValue::from_str(&retry_after_seconds.to_string())
                .expect("seconds fit a header value"),
        );
        return response;
    }

    let pairs = url::form_urlencoded::parse(raw_query.unwrap_or_default().as_bytes())
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();

    let train_number_occurrences = pairs.iter().filter(|(k, _)| k == "train_number").count();
    if train_number_occurrences != 1 {
        return validation_error(
            &state,
            StatusCode::BAD_REQUEST,
            "train_number: Required".to_string(),
        );
    }
    let train_number = pairs
        .iter()
        .find(|(k, _)| k == "train_number")
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    if !is_valid_train_number(&train_number) {
        return validation_error(
            &state,
            StatusCode::BAD_REQUEST,
            TRAIN_NUMBER_REGEX_MESSAGE.to_string(),
        );
    }

    let cache = state.runs_l1.clone();
    let l2 = state.runs_l2.clone();
    let transport = state.runs_transport.clone();
    let probe_key = train_number.clone();

    let probe = cache
        .get_or_set(&train_number, move || {
            let l2 = l2.clone();
            let transport = transport.clone();
            async move {
                if let Some(l2) = l2.as_ref() {
                    // Only a positive hit short-circuits; the "negative"
                    // marker falls through to a re-probe, as in the reference.
                    match l2.get(&probe_key).await {
                        CacheResult::Hit(value) => return Ok(value),
                        CacheResult::Negative => {}
                        CacheResult::Miss => {}
                    }
                }
                let result = probe_train_runs(
                    transport.as_ref(),
                    &probe_key,
                    &ProbeTrainRunsOptions::default(),
                )
                .await;
                if let Some(l2) = l2.as_ref() {
                    l2.set(&probe_key, &result, None).await.ok();
                }
                Ok(result)
            }
        })
        .await;

    match probe {
        Ok(result) => {
            let all_probes_failed = result.upstream_failures > 0
                && result.observed_runs.is_empty()
                && result.schedule_weekdays.as_ref().is_none_or(Vec::is_empty);
            if all_probes_failed {
                tracing::error!(
                    train_number,
                    upstream_failures = result.upstream_failures,
                    "Train run probe failed upstream"
                );
                state
                    .telemetry
                    .runs_requests_metrics()
                    .record_result("upstream_error");
                return json_error(StatusCode::BAD_GATEWAY, UPSTREAM_MESSAGE.to_string());
            }
            let runs = compute_run_dates(
                &result.weekdays,
                LocalDate::today(),
                tt_runs::RUN_WINDOW_DAYS,
            );
            state.telemetry.runs_requests_metrics().record_result("ok");
            (
                StatusCode::OK,
                Json(TrainRunsResponse { train_number, runs }),
            )
                .into_response()
        }
        Err(_) => {
            state
                .telemetry
                .runs_requests_metrics()
                .record_result("internal_error");
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                INTERNAL_ERROR_MESSAGE.to_string(),
            )
        }
    }
}

fn validation_error(
    state: &AppState,
    status: StatusCode,
    message: String,
) -> axum::response::Response {
    state
        .telemetry
        .runs_requests_metrics()
        .record_result("validation_error");
    json_error(status, message)
}

fn json_error(status: StatusCode, message: String) -> axum::response::Response {
    (status, Json(ErrorResponse { error: message })).into_response()
}
