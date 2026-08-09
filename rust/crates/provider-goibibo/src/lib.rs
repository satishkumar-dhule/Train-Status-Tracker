//! Rail Saarthi — `tt-provider-goibibo` crate.
//!
//! Seam: the Goibibo/MMT upstream adapter, ported 1:1 from
//! `lib/providers/goibibo.ts`. The fetch leg uses the shared
//! [`tt_provider_http::fetch_provider_json`] classification; only the request
//! encoding and payload parsing are ported here.
//!
//! Deep module: the public surface is small; the implementation lives in
//! private submodules. Callers depend on [`GoibiboProvider`] through
//! [`tt_provider_core::TrainStatusProvider`] and reason about failure through
//! [`tt_provider_core::ProviderError`].
//!
//! Public surface:
//!
//! - [`GoibiboProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam.
//! - [`create_goibibo_provider`] — the factory mirroring the TS
//!   `createGoibiboProvider`.
//! - [`map_goibibo_payload`] — untrusted Goibibo body → [`tt_mapper::MappedStatus`].
//! - [`to_goibibo_date`] — `YYYYMMDD` → `DD-MM-YYYY`.

mod map;
mod provider;

pub use map::{map_goibibo_payload, to_goibibo_date};
pub use provider::{create_goibibo_provider, GoibiboProvider};
