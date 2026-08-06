//! Rail Saarthi — `tt-logging` crate.
//!
//! Seam: structured JSON logger (pino-equivalent). The TypeScript server logs
//! JSON via pino; this crate produces the same shape with
//! `tracing` + `tracing-subscriber` (json feature).
//!
//! Deep module: the public surface here — [`Level`], [`init`], [`LogGuard`],
//! and [`warn_event`] — is the whole seam; the details are hidden in private
//! submodules and tested at this boundary.
//!
//! [`init`] installs a *global* subscriber (via
//! `tracing::subscriber::set_global_default`) so every thread of the server
//! logs structured JSON. The returned [`LogGuard`] is a lifetime marker: it
//! does nothing on drop, but must be held for the app's lifetime, and only one
//! call to [`init`] may ever happen per process.

mod level;
mod logger;

pub use level::Level;
pub use logger::{init, warn_event, LogGuard};
