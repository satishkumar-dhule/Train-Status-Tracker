//! The `ConfirmTktProvider` adapter: a JSON GET against
//! `api.confirmtkt.com/api/trains/livestatusall` (the endpoint the ConfirmTkt
//! Android app uses). No auth; a browser-ish `okhttp` user agent is enough.

use std::sync::Arc;

use async_trait::async_trait;

use crate::map::{map_confirmtkt_payload, to_confirmtkt_date};
use tt_mapper::{AssembleOptions, KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::{fetch_provider_json, HttpTransport, Request};

const CONFIRMTKT_ENDPOINT: &str = "https://api.confirmtkt.com/api/trains/livestatusall";
const CONFIRMTKT_USER_AGENT: &str = "okhttp/4.9.2";

/// The ConfirmTkt train-status adapter.
pub struct ConfirmTktProvider {
    transport: Arc<dyn HttpTransport>,
}

impl ConfirmTktProvider {
    /// Create an adapter over the injected transport seam.
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        Self { transport }
    }
}

/// Factory mirroring the TS `createConfirmTktProvider` (the transport seam is
/// injected instead of global fetch).
pub fn create_confirmtkt_provider(transport: Arc<dyn HttpTransport>) -> ConfirmTktProvider {
    ConfirmTktProvider::new(transport)
}

/// A per-request `session` value (any hex string is accepted).
fn session_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}{:x}", nanos, train_tick())
}

/// A small additional entropy source so two requests in the same nanosecond
/// still differ.
fn train_tick() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static TICK: AtomicU64 = AtomicU64::new(0);
    TICK.fetch_add(1, Ordering::Relaxed)
}

#[async_trait]
impl TrainStatusProvider for ConfirmTktProvider {
    fn name(&self) -> &str {
        "confirmtkt"
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
        let Some(confirmtkt_date) = to_confirmtkt_date(departure_date) else {
            return Err(ProviderError::upstream(
                "confirmtkt",
                format!("Unsupported date format: {departure_date}"),
            ));
        };

        let mut url =
            url::Url::parse(CONFIRMTKT_ENDPOINT).expect("static ConfirmTkt base URL is valid");
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("trainno", train_number);
            pairs.append_pair("doj", &confirmtkt_date);
            pairs.append_pair("locale", "en");
            pairs.append_pair("session", &session_token());
        }

        let mut request = Request::get(url.to_string())
            .header("Accept", "application/json")
            .header("User-Agent", CONFIRMTKT_USER_AGENT);
        if let Some(signal) = &options.abort {
            request = request.abort(signal.clone());
        }

        let raw = fetch_provider_json(self.transport.as_ref(), "confirmtkt", request).await?;

        map_confirmtkt_payload(
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
