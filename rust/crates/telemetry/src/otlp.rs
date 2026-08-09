//! Real OpenTelemetry handles + provider building for the `otlp` feature.
//!
//! The public API mirrors `noop.rs` exactly; behind the scenes spans and metric
//! records are handed to the OpenTelemetry SDK and exported over OTLP/HTTP
//! (reqwest blocking client, so no async runtime is required).

use std::cell::RefCell;

use opentelemetry::metrics::{Counter, Histogram};
use opentelemetry::KeyValue;
use opentelemetry_otlp::{WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::metrics::{PeriodicReader, SdkMeterProvider, Temporality};
use opentelemetry_sdk::resource::Resource;
use opentelemetry_sdk::trace::{Sampler, SdkTracer, SdkTracerProvider};

use tt_config::OtelConfig;

// The API `Span`/`Tracer` traits bring the `set_attribute`/`end`/`start`
// methods into scope; imported anonymously so they don't clash with our
// handle types of the same name.
use opentelemetry::trace::Span as _;
use opentelemetry::trace::Tracer as _;

const SERVICE_NAME: &str = "train-tracker-api";

/// A started span handle wrapping the OpenTelemetry span.
pub struct Span {
    // `RefCell` for interior mutability: the SDK `Span` methods take `&mut self`
    // but the handle API exposes `&self`, mirroring `noop.rs`.
    inner: RefCell<Option<opentelemetry_sdk::trace::Span>>,
}

impl Span {
    pub(crate) fn noop() -> Span {
        Span {
            inner: RefCell::new(None),
        }
    }

    pub(crate) fn with_inner(inner: opentelemetry_sdk::trace::Span) -> Span {
        Span {
            inner: RefCell::new(Some(inner)),
        }
    }

    /// Sets an attribute on the span; no-op when telemetry is disabled.
    pub fn set_attribute(&self, key: &str, value: &str) {
        if let Some(span) = self.inner.borrow_mut().as_mut() {
            span.set_attribute(KeyValue::new(key.to_string(), value.to_string()));
        }
    }

    /// Ends the span; no-op when telemetry is disabled.
    pub fn end(self) {
        if let Some(mut span) = self.inner.into_inner() {
            span.end();
        }
    }
}

/// A tracer handle. Inert when `inner` is `None`.
pub struct Tracer {
    inner: Option<SdkTracer>,
}

impl Tracer {
    pub(crate) fn noop() -> Tracer {
        Tracer { inner: None }
    }

    pub(crate) fn new(inner: SdkTracer) -> Tracer {
        Tracer { inner: Some(inner) }
    }

    /// Starts a span in the current context; inert when telemetry is disabled.
    ///
    /// Note: the span is *not* made the active span (no context activation),
    /// so child spans / log correlation are not wired up yet — see the
    /// "Pending for Slice 04" notes in the crate docs.
    pub fn start(&self, name: &'static str) -> Span {
        match &self.inner {
            Some(tracer) => Span::with_inner(tracer.start(name)),
            None => Span::noop(),
        }
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

    pub(crate) fn new() -> Meter {
        Meter {}
    }
}

/// RED-metrics recorder. Port of `observeRequestCompletion` in
/// `lib/http-metrics.ts`: a route-scoped `app.http.request.duration` histogram
/// (seconds) with `http.request.method`, `http.response.status_code`,
/// `url.route`, and — on 5xx — `error.type` attributes.
pub struct HttpMetrics {
    histogram: Option<Histogram<f64>>,
}

impl HttpMetrics {
    pub(crate) fn noop() -> HttpMetrics {
        HttpMetrics { histogram: None }
    }

    pub(crate) fn from_meter(meter: opentelemetry::metrics::Meter) -> HttpMetrics {
        let histogram = meter
            .f64_histogram("app.http.request.duration")
            .with_description("HTTP server request duration in seconds, by route.")
            .with_unit("s")
            .with_boundaries(vec![
                0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 7.5, 10.0,
            ])
            .build();
        HttpMetrics {
            histogram: Some(histogram),
        }
    }

    /// Records completion for a single request. No-op when telemetry is disabled.
    pub fn record(&self, status: u16, duration_ms: f64, method: &str, route: &str) {
        if let Some(histogram) = &self.histogram {
            let mut attributes = vec![
                KeyValue::new("http.request.method", method.to_string()),
                KeyValue::new("http.response.status_code", i64::from(status)),
                KeyValue::new("url.route", route.to_string()),
            ];
            if status >= 500 {
                attributes.push(KeyValue::new("error.type", format!("HTTP {status}")));
            }
            histogram.record(duration_ms / 1000.0, &attributes);
        }
    }
}

/// Provider-failover recorder. Port of `recordFailover` in
/// `lib/providers/orchestrator.ts`: a counter `app.provider.failover`
/// incremented by 1 with `outcome` and `attempts` attributes.
pub struct ProviderMetrics {
    counter: Option<Counter<u64>>,
}

impl ProviderMetrics {
    pub(crate) fn noop() -> ProviderMetrics {
        ProviderMetrics { counter: None }
    }

    pub(crate) fn from_meter(meter: opentelemetry::metrics::Meter) -> ProviderMetrics {
        let counter = meter
            .u64_counter("app.provider.failover")
            .with_description("Train status lookups that needed failover, by outcome and attempts")
            .build();
        ProviderMetrics {
            counter: Some(counter),
        }
    }

    /// Records one failover outcome (`recovered` / `not_found` /
    /// `upstream_error`) with the number of provider attempts. No-op when
    /// telemetry is disabled.
    pub fn record_failover(&self, outcome: &str, attempts: u64) {
        if let Some(counter) = &self.counter {
            counter.add(
                1,
                &[
                    KeyValue::new("outcome", outcome.to_string()),
                    KeyValue::new("attempts", attempts as i64),
                ],
            );
        }
    }
}

/// Cache and Redis recorder. Port of the instruments created by
/// `lib/ttl-cache.ts` and `lib/redis-cache.ts`: the L1 counters
/// (`trains.status.cache.hits`/`misses`/`evictions`/`single_flight`), the L1
/// size gauge, the `trains.status.redis.requests` counter (with `operation`
/// and `outcome` attributes), and the `trains.status.redis.duration`
/// histogram (seconds).
#[derive(Clone)]
pub struct CacheMetrics {
    hits: Option<Counter<u64>>,
    misses: Option<Counter<u64>>,
    evictions: Option<Counter<u64>>,
    single_flight: Option<Counter<u64>>,
    size_gauge: Option<opentelemetry::metrics::ObservableGauge<i64>>,
    redis_requests: Option<Counter<u64>>,
    redis_duration: Option<Histogram<f64>>,
}

impl CacheMetrics {
    pub(crate) fn noop() -> CacheMetrics {
        CacheMetrics {
            hits: None,
            misses: None,
            evictions: None,
            single_flight: None,
            size_gauge: None,
            redis_requests: None,
            redis_duration: None,
        }
    }

    pub(crate) fn from_meter(meter: opentelemetry::metrics::Meter) -> CacheMetrics {
        let hits = meter
            .u64_counter("trains.status.cache.hits")
            .with_description("Train status cache hits")
            .build();
        let misses = meter
            .u64_counter("trains.status.cache.misses")
            .with_description("Train status cache misses")
            .build();
        let evictions = meter
            .u64_counter("trains.status.cache.evictions")
            .with_description("Entries dropped from the L1 TTL cache (expiry or cap)")
            .build();
        let single_flight = meter
            .u64_counter("trains.status.cache.single_flight")
            .with_description("Times a concurrent caller shared an in-flight cache producer")
            .build();
        let size_gauge = meter
            .i64_observable_gauge("trains.status.cache.size")
            .with_description("Current number of entries in the L1 TTL cache")
            .with_unit("{entry}")
            .build();
        let redis_requests = meter
            .u64_counter("trains.status.redis.requests")
            .with_description("Redis cache operations by operation and outcome")
            .build();
        let redis_duration = meter
            .f64_histogram("trains.status.redis.duration")
            .with_description("Redis cache operation latency")
            .with_unit("s")
            .build();
        CacheMetrics {
            hits: Some(hits),
            misses: Some(misses),
            evictions: Some(evictions),
            single_flight: Some(single_flight),
            size_gauge: Some(size_gauge),
            redis_requests: Some(redis_requests),
            redis_duration: Some(redis_duration),
        }
    }

    /// Increments `trains.status.cache.hits`. No-op when disabled.
    pub fn record_l1_hit(&self) {
        if let Some(counter) = &self.hits {
            counter.add(1, &[]);
        }
    }

    /// Increments `trains.status.cache.misses`. No-op when disabled.
    pub fn record_l1_miss(&self) {
        if let Some(counter) = &self.misses {
            counter.add(1, &[]);
        }
    }

    /// Increments `trains.status.cache.single_flight`. No-op when disabled.
    pub fn record_l1_single_flight(&self) {
        if let Some(counter) = &self.single_flight {
            counter.add(1, &[]);
        }
    }

    /// Adds `count` to `trains.status.cache.evictions`. No-op when disabled.
    pub fn record_l1_evictions(&self, count: u64) {
        if let Some(counter) = &self.evictions {
            counter.add(count, &[]);
        }
    }

    /// Observes the current L1 entry count for `trains.status.cache.size`.
    /// No-op when disabled.
    pub fn observe_l1_size(&self, size: usize) {
        if let Some(gauge) = &self.size_gauge {
            gauge.observe(i64::try_from(size).unwrap_or(i64::MAX), &[]);
        }
    }

    /// Records one Redis cache operation on `trains.status.redis.requests`
    /// (counter, with `operation`/`outcome` attributes) and
    /// `trains.status.redis.duration` (histogram, seconds). No-op when
    /// disabled.
    pub fn record_redis(&self, operation: &str, outcome: &str, duration_secs: f64) {
        if let Some(counter) = &self.redis_requests {
            counter.add(
                1,
                &[
                    KeyValue::new("operation", operation.to_string()),
                    KeyValue::new("outcome", outcome.to_string()),
                ],
            );
        }
        if let Some(histogram) = &self.redis_duration {
            histogram.record(
                duration_secs,
                &[
                    KeyValue::new("operation", operation.to_string()),
                    KeyValue::new("outcome", outcome.to_string()),
                ],
            );
        }
    }
}

/// Rate-limit decision recorder. Port of the counter created by
/// `createRateLimitMiddleware` in `lib/rate-limit.ts`: `app.rate_limit.decisions`
/// incremented by 1 with `result` and an optional `route` attribute.
pub struct RateLimitMetrics {
    counter: Option<Counter<u64>>,
}

impl RateLimitMetrics {
    pub(crate) fn noop() -> RateLimitMetrics {
        RateLimitMetrics { counter: None }
    }

    pub(crate) fn from_meter(meter: opentelemetry::metrics::Meter) -> RateLimitMetrics {
        let counter = meter
            .u64_counter("app.rate_limit.decisions")
            .with_description("Rate-limit decisions by outcome.")
            .with_unit("{decision}")
            .build();
        RateLimitMetrics {
            counter: Some(counter),
        }
    }

    /// Records one decision. The client key is deliberately NOT an attribute
    /// (it is high-cardinality user input), only the decision and the route
    /// label are. No-op when telemetry is disabled.
    pub fn record_decision(&self, result: &str, route: Option<&str>) {
        if let Some(counter) = &self.counter {
            let mut attributes = vec![KeyValue::new("result", result.to_string())];
            if let Some(route) = route {
                attributes.push(KeyValue::new("route", route.to_string()));
            }
            counter.add(1, &attributes);
        }
    }
}

/// Train run-date lookup recorder. Port of the counter created by
/// `getRunsRequestsCounter` in `lib/routes/train-runs.ts`:
/// `trains.runs.requests` incremented by 1 with a `result` attribute.
pub struct RunsRequestsMetrics {
    counter: Option<Counter<u64>>,
}

impl RunsRequestsMetrics {
    pub(crate) fn noop() -> RunsRequestsMetrics {
        RunsRequestsMetrics { counter: None }
    }

    pub(crate) fn from_meter(meter: opentelemetry::metrics::Meter) -> RunsRequestsMetrics {
        let counter = meter
            .u64_counter("trains.runs.requests")
            .with_description("Train run-date lookups by result")
            .build();
        RunsRequestsMetrics {
            counter: Some(counter),
        }
    }

    /// Records one train run-date lookup with its `result` attribute (`ok` /
    /// `validation_error` / `upstream_error` / `internal_error`). No-op when
    /// telemetry is disabled.
    pub fn record_result(&self, result: &str) {
        if let Some(counter) = &self.counter {
            counter.add(1, &[KeyValue::new("result", result.to_string())]);
        }
    }
}

/// Owned SDK providers kept alive for the lifetime of a [`crate::Telemetry`].
pub(crate) struct Providers {
    tracer_provider: SdkTracerProvider,
    meter_provider: SdkMeterProvider,
}

impl Providers {
    /// Builds both providers against the configured endpoints. Returns `None`
    /// when either exporter cannot be constructed, so the caller fails open.
    pub(crate) fn build(otel: &OtelConfig) -> Option<Providers> {
        use std::collections::HashMap;

        let headers: HashMap<String, String> = otel
            .headers
            .clone()
            .map(|pairs| pairs.into_iter().collect())
            .unwrap_or_default();
        let attributes = resource_attributes(otel);

        let exporter = opentelemetry_otlp::SpanExporter::builder()
            .with_http()
            .with_endpoint(otel.traces_endpoint.clone())
            .with_headers(headers.clone())
            .build()
            .ok()?;
        let tracer_provider = SdkTracerProvider::builder()
            .with_resource(
                Resource::builder()
                    .with_attributes(attributes.clone())
                    .build(),
            )
            .with_sampler(Sampler::ParentBased(Box::new(Sampler::TraceIdRatioBased(
                otel.trace_sample_ratio,
            ))))
            .with_batch_exporter(exporter)
            .build();

        let exporter = opentelemetry_otlp::MetricExporter::builder()
            .with_http()
            .with_endpoint(otel.metrics_endpoint.clone())
            .with_headers(headers)
            .with_temporality(Temporality::Cumulative)
            .build()
            .ok()?;
        let reader = PeriodicReader::builder(exporter)
            .with_interval(std::time::Duration::from_millis(
                otel.metric_export_interval_ms,
            ))
            .build();
        let meter_provider = SdkMeterProvider::builder()
            .with_resource(Resource::builder().with_attributes(attributes).build())
            .with_reader(reader)
            .build();

        Some(Providers {
            tracer_provider,
            meter_provider,
        })
    }

    pub(crate) fn tracer(&self) -> SdkTracer {
        use opentelemetry::trace::TracerProvider;
        self.tracer_provider.tracer(SERVICE_NAME)
    }

    pub(crate) fn meter(&self) -> opentelemetry::metrics::Meter {
        use opentelemetry::metrics::MeterProvider;
        self.meter_provider.meter(SERVICE_NAME)
    }

    /// Flushes and shuts down both providers. Exporter failures are logged
    /// (via the SDK) but never thrown, so a down collector cannot crash
    /// shutdown — mirroring the bounded `shutdownTelemetry` in `telemetry.ts`.
    pub(crate) fn shutdown(self) {
        let _ = self.tracer_provider.shutdown();
        let _ = self.meter_provider.shutdown();
    }
}

/// `service.name` + `deployment.environment.name`, plus `service.version` when
/// set — the `buildResource` equivalent in `lib/telemetry.ts`.
fn resource_attributes(otel: &OtelConfig) -> Vec<KeyValue> {
    let mut attributes = vec![
        KeyValue::new("service.name", otel.service_name.clone()),
        KeyValue::new("deployment.environment.name", otel.environment.clone()),
    ];
    if let Some(version) = &otel.version {
        attributes.push(KeyValue::new("service.version", version.clone()));
    }
    attributes
}
