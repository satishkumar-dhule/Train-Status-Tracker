//! The `ErailProvider` adapter: an HTML GET of erail.in's server-rendered
//! `train-enquiry` page. The page is a schedule source (live status runs over
//! a SignalR peer network), so actual fields are mapped conservatively.

use std::sync::Arc;

use async_trait::async_trait;

use crate::map::{map_erail_payload, to_erail_date};
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{fetch_provider_text, HttpTransport, Request};

const ERAIL_ENDPOINT: &str = "https://erail.in/train-enquiry";
const ERAIL_USER_AGENT: &str =
    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

/// The erail.in train-status adapter.
pub struct ErailProvider {
    transport: Arc<dyn HttpTransport>,
}

impl ErailProvider {
    /// Create an adapter over the injected transport seam.
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        Self { transport }
    }

    fn build_url(&self, train_number: &str) -> String {
        let mut url = url::Url::parse(ERAIL_ENDPOINT).expect("static erail base URL is valid");
        {
            let mut path = url
                .path_segments_mut()
                .expect("static erail base URL has a path");
            path.push(train_number);
        }
        url.to_string()
    }
}

/// Factory mirroring the TS `createErailProvider` (the transport seam is
/// injected instead of global fetch).
pub fn create_erail_provider(transport: Arc<dyn HttpTransport>) -> ErailProvider {
    ErailProvider::new(transport)
}

#[async_trait]
impl TrainStatusProvider for ErailProvider {
    fn name(&self) -> &str {
        "erail"
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
        if to_erail_date(departure_date).is_none() {
            return Err(ProviderError::upstream(
                "erail",
                format!("Unsupported date format: {departure_date}"),
            ));
        }

        let mut request = Request::get(self.build_url(train_number))
            .header("User-Agent", ERAIL_USER_AGENT)
            .header("Accept", "text/html,application/xhtml+xml");
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let html = fetch_provider_text(self.transport.as_ref(), "erail", request).await?;

        map_erail_payload(
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
