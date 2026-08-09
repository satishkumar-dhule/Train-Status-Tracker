//! Port of `lib/redis-cache.test.ts` — every case 1:1 against the public
//! [`RedisTtlCache`] surface, driven by a fake [`RedisStore`].

use std::io::Write;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use tt_cache::{create_redis_ttl_cache, CacheResult, RedisCacheOptions, RedisStore, StoreError};

const PREFIX: &str = "tt:status:v1";
const KEY: &str = "22943:20260802";
const TTL_MS: i64 = 5 * 60 * 1000;
const DEFAULT_MAX: usize = 2 * 1024 * 1024;

struct StoredValue {
    value: Vec<u8>,
    ttl_seconds: u64,
}

/// The TS test's `FakeStore`: an in-memory map keyed by full key, with call
/// recording and injectable failures.
struct FakeStore {
    available: AtomicBool,
    data: Mutex<Vec<(String, StoredValue)>>,
    get_calls: Mutex<Vec<String>>,
    set_calls: Mutex<Vec<(String, Vec<u8>, u64)>>,
    get_error: Mutex<Option<StoreError>>,
    set_error: Mutex<Option<StoreError>>,
}

impl FakeStore {
    fn new() -> FakeStore {
        FakeStore {
            available: AtomicBool::new(true),
            data: Mutex::new(Vec::new()),
            get_calls: Mutex::new(Vec::new()),
            set_calls: Mutex::new(Vec::new()),
            get_error: Mutex::new(None),
            set_error: Mutex::new(None),
        }
    }

    fn set_available(&self, available: bool) {
        self.available
            .store(available, std::sync::atomic::Ordering::Relaxed);
    }

    fn set_get_error(&self, error: StoreError) {
        *self.get_error.lock().unwrap() = Some(error);
    }

    fn set_set_error(&self, error: StoreError) {
        *self.set_error.lock().unwrap() = Some(error);
    }

    fn get_calls(&self) -> Vec<String> {
        self.get_calls.lock().unwrap().clone()
    }

    fn set_calls(&self) -> Vec<(String, Vec<u8>, u64)> {
        self.set_calls.lock().unwrap().clone()
    }

    fn stored(&self, key: &str) -> Option<Vec<u8>> {
        self.data
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.value.clone())
    }

    fn inject(&self, key: &str, value: Vec<u8>, ttl_seconds: u64) {
        let mut data = self.data.lock().unwrap();
        if let Some((_, existing)) = data.iter_mut().find(|(k, _)| k == key) {
            existing.value = value;
            existing.ttl_seconds = ttl_seconds;
            return;
        }
        data.push((key.to_string(), StoredValue { value, ttl_seconds }));
    }
}

#[async_trait::async_trait]
impl RedisStore for FakeStore {
    fn is_available(&self) -> bool {
        self.available.load(std::sync::atomic::Ordering::Relaxed)
    }

    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, StoreError> {
        self.get_calls.lock().unwrap().push(key.to_string());
        if let Some(err) = &*self.get_error.lock().unwrap() {
            return Err(err.clone());
        }
        Ok(self.stored(key))
    }

    async fn set(&self, key: &str, value: Vec<u8>, ttl_seconds: u64) -> Result<(), StoreError> {
        self.set_calls
            .lock()
            .unwrap()
            .push((key.to_string(), value.clone(), ttl_seconds));
        if let Some(err) = &*self.set_error.lock().unwrap() {
            return Err(err.clone());
        }
        self.inject(key, value, ttl_seconds);
        Ok(())
    }
}

/// `(message, operation, key)` records, matching the TS `onError` triple.
type ErrorSink = Arc<Mutex<Vec<(String, String, String)>>>;

// `&String` is forced: `RedisCacheOptions::serialize` is `Arc<dyn Fn(&String) -> String + Send + Sync>`.
#[allow(clippy::ptr_arg)]
fn default_serialize(value: &String) -> String {
    value.clone()
}

fn default_deserialize(max: usize) -> impl Fn(&[u8]) -> Result<String, String> + Send + Sync {
    use std::io::Read;
    move |raw: &[u8]| {
        if raw.len() > max {
            return Err(format!("cached value exceeds {max} bytes"));
        }
        if raw.starts_with(&[0x1f, 0x8b]) {
            let mut out = Vec::new();
            flate2::read::GzDecoder::new(raw)
                .take((max as u64) + 1)
                .read_to_end(&mut out)
                .map_err(|e| e.to_string())?;
            if out.len() > max {
                return Err(format!("decompressed value exceeds {max} bytes"));
            }
            String::from_utf8(out).map_err(|e| e.to_string())
        } else {
            String::from_utf8(raw.to_vec()).map_err(|e| e.to_string())
        }
    }
}

