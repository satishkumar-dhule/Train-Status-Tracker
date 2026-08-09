//! Port of `lib/ttl-cache.test.ts` — every case 1:1 against the public
//! [`TtlCache`] surface.

use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::Poll;

use tt_cache::{CacheError, TtlCache, TtlCacheConfig};

const TTL: i64 = 5 * 60 * 1000;

/// Injectable clock: an atomic "now" in epoch milliseconds (TS `Date.now()`).
fn make_now() -> (Arc<Mutex<i64>>, impl Fn() -> i64 + Clone + Send + Sync) {
    let t = Arc::new(Mutex::new(1_000_000));
    let clock = {
        let t = Arc::clone(&t);
        move || *t.lock().unwrap()
    };
    (t, clock)
}

fn advance(t: &Arc<Mutex<i64>>, ms: i64) {
    *t.lock().unwrap() += ms;
}

fn cache_with(
    ttl_ms: i64,
    now: impl Fn() -> i64 + Send + Sync + 'static,
    max_size: usize,
) -> Arc<TtlCache<String>> {
    TtlCache::from_config(TtlCacheConfig {
        ttl_ms,
        now: Arc::new(now),
        max_size,
        metrics: None,
    })
    .expect("valid config")
}

#[test]
fn returns_the_stored_value_within_ttl() {
    let (t, now) = make_now();
    let cache = cache_with(TTL, now, 10_000);
    cache.set("22943:20260802", "payload".to_string());
    advance(&t, TTL - 1);
    assert_eq!(cache.get("22943:20260802").as_deref(), Some("payload"));
    assert!(cache.has("22943:20260802"));
}

#[test]
fn treats_expired_entries_as_missing() {
    let (t, now) = make_now();
    let cache = cache_with(TTL, now, 10_000);
    cache.set("22943:20260802", "payload".to_string());
    advance(&t, TTL);
    assert_eq!(cache.get("22943:20260802"), None);
    assert!(!cache.has("22943:20260802"));
}

#[test]
fn drops_the_expired_entry_on_access() {
    let (t, now) = make_now();
    let cache = cache_with(TTL, now, 10_000);
    cache.set("k", "v".to_string());
    advance(&t, TTL + 1);
    cache.get("k");
    advance(&t, 0);
    assert_eq!(cache.get("k"), None);
}

#[test]
fn overwriting_refreshes_the_expiry() {
    let (t, now) = make_now();
    let cache = cache_with(TTL, now, 10_000);
    cache.set("k", "v1".to_string());
    advance(&t, TTL - 1000);
    cache.set("k", "v2".to_string());
    advance(&t, TTL - 1);
    assert_eq!(cache.get("k").as_deref(), Some("v2"));
}

#[test]
fn isolates_keys() {
    let (_, now) = make_now();
    let cache = cache_with(TTL, now, 10_000);
    cache.set("22943:20260802", "a".to_string());
    cache.set("22944:20260802", "b".to_string());
    cache.set("22943:20260803", "c".to_string());
    assert_eq!(cache.get("22943:20260802").as_deref(), Some("a"));
    assert_eq!(cache.get("22944:20260802").as_deref(), Some("b"));
    assert_eq!(cache.get("22943:20260803").as_deref(), Some("c"));
}

#[test]
#[should_panic(expected = "ttlMs must be positive")]
fn rejects_non_positive_ttl_zero() {
    let _ = TtlCache::<String>::new(0);
}

#[test]
#[should_panic(expected = "ttlMs must be positive")]
fn rejects_non_positive_ttl_negative() {
    let _ = TtlCache::<String>::new(-1);
}

#[test]
fn rejects_a_non_positive_max_size() {
    let err = TtlCache::<String>::from_config(TtlCacheConfig {
        ttl_ms: TTL,
        now: Arc::new(|| 1_000_000),
        max_size: 0,
        metrics: None,
    });
    assert!(err.is_err());
}

