//! Rail Saarthi — `tt-telemetry` crate.
//!
//! Seam: OpenTelemetry init + handles (tracer, meter) + RED-metrics helper.
//! Port of `lib/telemetry.ts` and `lib/http-metrics.ts`.
//!
//! # Handle shape (read before using)
//!
//! [`Telemetry`] is obtained from [`init`] once at startup. It always yields
//! *usable* handles — [`Telemetry::tracer`], [`Telemetry::meter`], and
//! [`Telemetry::http_metrics`] — regardless of whether telemetry is enabled.
//! When disabled (the default) or when the `otlp` cargo feature is off, every
//! handle is **inert**: spans and metrics are recorded against internal
//! `None`s and disappear, exactly like the no-op `@opentelemetry/api` in the
//! TypeScript server. Later slices can therefore call
//! `telemetry.tracer().start("name")` / `telemetry.http_metrics().record(...)`
//! unconditionally without feature-gating their own code.
//!
//! # Features
//!
//! - `default`: no heavy dependencies. `init` builds a no-op [`Telemetry`]
//!   even when the environment opts in, logging a warning.
//! - `otlp`: real OpenTelemetry SDK + OTLP/HTTP exporters (reqwest blocking,
//!   so no async runtime is needed). Only then are spans/metrics exported.
//!
//! The enabled-detection rules live in [`tt_config::OtelConfig`] (the `OTEL_*`
//! env surface, ported 1:1 from `parseTelemetryConfig`); the rules table is
//! exercised in this crate's tests, driving [`tt_config::Config::parse`].
//!
//! # Pending for Slice 04
//!
//! - W3C `traceparent` propagation + active-span context (log correlation) —
//!   `tracing-opentelemetry` would be required; deliberately skipped here.
//! - Global provider registration (this crate keeps providers owned by
//!   [`Telemetry`] instead of registering them globally).

#[cfg(not(feature = "otlp"))]
mod noop;
#[cfg(feature = "otlp")]
mod otlp;

mod telemetry;

pub use telemetry::{init, is_enabled, Telemetry};

#[cfg(not(feature = "otlp"))]
pub use noop::{HttpMetrics, Meter, ProviderMetrics, Span, Tracer};
#[cfg(feature = "otlp")]
pub use otlp::{HttpMetrics, Meter, ProviderMetrics, Span, Tracer};
