//! L2 Redis-backed TTL cache — port of `lib/redis-cache.ts` (`RedisTtlCache`).
//!
//! Layered on any [`RedisStore`], so it is testable against a fake. Values
//! serialize to text (optionally gzip-compressed), expire via a Redis TTL,
//! and never produce poison: Redis failures are fail-open (`get` → miss,
//! `set`/`set_negative` → no-op) with an optional `on_error` sink, and TTLs
//! are jittered so a mass expiry storms neither Redis nor upstream.

use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::de::DeserializeOwned;
use serde::Serialize;
use tt_telemetry::CacheMetrics;

use crate::store::{RedisStore, StoreError};

/// Marker written by [`set_negative`](RedisTtlCache::set_negative) — port of
/// `NOT_FOUND_MARKER`. The marker is stored as-is (never compressed) so a
/// `get` can detect it before deserializing.
pub const NOT_FOUND_MARKER: &str = "tt:not-found";

/// Default maximum accepted value size (2 MiB), port of
/// `DEFAULT_MAX_VALUE_BYTES`.
pub const DEFAULT_MAX_VALUE_BYTES: usize = 2 * 1024 * 1024;

/// Default `key_prefix` ("tt").
pub const DEFAULT_KEY_PREFIX: &str = "tt";

/// gzip magic bytes (`0x1f 0x8b`), used to detect compressed values.
const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

/// Outcome of a [`get`](RedisTtlCache::get) against the L2 cache.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CacheResult<T> {
    /// A live value was found and deserialized.
    Hit(T),
    /// A cached "not found" marker was found.
    Negative,
    /// No usable value was found (miss, store unavailable, or undecodable).
    Miss,
}

/// Failure sink `(message, operation, key)` for `RedisCacheOptions::on_error`.
pub type OnErrorFn = Arc<dyn Fn(&str, &str, &str) + Send + Sync>;
/// Serializer `T -> String` for `RedisCacheOptions::serialize`.
pub type SerializeFn<T> = Arc<dyn Fn(&T) -> String + Send + Sync>;
/// Deserializer `&[u8] -> Result<T, String>` for `RedisCacheOptions::deserialize`.
pub type DeserializeFn<T> = Arc<dyn Fn(&[u8]) -> Result<T, String> + Send + Sync>;

/// Options for [`create_redis_ttl_cache`] — the full option bag of the TS
/// `RedisTtlCache` constructor.
///
/// `T` is unconstrained here so callers may attach custom `serialize` /
/// `deserialize` functions for any type; use
/// [`RedisCacheOptions::with_defaults`] when serde_json defaults suffice.
pub struct RedisCacheOptions<T> {
    /// Positive TTL for cached values, in milliseconds.
    pub ttl_ms: i64,
    /// Positive TTL for cached "not found" markers, in milliseconds.
    pub negative_ttl_ms: i64,
    /// Random TTL spread in `[0, 1)`: `0` disables jitter.
    pub jitter: f64,
    /// Key prefix applied to every `key` (`"{prefix}:{key}"`).
    pub key_prefix: String,
    /// Whether values are gzip-compressed before storage.
    pub compress: bool,
    /// Uniform `[0, 1)` source used for TTL jitter (defaults to an internal
    /// PRNG; inject `|| 0.0` for determinism in tests).
    pub random: Box<dyn Fn() -> f64 + Send + Sync>,
    /// Maximum accepted value size in bytes (raw or decompressed); larger
    /// values are treated as undecodable.
    pub max_value_bytes: usize,
    /// Failure sink `(message, operation, key)`; defaults to silently
    /// failing open when `None`. Store errors report the *prefixed* key;
    /// deserialization errors report the caller's key.
    pub on_error: Option<OnErrorFn>,
    /// Serializer applied to values before storage.
    pub serialize: SerializeFn<T>,
    /// Deserializer applied to raw stored bytes.
    pub deserialize: DeserializeFn<T>,
    /// Optional L2/Redis metrics recorder.
    pub metrics: Option<Arc<CacheMetrics>>,
}

