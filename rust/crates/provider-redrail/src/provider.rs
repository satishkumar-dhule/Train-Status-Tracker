//! The `RedRailProvider` adapter: a JSON GET against
//! `loco.redbus.com/api/Rails/v2/RIS/GetLiveTrainStatus` (the endpoint the
//! RedBus Rail app uses). Requires the mobile-app channel headers, including
//! `Country_name: IND` (missing/wrong value → 401).

use std::sync::Arc;

use async_trait::async_trait;

use crate::map::{map_redrail_payload, to_redrail_date};
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{fetch_provider_json, HttpTransport, Request};

const REDRAIL_ENDPOINT: &str = "https://loco.redbus.com/api/Rails/v2/RIS/GetLiveTrainStatus";
const REDRAIL_USER_AGENT: &str = "okhttp/4.11.0";

const HEADERS: &[(&str, &str)] = &[
    ("Channel_name", "MOBILE_APP"),
    ("Os", "Android"),
    ("Accept", "application/json"),
    ("Appversion", "5.5.1"),
    ("Auth_key", "1"),
    ("Appversioncode", "505010"),
    ("Language", "en"),
    ("Businessunit", "REDRAIL"),
    ("Currency", "INR"),
    ("Country_name", "IND"),
];

/// The RedBus Rail (redRail) train-status adapter.
pub struct RedRailProvider {
    transport: Arc<dyn HttpTransport>,
}

impl RedRailProvider {
    /// Create an adapter over the injected transport seam.
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        Self { transport }
    }
}

/// Factory mirroring the TS `createRedRailProvider` (the transport seam is
/// injected instead of global fetch).
pub fn create_redrail_provider(transport: Arc<dyn HttpTransport>) -> RedRailProvider {
    RedRailProvider::new(transport)
}

#[async_trait]
impl TrainStatusProvider for RedRailProvider {
    fn name(&self) -> &str {
        "redrail"
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
        let Some(redrail_date) = to_redrail_date(departure_date) else {
            return Err(ProviderError::upstream(
                "redrail",
                format!("Unsupported date format: {departure_date}"),
            ));
        };

        let mut url = url::Url::parse(REDRAIL_ENDPOINT).expect("static RedRail base URL is valid");
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("trainNo", train_number);
            pairs.append_pair("date", &redrail_date);
        }

        let mut request = Request::get(url.to_string());
        for (name, value) in HEADERS {
            request = request.header(*name, *value);
        }
        request = request.header("User-Agent", REDRAIL_USER_AGENT);
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let raw = fetch_provider_json(self.transport.as_ref(), "redrail", request).await?;

        map_redrail_payload(
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
