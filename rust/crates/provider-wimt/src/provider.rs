//! The `WhereIsMyTrainProvider` adapter, ported 1:1 from
//! `lib/providers/whereismytrain.ts`.

use std::sync::Arc;

use async_trait::async_trait;

use crate::map::{map_wimt_payload, to_wimt_date};
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{fetch_provider_json, HttpTransport, Request};

const WIMT_ENDPOINT: &str = "https://whereismytrain.in/cache/live_status";

const HEADERS: &[(&str, &str)] = &[
    ("Accept", "application/json"),
    (
        "User-Agent",
        "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36",
    ),
];

/// The WhereIsMyTrain train-status adapter.
pub struct WhereIsMyTrainProvider {
    transport: Arc<dyn HttpTransport>,
}

impl WhereIsMyTrainProvider {
    /// Create an adapter over the injected transport seam.
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        Self { transport }
    }
}

/// Factory mirroring the TS `createWhereIsMyTrainProvider`.
pub fn create_whereismytrain_provider(transport: Arc<dyn HttpTransport>) -> WhereIsMyTrainProvider {
    WhereIsMyTrainProvider::new(transport)
}

#[async_trait]
impl TrainStatusProvider for WhereIsMyTrainProvider {
    fn name(&self) -> &str {
        "whereismytrain"
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
        let Some(wimt_date) = to_wimt_date(departure_date) else {
            return Err(ProviderError::upstream(
                "whereismytrain",
                format!("Unsupported date format: {departure_date}"),
            ));
        };

        let mut url = url::Url::parse(WIMT_ENDPOINT).expect("static WIMT base URL is valid");
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("train_no", train_number);
            pairs.append_pair("date", &wimt_date);
            pairs.append_pair("lang", "en");
        }

        let mut request = Request::get(url.to_string());
        for (name, value) in HEADERS {
            request = request.header(*name, *value);
        }
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let raw = fetch_provider_json(self.transport.as_ref(), "whereismytrain", request).await?;

        map_wimt_payload(
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