impl<T: Serialize + DeserializeOwned + Send + Sync + 'static> RedisCacheOptions<T> {
    /// Options with the serde_json defaults: `tt` prefix, no compression, no
    /// jitter, 2 MiB value cap, no failure sink, no metrics.
    pub fn with_defaults(ttl_ms: i64, negative_ttl_ms: i64) -> RedisCacheOptions<T> {
        RedisCacheOptions {
            ttl_ms,
            negative_ttl_ms,
            jitter: 0.0,
            key_prefix: DEFAULT_KEY_PREFIX.to_string(),
            compress: false,
            random: Box::new(default_random),
            max_value_bytes: DEFAULT_MAX_VALUE_BYTES,
            on_error: None,
            metrics: None,
            serialize: Arc::new(default_serialize::<T>),
            deserialize: Arc::new(default_deserialize::<T>(DEFAULT_MAX_VALUE_BYTES)),
        }
    }
}

/// Creates a [`RedisTtlCache`] over `store`. `Err` for the same invalid
/// options that make the TS constructor throw (`ttlMs` / `negativeTtlMs`
/// non-positive). TTL jitter outside `[0, 1)` and other oddities silently
/// degrade to their defaults, exactly like the TS constructor.
pub fn create_redis_ttl_cache<T>(
    store: Arc<dyn RedisStore>,
    options: RedisCacheOptions<T>,
) -> Result<Arc<RedisTtlCache<T>>, String>
where
    T: Send + Sync + 'static,
{
    if options.ttl_ms <= 0 {
        return Err("ttlMs must be a positive finite number".to_string());
    }
    if options.negative_ttl_ms <= 0 {
        return Err("negativeTtlMs must be a positive finite number".to_string());
    }
    Ok(Arc::new(RedisTtlCache {
        store,
        options: Arc::new(options),
    }))
}

/// The L2 cache, port of `RedisTtlCache` in `lib/redis-cache.ts`.
pub struct RedisTtlCache<T> {
    store: Arc<dyn RedisStore>,
    options: Arc<RedisCacheOptions<T>>,
}

impl<T: Send + Sync + 'static> RedisTtlCache<T> {
    /// Whether the backing store is currently reachable.
    pub fn is_available(&self) -> bool {
        self.store.is_available()
    }

    /// Reads `key`, applying the not-found marker, size cap, and
    /// deserialization. Fail-open: any store trouble is a [`CacheResult::Miss`].
    pub async fn get(&self, key: &str) -> CacheResult<T> {
        let started = Instant::now();
        let full_key = self.key_of(key);
        if !self.store.is_available() {
            self.record_redis("get", "unavailable", started);
            return CacheResult::Miss;
        }
        let raw = match self.store.get(&full_key).await {
            Ok(raw) => raw,
            Err(err) => {
                self.record_redis("get", "error", started);
                self.on_error(&err.to_string(), "get", &full_key);
                return CacheResult::Miss;
            }
        };
        let Some(raw) = raw else {
            self.record_redis("get", "miss", started);
            return CacheResult::Miss;
        };

        if raw == NOT_FOUND_MARKER.as_bytes() {
            self.record_redis("get", "negative", started);
            return CacheResult::Negative;
        }
        if raw.len() > self.options.max_value_bytes {
            let msg = format!(
                "value exceeds max value size of {} bytes",
                self.options.max_value_bytes
            );
            self.record_redis("deserialize", "error", started);
            self.on_error(&msg, "deserialize", key);
            return CacheResult::Miss;
        }
        match (self.options.deserialize)(&raw) {
            Ok(value) => {
                self.record_redis("get", "hit", started);
                CacheResult::Hit(value)
            }
            Err(err) => {
                self.record_redis("deserialize", "error", started);
                self.on_error(&err, "deserialize", key);
                CacheResult::Miss
            }
        }
    }

    /// Stores `value` under `key` with the configured (jittered) TTL, or an
    /// explicit override. The only `Err` is the reserved-marker conflict
    /// (port of the TS throw); store failures fail open via `on_error`.
    pub async fn set(&self, key: &str, value: &T, ttl_ms: Option<i64>) -> Result<(), StoreError> {
        let started = Instant::now();
        let text = (self.options.serialize)(value);
        if text == NOT_FOUND_MARKER {
            return Err(StoreError(format!(
                "refusing to store the reserved marker {NOT_FOUND_MARKER} as a value"
            )));
        }
        let full_key = self.key_of(key);
        let ttl_seconds = self.ttl_seconds(ttl_ms.unwrap_or(self.options.ttl_ms));
        let buf = if self.options.compress {
            gzip(text.as_bytes())
        } else {
            text.into_bytes()
        };
        self.safe_set("set", &full_key, buf, ttl_seconds, started)
            .await
    }

    /// Caches a "not found" marker under `key` (port of `setNegative`). The
    /// marker is never compressed, so `get` finds it verbatim.
    pub async fn set_negative(&self, key: &str, ttl_ms: Option<i64>) {
        let started = Instant::now();
        let full_key = self.key_of(key);
        let ttl_seconds = self.ttl_seconds(ttl_ms.unwrap_or(self.options.negative_ttl_ms));
        let buf = NOT_FOUND_MARKER.as_bytes().to_vec();
        self.safe_set("set_negative", &full_key, buf, ttl_seconds, started)
            .await
            .ok();
    }

    fn key_of(&self, key: &str) -> String {
        format!("{}:{}", self.options.key_prefix, key)
    }

    /// TTL in whole seconds (`Math.max(1, Math.round(ms / 1000))`), after the
    /// optional jitter spread.
    fn ttl_seconds(&self, ttl_ms: i64) -> u64 {
        let jitter = self.options.jitter;
        let ttl = if (0.0..1.0).contains(&jitter) {
            let factor = 1.0 - jitter + (self.options.random)() * 2.0 * jitter;
            (ttl_ms as f64) * factor
        } else {
            ttl_ms as f64
        };
        ((ttl / 1000.0).round().max(1.0)) as u64
    }

    /// Fail-open store write (port of `safeSet`): unavailable stores and
    /// store errors are logged/recorded, never surfaced to the caller.
    async fn safe_set(
        &self,
        op: &str,
        key: &str,
        value: Vec<u8>,
        ttl_seconds: u64,
        started: Instant,
    ) -> Result<(), StoreError> {
        if !self.store.is_available() {
            self.record_redis(op, "unavailable", started);
            return Ok(());
        }
        match self.store.set(key, value, ttl_seconds).await {
            Ok(()) => {
                self.record_redis(op, "ok", started);
                Ok(())
            }
            Err(err) => {
                self.record_redis(op, "error", started);
                self.on_error(&err.to_string(), op, key);
                Ok(())
            }
        }
    }

    fn record_redis(&self, operation: &str, outcome: &str, started: Instant) {
        if let Some(metrics) = &self.options.metrics {
            metrics.record_redis(operation, outcome, started.elapsed().as_secs_f64());
        }
    }

    fn on_error(&self, message: &str, operation: &str, key: &str) {
        if let Some(on_error) = &self.options.on_error {
            on_error(message, operation, key);
        }
    }
}

