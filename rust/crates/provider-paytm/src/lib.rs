//! Rail Saarthi — `tt-provider-paytm` crate.
//!
//! Seam: the Paytm upstream adapter, ported 1:1 from `lib/providers/paytm.ts`
//! and `lib/paytm-client.ts` (the fetch leg is superseded by
//! `tt-provider-http`; only the parsing/classification is ported).
//!
//! Deep module: the public surface below is small; the implementation lives in
//! private submodules. Callers depend on [`PaytmProvider`] through
//! [`tt_provider_core::TrainStatusProvider`] and reason about failure through
//! [`tt_provider_core::ProviderError`] — never through this crate's internals.
//!
//! Public surface:
//!
//! - [`PaytmProvider`] — the adapter, constructed over the injected
//!   [`tt_provider_http::HttpTransport`] seam (never reqwest directly).
//! - [`create_paytm_provider`] — the factory mirroring the TS
//!   `createPaytmProvider`.
//! - [`map_paytm_payload`] — untrusted Paytm body → [`tt_mapper::MappedStatus`],
//!   adapting the Paytm error taxonomy into [`tt_provider_core::ProviderError`].
//! - [`parse_paytm_response_body`] — the shared validation/extraction gate,
//!   mirroring `parsePaytmResponseBody` in `lib/paytm-client.ts`.

mod coerce;
mod map;
mod parse;
mod provider;
mod row;

pub use map::map_paytm_payload;
pub use parse::{parse_paytm_response_body, PaytmError, PaytmTrainStatusPayload};
pub use provider::{create_paytm_provider, PaytmProvider};
