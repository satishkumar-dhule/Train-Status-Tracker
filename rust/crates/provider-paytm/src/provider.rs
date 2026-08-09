//! The `PaytmProvider` adapter, ported 1:1 from `PaytmProvider` in
//! `lib/providers/paytm.ts` — the shared transport (`fetchProviderStatus` in
//! `providers/http.ts`) is replaced by the injected
//! [`tt_provider_http::HttpTransport`] seam and its shared classification
//! helper [`tt_provider_http::fetch_provider_json`].
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
use tt_provider_http::{fetch_provider_json, HttpTransport, Request};

const PAYTM_BASE: &str = "https://travel.paytm.com/api/trains/v1/train/status";
pub(crate) const PAYTM_USER_AGENT: &str =
    "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36";

/// The status endpoint URL for `(train_number, departure_date)`, mirroring
/// `new URL(PAYTM_BASE)` + the `URLSearchParams.set(...)` calls in
/// `fetchPaytmTrainStatus` (percent-encoding, spaces become `+`). Shared by the
/// provider adapter and the run-date probe fetch so both hit the same endpoint.
pub(crate) fn paytm_status_url(train_number: &str, departure_date: &str) -> String {
    let mut url = url::Url::parse(PAYTM_BASE).expect("static Paytm base URL is valid");
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("train_number", train_number);
        pairs.append_pair("departure_date", departure_date);
        pairs.append_pair("isH5", "true");
        pairs.append_pair("client", "web");
        pairs.append_pair("deviceIdentifier", "Mozilla Firefox-150.0.0.0");
    }
    url.to_string()
}

/// The Paytm train-status adapter.
pub struct PaytmProvider {
    transport: Arc<dyn HttpTransport>,
}

impl PaytmProvider {
    /// Create an adapter over the injected transport seam.
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        Self { transport }
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
        let mut request = Request::get(paytm_status_url(train_number, departure_date))
            .header("User-Agent", PAYTM_USER_AGENT)
            .header("Accept", "application/json");
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let raw = fetch_provider_json(self.transport.as_ref(), "paytm", request).await?;

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
