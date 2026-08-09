//! Rail Saarthi — `tt-provider-railradar` crate.
//!
//! Seam: the RailRadar upstream adapter, ported 1:1 from
//! `lib/providers/railradar.ts`. RailRadar serves an ISO-timestamped JSON
//! body; times are sliced to `HH:MM` with `iso_time_of_day`.
//!
//! Deep module: the public surface is small; the implementation lives in
//! private submodules. Callers depend on [`RailRadarProvider`] through
//! [`tt_provider_core::TrainStatusProvider`] and reason about failure through
//! [`tt_provider_core::ProviderError`]. The adapter is *disabled* unless an
//! API key is configured, mirroring the TS `enabled = !!apiKey` gate.
//!
//! Public surface:
//!
//! - [`RailRadarProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam.
//! - [`create_railradar_provider`] — the factory mirroring the TS
//!   `createRailRadarProvider({ apiKey })`.
//! - [`map_railradar_payload`] — untrusted RailRadar body →
//!   [`tt_mapper::MappedStatus`].
//! - [`to_railradar_date`] — `YYYYMMDD` → `DD-MM-YYYY`.

mod map;
mod provider;

pub use map::{map_railradar_payload, to_railradar_date};
pub use provider::{create_railradar_provider, RailRadarProvider};
