//! Redis client layer — port of `lib/redis-client.ts` minus the concrete
//! socket code, which sits behind the `real-client` feature so the default
//! build stays hermetic.
//!
//! Public surface:
//!
//! - [`RedisStore`] — the minimal async key/value seam (the `RedisStore`
//!   interface in the TS) shared by the real connection and test fakes.
//! - [`RedisConfig`] / [`parse_redis_config`] — the pure env parsing rules of
//!   `parseRedisConfig`.
//! - [`create_redis_health`] / [`RedisHealth`] — the availability controller
//!   (port of `createRedisHealth`), driven by [`RedisHealthClient`] events.
//! - [`create_redis_store`] / [`create_redis_client`] — the real connection
//!   behind the `real-client` feature (the latter paired with its health
//!   controller as a [`RedisClient`]). Without that feature both report
//!   unconfigured, so the server degrades to in-memory-only exactly like a
//!   disabled `REDIS_URL`.

use std::collections::BTreeMap;
#[cfg(feature = "real-client")]
use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::pin::Pin;
#[cfg(feature = "real-client")]
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;

/// Accepted endpoint URL schemes; anything else is a misconfiguration.
const REDIS_URL_SCHEMES: [&str; 2] = ["redis://", "rediss://"];

/// Default per-command timeout, in milliseconds.
const DEFAULT_COMMAND_TIMEOUT_MS: u64 = 200;

/// How often an unreachable Redis is re-probed in auto mode, milliseconds.
const DEFAULT_PROBE_INTERVAL_MS: u64 = 15 * 60 * 1000;

/// A Redis operation failure, surfaced to the L2 cache so it can fail open.
#[derive(Debug, Clone)]
pub struct StoreError(pub String);

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for StoreError {}

/// The minimal async key/value surface shared by the real ioredis-analog store
/// and test fakes (the `RedisStore` interface in TS). Values are raw bytes;
/// `set` receives an absolute TTL in seconds.
#[async_trait]
pub trait RedisStore: Send + Sync {
    /// Whether the store is currently reachable (health-gated).
    fn is_available(&self) -> bool;

    /// Reads the raw value for `key`, or `None` when absent.
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, StoreError>;

    /// Stores `value` under `key` with an absolute TTL in seconds.
    async fn set(&self, key: &str, value: Vec<u8>, ttl_seconds: u64) -> Result<(), StoreError>;

    /// Disconnects; a no-op for stores without background state.
    async fn close(&self) {}
}

/// `- auto` (default): Redis is used while reachable; on connection failure it
///   is bypassed and re-probed every [`RedisConfig::probe_interval_ms`].
/// - `enabled`: always attempt to connect and use Redis (fail-open per op).
/// - `disabled`: never connect; the server stays in-memory-only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RedisMode {
    Auto,
    Enabled,
    Disabled,
}

/// Parsed Redis configuration (port of `RedisConfig` in TS).
#[derive(Debug, Clone)]
pub struct RedisConfig {
    pub mode: RedisMode,
    /// Endpoint URL to connect to.
    pub url: String,
    /// Per-command timeout in milliseconds.
    pub command_timeout_ms: u64,
    /// Re-probe cadence in auto mode, in milliseconds.
    pub probe_interval_ms: u64,
}

impl RedisConfig {
    /// Whether a configured (non-`disabled`) mode is in effect.
    pub fn connects(&self) -> bool {
        self.mode != RedisMode::Disabled
    }
}

