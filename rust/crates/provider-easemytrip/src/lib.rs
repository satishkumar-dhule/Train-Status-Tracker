//! Rail Saarthi — `tt-provider-easemytrip` crate.
//!
//! Seam: the EaseMyTrip upstream adapter, ported 1:1 from
//! `lib/providers/easemytrip.ts`. EaseMyTrip serves an HTML page rather than
//! JSON, so this adapter fetches via [`tt_provider_http::fetch_provider_text`]
//! and scrapes station blocks with the exact regexes from the reference
//! implementation.
//!
//! Deep module: the public surface is small; the implementation lives in
//! private submodules. Callers depend on [`EaseMyTripProvider`] through
//! [`tt_provider_core::TrainStatusProvider`] and reason about failure through
//! [`tt_provider_core::ProviderError`].
//!
//! Public surface:
//!
//! - [`EaseMyTripProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam.
//! - [`create_easemytrip_provider`] — the factory mirroring the TS
//!   `createEaseMyTripProvider`.
//! - [`parse_easemytrip_html`] — the HTML → normalized rows parser.
//! - [`map_easemytrip_html`] — page → [`tt_mapper::MappedStatus`].
//! - [`to_easemytrip_date`] — `YYYYMMDD` → `DD/MM/YYYY`.

mod map;
mod provider;

pub use map::{map_easemytrip_html, parse_easemytrip_html, to_easemytrip_date};
pub use provider::{create_easemytrip_provider, EaseMyTripProvider};
