//! App wiring: state, route mounting, and the middleware stack.
//!
//! Mirrors `app.ts` in the TypeScript reference server. Middleware is applied
//! with `Router::layer`, where each later call wraps the previous layer, so the
//! stack below runs outermost-first in the same order as the Express `use`s:
//! request logging, CORS, security headers, RED metrics, panic handling.

use std::sync::Arc;
use std::time::Instant;

use axum::http::{header, HeaderName, HeaderValue, Method};
use axum::middleware::{self, from_fn_with_state};
use axum::{routing, Router};
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

use tt_cache::{
    create_redis_client, create_redis_ttl_cache, RedisCacheOptions, RedisConfig, RedisHealth,
    RedisMode, RedisStore, RedisTtlCache, TtlCache,
};
use tt_config::Config;
use tt_mapper::MappedStatus;
use tt_orchestrator::build_status_providers;
use tt_provider_core::TrainStatusProvider;
use tt_qos::QosRegistry;
use tt_telemetry::Telemetry;

use crate::middleware::{
    metrics, panic_to_error_response, security_headers, FailureLog, RequestLog, RequestSpan,
    ResponseLog,
};
use crate::routes::{healthz, not_found, train_status, CachedStatus};

/// Shared, cloneable state handed to handlers and middleware.
#[derive(Clone)]
pub struct AppState {
    /// Parsed environment configuration.
    pub config: Config,
    /// Telemetry handles; inert when disabled.
    pub telemetry: Arc<Telemetry>,
    /// Process start marker, used for `uptime_seconds` on `/api/healthz`.
    pub started: Instant,
    /// Train-status upstreams in priority order; the orchestrator fails over
    /// across them. Mirrors the `statusProviders` list in `routes/trains.ts`.
    pub status_providers: Vec<Arc<dyn TrainStatusProvider>>,
    /// Shared QoS registry consulted by the orchestrator for circuit breaking.
    pub qos: Arc<QosRegistry>,
    /// L1 in-memory single-flight cache, mirroring `tlCache` in
    /// `routes/trains.ts`. Its producer consults L2, then the upstream.
    pub status_l1: Arc<TtlCache<CachedStatus>>,
    /// L2 Redis cache (`createRedisTtlCache`); `None` without Redis or a
    /// real-client build — Miss-equivalent, so the L1 still runs upstream.
    pub status_l2: Option<Arc<RedisTtlCache<MappedStatus>>>,
    /// Redis availability controller (port of `createRedisHealth`), sharing
    /// the connection behind `status_l2` so it reports the same reachability;
    /// `None` whenever the store is too. Read by `/api/healthz`.
    pub redis_health: Option<Arc<RedisHealth>>,
}

/// Builds the fully-wired application router with the configured train-status
/// providers (from `TRAIN_STATUS_PROVIDERS` / `RAILRADAR_API_KEY`) over the
/// production reqwest transport. Testable without binding a port.
pub fn build_app(config: Config, telemetry: Arc<Telemetry>) -> Router {
    let transport: Arc<dyn tt_provider_http::HttpTransport> =
        Arc::new(tt_provider_http::ReqwestTransport::new());
    let status_providers = build_status_providers(
        transport,
        &config.providers_enabled(),
        config.railradar_api_key.as_deref(),
    );
    build_app_with_providers(
        config,
        telemetry,
        status_providers,
        Arc::new(QosRegistry::default()),
    )
}

/// Builds the fully-wired application router over an injected provider list
/// and QoS registry. Route tests substitute `MockTransport`-backed providers
/// here so the whole HTTP surface stays hermetic; the Redis client (store +
/// health) comes from the config (and is `None` on builds without the cache
/// `real-client` feature).
pub fn build_app_with_providers(
    config: Config,
    telemetry: Arc<Telemetry>,
    status_providers: Vec<Arc<dyn TrainStatusProvider>>,
    qos: Arc<QosRegistry>,
) -> Router {
    let redis = create_redis_client(&redis_config(&config));
    let store = redis.as_ref().map(|client| Arc::clone(&client.store));
    let health = redis.as_ref().map(|client| Arc::clone(&client.health));
    build_app_with_cache(config, telemetry, status_providers, qos, store, health)
}