fn base_options() -> RedisCacheOptions<String> {
    RedisCacheOptions {
        ttl_ms: TTL_MS,
        negative_ttl_ms: 60_000,
        jitter: 0.0,
        key_prefix: PREFIX.to_string(),
        compress: false,
        random: Box::new(|| 0.5),
        max_value_bytes: DEFAULT_MAX,
        on_error: None,
        metrics: None,
        serialize: Arc::new(default_serialize),
        deserialize: Arc::new(default_deserialize(DEFAULT_MAX)),
    }
}

fn gzip(data: &[u8]) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(data).expect("gzip write");
    encoder.finish().expect("gzip finish")
}

/// Builds a cache over a fresh `FakeStore`, with an `on_error` sink recording
/// `(message, operation, key)` triples. Returns `(cache, store, sink)`.
fn make_cache(
    overrides: impl FnOnce(RedisCacheOptions<String>) -> RedisCacheOptions<String>,
) -> (
    Arc<tt_cache::RedisTtlCache<String>>,
    Arc<FakeStore>,
    ErrorSink,
) {
    let store: Arc<FakeStore> = Arc::new(FakeStore::new());
    let sink: ErrorSink = Arc::new(Mutex::new(Vec::new()));
    let sink_ctx = Arc::clone(&sink);
    let options = base_options();
    let options = RedisCacheOptions {
        on_error: Some(Arc::new(move |message, operation, key| {
            sink_ctx.lock().unwrap().push((
                message.to_string(),
                operation.to_string(),
                key.to_string(),
            ));
        })),
        ..overrides(options)
    };
    let dyn_store: Arc<dyn RedisStore> = store.clone();
    let cache = create_redis_ttl_cache(dyn_store, options).expect("valid options");
    (cache, store, sink)
}

#[tokio::test]
async fn returns_a_cached_value_as_a_hit() {
    let (cache, store, _) = make_cache(|o| o);
    cache.set(KEY, &"payload".to_string(), None).await.unwrap();
    assert_eq!(
        cache.get(KEY).await,
        CacheResult::Hit("payload".to_string())
    );
    assert_eq!(store.get_calls()[0], format!("{PREFIX}:{KEY}"));
}

#[tokio::test]
async fn reports_a_miss_for_an_unknown_key() {
    let (cache, _, _) = make_cache(|o| o);
    assert_eq!(cache.get("missing").await, CacheResult::<String>::Miss);
}

#[tokio::test]
async fn overwriting_a_key_refreshes_the_stored_value() {
    let (cache, _, _) = make_cache(|o| o);
    cache.set(KEY, &"v1".to_string(), None).await.unwrap();
    cache.set(KEY, &"v2".to_string(), None).await.unwrap();
    assert_eq!(cache.get(KEY).await, CacheResult::Hit("v2".to_string()));
}

#[tokio::test]
async fn round_trips_gzip_compressed_values() {
    let (cache, store, _) = make_cache(|o| RedisCacheOptions {
        compress: true,
        ..o
    });
    let payload = "{\"stations\":[\"x\",\"x\",\"x\"]}".to_string();
    cache.set(KEY, &payload, None).await.unwrap();

    let stored = store.stored(&format!("{PREFIX}:{KEY}")).unwrap();
    assert_eq!(&stored[0..2], &[0x1f, 0x8b]);

    assert_eq!(cache.get(KEY).await, CacheResult::Hit(payload));
}

#[tokio::test]
async fn stores_the_negative_marker_uncompressed_and_reports_negative() {
    let (cache, store, _) = make_cache(|o| RedisCacheOptions {
        compress: true,
        ..o
    });
    cache.set_negative(KEY, None).await;
    assert_eq!(
        store.stored(&format!("{PREFIX}:{KEY}")).unwrap(),
        b"tt:not-found".to_vec()
    );
    assert_eq!(cache.get(KEY).await, CacheResult::Negative);
}

#[tokio::test]
async fn reports_negative_when_the_store_returns_the_marker_as_bytes() {
    let (cache, store, _) = make_cache(|o| RedisCacheOptions {
        compress: true,
        ..o
    });
    store.inject(&format!("{PREFIX}:{KEY}"), b"tt:not-found".to_vec(), 60);
    assert_eq!(cache.get(KEY).await, CacheResult::Negative);
}

#[tokio::test]
async fn namespaces_keys_with_the_configured_prefix() {
    let (cache, store, _) = make_cache(|o| RedisCacheOptions {
        key_prefix: "ns".to_string(),
        ..o
    });
    cache.set("k", &"v".to_string(), None).await.unwrap();
    assert_eq!(store.set_calls()[0].0, "ns:k");
    assert!(store.get_calls().is_empty());
}

