//! L1 in-memory TTL cache — port of `lib/ttl-cache.ts` (`createTtlCache`).

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::future::Shared;
use futures_util::FutureExt;
use tt_telemetry::CacheMetrics;

/// Default entry cap guarding against unbounded key spray (`DEFAULT_MAX_SIZE`).
const DEFAULT_MAX_SIZE: usize = 10_000;

/// Producer/lookup failure. The message is carried for logs; the route maps a
/// failed lookup onto its HTTP verdicts itself. `Clone` so single-flight
/// futures (`Shared`) can be cloned per waiter without re-running the
/// producer.
#[derive(Debug, Clone)]
pub struct CacheError {
    pub message: String,
}

impl std::fmt::Display for CacheError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CacheError {}

/// Epoch milliseconds (the TS `Date.now()`).
pub fn epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Configuration for [`create_ttl_cache`] — the `ttlMs`, `now`, and `maxSize`
/// arguments of the TS factory.
pub struct TtlCacheConfig {
    /// Base TTL applied to stored values, in milliseconds.
    pub ttl_ms: i64,
    /// Injectable clock returning epoch milliseconds.
    pub now: Arc<dyn Fn() -> i64 + Send + Sync>,
    /// Entry cap (oldest live entries evicted when exceeded).
    pub max_size: usize,
    /// Optional L1 cache metrics recorder.
    pub metrics: Option<Arc<CacheMetrics>>,
}

impl TtlCacheConfig {
    /// Shorthand for a config with the real clock, default cap, no metrics.
    pub fn new(ttl_ms: i64) -> TtlCacheConfig {
        TtlCacheConfig {
            ttl_ms,
            now: Arc::new(epoch_ms),
            max_size: DEFAULT_MAX_SIZE,
            metrics: None,
        }
    }
}

struct Entry<T> {
    value: T,
    expires_at: i64,
}

type SharedProducer<T> = Shared<Pin<Box<dyn Future<Output = Result<T, CacheError>> + Send>>>;

/// Shared mutable state of a [`TtlCache`]. `order` mirrors the TypeScript `Map`
/// insertion order (oldest first) so capacity eviction is deterministic.
struct CacheState<T> {
    store: HashMap<String, Entry<T>>,
    order: VecDeque<String>,
    in_flight: HashMap<String, SharedProducer<T>>,
}

/// Zero-dependency in-memory TTL cache, port of `createTtlCache` from
/// `lib/ttl-cache.ts`.
///
/// Entries expire lazily — `get`/`has` drop stale entries instead of
/// returning them (fail-closed). Capacity is bounded by `max_size`: when
/// exceeded, expired entries are pruned first and then the oldest-inserted
/// live entries are evicted, so a key-spraying attacker cannot grow the cache
/// without bound. Overwriting an existing key keeps its insertion position.
///
/// `get_or_set` is single-flight: concurrent callers for the same key share
/// one producer invocation, and failures are never cached so the next call
/// retries. All state is behind interior-mutability locks and the type is
/// `Send + Sync` by construction; the cache is shared across handlers as `Arc`.
pub struct TtlCache<T> {
    ttl_ms: i64,
    now: Arc<dyn Fn() -> i64 + Send + Sync>,
    max_size: usize,
    metrics: Option<Arc<CacheMetrics>>,
    state: Arc<Mutex<CacheState<T>>>,
}

