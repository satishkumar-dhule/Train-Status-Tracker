//! The `EtrainProvider` adapter: an HTML GET of etrain.info's server-rendered
//! `/live` page.
//!
//! URL construction uses the slug-less form `https://etrain.info/train/{no}/
//! live?date=YYYYMMDD` — etrain redirects slug-less URLs in practice (the
//! canonical slug form requires a slug that cannot be derived from the train
//! number alone; see the crate docs). The ajax endpoint is anti-bot gated and
//! deliberately unused.

use std::sync::Arc;

use async_trait::async_trait;

use crate::map::{map_etrain_payload, to_etrain_date};
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{fetch_provider_text, HttpTransport, Request};

const ETRAIN_ENDPOINT: &str = "https://etrain.info/train";
const ETRAIN_USER_AGENT: &str =
    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

/// The etrain.info train-status adapter.
pub struct EtrainProvider {
    transport: Arc<dyn HttpTransport>,
}

impl EtrainProvider {
    /// Create an adapter over the injected transport seam.
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        Self { transport }
    }

    fn build_url(&self, train_number: &str, date: &str) -> String {
        let mut url = url::Url::parse(ETRAIN_ENDPOINT).expect("static etrain base URL is valid");
        {
            let mut path = url
                .path_segments_mut()
                .expect("static etrain base URL has a path");
            path.push(train_number);
            path.push("live");
        }
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("date", date);
        }
        url.to_string()
    }
}

/// Factory mirroring the TS `createEtrainProvider` (the transport seam is
/// injected instead of global fetch).
pub fn create_etrain_provider(transport: Arc<dyn HttpTransport>) -> EtrainProvider {
    EtrainProvider::new(transport)
}

#[async_trait]
impl TrainStatusProvider for EtrainProvider {
    fn name(&self) -> &str {
        "etrain"
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
        let Some(etrain_date) = to_etrain_date(departure_date) else {
            return Err(ProviderError::upstream(
                "etrain",
                format!("Unsupported date format: {departure_date}"),
            ));
        };

        let mut request = Request::get(self.build_url(train_number, &etrain_date))
            .header("User-Agent", ETRAIN_USER_AGENT)
            .header("Accept", "text/html,application/xhtml+xml");
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let html = fetch_provider_text(self.transport.as_ref(), "etrain", request).await?;

        map_etrain_payload(
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
