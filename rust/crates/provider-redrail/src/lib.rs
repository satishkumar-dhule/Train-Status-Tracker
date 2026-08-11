//! Rail Saarthi — `tt-provider-redrail` crate.
//!
//! Seam: the RedBus Rail (redRail) upstream adapter, a JSON GET against
//! `loco.redbus.com/api/Rails/v2/RIS/GetLiveTrainStatus`. The fetch leg uses
//! the shared [`tt_provider_http::fetch_provider_json`] classification; only
//! the request encoding (the channel headers the mobile app sends) and
//! payload parsing live here.
//!
//! Deep module: the public surface is small; the implementation lives in
//! private submodules. Callers depend on [`RedRailProvider`] through
//! [`tt_provider_core::TrainStatusProvider`] and reason about failure through
//! [`tt_provider_core::ProviderError`].
//!
//! Public surface:
//!
//! - [`RedRailProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam.
//! - [`create_redrail_provider`] — the factory.
//! - [`map_redrail_payload`] — untrusted RedRail body →
//!   [`tt_mapper::MappedStatus`].
//! - [`to_redrail_date`] — `YYYYMMDD` → `YYYY-MM-DD`.

mod map;
mod provider;

pub use map::{map_redrail_payload, to_redrail_date};
pub use provider::{create_redrail_provider, RedRailProvider};
