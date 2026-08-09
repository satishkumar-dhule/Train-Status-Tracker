//! Rail Saarthi — `tt-config` crate.
//!
//! Seam: typed [`Config`] parsed from the environment — the same env vars,
//! defaults, and fail-open semantics as the TypeScript `lib/env.ts`,
//! `lib/telemetry.ts`, and `lib/providers/registry.ts` configuration.
//!
//! Deep module: [`Config`] is the whole public surface; the parse rules live in
//! private submodules (`env`, `providers`, `otel`) and are tested at this seam.
//!
//! # Fail-open
//!
//! A missing, empty, or unparseable optional variable never crashes startup; it
//! falls back to its documented default. See the per-field docs and
//! `.env.example` at the repo root for the full documented surface.

mod env;
mod otel;
mod providers;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub use otel::OtelConfig;
pub use providers::DEFAULT_PROVIDER_ORDER;

/// `PORT` — default 5000. Positive finite number, else the default.
pub const DEFAULT_PORT: u16 = 5000;
/// `LOG_LEVEL` — default `info` (a pino-compatible level name; see `tt-logging`).
pub const DEFAULT_LOG_LEVEL: &str = "info";
/// `REDIS_URL` — default `redis://localhost:6379`.
pub const DEFAULT_REDIS_URL: &str = "redis://localhost:6379";
/// `TRAIN_CATALOG_TTL_MS` — default 1 hour (3600000 ms).
pub const DEFAULT_TRAIN_CATALOG_TTL_MS: u64 = 3_600_000;
/// `TRAIN_STATUS_QOS_FAILURE_THRESHOLD` — default 3.
pub const DEFAULT_QOS_FAILURE_THRESHOLD: u32 = 3;
/// `TRAIN_STATUS_QOS_COOLDOWN_MS` — default 60 seconds.
pub const DEFAULT_QOS_COOLDOWN_MS: u64 = 60_000;
/// `TRAIN_STATUS_QOS_LATENCY_SAMPLES` — default 100.
pub const DEFAULT_QOS_LATENCY_SAMPLES: usize = 100;
/// Base OTLP/HTTP collector endpoint when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset.
pub const DEFAULT_OTLP_ENDPOINT: &str = "http://localhost:4318";
/// `OTEL_SERVICE_NAME` — default `train-tracker-api`.
pub const DEFAULT_OTEL_SERVICE_NAME: &str = "train-tracker-api";
/// `OTEL_TRACE_SAMPLE_RATIO` — default 1 (sample everything).
pub const DEFAULT_TRACE_SAMPLE_RATIO: f64 = 1.0;
/// `OTEL_METRIC_EXPORT_INTERVAL_MS` — default 60 seconds.
pub const DEFAULT_METRIC_EXPORT_INTERVAL_MS: u64 = 60_000;
/// `NODE_ENV` fallback used for `deployment.environment.name`.
pub const DEFAULT_ENVIRONMENT: &str = "development";
/// `STATUS_CACHE_TTL_MS` — default 5 seconds; shield TTL for status reads.
pub const DEFAULT_STATUS_CACHE_TTL_MS: u64 = 5_000;
/// `STATUS_CACHE_L1_TTL_MS` — default 2 seconds (in-memory front cache).
pub const DEFAULT_STATUS_CACHE_L1_TTL_MS: u64 = 2_000;
/// `STATUS_CACHE_NEG_TTL_MS` — default 1 second (cached "no result" reads).
pub const DEFAULT_STATUS_CACHE_NEG_TTL_MS: u64 = 1_000;
/// `STATUS_CACHE_TTL_JITTER` — default 0.2 (TTL spread fraction in `[0, 1)`).
pub const DEFAULT_STATUS_CACHE_TTL_JITTER: f64 = 0.2;
/// `REDIS_KEY_PREFIX` — default `tt`.
pub const DEFAULT_REDIS_KEY_PREFIX: &str = "tt";
/// `REDIS_COMMAND_TIMEOUT_MS` — default 200 (per-command timeout).
pub const DEFAULT_REDIS_COMMAND_TIMEOUT_MS: u64 = 200;
/// `REDIS_PROBE_INTERVAL_MS` — default 15 minutes (health re-probe cadence).
pub const DEFAULT_REDIS_PROBE_INTERVAL_MS: u64 = 900_000;
/// `RUNS_CACHE_TTL_MS` — default 6 hours (21600000 ms).
pub const DEFAULT_RUNS_CACHE_TTL_MS: u64 = 21_600_000;
/// `RUNS_CACHE_L1_TTL_MS` — default 5 minutes (in-memory front cache).
pub const DEFAULT_RUNS_CACHE_L1_TTL_MS: u64 = 300_000;
/// `RUNS_CACHE_NEG_TTL_MS` — default 60 seconds (cached "no result" probes).
pub const DEFAULT_RUNS_CACHE_NEG_TTL_MS: u64 = 60_000;
/// `RUNS_CACHE_TTL_JITTER` — default 0.1 (TTL spread fraction in `[0, 1)`).
pub const DEFAULT_RUNS_CACHE_TTL_JITTER: f64 = 0.1;
/// `RUNS_RATE_LIMIT_PER_MIN` — default 10 (per-client runs requests).
pub const DEFAULT_RUNS_RATE_LIMIT_PER_MIN: u64 = 10;
/// Runs cache L2 key prefix — the `REDIS_KEY_PREFIX` default for the runs
/// route (`tt:runs:v1`), distinct from the status caches' `tt`.
pub const DEFAULT_RUNS_REDIS_KEY_PREFIX: &str = "tt:runs:v1";

