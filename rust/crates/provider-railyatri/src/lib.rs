//! Rail Saarthi — `tt-provider-railyatri` crate.
//!
//! Seam: the RailYatri upstream adapter, ported 1:1 from
//! `lib/providers/railyatri.ts`. RailYatri's endpoint has no date parameter —
//! it serves "today" (`start_day=0`) or "yesterday" (`start_day=1`) relative to
//! the server's local time, so [`compute_start_day`] rejects anything outside
//! that window rather than silently returning a wrong date. The current date
//! is injectable (`now`), like the TS `RailYatriProvider({ now })` constructor.
//!
//! Deep module: the public surface is small; the implementation lives in
//! private submodules. Callers depend on [`RailYatriProvider`] through
//! [`tt_provider_core::TrainStatusProvider`] and reason about failure through
//! [`tt_provider_core::ProviderError`].
//!
//! Public surface:
//!
//! - [`RailYatriProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam.
//! - [`create_railyatri_provider`] — the factory mirroring the TS
//!   `createRailYatriProvider`.
//! - [`compute_start_day`] — the today/yesterday window check.
//! - [`map_railyatri_payload`] — untrusted RailYatri body → [`tt_mapper::MappedStatus`].

mod map;
mod provider;

pub use map::{compute_start_day, map_railyatri_payload};
pub use provider::{create_railyatri_provider, RailYatriProvider};