/// Default serializer: `JSON.stringify` via serde_json.
fn default_serialize<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

/// Default deserializer factory: JSON.parse of the (optionally gunzipped)
/// bytes, rejecting raw or decompressed values larger than `max_value_bytes`
/// (the TS `defaultDeserialize(maxValueBytes)`).
fn default_deserialize<T: DeserializeOwned>(
    max_value_bytes: usize,
) -> impl Fn(&[u8]) -> Result<T, String> + Send + Sync {
    move |raw: &[u8]| {
        let bytes = if raw.starts_with(&GZIP_MAGIC) {
            gunzip_limited(raw, max_value_bytes)?
        } else {
            raw.to_vec()
        };
        let text = String::from_utf8(bytes).map_err(|err| err.to_string())?;
        serde_json::from_str(&text).map_err(|err| err.to_string())
    }
}

/// Bounded gunzip: the decoder is capped so a bomb cannot exceed memory.
fn gunzip_limited(raw: &[u8], max_value_bytes: usize) -> Result<Vec<u8>, String> {
    let decoder = GzDecoder::new(raw);
    let mut limited = decoder.take((max_value_bytes as u64) + 1);
    let mut out = Vec::new();
    limited
        .read_to_end(&mut out)
        .map_err(|err| err.to_string())?;
    if out.len() > max_value_bytes {
        return Err("decompressed value exceeds max value size".to_string());
    }
    Ok(out)
}

fn gzip(data: &[u8]) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(data).expect("gzip write");
    encoder.finish().expect("gzip finish")
}

/// Deterministic-ish uniform `[0, 1)` stream for TTL jitter (xorshift64*,
/// seeded from the clock). Tests inject `|| 0.0` for exactness.
fn default_random() -> f64 {
    static STATE: AtomicU64 = AtomicU64::new(0);
    let mut state = STATE.load(Ordering::Relaxed);
    if state == 0 {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9E37_79B9_7F4A_7C15)
            | 1;
        state = seed;
    }
    state ^= state << 13;
    state ^= state >> 7;
    state ^= state << 17;
    STATE.store(state, Ordering::Relaxed);
    ((state >> 11) as f64) / (1u64 << 53) as f64
}
