//! Real OpenTelemetry handles + provider building for the `otlp` feature.
//!
//! The public API mirrors `noop.rs` exactly; behind the scenes spans and metric
//! records are handed to the OpenTelemetry SDK and exported over OTLP/HTTP
//! (reqwest blocking client, so no async runtime is required).

use std::cell::RefCell;

use opentelemetry::metrics::Histogram;
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