/// `REDIS_MODE`. Mirrors `parseMode` in `lib/redis-client.ts`: `enabled`/`on`
/// and `disabled`/`off` are accepted case-insensitively; any other value
/// (including the documented-but-unimplemented `manual` and garbage) fails open
/// to [`RedisMode::Auto`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RedisMode {
    /// `auto` (default): Redis is used while reachable, bypassed on failure.
    Auto,
    /// `enabled` / `on`: always connect and use Redis.
    Enabled,
    /// `disabled` / `off`: never connect.
    Disabled,
}

impl RedisMode {
    pub(crate) fn parse(raw: Option<&str>) -> RedisMode {
        match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("enabled" | "on") => RedisMode::Enabled,
            Some("disabled" | "off") => RedisMode::Disabled,
            _ => RedisMode::Auto,
        }
    }
}

/// Typed server configuration parsed from an environment mapping. `Clone` so
/// the app can share it (wrapped in an `Arc` at wiring time).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Config {
    /// `PORT` — default 5000.
    pub port: u16,
    /// `LOG_LEVEL` — default `info`.
    pub log_level: String,
    /// `REDIS_MODE` — default [`RedisMode::Auto`].
    pub redis_mode: RedisMode,
    /// `REDIS_URL` — default `redis://localhost:6379`.
    pub redis_url: String,
    /// `REDIS_GZIP` — default `true`; only the exact string `"false"` disables.
    pub redis_gzip: bool,
    /// `CORS_ORIGIN` — optional comma-separated list, trimmed; `None` when unset.
    pub cors_origin: Option<Vec<String>>,
    /// `TRAIN_STATUS_PROVIDERS` — comma-separated, lowercased, deduplicated,
    /// unknown names dropped. Defaults to the six known providers.
    pub train_status_providers: Vec<String>,
    /// `RAILRADAR_API_KEY` — `Some` enables the RailRadar provider.
    pub railradar_api_key: Option<String>,
    /// `TRAIN_DATA_URL` — optional upstream catalog override.
    pub train_data_url: Option<String>,
    /// `TRAIN_CATALOG_TTL_MS` — default 3600000.
    pub train_catalog_ttl_ms: u64,
    /// `SERVICE_VERSION` — optional, reported on healthz + telemetry.
    pub service_version: Option<String>,
    /// `TRAIN_STATUS_QOS_FAILURE_THRESHOLD` — default 3.
    pub qos_failure_threshold: u32,
    /// `TRAIN_STATUS_QOS_COOLDOWN_MS` — default 60000.
    pub qos_cooldown_ms: u64,
    /// `TRAIN_STATUS_QOS_LATENCY_SAMPLES` — default 100.
    pub qos_latency_samples: usize,
    /// `STATUS_CACHE_TTL_MS` — default 5000.
    pub status_cache_ttl_ms: u64,
    /// `STATUS_CACHE_L1_TTL_MS` — default 2000.
    pub status_cache_l1_ttl_ms: u64,
    /// `STATUS_CACHE_NEG_TTL_MS` — default 1000.
    pub status_cache_neg_ttl_ms: u64,
    /// `STATUS_CACHE_TTL_JITTER` — default 0.2.
    pub status_cache_ttl_jitter: f64,
    /// `REDIS_KEY_PREFIX` — default `tt`.
    pub redis_key_prefix: String,
    /// `REDIS_COMMAND_TIMEOUT_MS` — default 200.
    pub redis_command_timeout_ms: u64,
    /// `REDIS_PROBE_INTERVAL_MS` — default 900000.
    pub redis_probe_interval_ms: u64,
    /// `RUNS_CACHE_TTL_MS` — default 21600000.
    pub runs_cache_ttl_ms: u64,
    /// `RUNS_CACHE_L1_TTL_MS` — default 300000.
    pub runs_cache_l1_ttl_ms: u64,
    /// `RUNS_CACHE_NEG_TTL_MS` — default 60000.
    pub runs_cache_neg_ttl_ms: u64,
    /// `RUNS_CACHE_TTL_JITTER` — default 0.1.
    pub runs_cache_ttl_jitter: f64,
    /// `RUNS_RATE_LIMIT_PER_MIN` — default 10.
    pub runs_rate_limit_per_min: u64,
    /// Runs L2 key prefix — `REDIS_KEY_PREFIX` when set, else `tt:runs:v1`.
    pub runs_redis_key_prefix: String,
    /// OpenTelemetry configuration (the `OTEL_*` env surface).
    pub otel: OtelConfig,
}

