//! The `IndianRailApiProvider` adapter: a key-gated JSON GET against
//! `indianrailapi.com/api/v2/livetrainstatus`. The API key is embedded in the
//! URL path; the adapter is disabled without one, mirroring the railradar
//! `enabled = !!apiKey` gate.

use std::sync::Arc;

use async_trait::async_trait;

use crate::map::{map_indianrailapi_payload, to_indianrailapi_date};
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{fetch_provider_json, HttpTransport, Request};

const INDIANRAILAPI_BASE: &str = "https://indianrailapi.com/api/v2/livetrainstatus";
const INDIANRAILAPI_USER_AGENT: &str = "okhttp/4.9.2";

/// The IndianRailAPI train-status adapter.
pub struct IndianRailApiProvider {
    transport: Arc<dyn HttpTransport>,
    api_key: Option<String>,
}

impl IndianRailApiProvider {
    /// Create an adapter over the injected transport seam. `None` key means
    /// the provider stays disabled (`enabled()` is `false`).
    pub fn new(transport: Arc<dyn HttpTransport>, api_key: Option<String>) -> Self {
        Self { transport, api_key }
    }
}

/// Factory mirroring the railradar key-gate factory.
pub fn create_indianrailapi_provider(
    transport: Arc<dyn HttpTransport>,
    api_key: Option<String>,
) -> IndianRailApiProvider {
    IndianRailApiProvider::new(transport, api_key)
}

#[async_trait]
impl TrainStatusProvider for IndianRailApiProvider {
    fn name(&self) -> &str {
        "indianrailapi"
    }

    fn enabled(&self) -> bool {
        self.api_key.is_some()
    }

    async fn fetch_train_status(
        &self,
        train_number: &str,
        departure_date: &str,
        options: &ProviderFetchOptions,
        known_train: Option<&KnownTrain>,
    ) -> Result<MappedStatus, ProviderError> {
        let Some(indianrailapi_date) = to_indianrailapi_date(departure_date) else {
            return Err(ProviderError::upstream(
                "indianrailapi",
                format!("Unsupported date format: {departure_date}"),
            ));
        };

        let Some(api_key) = &self.api_key else {
            return Err(ProviderError::upstream(
                "indianrailapi",
                "No API key configured",
            ));
        };

        let url = format!(
            "{INDIANRAILAPI_BASE}/apikey/{api_key}/trainnumber/{train_number}/date/{indianrailapi_date}/"
        );

        let mut request = Request::get(url)
            .header("Accept", "application/json")
            .header("User-Agent", INDIANRAILAPI_USER_AGENT);
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let raw = fetch_provider_json(self.transport.as_ref(), "indianrailapi", request).await?;

        map_indianrailapi_payload(
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
