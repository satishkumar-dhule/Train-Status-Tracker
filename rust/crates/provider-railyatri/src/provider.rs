//! The `RailYatriProvider` adapter, ported 1:1 from `RailYatriProvider` in
//! `lib/providers/railyatri.ts`. The current date is injectable via `now`, like
//! the TS constructor option.

use std::sync::Arc;

use async_trait::async_trait;
use chrono::NaiveDate;

use crate::map::{compute_start_day, map_railyatri_payload};
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{fetch_provider_json, HttpTransport, Request};

const RAILYATRI_ENDPOINT: &str = "https://livestatus.railyatri.in/api/v3/train_eta_data";
const RAILYATRI_USER_AGENT: &str = "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36";

fn default_now() -> NaiveDate {
    chrono::Local::now().date_naive()
}

/// The RailYatri train-status adapter.
pub struct RailYatriProvider {
    transport: Arc<dyn HttpTransport>,
    now: Box<dyn Fn() -> NaiveDate + Send + Sync>,
}

impl RailYatriProvider {
    /// Create an adapter over the injected transport seam.
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        Self::with_now(transport, None)
    }

    /// Create an adapter with an injectable "today" clock.
    pub fn with_now(transport: Arc<dyn HttpTransport>, now: Option<fn() -> NaiveDate>) -> Self {
        Self {
            transport,
            now: Box::new(now.unwrap_or(default_now)),
        }
    }
}

/// Factory mirroring the TS `createRailYatriProvider({ now })`.
pub fn create_railyatri_provider(
    transport: Arc<dyn HttpTransport>,
    now: Option<fn() -> NaiveDate>,
) -> RailYatriProvider {
    RailYatriProvider::with_now(transport, now)
}

#[async_trait]
impl TrainStatusProvider for RailYatriProvider {
    fn name(&self) -> &str {
        "railyatri"
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
        let start_day = compute_start_day(departure_date, (self.now)())?;

        let mut url = url::Url::parse(&format!("{RAILYATRI_ENDPOINT}/{train_number}/0.json"))
            .expect("static RailYatri base URL is valid");
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("start_day", &start_day.to_string());
        }

        let mut request = Request::get(url.to_string())
            .header("Accept", "application/json")
            .header("User-Agent", RAILYATRI_USER_AGENT);
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let raw = fetch_provider_json(self.transport.as_ref(), "railyatri", request).await?;

        map_railyatri_payload(
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
