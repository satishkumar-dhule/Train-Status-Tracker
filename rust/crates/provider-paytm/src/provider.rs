//! The `PaytmProvider` adapter, ported 1:1 from `PaytmProvider` in
//! `lib/providers/paytm.ts` — the shared transport (`fetchProviderStatus` in
//! `providers/http.ts`) is replaced by the injected
//! [`tt_provider_http::HttpTransport`] seam.
//!
//! Error classification mirrors `fetchProviderStatus`: transport failures
//! (timeout/abort/network/redirect-limit/other) become
//! `Network error reaching paytm`, a non-2xx status becomes
//! `paytm returned status {status}`, an oversized body becomes
//! `paytm response too large`, and a body that fails to parse as JSON becomes
//! `Invalid response body from paytm`. Mapping errors propagate unchanged, so
//! a positively-confirmed not-found stays [`tt_provider_core::ProviderError::NotFound`].

use std::sync::Arc;

use async_trait::async_trait;

use crate::map::map_paytm_payload;
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{HttpTransport, Request, TransportError};

const PAYTM_BASE: &str = "https://travel.paytm.com/api/trains/v1/train/status";
const PAYTM_USER_AGENT: &str = "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36";

/// The Paytm train-status adapter.
pub struct PaytmProvider {
    transport: Arc<dyn HttpTransport>,
}

impl PaytmProvider {
    /// Create an adapter over the injected transport seam.
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        Self { transport }
    }

    fn build_url(&self, train_number: &str, departure_date: &str) -> String {
        let mut url = url::Url::parse(PAYTM_BASE).expect("static Paytm base URL is valid");
        {
            // `URLSearchParams.set(...)` — percent-encoding (spaces become `+`).
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("train_number", train_number);
            pairs.append_pair("departure_date", departure_date);
            pairs.append_pair("isH5", "true");
            pairs.append_pair("client", "web");
            pairs.append_pair("deviceIdentifier", "Mozilla Firefox-150.0.0.0");
        }
        url.to_string()
    }
}

/// Factory mirroring the TS `createPaytmProvider`.
pub fn create_paytm_provider(transport: Arc<dyn HttpTransport>) -> PaytmProvider {
    PaytmProvider::new(transport)
}

#[async_trait]
impl TrainStatusProvider for PaytmProvider {
    fn name(&self) -> &str {
        "paytm"
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
        let mut request = Request::get(self.build_url(train_number, departure_date))
            .header("User-Agent", PAYTM_USER_AGENT)
            .header("Accept", "application/json");
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let response = self.transport.execute(request).await.map_err(|err| {
            let message = match &err {
                TransportError::Timeout { .. }
                | TransportError::Aborted
                | TransportError::Network { .. }
                | TransportError::RedirectLimit { .. }
                | TransportError::Other { .. } => "Network error reaching paytm".to_string(),
                TransportError::Status { status } => format!("paytm returned status {status}"),
                TransportError::Oversized { .. } => "paytm response too large".to_string(),
            };
            ProviderError::upstream_with_cause("paytm", message, err)
        })?;

        let raw: serde_json::Value = response.json().map_err(|cause| {
            ProviderError::upstream_with_cause("paytm", "Invalid response body from paytm", cause)
        })?;

        map_paytm_payload(
            &raw,
            &AssembleOptions {
                train_number: train_number.to_string(),
                departure_date: departure_date.to_string(),
                known_train: known_train.cloned(),
                ..AssembleOptions::default()
            },
        )
    }
}
