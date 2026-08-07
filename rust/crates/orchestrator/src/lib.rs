//! Rail Saarthi — `tt-orchestrator` crate.
//!
//! Seam: `fetch_status_with_failover` — try enabled providers in order,
//! record QoS, classify.
//!
//! Port of `lib/providers/orchestrator.ts`, with the ZTA classification
//! policy preserved 1:1:
//!
//! - Only a not-found verdict from *every* consulted provider is treated as
//!   "train not found". A single ambiguous/errored provider must not poison
//!   the shared negative cache with a false 404.
//! - If every provider errors, surface an upstream error.
//! - Any other thrown error (a programming bug) is rethrown immediately
//!   rather than masked by failover.
//!
//! Deep module: the whole public surface is [`fetch_status_with_failover`]
//! and [`FailoverOptions`]; the timeout walk and telemetry recording live in
//! private submodules.

mod failover;

pub use failover::{fetch_status_with_failover, FailoverOptions};
