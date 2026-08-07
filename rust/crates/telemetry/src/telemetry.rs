//! [`Telemetry`] lifecycle: init, the enabled flag, and shutdown.

use std::sync::atomic::{AtomicBool, Ordering};

use tt_config::{Config, OtelConfig};

use crate::{HttpMetrics, Meter, ProviderMetrics, Tracer};

/// Set once real SDK providers are up, so [`is_enabled`] reports true even when
/// the process environment changed after startup (port of `isTelemetryEnabled`
/// checking `sdk !== undefined`).
static INITIALIZED: AtomicBool = AtomicBool::new(false);

/// The telemetry runtime. Always constructed via [`init`].
pub struct Telemetry {
    enabled: bool,
    tracer: Tracer,
    meter: Meter,
    http_metrics: HttpMetrics,
    provider_metrics: ProviderMetrics,
    #[cfg(feature = "otlp")]
    providers: Option<crate::otlp::Providers>,
}

impl Telemetry {
    /// Whether telemetry is actually recording (enabled config + `otlp`
    /// feature present). Handles are still usable when this is `false` — they
    /// are simply inert.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// The tracer handle; inert when telemetry is disabled.
    pub fn tracer(&self) -> &Tracer {
        &self.tracer
    }

    /// The meter handle; inert when telemetry is disabled.
    pub fn meter(&self) -> &Meter {
        &self.meter
    }

    /// The RED-metrics recorder; inert when telemetry is disabled.
    pub fn http_metrics(&self) -> &HttpMetrics {
        &self.http_metrics
    }

    /// The provider-failover recorder; inert when telemetry is disabled.
    pub fn provider_metrics(&self) -> &ProviderMetrics {
        &self.provider_metrics
    }

    /// Flushes and shuts down the SDK providers, restoring the inert state.
    /// Safe to call once at shutdown; exporter failures never throw.
    pub fn shutdown(self) {
        #[cfg(feature = "otlp")]
        if let Some(providers) = self.providers {
            providers.shutdown();
        }
        INITIALIZED.store(false, Ordering::Relaxed);
    }

    fn noop() -> Telemetry {
        Telemetry {
            enabled: false,
            tracer: Tracer::noop(),
            meter: Meter::noop(),
            http_metrics: HttpMetrics::noop(),
            provider_metrics: ProviderMetrics::noop(),
            #[cfg(feature = "otlp")]
            providers: None,
        }
    }
}

/// Initializes telemetry from the parsed app config. When disabled (the
/// default) or the `otlp` feature is off, this is a cheap no-op that returns
/// inert handles — exactly like `initTelemetry` leaving `@opentelemetry/api`
/// on its no-op providers.
pub fn init(config: &Config) -> Telemetry {
    let otel: &OtelConfig = &config.otel;
    if !otel.enabled {
        tracing::info!(
            service_name = %otel.service_name,
            environment = %otel.environment,
            otel_enabled = false,
            "telemetry disabled; logging only"
        );
        return Telemetry::noop();
    }

    #[cfg(feature = "otlp")]
    {
        match crate::otlp::Providers::build(otel) {
            Some(providers) => {
                let meter_handle = providers.meter();
                INITIALIZED.store(true, Ordering::Relaxed);
                tracing::info!(
                    service_name = %otel.service_name,
                    environment = %otel.environment,
                    traces_endpoint = %otel.traces_endpoint,
                    metrics_endpoint = %otel.metrics_endpoint,
                    trace_sample_ratio = otel.trace_sample_ratio,
                    metric_export_interval_ms = otel.metric_export_interval_ms,
                    "telemetry initialized"
                );
                Telemetry {
                    enabled: true,
                    tracer: Tracer::new(providers.tracer()),
                    meter: Meter::new(),
                    http_metrics: HttpMetrics::from_meter(meter_handle),
                    provider_metrics: ProviderMetrics::from_meter(providers.meter()),
                    providers: Some(providers),
                }
            }
            None => {
                tracing::warn!("telemetry init failed; continuing without it");
                Telemetry::noop()
            }
        }
    }
    #[cfg(not(feature = "otlp"))]
    {
        tracing::warn!("telemetry enabled by config but the `otlp` feature is off; running no-op");
        Telemetry::noop()
    }
}

