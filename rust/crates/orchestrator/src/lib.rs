//! Rail Saarthi — `tt-orchestrator` crate.
//!
//! Seam: `fetch_status_with_failover` — try enabled providers in order,
//! record QoS, classify — and `build_status_providers` — assemble the
//! concrete provider list from configured names (the Rust counterpart of
//! `lib/providers/registry.ts`).
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
//! with [`FailoverOptions`], plus [`build_status_providers`]; the timeout walk
//! and telemetry recording live in private submodules.

mod failover;
mod registry;

pub use failover::{fetch_status_with_failover, FailoverOptions};
pub use registry::build_status_providers;