/// Parses Redis configuration from a `KEY` → value mapping. Pure with respect
/// to the mapping, so it is fully unit-testable (port of `parseRedisConfig`).
///
/// Mode resolution: `REDIS_MODE` wins when it names a mode (`auto`,
/// `enabled`/`on`, `disabled`/`off`); otherwise `REDIS_ENABLED=true`/`false`
/// opts in/out for backward compatibility; with neither set the default is
/// **auto**. There is deliberately no default endpoint: a blank or unusable
/// `REDIS_URL` (not `redis://`/`rediss://`) resolves the mode to `disabled`,
/// so a misconfigured process fails open.
pub fn parse_redis_config(env: &BTreeMap<String, String>) -> RedisConfig {
    let url = env
        .get("REDIS_URL")
        .map(String::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let usable = !url.is_empty()
        && REDIS_URL_SCHEMES
            .iter()
            .any(|scheme| url.starts_with(scheme));

    RedisConfig {
        mode: if usable {
            parse_mode(
                env.get("REDIS_MODE").map(String::as_str),
                env.get("REDIS_ENABLED").map(String::as_str),
            )
        } else {
            RedisMode::Disabled
        },
        url,
        command_timeout_ms: positive_ms(
            env,
            "REDIS_COMMAND_TIMEOUT_MS",
            DEFAULT_COMMAND_TIMEOUT_MS,
        ),
        probe_interval_ms: positive_ms(env, "REDIS_PROBE_INTERVAL_MS", DEFAULT_PROBE_INTERVAL_MS),
    }
}

fn positive_ms(env: &BTreeMap<String, String>, key: &str, fallback: u64) -> u64 {
    env.get(key)
        .and_then(|raw| raw.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v > 0.0)
        .map(|v| v as u64)
        .unwrap_or(fallback)
}

fn parse_mode(mode_raw: Option<&str>, enabled_raw: Option<&str>) -> RedisMode {
    if let Some(raw) = mode_raw {
        match raw.trim().to_ascii_lowercase().as_str() {
            "enabled" | "on" => return RedisMode::Enabled,
            "disabled" | "off" => return RedisMode::Disabled,
            // "auto" and unknown values fall through to REDIS_ENABLED.
            _ => {}
        }
    }
    match enabled_raw.map(str::trim) {
        Some("true") => RedisMode::Enabled,
        Some("false") => RedisMode::Disabled,
        _ => RedisMode::Auto,
    }
}

/// The subset of the client the health controller depends on (fakeable in
/// tests), port of `RedisHealthClientLike`. Implementers own the connection
/// lifecycle: they expose a `status` string, a `connect()` future (success
/// fires `ready`, failure fires `end`) and let listeners subscribe to the
/// `"ready"`, `"close"`, `"error"`, and `"end"` events.
pub trait RedisHealthClient: Send + Sync {
    /// Current connection status (`"wait"`, `"ready"`, `"connecting"`, `"end"`).
    fn status(&self) -> &str;

    /// Attempts a (re)connection: `Ok` when the client reached `"ready"`.
    fn connect(&self) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>>;

    /// Subscribes to `event`; returns a subscription id for [`off`](Self::off).
    fn on(&self, event: &'static str, callback: Box<dyn Fn() + Send + Sync>) -> usize;

    /// Removes the subscription `id` for `event`.
    fn off(&self, event: &'static str, id: usize);
}

/// Options for [`create_redis_health`] (port of `RedisHealthOptions`).
#[derive(Debug, Clone, Copy)]
pub struct RedisHealthOptions {
    /// Re-probe cadence for unreachable Redis in auto mode, in milliseconds.
    pub probe_interval_ms: u64,
    /// Whether failed connections should be re-probed on a timer.
    pub auto_recheck: bool,
}

/// Tracks whether the Redis client is usable and, in auto mode, re-checks an
/// unreachable client on a fixed cadence. Port of `createRedisHealth`:
///
/// - `ready` → healthy (also cancels any pending re-probe).
/// - `close`/`error` → unhealthy.
/// - `end` → unhealthy and, when `auto_recheck`, schedules a re-probe that
///   calls `client.connect()` after `probe_interval_ms`.
///
/// While unhealthy, callers bypass Redis entirely (no per-request timeouts).
pub struct RedisHealth {
    core: Arc<HealthCore>,
}

struct HealthCore {
    client: Arc<dyn RedisHealthClient>,
    opts: RedisHealthOptions,
    healthy: AtomicBool,
    probing: AtomicBool,
    /// Incremented on `ready`/`dispose`; a re-probe task that wakes with a
    /// stale generation cancels itself instead of probing (mirrors the TS
    /// `clearTimeout` in `markHealthy`).
    generation: Arc<AtomicU64>,
    subscriptions: Mutex<Vec<(&'static str, usize)>>,
    /// The single pending re-probe task; `Some` means the TS `timer` is set.
    probe_task: Mutex<Option<JoinHandle>>,
}

type JoinHandle = tokio::task::JoinHandle<()>;

impl RedisHealth {
    /// `true` when the client may issue commands.
    pub fn is_healthy(&self) -> bool {
        self.core.healthy.load(Ordering::Relaxed)
    }

    /// Stops probing and unsubscribes from the client's events (port of the
    /// TS `dispose`).
    pub fn dispose(&self) {
        self.core.dispose();
    }
}

impl HealthCore {
    fn mark_healthy(&self) {
        if self.healthy.swap(true, Ordering::Relaxed) {
            return;
        }
        self.generation.fetch_add(1, Ordering::Relaxed);
        // Mirrors the TS `clearProbe` in `markHealthy`: only a *pending*
        // re-probe timer is cancelled. A probe currently in flight must run to
        // completion so it can clear `probing` and its own task slot.
        if !self.probing.load(Ordering::Relaxed) {
            self.cancel_probe_task();
        }
    }

    fn mark_unhealthy(&self) {
        self.healthy.store(false, Ordering::Relaxed);
    }

    /// `"end"` event: unhealthy and, in auto mode, schedule a re-probe.
    fn on_end(self: &Arc<Self>) {
        self.mark_unhealthy();
        self.schedule_probe();
    }

    /// Mirrors the TS `clearProbe`: aborts the pending timer if any.
    fn cancel_probe_task(&self) {
        if let Some(t) = self.probe_task.lock().unwrap().take() {
            t.abort();
        }
    }

    fn schedule_probe(self: &Arc<Self>) {
        if !self.opts.auto_recheck
            || self.probing.load(Ordering::Relaxed)
            || self.probe_task.lock().unwrap().is_some()
        {
            return;
        }
        // Outside a tokio runtime (e.g. startup) the timer can't run; the
        // client is re-probed lazily by subsequent events instead.
        if tokio::runtime::Handle::try_current().is_err() {
            return;
        }
        let generation = Arc::clone(&self.generation);
        let core = Arc::clone(self);
        let task = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(core.opts.probe_interval_ms)).await;
            if generation.load(Ordering::Relaxed) != core.generation.load(Ordering::Relaxed) {
                return;
            }
            core.probe().await;
        });
        *self.probe_task.lock().unwrap() = Some(task);
    }

    /// The re-probe body (TS `probe`): mark ready when the client already is;
    /// otherwise attempt a connection. Failed or still-connecting clients
    /// re-schedule the next probe.
    async fn probe(self: &Arc<Self>) {
        self.probing.store(true, Ordering::Relaxed);
        let status = self.client.status().to_string();
        if status == "ready" {
            self.mark_healthy();
        } else if status != "connecting" && status != "connect" {
            match self.client.connect().await {
                Ok(()) => self.mark_healthy(),
                Err(_) => self.mark_unhealthy(),
            }
        }
        self.probing.store(false, Ordering::Relaxed);
        // Release our own slot before possibly re-arming a fresh timer.
        *self.probe_task.lock().unwrap() = None;
        if !self.healthy.load(Ordering::Relaxed) {
            self.schedule_probe();
        }
    }

    fn dispose(&self) {
        self.generation.fetch_add(1, Ordering::Relaxed);
        self.cancel_probe_task();
        self.probing.store(false, Ordering::Relaxed);
        for (event, id) in self.subscriptions.lock().unwrap().iter() {
            self.client.off(event, *id);
        }
        self.subscriptions.lock().unwrap().clear();
    }
}

/// Creates a [`RedisHealth`] controller over `client` (port of
/// `createRedisHealth`). The controller subscribes to the client's
/// `ready`/`close`/`error`/`end` events and re-probes an unreachable client
/// on the auto-recheck cadence.
pub fn create_redis_health(
    client: Arc<dyn RedisHealthClient>,
    options: RedisHealthOptions,
) -> Arc<RedisHealth> {
    let core = Arc::new(HealthCore {
        client,
        opts: options,
        healthy: AtomicBool::new(false),
        probing: AtomicBool::new(false),
        generation: Arc::new(AtomicU64::new(0)),
        subscriptions: Mutex::new(Vec::new()),
        probe_task: Mutex::new(None),
    });

    subscribe(&core, "ready", |core| core.mark_healthy());
    subscribe(&core, "close", |core| core.mark_unhealthy());
    subscribe(&core, "error", |core| core.mark_unhealthy());
    subscribe(&core, "end", |core| core.on_end());

    Arc::new(RedisHealth { core })
}

/// Registers `callback` for `event` on the core's client and records the
/// subscription id for `dispose`. The callback holds a `Weak` reference so an
/// abandoned controller never pins the (potentially long-lived) client.
fn subscribe(core: &Arc<HealthCore>, event: &'static str, callback: fn(&Arc<HealthCore>)) {
    let weak = Arc::downgrade(core);
    let id = core.client.on(
        event,
        Box::new(move || {
            if let Some(core) = weak.upgrade() {
                callback(&core);
            }
        }),
    );
    core.subscriptions.lock().unwrap().push((event, id));
}

/// Creates the real Redis store, or `None` when the config keeps the server
/// in-memory-only. Port of `createRedisStore`: `None` for `Disabled` mode
/// (and, on builds without the `real-client` feature, always — the socket
/// code is not compiled in, so the server degrades like a missing `REDIS_URL`).
pub fn create_redis_store(config: &RedisConfig) -> Option<Arc<dyn RedisStore>> {
    if config.mode == RedisMode::Disabled {
        return None;
    }
    #[cfg(feature = "real-client")]
    {
        Some(Arc::new(real::RealRedisStore::new(config)))
    }
    #[cfg(not(feature = "real-client"))]
    {
        let _ = config;
        None
    }
}

/// A real Redis client: the store and its health controller, sharing one
/// connection so [`RedisStore::is_available`] and
/// [`RedisHealth::is_healthy`] report the same reachability.
pub struct RedisClient {
    /// The store used by the L2 cache.
    pub store: Arc<dyn RedisStore>,
    /// Its availability controller, for `/api/healthz`.
    pub health: Arc<RedisHealth>,
}

/// Creates the real Redis store paired with its health controller, or `None`
/// when the config keeps the server in-memory-only (same rules as
/// [`create_redis_store`]). The controller re-probes an unreachable client on
/// the config's `probe_interval_ms` cadence, and the first connection attempt
/// starts eagerly — like ioredis's `new Redis()` in the TS — so the initial
/// health state reflects reachability instead of waiting for a probe.
pub fn create_redis_client(config: &RedisConfig) -> Option<RedisClient> {
    if config.mode == RedisMode::Disabled {
        return None;
    }
    #[cfg(feature = "real-client")]
    {
        let store = Arc::new(real::RealRedisStore::new(config));
        let health = create_redis_health(
            store.clone() as Arc<dyn RedisHealthClient>,
            RedisHealthOptions {
                probe_interval_ms: config.probe_interval_ms,
                auto_recheck: true,
            },
        );
        store.connect_initial();
        Some(RedisClient { store, health })
    }
    #[cfg(not(feature = "real-client"))]
    {
        let _ = config;
        None
    }
}

/// The real ioredis-analog connection: `redis` crate behind the `real-client`
/// feature. Lazy-connecting and fail-open: every operation (re)establishes a
/// managed connection when needed, within the per-command timeout, exactly
/// like the TS eager `connect()` degraded into a per-op reconnect. Success
/// flips [`RedisStore::is_available`]; failures flip it back and, as a
/// [`RedisHealthClient`], broadcast `ready`/`end` events so the health
/// controller follows the same connection state.
#[cfg(feature = "real-client")]
mod real {
    use super::*;
    use redis::aio::ConnectionManager;

    /// Connection-event listeners keyed by event name (`ready`, `end`).
    type Listeners = Mutex<HashMap<&'static str, Vec<(usize, Arc<dyn Fn() + Send + Sync>)>>>;

    pub struct RealRedisStore {
        client: redis::Client,
        manager: tokio::sync::Mutex<Option<ConnectionManager>>,
        available: AtomicBool,
        command_timeout: Duration,
        listeners: Listeners,
        next_id: AtomicUsize,
    }

    impl RealRedisStore {
        pub fn new(config: &RedisConfig) -> Self {
            let client = redis::Client::open(config.url.as_str())
                .expect("REDIS_URL validated by parse_redis_config");
            RealRedisStore {
                client,
                manager: tokio::sync::Mutex::new(None),
                available: AtomicBool::new(false),
                command_timeout: Duration::from_millis(config.command_timeout_ms),
                listeners: Mutex::new(HashMap::new()),
                next_id: AtomicUsize::new(0),
            }
        }

        /// Fires `event` to every subscribed listener, invoked outside the
        /// listener lock so callbacks may subscribe or unsubscribe freely.
        fn emit(&self, event: &'static str) {
            let callbacks = self
                .listeners
                .lock()
                .unwrap()
                .get(event)
                .cloned()
                .unwrap_or_default();
            for (_, callback) in callbacks {
                callback();
            }
        }

        /// Kicks off the first connection attempt (port of ioredis's eager
        /// connect at construction) so the health controller's initial state
        /// reflects reachability without waiting for a probe. Outside a tokio
        /// runtime there is nothing to spawn on; the client connects lazily.
        pub fn connect_initial(self: &Arc<Self>) {
            if tokio::runtime::Handle::try_current().is_err() {
                return;
            }
            let this = Arc::clone(self);
            tokio::spawn(async move {
                let _ = this.connect().await;
            });
        }

        /// Returns a live connection as needed, (re)connecting within the
        /// per-command timeout when the previous one is gone.
        async fn connection(&self) -> Result<ConnectionManager, StoreError> {
            let mut guard = self.manager.lock().await;
            if guard.is_none() {
                self.available.store(false, Ordering::Relaxed);
                let manager = match tokio::time::timeout(
                    self.command_timeout,
                    ConnectionManager::new(self.client.clone()),
                )
                .await
                {
                    Ok(Ok(manager)) => {
                        self.available.store(true, Ordering::Relaxed);
                        manager
                    }
                    Ok(Err(err)) => return Err(StoreError(err.to_string())),
                    Err(_) => return Err(StoreError("connection timed out".to_string())),
                };
                *guard = Some(manager);
            }
            Ok(guard.as_mut().expect("connected above").clone())
        }
    }

    #[async_trait]
    impl RedisStore for RealRedisStore {
        fn is_available(&self) -> bool {
            self.available.load(Ordering::Relaxed)
        }

        async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, StoreError> {
            let mut manager = self.connection().await?;
            tokio::time::timeout(self.command_timeout, async {
                redis::cmd("GET")
                    .arg(key)
                    .query_async::<Option<Vec<u8>>>(&mut manager)
                    .await
            })
            .await
            .map_err(|_| StoreError("command timed out".to_string()))?
            .map_err(|err| {
                self.available.store(false, Ordering::Relaxed);
                self.emit("end");
                StoreError(err.to_string())
            })
        }

        async fn set(&self, key: &str, value: Vec<u8>, ttl_seconds: u64) -> Result<(), StoreError> {
            let mut manager = self.connection().await?;
            tokio::time::timeout(self.command_timeout, async {
                redis::cmd("SET")
                    .arg(key)
                    .arg(value)
                    .arg("EX")
                    .arg(ttl_seconds)
                    .query_async::<()>(&mut manager)
                    .await
            })
            .await
            .map_err(|_| StoreError("command timed out".to_string()))?
            .map_err(|err| {
                self.available.store(false, Ordering::Relaxed);
                self.emit("end");
                StoreError(err.to_string())
            })
        }

        async fn close(&self) {
            self.available.store(false, Ordering::Relaxed);
            self.manager.lock().await.take();
            self.emit("end");
        }
    }

    impl RedisHealthClient for RealRedisStore {
        fn status(&self) -> &str {
            if self.available.load(Ordering::Relaxed) {
                "ready"
            } else {
                "end"
            }
        }

        fn connect(&self) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>> {
            Box::pin(async move {
                // Drop any stale manager so the shared establishment path
                // performs a fresh (re)connection and re-flips `available`.
                self.manager.lock().await.take();
                match self.connection().await {
                    Ok(_) => {
                        self.emit("ready");
                        Ok(())
                    }
                    Err(err) => {
                        self.emit("end");
                        Err(err.0)
                    }
                }
            })
        }

        fn on(&self, event: &'static str, callback: Box<dyn Fn() + Send + Sync>) -> usize {
            let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
            self.listeners
                .lock()
                .unwrap()
                .entry(event)
                .or_default()
                .push((id, Arc::from(callback)));
            id
        }

        fn off(&self, event: &'static str, id: usize) {
            if let Some(callbacks) = self.listeners.lock().unwrap().get_mut(event) {
                callbacks.retain(|(listener_id, _)| *listener_id != id);
            }
        }
    }
}
