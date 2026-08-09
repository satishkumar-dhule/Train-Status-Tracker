//! L2 Redis cache behavior — port of `redis-cache.test.ts`. Never touches a
//! real Redis: everything runs against the public surface with a fake store.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use tt_cache::{
    create_redis_ttl_cache, CacheResult, RedisCacheOptions, RedisStore, RedisTtlCache, StoreError,
    NOT_FOUND_MARKER,
};

type DynStore = Arc<dyn RedisStore>;

/// A scriptable `RedisStore`: records every `set` it receives.
struct FakeStore {
    available: AtomicBool,
    failing_get: AtomicBool,
    failing_set: AtomicBool,
    data: Mutex<HashMap<String, (Vec<u8>, u64)>>,
    writes: Mutex<Vec<(String, Vec<u8>, u64)>>,
}

impl FakeStore {
    fn new() -> FakeStore {
        FakeStore {
            available: AtomicBool::new(true),
            failing_get: AtomicBool::new(false),
            failing_set: AtomicBool::new(false),
            data: Mutex::new(HashMap::new()),
            writes: Mutex::new(Vec::new()),
        }
    }

    fn set_unavailable(&self) {
        self.available.store(false, Ordering::Relaxed);
    }

    fn fail_next_get(&self) {
        self.failing_get.store(true, Ordering::Relaxed);
    }

    fn fail_next_set(&self) {
        self.failing_set.store(true, Ordering::Relaxed);
    }

    /// Inserts a raw value directly, bypassing the cache (network shorthand).
    fn seed(&self, key: &str, value: &[u8]) {
        self.data
            .lock()
            .unwrap()
            .insert(key.to_string(), (value.to_vec(), 60));
    }

    fn writes(&self) -> Vec<(String, Vec<u8>, u64)> {
        self.writes.lock().unwrap().clone()
    }
}

#[async_trait]
impl RedisStore for FakeStore {
    fn is_available(&self) -> bool {
        self.available.load(Ordering::Relaxed)
    }

    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, StoreError> {
        if self.failing_get.swap(false, Ordering::Relaxed) {
            return Err(StoreError("get exploded".to_string()));
        }
        Ok(self
            .data
            .lock()
            .unwrap()
            .get(key)
            .map(|(value, _)| value.clone()))
    }

    async fn set(&self, key: &str, value: Vec<u8>, ttl_seconds: u64) -> Result<(), StoreError> {
        if self.failing_set.swap(false, Ordering::Relaxed) {
            return Err(StoreError("set exploded".to_string()));
        }
        self.data
            .lock()
            .unwrap()
            .insert(key.to_string(), (value.clone(), ttl_seconds));
        self.writes
            .lock()
            .unwrap()
            .push((key.to_string(), value, ttl_seconds));
        Ok(())
    }
}

type ErrorCalls = Arc<Mutex<Vec<String>>>;
type OnErrorFn = Arc<dyn Fn(&str, &str, &str) + Send + Sync>;

fn error_sink() -> (ErrorCalls, OnErrorFn) {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let sink_calls = Arc::clone(&calls);
    (
        calls,
        Arc::new(move |message, operation, key| {
            sink_calls
                .lock()
                .unwrap()
                .push(format!("{operation}|{key}|{message}"))
        }),
    )
}

fn options(on_error: Option<OnErrorFn>, jitter: f64) -> RedisCacheOptions<String> {
    RedisCacheOptions {
        ttl_ms: 5000,
        negative_ttl_ms: 60_000,
        jitter,
        key_prefix: "tt".to_string(),
        compress: false,
        random: Box::new(|| 0.0),
        max_value_bytes: 1024,
        on_error,
        serialize: Arc::new(|value: &String| value.clone()),
        deserialize: Arc::new(|raw: &[u8]| Ok(String::from_utf8_lossy(raw).to_string())),
        metrics: None,
    }
}

fn string_cache(store: &DynStore) -> Arc<RedisTtlCache<String>> {
    create_redis_ttl_cache(store.clone(), options(None, 0.0)).unwrap()
}

#[tokio::test]
async fn get_returns_a_miss_when_the_store_is_unavailable() {
    let raw = Arc::new(FakeStore::new());
    raw.seed("tt:key", b"value");
    let store: DynStore = raw.clone();
    let cache = string_cache(&store);
    raw.set_unavailable();
    assert_eq!(cache.get("key").await, CacheResult::Miss);
    let _ = &cache;
    let _ = &store;
}

#[tokio::test]
async fn get_returns_a_hit_for_a_stored_value() {
    let raw = Arc::new(FakeStore::new());
    raw.seed("tt:key", b"hello");
    let store: DynStore = raw;
    let cache = string_cache(&store);
    assert_eq!(
        cache.get("key").await,
        CacheResult::Hit("hello".to_string())
    );
}

#[tokio::test]
async fn get_returns_a_negative_for_a_not_found_marker() {
    let raw = Arc::new(FakeStore::new());
    raw.seed("tt:key", NOT_FOUND_MARKER.as_bytes());
    let store: DynStore = raw;
    let cache = string_cache(&store);
    assert_eq!(cache.get("key").await, CacheResult::Negative);
}

#[tokio::test]
async fn get_returns_a_miss_for_a_missing_key() {
    let raw = Arc::new(FakeStore::new());
    let store: DynStore = raw;
    let cache = string_cache(&store);
    assert_eq!(cache.get("missing").await, CacheResult::Miss);
}

#[tokio::test]
async fn set_then_get_round_trips() {
    let raw = Arc::new(FakeStore::new());
    let store: DynStore = raw;
    let cache = string_cache(&store);
    cache
        .set("key", &"hello".to_string(), Some(60_000))
        .await
        .unwrap();
    assert_eq!(
        cache.get("key").await,
        CacheResult::Hit("hello".to_string())
    );
}

