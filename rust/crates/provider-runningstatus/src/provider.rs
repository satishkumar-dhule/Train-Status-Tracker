//! The `RunningStatusProvider` adapter: an HTML scraper against
//! `runningstatus.in/status/{train_no}-on-{YYYYMMDD}`. runningstatus.in is
//! Cloudflare-guarded from this sandbox, so blocked responses surface as
//! `ProviderError::Upstream` through the fetch layer — exactly the aggregator's
//! expected degradation behaviour.

use std::sync::Arc;

use async_trait::async_trait;

use crate::map::{map_runningstatus_html, to_runningstatus_date};
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{fetch_provider_text, HttpTransport, Request};

const RUNNINGSTATUS_BASE: &str = "https://runningstatus.in/status";
const RUNNINGSTATUS_USER_AGENT: &str =
    "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36";

/// The runningstatus.in train-status adapter.
pub struct RunningStatusProvider {
    transport: Arc<dyn HttpTransport>,
}

impl RunningStatusProvider {
    /// Create an adapter over the injected transport seam.
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        Self { transport }
    }
}

/// Factory mirroring the TS adapter construction.
pub fn create_runningstatus_provider(transport: Arc<dyn HttpTransport>) -> RunningStatusProvider {
    RunningStatusProvider::new(transport)
}

#[async_trait]
impl TrainStatusProvider for RunningStatusProvider {
    fn name(&self) -> &str {
        "runningstatus"
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
        let Some(runningstatus_date) = to_runningstatus_date(departure_date) else {
            return Err(ProviderError::upstream(
                "runningstatus",
                format!("Unsupported date format: {departure_date}"),
            ));
        };

        let url = format!("{RUNNINGSTATUS_BASE}/{train_number}-on-{runningstatus_date}");

        let mut request = Request::get(url)
            .header("User-Agent", RUNNINGSTATUS_USER_AGENT)
            .header("Accept", "text/html,application/xhtml+xml");
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let html = fetch_provider_text(self.transport.as_ref(), "runningstatus", request).await?;

        map_runningstatus_html(
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