#[test]
fn evicts_the_oldest_entry_when_over_max_size() {
    let (_, now) = make_now();
    let cache = cache_with(TTL, now, 2);
    cache.set("a", "1".to_string());
    cache.set("b", "2".to_string());
    cache.set("c", "3".to_string());
    assert_eq!(cache.get("a"), None);
    assert_eq!(cache.get("b").as_deref(), Some("2"));
    assert_eq!(cache.get("c").as_deref(), Some("3"));
}

#[test]
fn prunes_expired_entries_before_evicting() {
    let (t, now) = make_now();
    let cache = cache_with(TTL, now, 2);
    cache.set("a", "1".to_string());
    advance(&t, TTL + 1);
    cache.set("b", "2".to_string());
    cache.set("c", "3".to_string());
    assert_eq!(cache.get("a"), None);
    assert_eq!(cache.get("b").as_deref(), Some("2"));
    assert_eq!(cache.get("c").as_deref(), Some("3"));
}

#[test]
fn overwriting_an_existing_key_does_not_consume_extra_capacity() {
    let (_, now) = make_now();
    let cache = cache_with(TTL, now, 2);
    cache.set("a", "1".to_string());
    cache.set("a", "2".to_string());
    cache.set("b", "3".to_string());
    assert_eq!(cache.get("a").as_deref(), Some("2"));
    assert_eq!(cache.get("b").as_deref(), Some("3"));
}

#[tokio::test]
async fn get_or_set_evicts_the_oldest_entry_when_over_max_size() {
    let (_, now) = make_now();
    let cache = cache_with(TTL, now, 2);
    cache.set("a", "1".to_string());
    cache.set("b", "2".to_string());
    cache
        .get_or_set("c", || async { Ok("3".to_string()) })
        .await
        .unwrap();
    assert_eq!(cache.get("a"), None);
    assert_eq!(cache.get("b").as_deref(), Some("2"));
    assert_eq!(cache.get("c").as_deref(), Some("3"));
}

#[test]
fn delete_removes_a_live_entry() {
    let (_, now) = make_now();
    let cache = cache_with(TTL, now, 10_000);
    cache.set("k", "v".to_string());
    assert!(cache.delete("k"));
    assert_eq!(cache.get("k"), None);
}

#[test]
fn delete_returns_false_for_missing_and_expired_keys() {
    let (t, now) = make_now();
    let cache = cache_with(TTL, now, 10_000);
    assert!(!cache.delete("missing"));
    cache.set("k", "v".to_string());
    advance(&t, TTL + 1);
    assert!(!cache.delete("k"));
    assert_eq!(cache.get("k"), None);
}

#[tokio::test]
async fn get_or_set_returns_a_cached_value_without_re_running_the_producer() {
    let (_, now) = make_now();
    let cache = cache_with(TTL, now, 10_000);
    let calls = Arc::new(AtomicUsize::new(0));
    let run = |calls: &Arc<AtomicUsize>| {
        let calls = Arc::clone(calls);
        move || async move {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok("value".to_string())
        }
    };
    assert_eq!(cache.get_or_set("k", run(&calls)).await.unwrap(), "value");
    assert_eq!(cache.get_or_set("k", run(&calls)).await.unwrap(), "value");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn get_or_set_single_flights_concurrent_calls_for_the_same_key() {
    let (_, now) = make_now();
    let cache = cache_with(TTL, now, 10_000);
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let calls = Arc::new(AtomicUsize::new(0));
    // An async fn body is lazy in Rust (unlike TS, which runs synchronously up
    // to the first await), so poll each caller once to start it before
    // asserting the producer ran exactly once.
    let mut p1 = Box::pin(cache.get_or_set("k", {
        let calls = Arc::clone(&calls);
        move || {
            let calls = Arc::clone(&calls);
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                rx.await.map_err(|_| CacheError {
                    message: "sender dropped".to_string(),
                })
            }
        }
    }));
    let mut p2 = Box::pin(cache.get_or_set("k", {
        let calls = Arc::clone(&calls);
        move || async move {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(CacheError {
                message: "producer must not run for a single-flighted call".to_string(),
            })
        }
    }));
    let _ = std::future::poll_fn(|cx| {
        let _ = p1.as_mut().poll(cx);
        let _ = p2.as_mut().poll(cx);
        Poll::Ready(())
    })
    .await;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    tx.send("payload".to_string()).unwrap();
    assert_eq!(p1.await.unwrap(), "payload");
    assert_eq!(p2.await.unwrap(), "payload");
    assert_eq!(cache.get("k").as_deref(), Some("payload"));
}

