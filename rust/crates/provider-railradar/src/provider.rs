//! The `RailRadarProvider` adapter, ported 1:1 from
//! `lib/providers/railradar.ts`. The adapter is disabled without an API key,
//! mirroring the TS `enabled = !!apiKey` gate.

use std::sync::Arc;

use async_trait::async_trait;

use crate::map::{map_railradar_payload, to_railradar_date};
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{fetch_provider_json, HttpTransport, Request};

const RAILRADAR_ENDPOINT: &str = "https://api.railradar.in/rest/v1/trains/status";

const HEADERS: &[(&str, &str)] = &[
    ("Accept", "application/json"),
    (
        "User-Agent",
        "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36",
    ),
];

/// The RailRadar train-status adapter.
pub struct RailRadarProvider {
    transport: Arc<dyn HttpTransport>,
    api_key: Option<String>,
}

impl RailRadarProvider {
    /// Create an adapter over the injected transport seam. `None` key means
    /// the provider stays disabled (`enabled()` is `false`).
    pub fn new(transport: Arc<dyn HttpTransport>, api_key: Option<String>) -> Self {
        Self { transport, api_key }
    }
}

/// Factory mirroring the TS `createRailRadarProvider({ apiKey })`.
pub fn create_railradar_provider(
    transport: Arc<dyn HttpTransport>,
    api_key: Option<String>,
) -> RailRadarProvider {
    RailRadarProvider::new(transport, api_key)
}

#[async_trait]
impl TrainStatusProvider for RailRadarProvider {
    fn name(&self) -> &str {
        "railradar"
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
        let Some(railradar_date) = to_railradar_date(departure_date) else {
            return Err(ProviderError::upstream(
                "railradar",
                format!("Unsupported date format: {departure_date}"),
            ));
        };

        let mut url =
            url::Url::parse(RAILRADAR_ENDPOINT).expect("static RailRadar base URL is valid");
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("trainNumber", train_number);
            pairs.append_pair("dateOfJourney", &railradar_date);
        }

        let mut request = Request::get(url.to_string());
        for (name, value) in HEADERS {
            request = request.header(*name, *value);
        }
        if let Some(api_key) = &self.api_key {
            request = request.header("x-api-key", api_key);
        }
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let raw = fetch_provider_json(self.transport.as_ref(), "railradar", request).await?;

        map_railradar_payload(
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
