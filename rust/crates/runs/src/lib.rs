//! Rail Saarthi — `tt-runs` crate.
//!
//! Seam: run-date derivation for a single train — port of `lib/train-runs.ts`
//! — answering "which dates does this train run?" for the
//! `GET /api/trains/runs` route.
//!
//! Deep module: the public surface below is small; the implementation lives in
//! private submodules (`probe`, `parse`). Callers feed in the transport seam
//! and a pinned clock; the crate returns the derived weekdays and run dates.
//!
//! Public surface:
//!
//! - [`probe_train_runs`] — probe the data provider across a trailing window
//!   and derive the train's running-weekday pattern.
//! - [`compute_run_dates`] — the last 3 run dates up to today plus the next
//!   upcoming run, from a weekday pattern.
//! - [`parse_schedule_weekdays`] — parse the provider's "runs only on MON,FRI"
//!   schedule note.
//! - [`RunWeekdaysResult`], [`ProbeTrainRunsOptions`], [`RUN_WINDOW_DAYS`].

mod parse;
mod probe;

pub use parse::parse_schedule_weekdays;
pub use probe::{
    compute_run_dates, probe_train_runs, ProbeTrainRunsOptions, RunWeekdaysResult,
    RUN_WINDOW_DAYS,
};