/// Whether telemetry is enabled: `true` once [`init`] built real SDK providers,
/// or when the current process environment opts in (port of
/// `isTelemetryEnabled`).
pub fn is_enabled() -> bool {
    INITIALIZED.load(Ordering::Relaxed) || Config::from_env().otel.enabled
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn env(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    // Port of `parseTelemetryConfig` in `lib/telemetry.test.ts` — the enabled
    // detection rules table, driving the `OTEL_*` parsing in `tt-config` (the
    // single source of truth for the env surface).
    #[test]
    fn detection_is_disabled_when_nothing_opts_in() {
        assert!(!Config::parse(&BTreeMap::new()).otel.enabled);
    }

    #[test]
    fn detection_enables_for_each_opt_in_source() {
        for (key, value) in [
            ("OTEL_ENABLED", "true"),
            ("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318"),
            (
                "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
                "http://collector:4318/v1/traces",
            ),
            (
                "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
                "http://collector:4318/v1/metrics",
            ),
            ("OTEL_TRACES_EXPORTER", "otlp"),
            ("OTEL_METRICS_EXPORTER", "console"),
        ] {
            let cfg = Config::parse(&env(&[(key, value)]));
            assert!(cfg.otel.enabled, "{key}={value} should enable telemetry");
        }
    }

    #[test]
    fn detection_enables_on_exporter_lists_and_not_on_others() {
        assert!(
            Config::parse(&env(&[("OTEL_TRACES_EXPORTER", "console,otlp")]))
                .otel
                .enabled
        );
        let cfg = Config::parse(&env(&[
            ("OTEL_TRACES_EXPORTER", "jaeger"),
            ("OTEL_METRICS_EXPORTER", "none"),
        ]));
        assert!(!cfg.otel.enabled);
    }

    #[test]
    fn detection_resolves_endpoints_like_the_ts_server() {
        let cfg = Config::parse(&env(&[("OTEL_ENABLED", "true")])).otel;
        assert_eq!(cfg.traces_endpoint, "http://localhost:4318/v1/traces");
        assert_eq!(cfg.metrics_endpoint, "http://localhost:4318/v1/metrics");

        let cfg = Config::parse(&env(&[(
            "OTEL_EXPORTER_OTLP_ENDPOINT",
            "http://collector:4318",
        )]))
        .otel;
        assert_eq!(cfg.traces_endpoint, "http://collector:4318/v1/traces");
        assert_eq!(cfg.metrics_endpoint, "http://collector:4318/v1/metrics");

        let cfg = Config::parse(&env(&[
            ("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318"),
            (
                "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
                "http://traces.internal/v1/traces",
            ),
        ]))
        .otel;
        assert_eq!(cfg.traces_endpoint, "http://traces.internal/v1/traces");
        assert_eq!(cfg.metrics_endpoint, "http://collector:4318/v1/metrics");
    }

    #[test]
    fn detection_parses_headers() {
        let cfg = Config::parse(&env(&[(
            "OTEL_EXPORTER_OTLP_HEADERS",
            "Authorization=Bearer token, X-Key=a=b",
        )]))
        .otel;
        assert_eq!(
            cfg.headers,
            Some(vec![
                ("Authorization".to_string(), "Bearer token".to_string()),
                ("X-Key".to_string(), "a=b".to_string()),
            ])
        );
        let cfg = Config::parse(&env(&[(
            "OTEL_EXPORTER_OTLP_HEADERS",
            "=novalue,novalue,ok=yes",
        )]))
        .otel;
        assert_eq!(
            cfg.headers,
            Some(vec![("ok".to_string(), "yes".to_string())])
        );
        let cfg = Config::parse(&env(&[("OTEL_EXPORTER_OTLP_HEADERS", "")])).otel;
        assert_eq!(cfg.headers, None);
    }

    // Port of the `initTelemetry` disabled-path test in `lib/telemetry.test.ts`.
    #[test]
    fn disabled_init_returns_inert_handles() {
        let config = Config::parse(&BTreeMap::new());
        assert!(!config.otel.enabled);

        let telemetry = init(&config);
        assert!(!telemetry.is_enabled());
        let _span = telemetry.tracer().start("noop-span");
    }

    #[test]
    fn inert_handles_noop_without_panicking() {
        let config = Config::parse(&BTreeMap::new());
        let telemetry = init(&config);

        let span = telemetry.tracer().start("noop-span");
        span.set_attribute("train_number", "12345");
        span.end();

        telemetry.tracer().in_span("noop-in-span", |span| {
            span.set_attribute("k", "v");
            42
        });

        telemetry
            .http_metrics()
            .record(200, 12.5, "GET", "/api/trains/status");
        telemetry
            .http_metrics()
            .record(502, 0.5, "GET", "/api/trains/status");

        telemetry.shutdown();
    }

    #[test]
    fn is_enabled_matches_env_detection() {
        // Same environment the process was started with — mirrors the TS
        // `isTelemetryEnabled()` reading `process.env`.
        assert_eq!(is_enabled(), Config::from_env().otel.enabled);
    }
}
