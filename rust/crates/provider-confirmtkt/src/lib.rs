//! Rail Saarthi — `tt-provider-confirmtkt` crate.
//!
//! Seam: the ConfirmTkt upstream adapter, a JSON GET against
//! `api.confirmtkt.com/api/trains/livestatusall`. The fetch leg uses the
//! shared [`tt_provider_http::fetch_provider_json`] classification; only the
//! request encoding and payload parsing live here.
//!
//! Deep module: the public surface is small; the implementation lives in
//! private submodules. Callers depend on [`ConfirmTktProvider`] through
//! [`tt_provider_core::TrainStatusProvider`] and reason about failure through
//! [`tt_provider_core::ProviderError`].
//!
//! Public surface:
//!
//! - [`ConfirmTktProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam.
//! - [`create_confirmtkt_provider`] — the factory.
//! - [`map_confirmtkt_payload`] — untrusted ConfirmTkt body →
//!   [`tt_mapper::MappedStatus`].
//! - [`to_confirmtkt_date`] — `YYYYMMDD` → `DD-MM-YYYY`.

mod map;
mod provider;

pub use map::{map_confirmtkt_payload, to_confirmtkt_date};
pub use provider::{create_confirmtkt_provider, ConfirmTktProvider};
