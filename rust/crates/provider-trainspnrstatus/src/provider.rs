//! The `TrainSpnrStatusProvider` adapter: a JSON POST against
//! `trainspnrstatus.com/api/fetch-live-status` (the endpoint the site's React
//! bundle calls). No auth; the web form's Cloudflare Turnstile guard may block
//! plain POSTs from some egresses, in which case the fetch leg degrades to a
//! [`tt_provider_core::ProviderError::Upstream`].

use std::sync::Arc;

use async_trait::async_trait;

use crate::map::{map_trainspnrstatus_payload, to_trainspnrstatus_date};
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{fetch_provider_json, HttpTransport, Request};

const TRAINSPNRSTATUS_ENDPOINT: &str = "https://trainspnrstatus.com/api/fetch-live-status";

/// The trainspnrstatus.com train-status adapter.
pub struct TrainSpnrStatusProvider {
    transport: Arc<dyn HttpTransport>,
}

impl TrainSpnrStatusProvider {
    /// Create an adapter over the injected transport seam.
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        Self { transport }
    }
}

/// Factory mirroring the TS `createTrainSpnrStatusProvider` (the transport seam
/// is injected instead of global fetch).
pub fn create_trainspnrstatus_provider(
    transport: Arc<dyn HttpTransport>,
) -> TrainSpnrStatusProvider {
    TrainSpnrStatusProvider::new(transport)
}

#[async_trait]
impl TrainStatusProvider for TrainSpnrStatusProvider {
    fn name(&self) -> &str {
        "trainspnrstatus"
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
        let Some(converted_date) = to_trainspnrstatus_date(departure_date) else {
            return Err(ProviderError::upstream(
                "trainspnrstatus",
                format!("Unsupported date format: {departure_date}"),
            ));
        };

        let body = serde_json::json!({
            "train_no": train_number,
            "date": converted_date,
        });

        let mut request = Request::post(TRAINSPNRSTATUS_ENDPOINT)
            .json_body(&body)
            .map_err(|cause| {
                ProviderError::upstream_with_cause(
                    "trainspnrstatus",
                    "Failed to encode request body",
                    cause,
                )
            })?;
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let raw = fetch_provider_json(self.transport.as_ref(), "trainspnrstatus", request).await?;

        map_trainspnrstatus_payload(
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