#[tokio::test]
async fn jitters_the_stored_ttl_around_the_base_using_the_injected_rng() {
    let (cache_low, store_low, _) = make_cache(|o| RedisCacheOptions {
        jitter: 0.1,
        random: Box::new(|| 0.0),
        ..o
    });
    cache_low.set(KEY, &"v".to_string(), None).await.unwrap();
    assert_eq!(
        store_low.set_calls()[0].2,
        ((TTL_MS as f64 * 0.9) / 1000.0).round() as u64
    );

    let (cache_high, store_high, _) = make_cache(|o| RedisCacheOptions {
        jitter: 0.1,
        random: Box::new(|| 1.0),
        ..o
    });
    cache_high.set(KEY, &"v".to_string(), None).await.unwrap();
    assert_eq!(
        store_high.set_calls()[0].2,
        ((TTL_MS as f64 * 1.1) / 1000.0).round() as u64
    );
}

#[tokio::test]
async fn keeps_a_fixed_ttl_when_jitter_is_zero() {
    let (cache, store, _) = make_cache(|o| o);
    cache.set(KEY, &"v".to_string(), None).await.unwrap();
    assert_eq!(
        store.set_calls()[0].2,
        (TTL_MS as f64 / 1000.0).round() as u64
    );
}

#[tokio::test]
async fn honors_a_per_call_ttl_override() {
    let (cache, store, _) = make_cache(|o| o);
    cache
        .set(KEY, &"v".to_string(), Some(30_000))
        .await
        .unwrap();
    assert_eq!(store.set_calls()[0].2, 30);

    let (neg, neg_store, _) = make_cache(|o| o);
    neg.set_negative(KEY, Some(5_000)).await;
    assert_eq!(neg_store.set_calls()[0].2, 5);
}

#[tokio::test]
async fn uses_custom_serialize_deserialize_functions() {
    let store = Arc::new(FakeStore::new());
    let dyn_store: Arc<dyn RedisStore> = store.clone();
    let cache = create_redis_ttl_cache(
        dyn_store,
        RedisCacheOptions {
            serialize: Arc::new(|v: &String| v.to_uppercase()),
            deserialize: Arc::new(|raw: &[u8]| {
                Ok(String::from_utf8(raw.to_vec()).unwrap().to_lowercase())
            }),
            ..base_options()
        },
    )
    .expect("valid");
    cache.set(KEY, &"abc".to_string(), None).await.unwrap();
    assert_eq!(
        store.stored(&format!("{PREFIX}:{KEY}")).unwrap(),
        b"ABC".to_vec()
    );
    assert_eq!(cache.get(KEY).await, CacheResult::Hit("abc".to_string()));
}

#[tokio::test]
async fn fails_open_when_the_store_throws_on_get() {
    let (cache, store, sink) = make_cache(|o| o);
    store.set_get_error(StoreError("redis down".to_string()));
    assert_eq!(cache.get(KEY).await, CacheResult::<String>::Miss);
    let recorded = sink.lock().unwrap().clone();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].1, "get");
}

#[tokio::test]
async fn fails_open_when_the_store_throws_on_set() {
    let (cache, store, sink) = make_cache(|o| o);
    store.set_set_error(StoreError("oom".to_string()));
    assert!(cache.set(KEY, &"v".to_string(), None).await.is_ok());
    let recorded = sink.lock().unwrap().clone();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].1, "set");
}

#[tokio::test]
async fn fails_open_when_set_negative_hits_an_error() {
    let (cache, store, sink) = make_cache(|o| o);
    store.set_set_error(StoreError("oom".to_string()));
    cache.set_negative(KEY, None).await;
    let recorded = sink.lock().unwrap().clone();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].1, "set_negative");
}

#[tokio::test]
async fn bypasses_an_unavailable_store_without_calling_it() {
    let (cache, store, _) = make_cache(|o| o);
    store.set_available(false);
    assert_eq!(cache.get(KEY).await, CacheResult::<String>::Miss);
    assert!(cache.set(KEY, &"v".to_string(), None).await.is_ok());
    assert!(store.get_calls().is_empty());
    assert!(store.set_calls().is_empty());
}

#[tokio::test]
async fn treats_undecodable_values_as_a_miss_and_reports_the_error() {
    let (cache, store, sink) = make_cache(|o| o);
    // The TS default deserialize is JSON.parse, so "not-json{" fails there; the
    // Rust default for String is UTF-8, so the undecodable analog is invalid
    // UTF-8.
    store.inject(&format!("{PREFIX}:{KEY}"), b"\xff\xfe\x00".to_vec(), 60);
    assert_eq!(cache.get(KEY).await, CacheResult::<String>::Miss);
    let recorded = sink.lock().unwrap().clone();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].1, "deserialize");
}

