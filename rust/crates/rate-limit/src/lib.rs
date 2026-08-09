//! Rail Saarthi — `tt-rate-limit` crate.
//!
//! Seam: per-key fixed-window rate limiter.
//!
//! Deep module: the whole public surface is below (a limiter with
//! [`RateLimiter::check`] plus the options/results it consumes); the
//! implementation lives in the private `window` submodule. Ported 1:1 from
//! `createRateLimiter` in `lib/rate-limit.ts` — a zero-dependency fixed-window
//! limiter keyed by an arbitrary string (e.g. a client IP). State is
//! in-process only, so limits apply per instance.

mod window;

pub use window::{create_rate_limiter, RateLimitOptions, RateLimitResult, RateLimiter};
