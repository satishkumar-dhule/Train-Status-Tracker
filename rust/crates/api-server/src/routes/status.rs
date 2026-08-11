//! `GET /api/trains/status` — running-status lookup, ported from
//! `routes/trains.ts` including the caching layer.
//!
//! Query validation mirrors the reference exactly: missing and repeated params
//! are rejected up front over the raw query (so arrays can never be silently
//! stringified), then the shape regexes, then the real-calendar gate, and only
//! then is the cache consulted. The L1 `TtlCache` (single-flight) producer
//! reads the L2 `RedisTtlCache` first, then the upstream; positives and
//! not-founds are written back (L2 negative markers carry their own TTL),
//! failures travel through [`CacheError`] uncached so the next call retries.
//! Validation failures and upstream verdicts map to the same status codes and
//! bodies as the TypeScript server (404 only when every consulted provider
//! agrees not-found; 502 when all upstreams fail).

use axum::extract::{RawQuery, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};

use tt_cache::{CacheError, CacheResult};
use tt_contract::{is_valid_departure_date, is_valid_train_number, ErrorResponse};
use tt_mapper::{KnownTrain, MappedStatus};
use tt_orchestrator::{fetch_status_with_failover, FailoverOptions};
use tt_provider_core::ProviderError;
use tt_trains_data::{find_train_by_number, is_valid_api_date, TRAINS};

use crate::app::AppState;

/// `zod`-schema shape keys, in declaration order (first issue wins).
const SHAPE_KEYS: [&str; 2] = ["train_number", "departure_date"];

const TRAIN_NUMBER_REGEX_MESSAGE: &str = "train_number: Invalid input: must match ^\\d{5}$";
const DEPARTURE_DATE_REGEX_MESSAGE: &str = "departure_date: Invalid input: must match ^\\d{8}$";
const INVALID_CALENDAR_DATE_MESSAGE: &str =
    "departure_date must be a valid date in YYYYMMDD format";
const NOT_FOUND_MESSAGE: &str = "Train not found or no data available";
const UPSTREAM_MESSAGE: &str = "Could not reach train data provider";
const INTERNAL_ERROR_MESSAGE: &str = "Internal server error";

/// The `provider` param enum from the OpenAPI schema (`GetTrainStatusQueryParams`):
/// every known upstream name, whether or not it is enabled in this deployment.
const KNOWN_PROVIDERS: [&str; 6] = [
    "paytm",
    "goibibo",
    "railyatri",
    "whereismytrain",
    "easemytrip",
    "railradar",
];

/// The error-carried classification of a failed cache lookup. The L1 caches
/// values only; failures travel through [`CacheError::message`] so
/// single-flight waiters all see the same verdict.
const UPSTREAM_CACHE_ERROR: &str = "upstream-provider-error";
const PROGRAM_CACHE_ERROR: &str = "internal-provider-error";

/// What the cache holds for a `train_number:departure_date` lookup.
#[derive(Debug, Clone)]
pub enum CachedStatus {
    /// A mapped, positive status (shared with L2; serde_json round-trips).
    /// Boxed so the enum's variants stay small — the L1 stores it as-is.
    Value(Box<MappedStatus>),
    /// A cached "no data" verdict (L2's negative marker; L1 serves it too).
    NotFound,
}

