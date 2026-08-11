//! The `RailMitraProvider` adapter: a GET against
//! `https://www.railmitra.com/live-train-running-status/{train_no}`, a
//! server-rendered HTML page whose full station table is embedded server-side.
//! The page title is reachable from this sandbox; the documented table shape is
//! described in `crate::map`. Like every Tier-C upstream, any blocked/odd
//! response surfaces as [`ProviderError::Upstream`] through the shared fetch
//! classification.

use std::sync::Arc;

use async_trait::async_trait;

use crate::map::{map_railmitra_payload, to_railmitra_date};
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{fetch_provider_text, HttpTransport, Request};

const RAILMITRA_ENDPOINT: &str = "https://www.railmitra.com/live-train-running-status";
const RAILMITRA_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// The railmitra.com train-status adapter.
pub struct RailMitraProvider {
    transport: Arc<dyn HttpTransport>,
}

impl RailMitraProvider {
    /// Create an adapter over the injected transport seam.
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        Self { transport }
    }

    fn build_url(&self, train_number: &str) -> String {
        format!("{RAILMITRA_ENDPOINT}/{train_number}")
    }
}

/// Factory mirroring the TS `createRailMitraProvider` (the transport seam is
/// injected instead of global fetch).
pub fn create_railmitra_provider(transport: Arc<dyn HttpTransport>) -> RailMitraProvider {
    RailMitraProvider::new(transport)
}

#[async_trait]
impl TrainStatusProvider for RailMitraProvider {
    fn name(&self) -> &str {
        "railmitra"
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
        if to_railmitra_date(departure_date).is_none() {
            return Err(ProviderError::upstream(
                "railmitra",
                format!("Unsupported date format: {departure_date}"),
            ));
        }

        let mut request = Request::get(self.build_url(train_number))
            .header("User-Agent", RAILMITRA_USER_AGENT)
            .header("Accept", "text/html,application/xhtml+xml");
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let html = fetch_provider_text(self.transport.as_ref(), "railmitra", request).await?;

        map_railmitra_payload(
            &html,
            &AssembleOptions {
                train_number: train_number.to_string(),
                departure_date: departure_date.to_string(),
                known_train: known_train.cloned(),
                ..AssembleOptions::default()
            },
        )
    }
}
