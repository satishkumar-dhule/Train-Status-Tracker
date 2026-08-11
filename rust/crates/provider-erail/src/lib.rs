//! Rail Saarthi — `tt-provider-erail` crate.
//!
//! Seam: the erail.in upstream adapter. erail.in serves an ASP.NET-rendered
//! HTML page at `https://erail.in/train-enquiry/{train_no}` carrying the full
//! *schedule* of the train: a station list, scheduled times, and platforms.
//! Live status on erail runs over a SignalR peer network rather than plain
//! HTML, so the server page is a schedule source: actual arrival/departure
//! fields are left `None` unless the embedded data carries them (it usually
//! does not), and the shared assembler computes delay only where an actual is
//! present. The adapter fetches via
//! [`tt_provider_http::fetch_provider_text`] and maps with
//! [`map_erail_payload`] (embedded JSON first, `<table>` fallback — both
//! pinned to documented fixtures in `map.rs`).
//!
//! Deep module: the public surface is small; the implementation lives in
//! private submodules. Callers depend on [`ErailProvider`] through
//! [`tt_provider_core::TrainStatusProvider`] and reason about failure through
//! [`tt_provider_core::ProviderError`].
//!
//! Public surface:
//!
//! - [`ErailProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam.
//! - [`create_erail_provider`] — the factory.
//! - [`map_erail_payload`] — the HTML → [`tt_mapper::MappedStatus`] parser.
//! - [`to_erail_date`] — `YYYYMMDD` passthrough validator.

mod map;
mod provider;

pub use map::{map_erail_payload, to_erail_date};
pub use provider::{create_erail_provider, ErailProvider};
