//! The run-date probe fetch, ported 1:1 from `fetchPaytmTrainStatus` in
//! `lib/paytm-client.ts` (minus the OTel span/metric leg, which is a server
//! concern). It powers the `GET /api/trains/runs` probe derivation.
//!
//! Classification mirrors the TS exactly:
//!
//! - a transport failure (timeout / abort / network / redirect limit) becomes
//!   `Network error reaching Paytm`;
//! - a non-2xx status becomes `Paytm returned status {status}` (Paytm answers
//!   200 with an `error: true` body for genuine "train not found", so an HTTP
//!   404 is still an upstream error here, exactly like the reference);
//! - an unparseable body becomes `Invalid JSON from Paytm`;
//! - a positively-confirmed `failure` result (from
//!   [`parse_paytm_response_body`](crate::parse_paytm_response_body)) becomes
//!   [`PaytmError::NotFound`], which the probe maps to "does not run that day".

use std::time::Duration;

use tt_provider_http::{HttpTransport, Request, TransportError};

use crate::parse::{parse_paytm_response_body, PaytmError, PaytmTrainStatusPayload};
use crate::provider::{paytm_status_url, PAYTM_USER_AGENT};

/// Probe request timeout — mirrors `TIMEOUT_MS = 10_000` in `paytm-client.ts`.
const TIMEOUT_MS: u64 = 10_000;

/// Fetches and validates the Paytm status payload for one probe date.
pub async fn fetch_paytm_train_status(
    transport: &dyn HttpTransport,
    train_number: &str,
    departure_date: &str,
) -> Result<PaytmTrainStatusPayload, PaytmError> {
    let request = Request::get(paytm_status_url(train_number, departure_date))
        .header("User-Agent", PAYTM_USER_AGENT)
        .header("Accept", "application/json")
        .timeout(Duration::from_millis(TIMEOUT_MS));

    let response = match transport.execute(request).await {
        Ok(response) => response,
        Err(err) => {
            return Err(match err {
                TransportError::Status { status } => {
                    PaytmError::Upstream(format!("Paytm returned status {status}"))
                }
                TransportError::Oversized { .. } => {
                    PaytmError::Upstream("Paytm response too large".to_string())
                }
                _ => PaytmError::Upstream("Network error reaching Paytm".to_string()),
            });
        }
    };

    let raw: serde_json::Value = match response.json() {
        Ok(raw) => raw,
        Err(_) => return Err(PaytmError::Upstream("Invalid JSON from Paytm".to_string())),
    };

    parse_paytm_response_body(&raw)
}