pub(crate) async fn train_status(
    State(state): State<AppState>,
    RawQuery(raw_query): RawQuery,
) -> axum::response::Response {
    // Keep the raw query as pairs so repeated params survive form-decoding
    // (Express 5 arrays), exactly like `req.query` in the reference.
    let pairs = url::form_urlencoded::parse(raw_query.unwrap_or_default().as_bytes())
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();

    for key in SHAPE_KEYS {
        let occurrences = pairs.iter().filter(|(k, _)| k == key).count();
        if occurrences == 0 {
            return json_error(StatusCode::BAD_REQUEST, format!("{key}: Required"));
        }
        if occurrences > 1 {
            return json_error(
                StatusCode::BAD_REQUEST,
                format!("{key}: expected string, received array"),
            );
        }
    }

    // `provider` is optional, so only a repeated param is rejected here (the
    // TS pushes an `invalid_type`/array issue for it ahead of `safeParse`).
    let provider_occurrences = pairs.iter().filter(|(k, _)| k == "provider").count();
    if provider_occurrences > 1 {
        return json_error(
            StatusCode::BAD_REQUEST,
            "provider: expected string, received array".to_string(),
        );
    }

    let value = |key: &str| {
        pairs
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    };
    let train_number = value("train_number");
    let departure_date = value("departure_date");
    let provider = value("provider");

    if !is_valid_train_number(&train_number) {
        return json_error(
            StatusCode::BAD_REQUEST,
            TRAIN_NUMBER_REGEX_MESSAGE.to_string(),
        );
    }
    if !is_valid_departure_date(&departure_date) {
        return json_error(
            StatusCode::BAD_REQUEST,
            DEPARTURE_DATE_REGEX_MESSAGE.to_string(),
        );
    }

    // The `provider` enum is validated by `safeParse` in the TS, before the
    // real-calendar gate; replicate its message byte-for-byte.
    let provider = if provider.is_empty() {
        None
    } else if KNOWN_PROVIDERS.contains(&provider.as_str()) {
        Some(provider)
    } else {
        let expected = KNOWN_PROVIDERS
            .iter()
            .map(|name| format!("'{name}'"))
            .collect::<Vec<_>>()
            .join(" | ");
        return json_error(
            StatusCode::BAD_REQUEST,
            format!("provider: Invalid enum value. Expected {expected}, received '{provider}'"),
        );
    };

    if !is_valid_api_date(&departure_date) {
        return json_error(
            StatusCode::BAD_REQUEST,
            INVALID_CALENDAR_DATE_MESSAGE.to_string(),
        );
    }

    // A pinned provider must be one that is enabled in this deployment; the
    // enum above only covers the known upstream names.
    if let Some(provider) = &provider {
        let enabled = state.config.providers_enabled();
        if !enabled.iter().any(|name| name == provider) {
            return json_error(
                StatusCode::BAD_REQUEST,
                format!("provider must be one of: {}", enabled.join(", ")),
            );
        }
    }

    let known_train = find_train_by_number(&TRAINS, &train_number).map(|train| KnownTrain {
        number: train.number.clone(),
        name: train.name.clone(),
    });

    // Pinned lookups are cached separately so a provider-specific result can
    // never be served for the auto (failover) query or vice versa.
    let cache_key = match &provider {
        Some(provider) => format!("{provider}:{train_number}:{departure_date}"),
        None => format!("{train_number}:{departure_date}"),
    };
    let producer_key = cache_key.clone();
    let cache = state.status_l1.clone();
    let l2 = state.status_l2.clone();
    let providers = state.status_providers.clone();
    let qos = state.qos.clone();
    let telemetry = state.telemetry.clone();

    let outcome = cache
        .get_or_set(&cache_key, move || {
            let providers = providers.clone();
            let l2 = l2.clone();
            async move {
                if let Some(l2) = l2.as_ref() {
                    match l2.get(&producer_key).await {
                        CacheResult::Hit(mapped) => {
                            return Ok(CachedStatus::Value(Box::new(mapped)))
                        }
                        CacheResult::Negative => return Ok(CachedStatus::NotFound),
                        CacheResult::Miss => {}
                    }
                }
                let options = FailoverOptions {
                    known_train,
                    qos: Some(qos),
                    telemetry: Some(telemetry),
                    pinned_provider: provider.clone(),
                    ..FailoverOptions::default()
                };
                match fetch_status_with_failover(
                    &providers,
                    &train_number,
                    &departure_date,
                    &options,
                )
                .await
                {
                    Ok(mapped) => {
                        if let Some(l2) = l2.as_ref() {
                            l2.set(&producer_key, &mapped, None).await.ok();
                        }
                        Ok(CachedStatus::Value(Box::new(mapped)))
                    }
                    Err(ProviderError::NotFound { .. }) => {
                        if let Some(l2) = l2.as_ref() {
                            l2.set_negative(&producer_key, None).await;
                        }
                        Ok(CachedStatus::NotFound)
                    }
                    Err(ProviderError::Upstream { .. }) => Err(CacheError {
                        message: UPSTREAM_CACHE_ERROR.to_string(),
                    }),
                    Err(ProviderError::Program(_)) => Err(CacheError {
                        message: PROGRAM_CACHE_ERROR.to_string(),
                    }),
                }
            }
        })
        .await;

    match outcome {
        Ok(CachedStatus::Value(mapped)) => {
            (StatusCode::OK, Json(tt_mapper::to_wire_status(&mapped))).into_response()
        }
        Ok(CachedStatus::NotFound) => {
            json_error(StatusCode::NOT_FOUND, NOT_FOUND_MESSAGE.to_string())
        }
        Err(err) if err.message == UPSTREAM_CACHE_ERROR => {
            json_error(StatusCode::BAD_GATEWAY, UPSTREAM_MESSAGE.to_string())
        }
        Err(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            INTERNAL_ERROR_MESSAGE.to_string(),
        ),
    }
}

fn json_error(status: StatusCode, message: String) -> axum::response::Response {
    (status, Json(ErrorResponse { error: message })).into_response()
}
