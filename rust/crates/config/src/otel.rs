//! OpenTelemetry configuration (`OTEL_*` env surface).
//!
//! Direct port of `parseTelemetryConfig` in `lib/telemetry.ts`: same defaults
//! (`http://localhost:4318` base endpoint, `train-tracker-api` service name,
//! `development` environment, sample ratio 1, 60s metric interval) and the
//! same fail-open detection rules for whether telemetry is enabled.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::env;
use crate::{
    DEFAULT_ENVIRONMENT, DEFAULT_METRIC_EXPORT_INTERVAL_MS, DEFAULT_OTEL_SERVICE_NAME,
    DEFAULT_OTLP_ENDPOINT,
};

/// Exporter env values that opt in to telemetry (port of
/// `ENABLING_EXPORTER_VALUES` in `lib/telemetry.ts`).
const ENABLING_EXPORTER_VALUES: [&str; 2] = ["otlp", "console"];

/// Parsed OpenTelemetry configuration for the API server — the Rust mirror of
/// the TypeScript `TelemetryConfig` interface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OtelConfig {
    /// Whether telemetry should be initialized at all. Port of the combined
    /// detection in `parseTelemetryConfig`: `OTEL_ENABLED` truthy, a non-empty
    /// OTLP endpoint (base or per-signal), or an enabling exporter value.
    pub enabled: bool,
    /// `service.name` resource attribute (`OTEL_SERVICE_NAME`).
    pub service_name: String,
    /// `deployment.environment.name` resource attribute (`NODE_ENV`).
    pub environment: String,
    /// `service.version` resource attribute (`SERVICE_VERSION`).
    pub version: Option<String>,
    /// Full OTLP/HTTP traces endpoint (always ends in `/v1/traces`).
    pub traces_endpoint: String,
    /// Full OTLP/HTTP metrics endpoint (always ends in `/v1/metrics`).
    pub metrics_endpoint: String,
    /// Extra HTTP headers sent to the OTLP endpoints (`OTEL_EXPORTER_OTLP_HEADERS`).
    pub headers: Option<Vec<(String, String)>>,
    /// Root span sample ratio in `[0, 1]` (`OTEL_TRACE_SAMPLE_RATIO`).
    pub trace_sample_ratio: f64,
    /// Metric collection/export interval in milliseconds
    /// (`OTEL_METRIC_EXPORT_INTERVAL_MS`).
    pub metric_export_interval_ms: u64,
    /// Whether auto-instrumentations should be registered
    /// (`OTEL_INSTRUMENTATIONS_ENABLED`).
    pub instrumentations_enabled: bool,
}

impl OtelConfig {
    /// Parses the `OTEL_*` (and `NODE_ENV`/`SERVICE_VERSION`) environment
    /// surface. Pure with respect to `env`.
    pub(crate) fn parse(env: &BTreeMap<String, String>) -> OtelConfig {
        let endpoint_raw = env.get("OTEL_EXPORTER_OTLP_ENDPOINT").map(String::as_str);
        let base_endpoint = match non_empty(endpoint_raw) {
            Some(endpoint) => endpoint.to_string(),
            None => DEFAULT_OTLP_ENDPOINT.to_string(),
        };
        let traces_raw = env
            .get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
            .map(String::as_str);
        let metrics_raw = env
            .get("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT")
            .map(String::as_str);

        let enabled = env::truthy(env.get("OTEL_ENABLED").map(String::as_str))
            || non_empty(endpoint_raw).is_some()
            || non_empty(traces_raw).is_some()
            || non_empty(metrics_raw).is_some()
            || enabling_exporter(env.get("OTEL_TRACES_EXPORTER").map(String::as_str))
            || enabling_exporter(env.get("OTEL_METRICS_EXPORTER").map(String::as_str));

        OtelConfig {
            enabled,
            service_name: env::trimmed(env, "OTEL_SERVICE_NAME")
                .unwrap_or(DEFAULT_OTEL_SERVICE_NAME)
                .to_string(),
            environment: env::trimmed(env, "NODE_ENV")
                .unwrap_or(DEFAULT_ENVIRONMENT)
                .to_string(),
            version: env::trimmed(env, "SERVICE_VERSION").map(str::to_string),
            traces_endpoint: endpoint_or_signal(traces_raw, &base_endpoint, "traces"),
            metrics_endpoint: endpoint_or_signal(metrics_raw, &base_endpoint, "metrics"),
            headers: env::parse_headers(env.get("OTEL_EXPORTER_OTLP_HEADERS").map(String::as_str)),
            trace_sample_ratio: env::sample_ratio(
                env.get("OTEL_TRACE_SAMPLE_RATIO").map(String::as_str),
            ),
            metric_export_interval_ms: env::positive_u64(
                env,
                "OTEL_METRIC_EXPORT_INTERVAL_MS",
                DEFAULT_METRIC_EXPORT_INTERVAL_MS,
            ),
            instrumentations_enabled: env.get("OTEL_INSTRUMENTATIONS_ENABLED").map(String::as_str)
                != Some("false"),
        }
    }
}