#[tokio::test]
async fn set_writes_the_prefixed_key_with_rounded_ttl_seconds() {
    let raw = Arc::new(FakeStore::new());
    let store: DynStore = raw.clone();
    let cache = string_cache(&store);
    cache
        .set("key", &"value".to_string(), Some(60_000))
        .await
        .unwrap();
    let writes = raw.writes();
    assert_eq!(writes.len(), 1);
    assert_eq!(writes[0].0, "tt:key", "keys are prefixed");
    assert_eq!(writes[0].1, b"value");
    assert_eq!(writes[0].2, 60, "60000 ms rounds to 60 s");
}

#[tokio::test]
async fn set_rounds_sub_second_ttls_to_at_least_one_second() {
    let raw = Arc::new(FakeStore::new());
    let store: DynStore = raw.clone();
    let cache = string_cache(&store);
    cache.set("key", &"v".to_string(), Some(1)).await.unwrap();
    assert_eq!(raw.writes()[0].2, 1);
    cache
        .set("key", &"v".to_string(), Some(1499))
        .await
        .unwrap();
    assert_eq!(raw.writes()[1].2, 1, "1499 ms rounds down to 1 s");
    cache
        .set("key", &"v".to_string(), Some(1500))
        .await
        .unwrap();
    assert_eq!(raw.writes()[2].2, 2, "1500 ms rounds up to 2 s");
}

#[tokio::test]
async fn set_negative_writes_a_not_found_marker_with_the_negative_ttl() {
    let raw = Arc::new(FakeStore::new());
    let store: DynStore = raw.clone();
    let cache = string_cache(&store);
    cache.set_negative("key", None).await;
    let writes = raw.writes();
    assert_eq!(writes.len(), 1);
    assert_eq!(writes[0].0, "tt:key");
    assert_eq!(writes[0].1, NOT_FOUND_MARKER.as_bytes());
    assert_eq!(writes[0].2, 60, "60_000 ms negative TTL");
}

#[tokio::test]
async fn set_is_a_noop_when_the_store_is_unavailable() {
    let raw = Arc::new(FakeStore::new());
    raw.set_unavailable();
    let store: DynStore = raw.clone();
    let cache = string_cache(&store);
    cache.set("key", &"value".to_string(), None).await.unwrap();
    assert!(raw.writes().is_empty());
}

#[tokio::test]
async fn set_fails_open_and_reports_store_errors_via_on_error() {
    let raw = Arc::new(FakeStore::new());
    let (calls, on_error) = error_sink();
    let store: DynStore = raw.clone();
    let cache = create_redis_ttl_cache(store, options(Some(on_error), 0.0)).unwrap();
    raw.fail_next_set();
    assert!(cache.set("key", &"value".to_string(), None).await.is_ok());
    let seen = calls.lock().unwrap();
    assert!(
        seen.iter().any(|c| c.starts_with("set|tt:key|")),
        "got {seen:?}"
    );
}

#[tokio::test]
async fn get_fails_open_and_reports_store_errors_via_on_error() {
    let raw = Arc::new(FakeStore::new());
    let (calls, on_error) = error_sink();
    let store: DynStore = raw.clone();
    let cache = create_redis_ttl_cache(store, options(Some(on_error), 0.0)).unwrap();
    raw.fail_next_get();
    assert_eq!(cache.get("key").await, CacheResult::Miss);
    let seen = calls.lock().unwrap();
    assert!(
        seen.iter().any(|c| c.starts_with("get|tt:key|")),
        "got {seen:?}"
    );
}

#[tokio::test]
async fn a_value_larger_than_max_value_bytes_is_a_miss_with_on_error() {
    let raw = Arc::new(FakeStore::new());
    raw.seed("tt:key", &vec![b'x'; 2048]);
    let (calls, on_error) = error_sink();
    let store: DynStore = raw;
    let cache = create_redis_ttl_cache(store, options(Some(on_error), 0.0)).unwrap();
    assert_eq!(cache.get("key").await, CacheResult::Miss);
    let seen = calls.lock().unwrap();
    assert!(
        seen.iter().any(|c| c.starts_with("deserialize|key|")),
        "got {seen:?}"
    );
}

#[tokio::test]
async fn jitter_scales_the_ttl() {
    let raw = Arc::new(FakeStore::new());
    let store: DynStore = raw.clone();
    let cache = create_redis_ttl_cache(store, options(None, 0.1)).unwrap();
    cache
        .set("key", &"v".to_string(), Some(100_000))
        .await
        .unwrap();
    let writes = raw.writes();
    assert_eq!(writes[0].2, 90, "random()=0 with 0.1 jitter -> 0.9x");
}

#[tokio::test]
async fn rejects_a_non_positive_ttl() {
    let raw: DynStore = Arc::new(FakeStore::new());
    let mut opts = options(None, 0.0);
    opts.ttl_ms = 0;
    let err = create_redis_ttl_cache::<String>(raw, opts)
        .err()
        .expect("invalid ttl must fail");
    assert_eq!(err, "ttlMs must be a positive finite number");
}

#[tokio::test]
async fn rejects_a_non_positive_negative_ttl() {
    let raw: DynStore = Arc::new(FakeStore::new());
    let mut opts = options(None, 0.0);
    opts.negative_ttl_ms = 0;
    let err = create_redis_ttl_cache::<String>(raw, opts)
        .err()
        .expect("invalid negative ttl must fail");
    assert_eq!(err, "negativeTtlMs must be a positive finite number");
}
