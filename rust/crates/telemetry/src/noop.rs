//! Inert handles for the default build (no `otlp` feature).
//!
//! These mirror the public API of the real handles in `otlp.rs` exactly, but
//! every method is a no-op. Kept feature-agnostic so later slices never need to
//! know whether telemetry is actually enabled.

/// A started span handle. All methods are no-ops.
pub struct Span {}

impl Span {
    pub(crate) fn noop() -> Span {
        Span {}
    }

    /// No-op when telemetry is disabled.
    pub fn set_attribute(&self, _key: &str, _value: &str) {}

    /// No-op when telemetry is disabled.
    pub fn end(self) {}
}

/// A tracer handle that produces inert spans.
pub struct Tracer {}

impl Tracer {
    pub(crate) fn noop() -> Tracer {
        Tracer {}
    }

    /// Starts a span; the returned handle is inert when telemetry is disabled.
    pub fn start(&self, _name: &'static str) -> Span {
        Span::noop()
    }

    /// Runs `f` with a started span, ending it afterwards.
    pub fn in_span<R>(&self, name: &'static str, f: impl FnOnce(&Span) -> R) -> R {
        let span = self.start(name);
        let result = f(&span);
        span.end();
        result
    }
}

/// A meter handle. Kept minimal: instruments are built internally; exposing the
/// raw handle is a `tt-telemetry` concern for later slices to extend.
pub struct Meter {}

impl Meter {
    pub(crate) fn noop() -> Meter {
        Meter {}
    }
}

/// RED-metrics recorder. Port of `observeRequestCompletion` in
/// `lib/http-metrics.ts`; a no-op when telemetry is disabled.
pub struct HttpMetrics {}

impl HttpMetrics {
    pub(crate) fn noop() -> HttpMetrics {
        HttpMetrics {}
    }

    /// Records completion for a single request. No-op when disabled.
    pub fn record(&self, _status: u16, _duration_ms: f64, _method: &str, _route: &str) {}
}
