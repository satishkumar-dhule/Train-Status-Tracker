//! Rail Saarthi — `tt-provider-ntes` crate.
//!
//! Seam: the CRIS NTES (official Indian Railways) upstream adapter — an
//! encrypted JSON POST against `enquiry.indianrail.gov.in/crisns/AppServAnd`.
//! The fetch leg uses the shared [`tt_provider_http::fetch_provider_json`]
//! classification; the CRIS AES envelope, request encoding, and payload
//! parsing live here.
//!
//! Deep module: the public surface is small; the implementation (including the
//! envelope crypto) lives in private submodules. Callers depend on
//! [`NtesProvider`] through [`tt_provider_core::TrainStatusProvider`] and
//! reason about failure through [`tt_provider_core::ProviderError`].
//!
//! Public surface:
//!
//! - [`NtesProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam.
//! - [`create_ntes_provider`] — the factory.
//! - [`map_ntes_payload`] — decrypted NTES run JSON →
//!   [`tt_mapper::MappedStatus`].
//! - [`to_ntes_date`] — `YYYYMMDD` → `DD-MMM-YYYY`.

mod crypto;
mod crypto_error;
mod map;
mod provider;

pub use map::{map_ntes_payload, to_ntes_date};
pub use provider::{create_ntes_provider, NtesProvider};
