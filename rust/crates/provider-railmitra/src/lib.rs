//! Rail Saarthi — `tt-provider-railmitra` crate.
//!
//! Seam: the railmitra.com upstream adapter, an HTML scraper against
//! `https://www.railmitra.com/live-train-running-status/{train_no}`. Unlike a
//! JSON adapter, the fetch leg uses [`tt_provider_http::fetch_provider_text`]
//! and the payload is scraped with the documented regexes in `map` (no HTML
//! parser — the layout-dependent extraction is pinned by the fixtures).
//!
//! Deep module: the public surface is small; the implementation lives in
//! private submodules. Callers depend on [`RailMitraProvider`] through
//! [`tt_provider_core::TrainStatusProvider`] and reason about failure through
//! [`tt_provider_core::ProviderError`].
//!
//! Public surface:
//!
//! - [`RailMitraProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam.
//! - [`create_railmitra_provider`] — the factory.
//! - [`map_railmitra_payload`] — page → [`tt_mapper::MappedStatus`].
//! - [`to_railmitra_date`] — `YYYYMMDD` passthrough validator (the RailMitra
//!   URL carries no date parameter).

mod map;
mod provider;

pub use map::{map_railmitra_payload, to_railmitra_date};
pub use provider::{create_railmitra_provider, RailMitraProvider};
