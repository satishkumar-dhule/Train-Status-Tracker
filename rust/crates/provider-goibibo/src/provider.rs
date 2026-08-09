//! The `GoibiboProvider` adapter, ported 1:1 from `GoibiboProvider` in
//! `lib/providers/goibibo.ts`.

use std::sync::Arc;

use async_trait::async_trait;

use crate::map::{map_goibibo_payload, to_goibibo_date};
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{fetch_provider_json, HttpTransport, Request};

const GOIBIBO_ENDPOINT: &str = "https://rails-ris.makemytrip.com/api/ris/train/livestatus/v2";
const GOIBIBO_USER_AGENT: &str = "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36";

/// The Goibibo/MMT train-status adapter.
pub struct GoibiboProvider {
    transport: Arc<dyn HttpTransport>,
}

impl GoibiboProvider {
    /// Create an adapter over the injected transport seam.
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        Self { transport }
    }
}

/// Factory mirroring the TS `createGoibiboProvider` (the transport seam is
/// injected instead of global fetch).
pub fn create_goibibo_provider(transport: Arc<dyn HttpTransport>) -> GoibiboProvider {
    GoibiboProvider::new(transport)
}

#[async_trait]
impl TrainStatusProvider for GoibiboProvider {
    fn name(&self) -> &str {
        "goibibo"
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
        let Some(goibibo_date) = to_goibibo_date(departure_date) else {
            return Err(ProviderError::upstream(
                "goibibo",
                format!("Unsupported date format: {departure_date}"),
            ));
        };

        let body = serde_json::json!({
            "trainNumber": train_number,
            "dateOfJourney": goibibo_date,
            "findNextRunningDate": true,
        });

        let mut request = Request::post(GOIBIBO_ENDPOINT)
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .header("Origin", "https://www.goibibo.com")
            .header("Referer", "https://www.goibibo.com/")
            .header("User-Agent", GOIBIBO_USER_AGENT)
            .json_body(&body)
            .expect("static JSON body always serializes");
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let raw = fetch_provider_json(self.transport.as_ref(), "goibibo", request).await?;

        map_goibibo_payload(
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
