//! Rail Saarthi — `tt-provider-railbeeps` crate.
//!
//! Seam: the NDTV railbeeps upstream adapter, a JSON GET against
//! `api.railbeeps.com` using the public web API key hard-coded in NDTV's site
//! bundle. The response is an untrusted JSON body with a station list.
//!
//! Deep module: the public surface is small; the implementation lives in
//! private submodules. Callers depend on [`RailBeepsProvider`] through
//! [`tt_provider_core::TrainStatusProvider`] and reason about failure through
//! [`tt_provider_core::ProviderError`].
//!
//! Public surface:
//!
//! - [`RailBeepsProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam.
//! - [`create_railbeeps_provider`] — the factory.
//! - [`map_railbeeps_payload`] — untrusted body → [`tt_mapper::MappedStatus`].
//! - [`to_railbeeps_date`] — `YYYYMMDD` → `D MMM` (upstream form).

mod map;
mod provider;

pub use map::{map_railbeeps_payload, to_railbeeps_date};
pub use provider::{create_railbeeps_provider, RailBeepsProvider};
