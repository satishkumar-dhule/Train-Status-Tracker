//! L1 in-memory cache behavior — port of `artifacts/.../ttl-cache.test.ts`.
//! All run against the public surface with an injectable clock.

use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tt_cache::{CacheError, TtlCache, TtlCacheConfig};

type TCache = TtlCache<i64>;

/// Injectable clock helper: returns the shared cell and a `now` closure.
fn fake_now(start: i64) -> (Arc<AtomicI64>, Arc<dyn Fn() -> i64 + Send + Sync>) {
    let clock = Arc::new(AtomicI64::new(start));
    let now = Arc::clone(&clock);
    (clock, Arc::new(move || now.load(Ordering::Relaxed)))
}

fn cache_with(ttl_ms: i64, now: Arc<dyn Fn() -> i64 + Send + Sync>) -> Arc<TCache> {
    TtlCache::from_config(TtlCacheConfig {
        ttl_ms,
        now,
        max_size: 100,
        metrics: None,
    })
    .expect("valid config")
}

#[test]
fn hits_a_value_stored_within_its_ttl() {
    let (clock, now) = fake_now(0);
    let cache = cache_with(1_000, now);
    cache.set("k", 42);
    assert_eq!(cache.get("k"), Some(42));
    clock.store(999, Ordering::Relaxed);
    assert_eq!(cache.get("k"), Some(42), "expiry is exclusive (> not >=)");
    clock.store(1_000, Ordering::Relaxed);
    assert_eq!(cache.get("k"), None, "expired entry is dropped lazily");
}

#[test]
fn misses_when_key_absent() {
    let (_, now) = fake_now(0);
    let cache = cache_with(1_000, now);
    assert_eq!(cache.get("missing"), None);
}

#[test]
fn has_mirrors_live_entries() {
    let (clock, now) = fake_now(0);
    let cache = cache_with(1_000, now);
    assert!(!cache.has("k"));
    cache.set("k", 1);
    assert!(cache.has("k"));
    clock.store(2_000, Ordering::Relaxed);
    assert!(!cache.has("k"));
}

#[tokio::test]
async fn expiry_is_measured_from_fetch_start_not_completion() {
    let (clock, now) = fake_now(0);
    let cache = Arc::clone(&cache_with(10, now));
    let result = cache
        .get_or_set("k", {
            let clock = Arc::clone(&clock);
            move || async move {
                clock.store(50, Ordering::Relaxed);
                Ok::<_, CacheError>(7)
            }
        })
        .await;
    assert_eq!(result.unwrap(), 7);
    assert_eq!(
        cache.get("k"),
        None,
        "producer outlived the TTL: nothing stored"
    );
}

#[tokio::test]
async fn get_or_set_returns_cached_value_on_hit_without_producing() {
    let (_, now) = fake_now(0);
    let cache = Arc::clone(&cache_with(1_000, now));
    cache.set("k", 1);
    let calls = Arc::new(AtomicUsize::new(0));
    let value = cache
        .get_or_set("k", {
            let calls = Arc::clone(&calls);
            move || {
                let calls = Arc::clone(&calls);
                async move {
                    calls.fetch_add(1, Ordering::Relaxed);
                    Ok::<_, CacheError>(2)
                }
            }
        })
        .await
        .unwrap();
    assert_eq!(value, 1, "cached value wins over the producer");
    assert_eq!(
        calls.load(Ordering::Relaxed),
        0,
        "producer not invoked on hit"
    );
}