impl<T: Clone + Send + Sync + 'static> TtlCache<T> {
    /// Creates a cache with the default clock and cap. Panics when `ttl_ms` is
    /// non-positive (mirrors the TS `"ttlMs must be positive"` throw).
    pub fn new(ttl_ms: i64) -> Arc<TtlCache<T>> {
        TtlCache::from_config(TtlCacheConfig::new(ttl_ms)).unwrap_or_else(|e| panic!("{e}"))
    }

    /// Creates a cache from a config; returns `Err` for the same invalid
    /// inputs that make the TS factory throw (`ttlMs <= 0`, `maxSize <= 0`).
    pub fn from_config(config: TtlCacheConfig) -> Result<Arc<TtlCache<T>>, CacheError> {
        if config.ttl_ms <= 0 {
            return Err(CacheError {
                message: "ttlMs must be positive".to_string(),
            });
        }
        if config.max_size == 0 {
            return Err(CacheError {
                message: "maxSize must be a positive finite number".to_string(),
            });
        }
        Ok(Arc::new(TtlCache {
            ttl_ms: config.ttl_ms,
            now: config.now,
            max_size: config.max_size,
            metrics: config.metrics,
            state: Arc::new(Mutex::new(CacheState {
                store: HashMap::new(),
                order: VecDeque::new(),
                in_flight: HashMap::new(),
            })),
        }))
    }

    /// Returns the stored value, or `None` when missing or expired. Expired
    /// entries are dropped instead of returned (fail-closed).
    pub fn get(&self, key: &str) -> Option<T> {
        let mut state = self.state.lock().unwrap();
        match state.store.get(key) {
            Some(entry) if entry.expires_at <= (self.now)() => {
                state.store.remove(key);
                self.observe_size(&state);
                None
            }
            Some(entry) => Some(entry.value.clone()),
            None => None,
        }
    }

    /// Stores `value` under `key` with the cache-wide TTL.
    pub fn set(&self, key: &str, value: T) {
        let now = (self.now)();
        self.put(key, value, now + self.ttl_ms);
    }

    /// `true` when a live entry exists for `key` (dropping stale entries).
    pub fn has(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    /// Removes a live entry; `false` when missing or already expired.
    pub fn delete(&self, key: &str) -> bool {
        let mut state = self.state.lock().unwrap();
        let Some(entry) = state.store.get(key) else {
            return false;
        };
        if entry.expires_at <= (self.now)() {
            state.store.remove(key);
            return false;
        }
        state.store.remove(key);
        state.order.retain(|k| k != key);
        self.observe_size(&state);
        true
    }

    /// Fetches the value for `key`, or fetches it once via `producer`
    /// (single-flight) and caches it. Failures are never cached, so the next
    /// call retries. The entry's expiry is measured from when the fetch
    /// *started* (not when it completed), so a producer that outlives its TTL
    /// stores nothing.
    pub async fn get_or_set<F, Fut>(&self, key: &str, producer: F) -> Result<T, CacheError>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<T, CacheError>> + Send + 'static,
    {
        if let Some(cached) = self.get(key) {
            self.record_hit();
            return Ok(cached);
        }

        let pending = self.state.lock().unwrap().in_flight.get(key).cloned();
        if let Some(future) = pending {
            self.record_single_flight();
            return future.await;
        }

        self.record_miss();

        let started_at = (self.now)();
        let expires_at = started_at + self.ttl_ms;
        let this = self.clone_inner();
        let key_for_block = key.to_string();
        let producer_future = producer();

        let future: SharedProducer<T> = async move {
            let result = producer_future.await;
            let mut state = this.state.lock().unwrap();
            state.in_flight.remove(&key_for_block);
            match result {
                Ok(value) => {
                    drop(state);
                    this.put(&key_for_block, value.clone(), expires_at);
                    Ok(value)
                }
                Err(err) => Err(err),
            }
        }
        .boxed()
        .shared();

        self.state
            .lock()
            .unwrap()
            .in_flight
            .insert(key.to_string(), future.clone());
        future.await
    }

    /// Stores `value` with an explicit expiry, evicting when over capacity
    /// (port of the inner `put` of `ttl-cache.ts`).
    fn put(&self, key: &str, value: T, expires_at: i64) {
        let mut state = self.state.lock().unwrap();
        if !state.store.contains_key(key) {
            state.order.push_back(key.to_string());
        }
        state
            .store
            .insert(key.to_string(), Entry { value, expires_at });
        if state.store.len() <= self.max_size {
            self.observe_size(&state);
            return;
        }

        let t = (self.now)();
        let mut dropped = 0;
        let expired: Vec<String> = state
            .store
            .iter()
            .filter(|(_, entry)| entry.expires_at <= t)
            .map(|(k, _)| k.clone())
            .collect();
        for key in expired {
            state.store.remove(&key);
            dropped += 1;
        }
        while state.store.len() > self.max_size {
            match state.order.pop_front() {
                // Keys already pruned as expired below never pushed again.
                Some(oldest) if state.store.remove(&oldest).is_some() => dropped += 1,
                Some(_) => {}
                None => break,
            }
        }
        let live: std::collections::HashSet<String> = state.store.keys().cloned().collect();
        state.order.retain(|k| live.contains(k));
        self.observe_size(&state);
        if dropped > 0 {
            if let Some(metrics) = &self.metrics {
                metrics.record_l1_evictions(dropped as u64);
            }
        }
    }

    fn clone_inner(&self) -> Arc<TtlCache<T>> {
        Arc::new(TtlCache {
            ttl_ms: self.ttl_ms,
            now: Arc::clone(&self.now),
            max_size: self.max_size,
            metrics: self.metrics.clone(),
            state: Arc::clone(&self.state),
        })
    }

    fn observe_size(&self, state: &CacheState<T>) {
        if let Some(metrics) = &self.metrics {
            metrics.observe_l1_size(state.store.len());
        }
    }

    fn record_hit(&self) {
        if let Some(metrics) = &self.metrics {
            metrics.record_l1_hit();
        }
    }

    fn record_miss(&self) {
        if let Some(metrics) = &self.metrics {
            metrics.record_l1_miss();
        }
    }

    fn record_single_flight(&self) {
        if let Some(metrics) = &self.metrics {
            metrics.record_l1_single_flight();
        }
    }
}