impl Config {
    /// Parses a `Config` from an environment mapping. Pure with respect to
    /// `env`, so it is fully unit-testable.
    pub fn parse(env: &BTreeMap<String, String>) -> Config {
        Config {
            port: env::port(env, "PORT", DEFAULT_PORT),
            log_level: env::trimmed(env, "LOG_LEVEL")
                .unwrap_or(DEFAULT_LOG_LEVEL)
                .to_string(),
            redis_mode: RedisMode::parse(env.get("REDIS_MODE").map(String::as_str)),
            redis_url: env::trimmed(env, "REDIS_URL")
                .unwrap_or(DEFAULT_REDIS_URL)
                .to_string(),
            redis_gzip: env.get("REDIS_GZIP").map(String::as_str) != Some("false"),
            cors_origin: env::origin_list(env.get("CORS_ORIGIN").map(String::as_str)),
            train_status_providers: providers::parse_list(
                env.get("TRAIN_STATUS_PROVIDERS").map(String::as_str),
            ),
            railradar_api_key: env::trimmed(env, "RAILRADAR_API_KEY").map(str::to_string),
            train_data_url: env::trimmed(env, "TRAIN_DATA_URL").map(str::to_string),
            train_catalog_ttl_ms: env::positive_u64(
                env,
                "TRAIN_CATALOG_TTL_MS",
                DEFAULT_TRAIN_CATALOG_TTL_MS,
            ),
            service_version: env::trimmed(env, "SERVICE_VERSION").map(str::to_string),
            qos_failure_threshold: env::positive_u32(
                env,
                "TRAIN_STATUS_QOS_FAILURE_THRESHOLD",
                DEFAULT_QOS_FAILURE_THRESHOLD,
            ),
            qos_cooldown_ms: env::positive_u64(
                env,
                "TRAIN_STATUS_QOS_COOLDOWN_MS",
                DEFAULT_QOS_COOLDOWN_MS,
            ),
            qos_latency_samples: env::positive_u64(
                env,
                "TRAIN_STATUS_QOS_LATENCY_SAMPLES",
                DEFAULT_QOS_LATENCY_SAMPLES as u64,
            ) as usize,
            status_cache_ttl_ms: env::positive_u64(
                env,
                "STATUS_CACHE_TTL_MS",
                DEFAULT_STATUS_CACHE_TTL_MS,
            ),
            status_cache_l1_ttl_ms: env::positive_u64(
                env,
                "STATUS_CACHE_L1_TTL_MS",
                DEFAULT_STATUS_CACHE_L1_TTL_MS,
            ),
            status_cache_neg_ttl_ms: env::positive_u64(
                env,
                "STATUS_CACHE_NEG_TTL_MS",
                DEFAULT_STATUS_CACHE_NEG_TTL_MS,
            ),
            status_cache_ttl_jitter: env::fraction(
                env,
                "STATUS_CACHE_TTL_JITTER",
                DEFAULT_STATUS_CACHE_TTL_JITTER,
            ),
            redis_key_prefix: env::trimmed(env, "REDIS_KEY_PREFIX")
                .unwrap_or(DEFAULT_REDIS_KEY_PREFIX)
                .to_string(),
            redis_command_timeout_ms: env::positive_u64(
                env,
                "REDIS_COMMAND_TIMEOUT_MS",
                DEFAULT_REDIS_COMMAND_TIMEOUT_MS,
            ),
            redis_probe_interval_ms: env::positive_u64(
                env,
                "REDIS_PROBE_INTERVAL_MS",
                DEFAULT_REDIS_PROBE_INTERVAL_MS,
            ),
            runs_cache_ttl_ms: env::positive_u64(
                env,
                "RUNS_CACHE_TTL_MS",
                DEFAULT_RUNS_CACHE_TTL_MS,
            ),
            runs_cache_l1_ttl_ms: env::positive_u64(
                env,
                "RUNS_CACHE_L1_TTL_MS",
                DEFAULT_RUNS_CACHE_L1_TTL_MS,
            ),
            runs_cache_neg_ttl_ms: env::positive_u64(
                env,
                "RUNS_CACHE_NEG_TTL_MS",
                DEFAULT_RUNS_CACHE_NEG_TTL_MS,
            ),
            runs_cache_ttl_jitter: env::fraction(
                env,
                "RUNS_CACHE_TTL_JITTER",
                DEFAULT_RUNS_CACHE_TTL_JITTER,
            ),
            runs_rate_limit_per_min: env::positive_u64(
                env,
                "RUNS_RATE_LIMIT_PER_MIN",
                DEFAULT_RUNS_RATE_LIMIT_PER_MIN,
            ),
            runs_redis_key_prefix: env::trimmed(env, "REDIS_KEY_PREFIX")
                .unwrap_or(DEFAULT_RUNS_REDIS_KEY_PREFIX)
                .to_string(),
            otel: OtelConfig::parse(env),
        }
    }