#[tokio::test]
async fn single_flight_shares_one_producer_across_concurrent_callers() {
    let (_, now) = fake_now(0);
    let cache: Arc<TtlCache<String>> = TtlCache::from_config(TtlCacheConfig {
        ttl_ms: 1_000,
        now,
        max_size: 100,
        metrics: None,
    })
    .unwrap();
    let calls = Arc::new(AtomicUsize::new(0));

    let mut handles = Vec::new();
    for _ in 0..10 {
        let cache = Arc::clone(&cache);
        let calls = Arc::clone(&calls);
        handles.push(tokio::spawn(async move {
            cache
                .get_or_set("k", {
                    let calls = Arc::clone(&calls);
                    move || {
                        let calls = Arc::clone(&calls);
                        async move {
                            tokio::time::sleep(Duration::from_millis(50)).await;
                            calls.fetch_add(1, Ordering::Relaxed);
                            Ok::<_, CacheError>("value".to_string())
                        }
                    }
                })
                .await
        }));
    }

    let mut results = Vec::new();
    for handle in handles {
        results.push(handle.await.unwrap().unwrap());
    }
    assert!(results.iter().all(|v| v == "value"));
    assert_eq!(
        calls.load(Ordering::Relaxed),
        1,
        "producer ran exactly once"
    );
}

#[tokio::test]
async fn failures_are_never_cached_and_are_fan_out() {
    let (clock, now) = fake_now(0);
    let cache = Arc::clone(&cache_with(1_000, now));
    let calls = Arc::new(AtomicUsize::new(0));

    let first = cache
        .get_or_set("k", {
            let calls = Arc::clone(&calls);
            move || {
                let calls = Arc::clone(&calls);
                async move {
                    calls.fetch_add(1, Ordering::Relaxed);
                    Err::<i64, CacheError>(CacheError {
                        message: "upstream exploded".to_string(),
                    })
                }
            }
        })
        .await;
    assert!(first.is_err());
    assert_eq!(cache.get("k"), None, "failures are not cached");

    clock.store(0, Ordering::Relaxed);
    let second = cache
        .get_or_set("k", {
            let calls = Arc::clone(&calls);
            move || {
                let calls = Arc::clone(&calls);
                async move {
                    calls.fetch_add(1, Ordering::Relaxed);
                    Ok::<_, CacheError>(9)
                }
            }
        })
        .await;
    assert_eq!(second.unwrap(), 9, "next call retries and succeeds");
    assert_eq!(calls.load(Ordering::Relaxed), 2);
}

#[test]
fn capacity_eviction_drops_oldest_live_entries() {
    let (_, now) = fake_now(0);
    let cache = TtlCache::from_config(TtlCacheConfig {
        ttl_ms: 1_000,
        now,
        max_size: 3,
        metrics: None,
    })
    .unwrap();
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4); // over capacity: evicts the oldest live entry ("a")
    assert_eq!(cache.get("a"), None);
    assert_eq!(cache.get("b"), Some(2));
    assert_eq!(cache.get("c"), Some(3));
    assert_eq!(cache.get("d"), Some(4));
}

#[test]
fn overwrite_keeps_insertion_position() {
    let (clock, now) = fake_now(0);
    let cache = TtlCache::from_config(TtlCacheConfig {
        ttl_ms: 1_000,
        now,
        max_size: 2,
        metrics: None,
    })
    .unwrap();
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10); // overwrite: "a" stays the oldest
    cache.set("c", 3); // over capacity: evicts "a", not "b"
    assert_eq!(cache.get("a"), None);
    assert_eq!(cache.get("b"), Some(2));
    assert_eq!(cache.get("c"), Some(3));
    let _ = clock;
}

#[test]
fn rejects_a_non_positive_ttl() {
    let err = TtlCache::<i64>::from_config(TtlCacheConfig::new(0))
        .err()
        .expect("invalid ttl_ms must fail");
    assert_eq!(err.message, "ttlMs must be positive");
}

#[test]
fn rejects_a_non_positive_max_size() {
    let (_, now) = fake_now(0);
    let err = TtlCache::<i64>::from_config(TtlCacheConfig {
        ttl_ms: 1_000,
        now,
        max_size: 0,
        metrics: None,
    })
    .err()
    .expect("invalid max_size must fail");
    assert_eq!(err.message, "maxSize must be a positive finite number");
}
