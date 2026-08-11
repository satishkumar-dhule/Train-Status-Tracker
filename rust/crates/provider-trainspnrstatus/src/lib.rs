//! Rail Saarthi — `tt-provider-trainspnrstatus` crate.
//!
//! Seam: the trainspnrstatus.com upstream adapter, a JSON POST against
//! `trainspnrstatus.com/api/fetch-live-status` (the endpoint the site's React
//! bundle posts to). The fetch leg uses the shared
//! [`tt_provider_http::fetch_provider_json`] classification; only the request
//! encoding (the JSON body) and payload parsing live here.
//!
//! Deep module: the public surface is small; the implementation lives in
//! private submodules. Callers depend on [`TrainSpnrStatusProvider`] through
//! [`tt_provider_core::TrainStatusProvider`] and reason about failure through
//! [`tt_provider_core::ProviderError`].
//!
//! Public surface:
//!
//! - [`TrainSpnrStatusProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam.
//! - [`create_trainspnrstatus_provider`] — the factory.
//! - [`map_trainspnrstatus_payload`] — untrusted trainspnrstatus body →
//!   [`tt_mapper::MappedStatus`].
//! - [`to_trainspnrstatus_date`] — `YYYYMMDD` → `YYYY-MM-DD`.

mod map;
mod provider;

pub use map::{map_trainspnrstatus_payload, to_trainspnrstatus_date};
pub use provider::{create_trainspnrstatus_provider, TrainSpnrStatusProvider};