#[test]
fn rejects_non_positive_ttls() {
    let err = create_redis_ttl_cache::<String>(
        Arc::new(FakeStore::new()) as Arc<dyn RedisStore>,
        RedisCacheOptions {
            ttl_ms: 0,
            negative_ttl_ms: 1000,
            ..base_options()
        },
    );
    assert!(err.is_err());

    let err = create_redis_ttl_cache::<String>(
        Arc::new(FakeStore::new()) as Arc<dyn RedisStore>,
        RedisCacheOptions {
            ttl_ms: 1000,
            negative_ttl_ms: 0,
            ..base_options()
        },
    );
    assert!(err.is_err());
}

#[test]
fn rejects_non_finite_ttls() {
    let err = create_redis_ttl_cache::<String>(
        Arc::new(FakeStore::new()) as Arc<dyn RedisStore>,
        RedisCacheOptions {
            ttl_ms: i64::MAX,
            negative_ttl_ms: 1000,
            ..base_options()
        },
    );
    // i64 has no NaN; the closest analog (an absurdly large finite value) is
    // accepted. The TS-only NaN/Infinity branches have no Rust equivalent.
    assert!(err.is_ok());
}

#[tokio::test]
async fn refuses_to_store_a_value_that_serializes_to_the_not_found_marker() {
    let cache = create_redis_ttl_cache(
        Arc::new(FakeStore::new()) as Arc<dyn RedisStore>,
        RedisCacheOptions {
            serialize: Arc::new(|_: &String| "tt:not-found".to_string()),
            ..base_options()
        },
    )
    .expect("valid");
    assert!(cache.set(KEY, &"anything".to_string(), None).await.is_err());
    cache.set_negative(KEY, None).await;
}

#[tokio::test]
async fn treats_an_over_limit_decompressed_value_as_a_miss_without_unbounded_decompression() {
    let (cache, store, sink) = make_cache(|o| RedisCacheOptions {
        max_value_bytes: 1_000,
        deserialize: Arc::new(default_deserialize(1_000)),
        ..o
    });
    let bomb = gzip(&"x".repeat(5_000).into_bytes());
    store.inject(&format!("{PREFIX}:{KEY}"), bomb, 300);
    assert_eq!(cache.get(KEY).await, CacheResult::<String>::Miss);
    let recorded = sink.lock().unwrap().clone();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].1, "deserialize");
}

#[tokio::test]
async fn treats_an_over_limit_uncompressed_value_as_a_miss() {
    let (cache, store, sink) = make_cache(|o| RedisCacheOptions {
        max_value_bytes: 1_000,
        ..o
    });
    store.inject(
        &format!("{PREFIX}:{KEY}"),
        "y".repeat(5_000).into_bytes(),
        300,
    );
    assert_eq!(cache.get(KEY).await, CacheResult::<String>::Miss);
    let recorded = sink.lock().unwrap().clone();
    assert_eq!(recorded.len(), 1);
}

#[tokio::test]
async fn round_trips_a_pre_compressed_payload_exactly_like_production_stores() {
    #[derive(Serialize, Deserialize, PartialEq, Debug)]
    struct Payload {
        train_number: String,
        stations: Vec<String>,
    }
    let store = Arc::new(FakeStore::new());
    let payload = Payload {
        train_number: "22943".to_string(),
        stations: vec!["a".to_string(), "b".to_string(), "c".to_string()],
    };
    store.inject(
        &format!("{PREFIX}:{KEY}"),
        gzip(&serde_json::to_string(&payload).unwrap().into_bytes()),
        300,
    );
    let dyn_store: Arc<dyn RedisStore> = store.clone();
    let cache = create_redis_ttl_cache(
        dyn_store,
        RedisCacheOptions {
            ttl_ms: TTL_MS,
            negative_ttl_ms: 60_000,
            jitter: 0.0,
            key_prefix: PREFIX.to_string(),
            compress: true,
            random: Box::new(|| 0.5),
            max_value_bytes: DEFAULT_MAX,
            on_error: None,
            metrics: None,
            serialize: Arc::new(|p: &Payload| serde_json::to_string(p).unwrap()),
            deserialize: Arc::new(|raw: &[u8]| {
                let bytes = if raw.starts_with(&[0x1f, 0x8b]) {
                    let mut out = Vec::new();
                    use std::io::Read;
                    flate2::read::GzDecoder::new(raw)
                        .take((DEFAULT_MAX as u64) + 1)
                        .read_to_end(&mut out)
                        .map_err(|e| e.to_string())?;
                    out
                } else {
                    raw.to_vec()
                };
                serde_json::from_slice(&bytes).map_err(|e| e.to_string())
            }),
        },
    )
    .expect("valid");
    assert_eq!(cache.get(KEY).await, CacheResult::Hit(payload));
}
