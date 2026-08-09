//! Provider assembly, ported from `buildStatusProviders` in
//! `lib/providers/registry.ts`: name → concrete adapter, skipping unknown
//! names and disabled providers (RailRadar without an API key).
//!
//! Ordering, case, and dedupe decisions live in `tt-config` (which parses
//! `TRAIN_STATUS_PROVIDERS`); this module is total with respect to the names
//! it is given — it builds what it can and drops the rest, so a caller can
//! hand it the raw configured list without fear of a panic.

use std::sync::Arc;

use tt_provider_core::TrainStatusProvider;
use tt_provider_easemytrip::create_easemytrip_provider;
use tt_provider_goibibo::create_goibibo_provider;
use tt_provider_http::HttpTransport;
use tt_provider_paytm::create_paytm_provider;
use tt_provider_railradar::create_railradar_provider;
use tt_provider_railyatri::create_railyatri_provider;
use tt_provider_wimt::create_whereismytrain_provider;

/// Build the provider list in priority order. Unknown names and disabled
/// providers (RailRadar without a key) are skipped silently, mirroring
/// `buildStatusProviders` in `lib/providers/registry.ts`.
pub fn build_status_providers(
    transport: Arc<dyn HttpTransport>,
    names: &[String],
    railradar_api_key: Option<&str>,
) -> Vec<Arc<dyn TrainStatusProvider>> {
    let api_key = railradar_api_key.map(str::to_string);
    let mut seen = std::collections::HashSet::new();
    let mut providers: Vec<Arc<dyn TrainStatusProvider>> = Vec::new();
    for name in names {
        if !seen.insert(name.clone()) {
            continue;
        }
        let provider: Option<Arc<dyn TrainStatusProvider>> = match name.as_str() {
            "paytm" => Some(Arc::new(create_paytm_provider(transport.clone()))),
            "goibibo" => Some(Arc::new(create_goibibo_provider(transport.clone()))),
            "railyatri" => Some(Arc::new(create_railyatri_provider(transport.clone(), None))),
            "whereismytrain" => Some(Arc::new(create_whereismytrain_provider(transport.clone()))),
            "easemytrip" => Some(Arc::new(create_easemytrip_provider(transport.clone()))),
            "railradar" => Some(Arc::new(create_railradar_provider(
                transport.clone(),
                api_key.clone(),
            ))),
            _ => None,
        };
        if let Some(provider) = provider {
            if provider.enabled() {
                providers.push(provider);
            }
        }
    }
    providers
}
