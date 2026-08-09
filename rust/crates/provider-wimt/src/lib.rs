//! Rail Saarthi — `tt-provider-wimt` crate.
//!
//! Seam: the WhereIsMyTrain upstream adapter, ported 1:1 from
//! `lib/providers/whereismytrain.ts`. WIMT does not expose station names, so
//! rows carry empty names for the name-lookup layer to fill in.
//!
//! Deep module: the public surface is small; the implementation lives in
//! private submodules. Callers depend on [`WhereIsMyTrainProvider`] through
//! [`tt_provider_core::TrainStatusProvider`] and reason about failure through
//! [`tt_provider_core::ProviderError`].
//!
//! Public surface:
//!
//! - [`WhereIsMyTrainProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam.
//! - [`create_whereismytrain_provider`] — the factory mirroring the TS
//!   `createWhereIsMyTrainProvider`.
//! - [`map_wimt_payload`] — untrusted WIMT body → [`tt_mapper::MappedStatus`].
//! - [`to_wimt_date`] — `YYYYMMDD` → `DD-MM-YYYY`.

mod map;
mod provider;

pub use map::{map_wimt_payload, to_wimt_date};
pub use provider::{create_whereismytrain_provider, WhereIsMyTrainProvider};
