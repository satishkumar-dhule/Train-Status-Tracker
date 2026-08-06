//! Validate + extract a typed payload from an untrusted Paytm response body,
//! ported 1:1 from `parsePaytmResponseBody` in `lib/paytm-client.ts`.
//!
//! Only a positively-confirmed `failure` result is a genuine "train not
//! found". Anything else the provider flags as errored (transient outages,
//! empty results, unknown codes) is ambiguous and must surface as an upstream
//! error — otherwise a momentary glitch gets cached as a permanent 404 marker
//! shared by all users.

use serde_json::Value;

use crate::coerce::{js_string, js_truthy};

const UNEXPECTED_SHAPE: &str = "Unexpected response shape from Paytm";
const TRAIN_NOT_FOUND: &str = "Train not found or no data available";

/// Paytm-specific parse classification. Mirrors `PaytmTrainNotFoundError` /
/// `PaytmUpstreamError` in `lib/paytm-client.ts`; the adapter maps it into
/// [`tt_provider_core::ProviderError`].
#[derive(Debug, thiserror::Error)]
pub enum PaytmError {
    /// The upstream positively confirmed the train does not exist.
    #[error("{0}")]
    NotFound(String),
    /// The upstream is unavailable or reported an ambiguous error.
    #[error("{0}")]
    Upstream(String),
}

/// The validated Paytm payload. Stations are kept **raw** (each a
/// [`Value`]); the adapters translate them via `toRow`.
#[derive(Debug, Clone)]
pub struct PaytmTrainStatusPayload {
    /// Raw `body.stations` entries, or `[]` when absent/not an array.
    pub stations: Vec<Value>,
    /// `body.current_station` when it is a string, else `None`.
    pub current_station: Option<String>,
    /// `body.train_status_message` when it is a string, else `None`.
    pub train_status_message: Option<String>,
    /// `body.server_timestamp` when it is a string, else `None`.
    pub server_timestamp: Option<String>,
}

/// Validate + extract a typed payload from an untrusted Paytm response body.
///
/// JS semantics preserved: `typeof []` is `"object"` (arrays pass the object
/// checks and fail on the later `"body"`/`"error"` key lookups), `null` is
/// falsy, and `error` only enters the failure branch when truthy.
pub fn parse_paytm_response_body(raw: &Value) -> Result<PaytmTrainStatusPayload, PaytmError> {
    // `if (!raw || typeof raw !== "object")` — `null` is falsy; strings,
    // numbers and booleans fail the `typeof` check. Arrays pass (JS `typeof []`
    // is `"object"`) and die on the `"body" in raw` check below.
    match raw {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            return Err(PaytmError::Upstream(UNEXPECTED_SHAPE.to_string()));
        }
        Value::Array(_) | Value::Object(_) => {}
    }

    // `if ("error" in raw && raw.error)` — only a truthy `error` enters the
    // block. `status = "status" in raw ? raw.status : {}`; `result` is
    // `String(status.result)` when `status` is an object with a `result` key,
    // else `""`.
    if let Some(error) = raw.get("error") {
        if js_truthy(error) {
            let result = match raw.get("status") {
                Some(status) if matches!(status, Value::Object(_) | Value::Array(_)) => {
                    status.get("result").map(js_string).unwrap_or_default()
                }
                _ => String::new(),
            };
            if result == "failure" {
                return Err(PaytmError::NotFound(TRAIN_NOT_FOUND.to_string()));
            }
            if result != "success" {
                return Err(PaytmError::Upstream(format!(
                    "Paytm reported an unsuccessful result: \"{result}\""
                )));
            }
        }
    }

    // `if (!("body" in raw) || !raw.body || typeof raw.body !== "object")`.
    let body = match raw.get("body") {
        Some(body @ (Value::Object(_) | Value::Array(_))) => body,
        _ => return Err(PaytmError::Upstream(UNEXPECTED_SHAPE.to_string())),
    };

    // `Array.isArray(body.stations) ? body.stations : []`.
    let stations = match body.get("stations") {
        Some(Value::Array(stations)) => stations.clone(),
        _ => Vec::new(),
    };

    let string_or = |key: &str| match body.get(key) {
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    };

    Ok(PaytmTrainStatusPayload {
        stations,
        current_station: string_or("current_station"),
        train_status_message: string_or("train_status_message"),
        server_timestamp: string_or("server_timestamp"),
    })
}
