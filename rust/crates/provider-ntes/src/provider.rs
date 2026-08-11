//! The `NtesProvider` adapter: an encrypted JSON POST against the official
//! CRIS `AppServAnd` endpoint.
//!
//! Request/response are wrapped in the CRIS AES envelope (see [`crate::crypto`]).
//! The response body is a JSON object carrying the ciphertext under `jsonIn`;
//! we decrypt it to a JSON body and map that.

use std::sync::Arc;

use async_trait::async_trait;

use crate::crypto::{build_envelope, decode_envelope};
use crate::map::{map_ntes_payload, to_ntes_date};
use serde_json::Value;
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{fetch_provider_json, HttpTransport, Request};

const NTES_ENDPOINT: &str = "https://enquiry.indianrail.gov.in/crisns/AppServAnd";
const NTES_USER_AGENT: &str = "okhttp/4.9.2";

/// The `ShowFullRunJson` plaintext body for a train/date.
fn plaintext(train_number: &str, ntes_date: &str) -> String {
    format!(
        "service=TrainRunningMob&subService=ShowFullRunJson&trainNo={train_number}&startDate={ntes_date}"
    )
}

/// The `NtesProvider` adapter.
pub struct NtesProvider {
    transport: Arc<dyn HttpTransport>,
}

impl NtesProvider {
    /// Create an adapter over the injected transport seam.
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        Self { transport }
    }
}

/// Factory mirroring the TS `createNtesProvider`.
pub fn create_ntes_provider(transport: Arc<dyn HttpTransport>) -> NtesProvider {
    NtesProvider::new(transport)
}

#[async_trait]
impl TrainStatusProvider for NtesProvider {
    fn name(&self) -> &str {
        "ntes"
    }

    fn enabled(&self) -> bool {
        true
    }

    async fn fetch_train_status(
        &self,
        train_number: &str,
        departure_date: &str,
        options: &ProviderFetchOptions,
        known_train: Option<&KnownTrain>,
    ) -> Result<MappedStatus, ProviderError> {
        let Some(ntes_date) = to_ntes_date(departure_date) else {
            return Err(ProviderError::upstream(
                "ntes",
                format!("Unsupported date format: {departure_date}"),
            ));
        };

        let envelope = build_envelope(&plaintext(train_number, &ntes_date));
        let body = serde_json::json!({ "jsonIn": envelope });

        let mut request = Request::post(NTES_ENDPOINT)
            .json_body(&body)
            .map_err(|cause| {
                ProviderError::upstream_with_cause("ntes", "Failed to encode request body", cause)
            })?
            .header("User-Agent", NTES_USER_AGENT)
            .header("X-Requested-With", "XMLHttpRequest");
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let raw = fetch_provider_json(self.transport.as_ref(), "ntes", request).await?;

        let json_in = raw
            .get("jsonIn")
            .and_then(Value::as_str)
            .ok_or_else(|| ProviderError::upstream("ntes", "Unexpected response shape"))?;
        let decrypted = decode_envelope(json_in).map_err(|cause| {
            ProviderError::upstream_with_cause("ntes", "Envelope decode failed", cause)
        })?;
        let parsed: Value = serde_json::from_str(&decrypted).map_err(|cause| {
            ProviderError::upstream_with_cause("ntes", "Invalid response body from ntes", cause)
        })?;

        map_ntes_payload(
            &parsed,
            &AssembleOptions {
                train_number: train_number.to_string(),
                departure_date: departure_date.to_string(),
                known_train: known_train.cloned(),
                ..AssembleOptions::default()
            },
        )
    }
}