/// The shared wiring core: every constructor funnels here. Route tests pass an
/// injected [`RedisStore`] (the cache crate's `testkit`) to exercise L2
/// behavior hermetically, and an optional health controller for the
/// `/api/healthz` `redis` field (`None` reports `disabled`).
pub fn build_app_with_cache(
    config: Config,
    telemetry: Arc<Telemetry>,
    status_providers: Vec<Arc<dyn TrainStatusProvider>>,
    qos: Arc<QosRegistry>,
    store: Option<Arc<dyn RedisStore>>,
    redis_health: Option<Arc<RedisHealth>>,
) -> Router {
    let status_l1 = TtlCache::new(config.status_cache_l1_ttl_ms as i64);
    let status_l2 = store.and_then(|store| {
        let mut options = RedisCacheOptions::with_defaults(
            config.status_cache_ttl_ms as i64,
            config.status_cache_neg_ttl_ms as i64,
        );
        options.key_prefix = config.redis_key_prefix.clone();
        options.jitter = config.status_cache_ttl_jitter;
        options.compress = config.redis_gzip;
        match create_redis_ttl_cache(store, options) {
            Ok(cache) => Some(cache),
            Err(err) => {
                tracing::warn!(error = %err, "status cache disabled by invalid options");
                None
            }
        }
    });

    let state = AppState {
        config: config.clone(),
        telemetry,
        started: Instant::now(),
        status_providers,
        qos,
        status_l1,
        status_l2,
        redis_health,
    };

    Router::new()
        .route("/api/healthz", routing::get(healthz))
        .route("/api/trains/status", routing::get(train_status))
        .fallback(not_found)
        .layer(CatchPanicLayer::custom(panic_to_error_response))
        .layer(from_fn_with_state(state.clone(), metrics))
        .layer(middleware::from_fn(security_headers))
        .layer(build_cors(&config))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(RequestSpan)
                .on_request(RequestLog)
                .on_response(ResponseLog)
                .on_failure(FailureLog),
        )
        .with_state(state)
}

/// The cache crate's `RedisConfig` built from the parsed app config (its
/// `RedisMode` enum mirrors the config crate's 1:1).
fn redis_config(config: &Config) -> RedisConfig {
    RedisConfig {
        mode: match config.redis_mode {
            tt_config::RedisMode::Auto => RedisMode::Auto,
            tt_config::RedisMode::Enabled => RedisMode::Enabled,
            tt_config::RedisMode::Disabled => RedisMode::Disabled,
        },
        url: config.redis_url.clone(),
        command_timeout_ms: config.redis_command_timeout_ms,
        probe_interval_ms: config.redis_probe_interval_ms,
    }
}

/// CORS policy, mirroring `buildCorsOptions` in `app.ts`: `CORS_ORIGIN` is a
/// comma-separated allowlist; when unset, every cross-origin request is allowed
/// (`*`). Credentials are never granted.
fn build_cors(config: &Config) -> CorsLayer {
    let origins: Vec<HeaderValue> = config
        .cors_origin
        .iter()
        .flatten()
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect();

    let origin = if origins.is_empty() {
        AllowOrigin::any()
    } else {
        AllowOrigin::list(origins)
    };

    let cors_headers = [
        header::CONTENT_TYPE,
        HeaderName::from_static("x-request-id"),
        HeaderName::from_static("traceparent"),
        HeaderName::from_static("tracestate"),
        HeaderName::from_static("baggage"),
    ];

    CorsLayer::new()
        .allow_origin(origin)
        .allow_methods([Method::GET])
        .allow_headers(cors_headers)
        .expose_headers([HeaderName::from_static("x-request-id")])
        .max_age(std::time::Duration::from_secs(86_400))
}