#[tokio::test]
async fn get_or_set_runs_producers_independently_for_different_keys() {
    let (_, now) = make_now();
    let cache = cache_with(TTL, now, 10_000);
    let (tx1, rx1) = tokio::sync::oneshot::channel::<String>();
    let (tx2, rx2) = tokio::sync::oneshot::channel::<String>();
    let p1 = cache.get_or_set("a", move || async move {
        rx1.await.map_err(|_| CacheError {
            message: "sender dropped".to_string(),
        })
    });
    let p2 = cache.get_or_set("b", move || async move {
        rx2.await.map_err(|_| CacheError {
            message: "sender dropped".to_string(),
        })
    });
    tx1.send("A".to_string()).unwrap();
    tx2.send("B".to_string()).unwrap();
    assert_eq!(p1.await.unwrap(), "A");
    assert_eq!(p2.await.unwrap(), "B");
    assert_eq!(cache.get("a").as_deref(), Some("A"));
    assert_eq!(cache.get("b").as_deref(), Some("B"));
}

#[tokio::test]
async fn get_or_set_rethrows_producer_failures_and_retries_on_the_next_call() {
    let (_, now) = make_now();
    let cache = cache_with(TTL, now, 10_000);
    let calls = Arc::new(AtomicUsize::new(0));
    let err = cache
        .get_or_set("k", {
            let calls = Arc::clone(&calls);
            move || async move {
                if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                    Err(CacheError {
                        message: "upstream down".to_string(),
                    })
                } else {
                    Ok("recovered".to_string())
                }
            }
        })
        .await
        .unwrap_err();
    assert_eq!(err.message, "upstream down");
    assert_eq!(cache.get("k"), None);
    let recovered = cache
        .get_or_set("k", {
            let calls = Arc::clone(&calls);
            move || async move {
                if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                    Err(CacheError {
                        message: "upstream down".to_string(),
                    })
                } else {
                    Ok("recovered".to_string())
                }
            }
        })
        .await
        .unwrap();
    assert_eq!(recovered, "recovered");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn get_or_set_ignores_an_expired_cached_value_and_refetches() {
    let (t, now) = make_now();
    let cache = cache_with(TTL, now, 10_000);
    cache.set("k", "stale".to_string());
    advance(&t, TTL);
    let calls = Arc::new(AtomicUsize::new(0));
    let producer_calls = Arc::clone(&calls);
    let producer = move || {
        let calls = Arc::clone(&producer_calls);
        async move {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok("fresh".to_string())
        }
    };
    assert_eq!(cache.get_or_set("k", producer).await.unwrap(), "fresh");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(cache.get("k").as_deref(), Some("fresh"));
}

#[tokio::test]
async fn get_or_set_does_not_store_a_value_that_expires_before_it_completes() {
    let (t, now) = make_now();
    let cache = cache_with(TTL, now, 10_000);
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let mut p = Box::pin(cache.get_or_set("k", move || async move {
        rx.await.map_err(|_| CacheError {
            message: "sender dropped".to_string(),
        })
    }));
    // Start the fetch first (capturing its start time), mirroring the TS
    // `getOrSet`, which runs synchronously until the producer's first await.
    let _ = std::future::poll_fn(|cx| {
        let _ = p.as_mut().poll(cx);
        Poll::Ready(())
    })
    .await;
    advance(&t, TTL + 1);
    tx.send("late".to_string()).unwrap();
    assert_eq!(p.await.unwrap(), "late");
    assert_eq!(cache.get("k"), None);
}
