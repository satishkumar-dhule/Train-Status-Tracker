//! Rail Saarthi — `tt-provider-runningstatus` crate.
//!
//! Seam: the runningstatus.in upstream adapter, an HTML scraper against
//! `https://runningstatus.in/status/{train_no}-on-{YYYYMMDD}`. runningstatus.in
//! is the site the RSTGCN paper scraped for its open dataset (§6 of
//! `docs/providers-research.md`), so it is a primary-source target. The site is
//! Cloudflare-guarded from this sandbox, so the adapter surfaces any blocked
//! response as [`tt_provider_core::ProviderError::Upstream`] via the fetch
//! layer, and the scraper is pinned to the documented station-table structure.
//!
//! Deep module: the public surface is small; the implementation lives in
//! private submodules. Callers depend on [`RunningStatusProvider`] through
//! [`tt_provider_core::TrainStatusProvider`] and reason about failure through
//! [`tt_provider_core::ProviderError`].
//!
//! Public surface:
//!
//! - [`RunningStatusProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam.
//! - [`create_runningstatus_provider`] — the factory.
//! - [`parse_runningstatus_html`] — page → normalized station rows.
//! - [`map_runningstatus_html`] — page → [`tt_mapper::MappedStatus`].
//! - [`to_runningstatus_date`] — `YYYYMMDD` passthrough validator.

mod map;
mod provider;

pub use map::{map_runningstatus_html, parse_runningstatus_html, to_runningstatus_date};
pub use provider::{create_runningstatus_provider, RunningStatusProvider};
