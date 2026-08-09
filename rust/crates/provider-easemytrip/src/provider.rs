//! The `EaseMyTripProvider` adapter, ported 1:1 from `EaseMyTripProvider` in
//! `lib/providers/easemytrip.ts`.

use std::sync::Arc;

use async_trait::async_trait;

use crate::map::{map_easemytrip_html, to_easemytrip_date};
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{fetch_provider_text, HttpTransport, Request};

const EASEMYTRIP_ENDPOINT: &str =
    "https://www.easemytrip.com/railways/train-live-status-with-click";
const EASEMYTRIP_USER_AGENT: &str = "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36";

/// The EaseMyTrip train-status adapter.
pub struct EaseMyTripProvider {
    transport: Arc<dyn HttpTransport>,
}

impl EaseMyTripProvider {
    /// Create an adapter over the injected transport seam.
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        Self { transport }
    }

    fn build_url(&self, train_number: &str, date: &str) -> String {
        let mut url =
            url::Url::parse(EASEMYTRIP_ENDPOINT).expect("static EaseMyTrip base URL is valid");
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("trainnumber", train_number);
            pairs.append_pair("date", date);
        }
        url.to_string()
    }
}

/// Factory mirroring the TS `createEaseMyTripProvider` (the transport seam is
/// injected instead of global fetch).
pub fn create_easemytrip_provider(transport: Arc<dyn HttpTransport>) -> EaseMyTripProvider {
    EaseMyTripProvider::new(transport)
}

#[async_trait]
impl TrainStatusProvider for EaseMyTripProvider {
    fn name(&self) -> &str {
        "easemytrip"
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
        let Some(emt_date) = to_easemytrip_date(departure_date) else {
            // The reference rejects an unsupported date with a
            // `TrainStatusNotFoundError` here (unlike the other adapters).
            return Err(ProviderError::not_found("easemytrip"));
        };

        let mut request = Request::get(self.build_url(train_number, &emt_date))
            .header("User-Agent", EASEMYTRIP_USER_AGENT)
            .header("Accept", "text/html,application/xhtml+xml");
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let html = fetch_provider_text(self.transport.as_ref(), "easemytrip", request).await?;

        map_easemytrip_html(
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