/// The raw value when present and non-blank, else `None`.
fn non_empty(raw: Option<&str>) -> Option<&str> {
    raw.map(str::trim).filter(|s| !s.is_empty())
}

/// Whether an exporter env value (`OTEL_TRACES_EXPORTER` /
/// `OTEL_METRICS_EXPORTER`) opts in to telemetry. Port of `isEnablingExporter`.
fn enabling_exporter(raw: Option<&str>) -> bool {
    non_empty(raw)
        .map(|raw| {
            raw.split(',')
                .map(str::trim)
                .map(str::to_ascii_lowercase)
                .any(|token| ENABLING_EXPORTER_VALUES.contains(&token.as_str()))
        })
        .unwrap_or(false)
}

/// A per-signal override, or `{base}/v1/{signal}` when unset.
fn endpoint_or_signal(raw: Option<&str>, base: &str, signal: &str) -> String {
    match non_empty(raw) {
        Some(endpoint) => endpoint.to_string(),
        None => format!("{base}/v1/{signal}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    // Port of `parseTelemetryConfig` in `lib/telemetry.test.ts`.
    #[test]
    fn disabled_when_nothing_opts_in() {
        assert!(!OtelConfig::parse(&BTreeMap::new()).enabled);
    }

    #[test]
    fn enabled_by_each_opt_in_source() {
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
            let cfg = OtelConfig::parse(&env(&[(key, value)]));
            assert!(cfg.enabled, "{key}={value} should enable telemetry");
        }
    }

    #[test]
    fn enabled_by_exporter_list_containing_an_enabling_value() {
        let cfg = OtelConfig::parse(&env(&[("OTEL_TRACES_EXPORTER", "console,otlp")]));
        assert!(cfg.enabled);
    }

    #[test]
    fn not_enabled_for_non_enabling_exporter_values() {
        let cfg = OtelConfig::parse(&env(&[
            ("OTEL_TRACES_EXPORTER", "jaeger"),
            ("OTEL_METRICS_EXPORTER", "none"),
        ]));
        assert!(!cfg.enabled);
    }

    #[test]
    fn truthy_enabled_spellings_are_accepted() {
        for value in ["TRUE", "1", "yes", "on"] {
            let cfg = OtelConfig::parse(&env(&[("OTEL_ENABLED", value)]));
            assert!(cfg.enabled, "{value:?} should enable telemetry");
        }
    }

    #[test]
    fn default_endpoints_when_unspecified() {
        let cfg = OtelConfig::parse(&env(&[("OTEL_ENABLED", "true")]));
        assert_eq!(cfg.traces_endpoint, "http://localhost:4318/v1/traces");
        assert_eq!(cfg.metrics_endpoint, "http://localhost:4318/v1/metrics");
    }

    #[test]
    fn appends_signal_paths_to_the_base_endpoint() {
        let cfg = OtelConfig::parse(&env(&[(
            "OTEL_EXPORTER_OTLP_ENDPOINT",
            "http://collector:4318",
        )]));
        assert_eq!(cfg.traces_endpoint, "http://collector:4318/v1/traces");
        assert_eq!(cfg.metrics_endpoint, "http://collector:4318/v1/metrics");
    }

    #[test]
    fn honors_per_signal_endpoint_overrides() {
        let cfg = OtelConfig::parse(&env(&[
            ("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318"),
            (
                "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
                "http://traces.internal/v1/traces",
            ),
        ]));
        assert_eq!(cfg.traces_endpoint, "http://traces.internal/v1/traces");
        assert_eq!(cfg.metrics_endpoint, "http://collector:4318/v1/metrics");
    }

    #[test]
    fn parses_otlp_headers() {
        let cfg = OtelConfig::parse(&env(&[
            ("OTEL_ENABLED", "true"),
            (
                "OTEL_EXPORTER_OTLP_HEADERS",
                "Authorization=Bearer token, X-Key=a=b",
            ),
        ]));
        assert_eq!(
            cfg.headers,
            Some(vec![
                ("Authorization".to_string(), "Bearer token".to_string()),
                ("X-Key".to_string(), "a=b".to_string()),
            ])
        );
    }

    #[test]
    fn headers_none_for_empty_input() {
        let cfg = OtelConfig::parse(&env(&[
            ("OTEL_ENABLED", "true"),
            ("OTEL_EXPORTER_OTLP_HEADERS", ""),
        ]));
        assert_eq!(cfg.headers, None);
    }

    #[test]
    fn skips_malformed_header_pairs() {
        let cfg = OtelConfig::parse(&env(&[(
            "OTEL_EXPORTER_OTLP_HEADERS",
            "=novalue,novalue,ok=yes",
        )]));
        assert_eq!(
            cfg.headers,
            Some(vec![("ok".to_string(), "yes".to_string())])
        );
    }

    #[test]
    fn defaults_service_name_and_environment() {
        let cfg = OtelConfig::parse(&BTreeMap::new());
        assert_eq!(cfg.service_name, "train-tracker-api");
        assert_eq!(cfg.environment, "development");
    }

    #[test]
    fn reads_service_name_and_environment_overrides() {
        let cfg = OtelConfig::parse(&env(&[
            ("OTEL_SERVICE_NAME", "custom"),
            ("NODE_ENV", "production"),
        ]));
        assert_eq!(cfg.service_name, "custom");
        assert_eq!(cfg.environment, "production");
    }

    #[test]
    fn version_unset_when_service_version_absent() {
        assert_eq!(OtelConfig::parse(&BTreeMap::new()).version, None);
    }

    #[test]
    fn reads_service_version() {
        assert_eq!(
            OtelConfig::parse(&env(&[("SERVICE_VERSION", "1.2.3")]))
                .version
                .as_deref(),
            Some("1.2.3")
        );
    }

    #[test]
    fn defaults_trace_sample_ratio_to_one() {
        assert_eq!(OtelConfig::parse(&BTreeMap::new()).trace_sample_ratio, 1.0);
    }

    #[test]
    fn parses_valid_sample_ratios() {
        for value in ["0", "0.5", "1"] {
            let ratio =
                OtelConfig::parse(&env(&[("OTEL_TRACE_SAMPLE_RATIO", value)])).trace_sample_ratio;
            assert_eq!(ratio, value.parse::<f64>().unwrap(), "ratio {value:?}");
        }
    }

    #[test]
    fn invalid_sample_ratio_falls_back_to_default() {
        for value in ["abc", "-1", "1.5", "NaN"] {
            let ratio =
                OtelConfig::parse(&env(&[("OTEL_TRACE_SAMPLE_RATIO", value)])).trace_sample_ratio;
            assert_eq!(ratio, 1.0, "ratio {value:?}");
        }
    }

    #[test]
    fn defaults_metric_export_interval_to_60000() {
        assert_eq!(
            OtelConfig::parse(&BTreeMap::new()).metric_export_interval_ms,
            60_000
        );
    }

    #[test]
    fn parses_a_valid_metric_export_interval() {
        let cfg = OtelConfig::parse(&env(&[("OTEL_METRIC_EXPORT_INTERVAL_MS", "15000")]));
        assert_eq!(cfg.metric_export_interval_ms, 15_000);
    }

    #[test]
    fn invalid_metric_export_interval_falls_back_to_default() {
        for value in ["abc", "0", "-100", "Infinity"] {
            let interval = OtelConfig::parse(&env(&[("OTEL_METRIC_EXPORT_INTERVAL_MS", value)]))
                .metric_export_interval_ms;
            assert_eq!(interval, 60_000, "interval {value:?}");
        }
    }

    #[test]
    fn instrumentations_enabled_by_default() {
        assert!(OtelConfig::parse(&BTreeMap::new()).instrumentations_enabled);
    }

    #[test]
    fn instrumentations_disabled_when_explicitly_off() {
        let cfg = OtelConfig::parse(&env(&[("OTEL_INSTRUMENTATIONS_ENABLED", "false")]));
        assert!(!cfg.instrumentations_enabled);
    }
}
