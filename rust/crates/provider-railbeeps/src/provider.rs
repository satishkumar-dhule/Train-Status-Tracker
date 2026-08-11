//! The `RailBeepsProvider` adapter: a JSON GET against
//! `api.railbeeps.com` using the public web API key baked into NDTV's site
//! bundle. The key is a fixed constant here, mirroring how the TS backend
//! embeds it.

use std::sync::Arc;

use async_trait::async_trait;

use crate::map::{map_railbeeps_payload, to_railbeeps_date};
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{fetch_provider_json, HttpTransport, Request};

/// The public web API key hard-coded in NDTV's site bundle (Tier C provider —
/// the host has no public DNS in this sandbox, but the backend is stable).
const RAILBEEPS_WEB_KEY: &str = "eP5e2k1aJq4oV9fA";

const RAILBEEPS_BASE: &str = "https://api.railbeeps.com/api/getRunningStatus";

/// The railbeeps (NDTV) train-status adapter.
pub struct RailBeepsProvider {
    transport: Arc<dyn HttpTransport>,
}

impl RailBeepsProvider {
    /// Create an adapter over the injected transport seam.
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        Self { transport }
    }
}

/// Factory mirroring the TS adapter construction.
pub fn create_railbeeps_provider(transport: Arc<dyn HttpTransport>) -> RailBeepsProvider {
    RailBeepsProvider::new(transport)
}

#[async_trait]
impl TrainStatusProvider for RailBeepsProvider {
    fn name(&self) -> &str {
        "railbeeps"
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
        let Some(railbeeps_date) = to_railbeeps_date(departure_date) else {
            return Err(ProviderError::upstream(
                "railbeeps",
                format!("Unsupported date format: {departure_date}"),
            ));
        };

        let url = {
            let mut url =
                url::Url::parse(RAILBEEPS_BASE).expect("static railbeeps base URL is valid");
            {
                let mut segments = url
                    .path_segments_mut()
                    .expect("railbeeps base URL is hierarchical");
                segments.extend([
                    "api-key",
                    RAILBEEPS_WEB_KEY,
                    "trainno",
                    train_number,
                    "date",
                    &railbeeps_date,
                ]);
            }
            url.to_string()
        };

        let mut request = Request::get(url).header("Accept", "application/json");
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let raw = fetch_provider_json(self.transport.as_ref(), "railbeeps", request).await?;

        map_railbeeps_payload(
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