    /// Parses a `Config` from the real process environment.
    pub fn from_env() -> Config {
        Config::parse(&env::process_env())
    }

    /// Provider names that are actually enabled, in priority order.
    ///
    /// Mirrors `buildStatusProviders` in `lib/providers/registry.ts`: unknown
    /// and duplicate names were already dropped during parsing, and RailRadar
    /// is only enabled when `RAILRADAR_API_KEY` is present.
    pub fn providers_enabled(&self) -> Vec<String> {
        self.train_status_providers
            .iter()
            .filter(|name| name.as_str() != "railradar" || self.railradar_api_key.is_some())
            .cloned()
            .collect()
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

    fn default_provider_order() -> Vec<String> {
        DEFAULT_PROVIDER_ORDER
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    #[test]
    fn defaults_for_every_env_var() {
        let cfg = Config::parse(&BTreeMap::new());
        assert_eq!(cfg.port, 5000);
        assert_eq!(cfg.log_level, "info");
        assert_eq!(cfg.redis_mode, RedisMode::Auto);
        assert_eq!(cfg.redis_url, "redis://localhost:6379");
        assert!(cfg.redis_gzip);
        assert_eq!(cfg.cors_origin, None);
        assert_eq!(cfg.train_status_providers, default_provider_order());
        assert_eq!(cfg.railradar_api_key, None);
        assert_eq!(cfg.train_data_url, None);
        assert_eq!(cfg.train_catalog_ttl_ms, 3_600_000);
        assert_eq!(cfg.service_version, None);
        assert_eq!(cfg.qos_failure_threshold, 3);
        assert_eq!(cfg.qos_cooldown_ms, 60_000);
        assert_eq!(cfg.qos_latency_samples, 100);
        assert_eq!(cfg.status_cache_ttl_ms, 5_000);
        assert_eq!(cfg.status_cache_l1_ttl_ms, 2_000);
        assert_eq!(cfg.status_cache_neg_ttl_ms, 1_000);
        assert_eq!(cfg.status_cache_ttl_jitter, 0.2);
        assert_eq!(cfg.redis_key_prefix, "tt");
        assert_eq!(cfg.redis_command_timeout_ms, 200);
        assert_eq!(cfg.redis_probe_interval_ms, 900_000);
        assert_eq!(cfg.runs_cache_ttl_ms, 21_600_000);
        assert_eq!(cfg.runs_cache_l1_ttl_ms, 300_000);
        assert_eq!(cfg.runs_cache_neg_ttl_ms, 60_000);
        assert_eq!(cfg.runs_cache_ttl_jitter, 0.1);
        assert_eq!(cfg.runs_rate_limit_per_min, 10);
        assert_eq!(cfg.runs_redis_key_prefix, "tt:runs:v1");
        assert!(!cfg.otel.enabled);
        assert_eq!(cfg.otel.service_name, "train-tracker-api");
        assert_eq!(cfg.otel.environment, "development");
        assert_eq!(cfg.otel.version, None);
        assert_eq!(cfg.otel.traces_endpoint, "http://localhost:4318/v1/traces");
        assert_eq!(
            cfg.otel.metrics_endpoint,
            "http://localhost:4318/v1/metrics"
        );
        assert_eq!(cfg.otel.headers, None);
        assert_eq!(cfg.otel.trace_sample_ratio, 1.0);
        assert_eq!(cfg.otel.metric_export_interval_ms, 60_000);
        assert!(cfg.otel.instrumentations_enabled);
    }

    #[test]
    fn parses_a_sample_env_map() {
        let cfg = Config::parse(&env(&[
            ("PORT", "8080"),
            ("LOG_LEVEL", "debug"),
            ("REDIS_MODE", "enabled"),
            ("REDIS_URL", "rediss://cache.internal:6379"),
            ("REDIS_GZIP", "false"),
            ("CORS_ORIGIN", "http://a.example, http://b.example"),
            ("TRAIN_STATUS_PROVIDERS", "  Paytm , RailRadar,paytm, bogus"),
            ("RAILRADAR_API_KEY", "sekrit"),
            ("TRAIN_DATA_URL", "https://example.com/trains.json"),
            ("TRAIN_CATALOG_TTL_MS", "1800000"),
            ("SERVICE_VERSION", "1.2.3"),
            ("TRAIN_STATUS_QOS_FAILURE_THRESHOLD", "5"),
            ("TRAIN_STATUS_QOS_COOLDOWN_MS", "120000"),
            ("TRAIN_STATUS_QOS_LATENCY_SAMPLES", "50"),
            ("STATUS_CACHE_TTL_MS", "8000"),
            ("STATUS_CACHE_L1_TTL_MS", "1500"),
            ("STATUS_CACHE_NEG_TTL_MS", "250"),
            ("STATUS_CACHE_TTL_JITTER", "0.5"),
            ("REDIS_KEY_PREFIX", "rr"),
            ("REDIS_COMMAND_TIMEOUT_MS", "500"),
            ("REDIS_PROBE_INTERVAL_MS", "60000"),
            ("RUNS_CACHE_TTL_MS", "3600000"),
            ("RUNS_CACHE_L1_TTL_MS", "60000"),
            ("RUNS_CACHE_NEG_TTL_MS", "5000"),
            ("RUNS_CACHE_TTL_JITTER", "0.5"),
            ("RUNS_RATE_LIMIT_PER_MIN", "25"),
            ("OTEL_ENABLED", "true"),
            ("OTEL_SERVICE_NAME", "custom"),
            ("OTEL_TRACE_SAMPLE_RATIO", "0.25"),
            ("OTEL_METRIC_EXPORT_INTERVAL_MS", "15000"),
        ]));
        assert_eq!(cfg.port, 8080);
        assert_eq!(cfg.log_level, "debug");
        assert_eq!(cfg.redis_mode, RedisMode::Enabled);
        assert_eq!(cfg.redis_url, "rediss://cache.internal:6379");
        assert!(!cfg.redis_gzip);
        assert_eq!(
            cfg.cors_origin,
            Some(vec![
                "http://a.example".to_string(),
                "http://b.example".to_string()
            ])
        );
        assert_eq!(cfg.train_status_providers, vec!["paytm", "railradar"]);
        assert_eq!(cfg.providers_enabled(), vec!["paytm", "railradar"]);
        assert_eq!(cfg.railradar_api_key.as_deref(), Some("sekrit"));
        assert_eq!(
            cfg.train_data_url.as_deref(),
            Some("https://example.com/trains.json")
        );
        assert_eq!(cfg.train_catalog_ttl_ms, 1_800_000);
        assert_eq!(cfg.service_version.as_deref(), Some("1.2.3"));
        assert_eq!(cfg.qos_failure_threshold, 5);
        assert_eq!(cfg.qos_cooldown_ms, 120_000);
        assert_eq!(cfg.qos_latency_samples, 50);
        assert_eq!(cfg.status_cache_ttl_ms, 8_000);
        assert_eq!(cfg.status_cache_l1_ttl_ms, 1_500);
        assert_eq!(cfg.status_cache_neg_ttl_ms, 250);
        assert_eq!(cfg.status_cache_ttl_jitter, 0.5);
        assert_eq!(cfg.redis_key_prefix, "rr");
        assert_eq!(cfg.redis_command_timeout_ms, 500);
        assert_eq!(cfg.redis_probe_interval_ms, 60_000);
        assert_eq!(cfg.runs_cache_ttl_ms, 3_600_000);
        assert_eq!(cfg.runs_cache_l1_ttl_ms, 60_000);
        assert_eq!(cfg.runs_cache_neg_ttl_ms, 5_000);
        assert_eq!(cfg.runs_cache_ttl_jitter, 0.5);
        assert_eq!(cfg.runs_rate_limit_per_min, 25);
        assert_eq!(cfg.runs_redis_key_prefix, "rr");
        assert!(cfg.otel.enabled);
        assert_eq!(cfg.otel.service_name, "custom");
        assert_eq!(cfg.otel.trace_sample_ratio, 0.25);
        assert_eq!(cfg.otel.metric_export_interval_ms, 15_000);
    }

    #[test]
    fn fails_open_on_garbage_values() {
        let cfg = Config::parse(&env(&[
            ("PORT", "abc"),
            ("REDIS_MODE", "wumbo"),
            ("REDIS_URL", ""),
            ("TRAIN_CATALOG_TTL_MS", "-5"),
            ("TRAIN_STATUS_QOS_FAILURE_THRESHOLD", "0"),
            ("TRAIN_STATUS_QOS_COOLDOWN_MS", "Infinity"),
            ("TRAIN_STATUS_QOS_LATENCY_SAMPLES", "-3"),
            ("STATUS_CACHE_TTL_MS", "0"),
            ("STATUS_CACHE_L1_TTL_MS", "bogus"),
            ("STATUS_CACHE_NEG_TTL_MS", "-100"),
            ("STATUS_CACHE_TTL_JITTER", "2"),
            ("REDIS_KEY_PREFIX", "   "),
            ("REDIS_COMMAND_TIMEOUT_MS", "0"),
            ("REDIS_PROBE_INTERVAL_MS", "never"),
            ("RUNS_CACHE_TTL_MS", "-5"),
            ("RUNS_CACHE_L1_TTL_MS", "bogus"),
            ("RUNS_CACHE_NEG_TTL_MS", "0"),
            ("RUNS_CACHE_TTL_JITTER", "2"),
            ("RUNS_RATE_LIMIT_PER_MIN", "Infinity"),
            ("OTEL_TRACE_SAMPLE_RATIO", "1.5"),
            ("OTEL_METRIC_EXPORT_INTERVAL_MS", "abc"),
        ]));
        assert_eq!(cfg.port, 5000);
        assert_eq!(cfg.redis_mode, RedisMode::Auto);
        assert_eq!(cfg.redis_url, "redis://localhost:6379");
        assert_eq!(cfg.train_catalog_ttl_ms, 3_600_000);
        assert_eq!(cfg.qos_failure_threshold, 3);
        assert_eq!(cfg.qos_cooldown_ms, 60_000);
        assert_eq!(cfg.qos_latency_samples, 100);
        assert_eq!(cfg.status_cache_ttl_ms, 5_000);
        assert_eq!(cfg.status_cache_l1_ttl_ms, 2_000);
        assert_eq!(cfg.status_cache_neg_ttl_ms, 1_000);
        assert_eq!(cfg.status_cache_ttl_jitter, 0.2);
        assert_eq!(cfg.redis_key_prefix, "tt");
        assert_eq!(cfg.redis_command_timeout_ms, 200);
        assert_eq!(cfg.redis_probe_interval_ms, 900_000);
        assert_eq!(cfg.runs_cache_ttl_ms, 21_600_000);
        assert_eq!(cfg.runs_cache_l1_ttl_ms, 300_000);
        assert_eq!(cfg.runs_cache_neg_ttl_ms, 60_000);
        assert_eq!(cfg.runs_cache_ttl_jitter, 0.1);
        assert_eq!(cfg.runs_rate_limit_per_min, 10);
        assert_eq!(cfg.runs_redis_key_prefix, "tt:runs:v1");
        assert_eq!(cfg.otel.trace_sample_ratio, 1.0);
        assert_eq!(cfg.otel.metric_export_interval_ms, 60_000);
    }

    #[test]
    fn redis_mode_accepts_on_off_and_fails_open() {
        assert_eq!(RedisMode::parse(Some("auto")), RedisMode::Auto);
        assert_eq!(RedisMode::parse(Some("ENABLED")), RedisMode::Enabled);
        assert_eq!(RedisMode::parse(Some("on")), RedisMode::Enabled);
        assert_eq!(RedisMode::parse(Some("disabled")), RedisMode::Disabled);
        assert_eq!(RedisMode::parse(Some("off")), RedisMode::Disabled);
        assert_eq!(RedisMode::parse(None), RedisMode::Auto);
        assert_eq!(RedisMode::parse(Some("manual")), RedisMode::Auto);
        assert_eq!(RedisMode::parse(Some("garbage")), RedisMode::Auto);
    }

    #[test]
    fn providers_default_order_when_unset_or_blank() {
        assert_eq!(
            Config::parse(&BTreeMap::new()).train_status_providers,
            default_provider_order()
        );
        let cfg = Config::parse(&env(&[("TRAIN_STATUS_PROVIDERS", " , ")]));
        assert_eq!(cfg.train_status_providers, default_provider_order());
    }

    #[test]
    fn providers_are_lowercased_deduplicated_and_unknown_dropped() {
        let cfg = Config::parse(&env(&[(
            "TRAIN_STATUS_PROVIDERS",
            "PAYTM, goibibo, paytm, bogus",
        )]));
        assert_eq!(cfg.train_status_providers, vec!["paytm", "goibibo"]);
    }

    #[test]
    fn providers_enabled_drops_railradar_without_key() {
        let cfg = Config::parse(&BTreeMap::new());
        assert_eq!(
            cfg.providers_enabled(),
            vec![
                "paytm",
                "goibibo",
                "railyatri",
                "whereismytrain",
                "easemytrip"
            ]
        );
    }

    #[test]
    fn providers_enabled_keeps_railradar_with_key() {
        let cfg = Config::parse(&env(&[("RAILRADAR_API_KEY", "k-123")]));
        assert_eq!(cfg.providers_enabled(), default_provider_order());
    }

    #[test]
    fn config_is_clone_and_shareable() {
        let cfg = Config::parse(&env(&[("PORT", "9000")]));
        let clone = cfg.clone();
        assert_eq!(cfg.port, clone.port);
        assert_eq!(cfg, clone);
    }
}
