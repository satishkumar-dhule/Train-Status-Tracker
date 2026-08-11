//! Rail Saarthi — `tt-provider-etrain` crate.
//!
//! Seam: the etrain.info (TripOzo) upstream adapter. etrain serves
//! server-rendered HTML rather than JSON, so this adapter fetches the `/live`
//! page via [`tt_provider_http::fetch_provider_text`] and scrapes the embedded
//! running-status table with regexes pinned to a documented fixture (see
//! [`map_etrain_payload`]).
//!
//! Slug construction: etrain's canonical URL is
//! `https://etrain.info/train/{slug}-{train_no}/live?date=YYYYMMDD`, but the
//! slug (e.g. `12301-RAJDHANI-EXPRES`) cannot be derived from the train number
//! alone. In practice etrain redirects slug-less `/train/{train_no}/live`
//! URLs, so this adapter uses the slug-less form as the primary URL.
//!
//! The reverse-engineered ajax endpoint (`ajax.php?q=runningstatus`) is
//! anti-bot gated and returns a fixed `{"error":"Some feature has been
//! Changed/Upgraded..."}` body regardless of request shape (verified 3×), so
//! it is deliberately not implemented. That body fails the running-status
//! table marker check and surfaces as an upstream error — never a parse
//! failure and never a false not-found.
//!
//! Deep module: the public surface is small; the implementation lives in
//! private submodules. Callers depend on [`EtrainProvider`] through
//! [`tt_provider_core::TrainStatusProvider`] and reason about failure through
//! [`tt_provider_core::ProviderError`].
//!
//! Public surface:
//!
//! - [`EtrainProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam.
//! - [`create_etrain_provider`] — the factory.
//! - [`map_etrain_payload`] — the HTML → [`tt_mapper::MappedStatus`] parser.
//! - [`to_etrain_date`] — `YYYYMMDD` passthrough validator.

mod map;
mod provider;

pub use map::{map_etrain_payload, to_etrain_date};
pub use provider::{create_etrain_provider, EtrainProvider};
