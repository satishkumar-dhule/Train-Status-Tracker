//! Rail Saarthi — `tt-provider-indianrailapi` crate.
//!
//! Seam: the indianrailapi.com upstream adapter. The API is a JSON GET with the
//! API key embedded in the URL path, gated exactly like the existing railradar
//! provider: the adapter is *disabled* unless a key is configured, so it never
//! runs against an unconfigured key in production.
//!
//! Deep module: the public surface is small; the implementation lives in
//! private submodules. Callers depend on [`IndianRailApiProvider`] through
//! [`tt_provider_core::TrainStatusProvider`] and reason about failure through
//! [`tt_provider_core::ProviderError`].
//!
//! Public surface:
//!
//! - [`IndianRailApiProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam.
//! - [`create_indianrailapi_provider`] — the factory taking the optional API
//!   key (mirrors the railradar key gate).
//! - [`map_indianrailapi_payload`] — untrusted body → [`tt_mapper::MappedStatus`].
//! - [`to_indianrailapi_date`] — `YYYYMMDD` → `DD-MM-YYYY` (upstream form).

mod map;
mod provider;

pub use map::{map_indianrailapi_payload, to_indianrailapi_date};
pub use provider::{create_indianrailapi_provider, IndianRailApiProvider};
