//! Health controller — port of `redis-health.test.ts`. The controller's
//! timer loop is driven by tokio's paused clock so tests are deterministic.
//!
//! NOTE: `tokio::time::advance` fires a timer only when the clock has moved
//! *past* its deadline, so the tests advance a couple of ms beyond each
//! interval boundary (see `advance_past`).

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tt_cache::{create_redis_health, RedisHealth, RedisHealthClient, RedisHealthOptions};

/// The `FakeRedis` of the TS tests: scriptable status, connect success/failure
/// counting, and an event bus for `ready`/`close`/`error`/`end`.
type Listeners = Mutex<HashMap<&'static str, Vec<(usize, Arc<dyn Fn() + Send + Sync>)>>>;

struct FakeRedis {
    status: AtomicU8, // 0 wait, 1 ready, 2 end, 3 connecting
    should_connect: AtomicBool,
    connect_calls: AtomicUsize,
    listeners: Listeners,
    next_id: AtomicUsize,
}

impl FakeRedis {
    fn new() -> Arc<FakeRedis> {
        Arc::new(FakeRedis {
            status: AtomicU8::new(0),
            should_connect: AtomicBool::new(true),
            connect_calls: AtomicUsize::new(0),
            listeners: Mutex::new(HashMap::new()),
            next_id: AtomicUsize::new(0),
        })
    }

    fn set_should_connect(&self, value: bool) {
        self.should_connect.store(value, Ordering::Relaxed);
    }

    fn connect_calls(&self) -> usize {
        self.connect_calls.load(Ordering::Relaxed)
    }

    fn emit(&self, event: &'static str) {
        let entries = self.listeners.lock().unwrap().get(event).cloned();
        if let Some(entries) = entries {
            for (_, callback) in entries {
                callback();
            }
        }
    }

    fn set_status(&self, status: u8) {
        self.status.store(status, Ordering::Relaxed);
    }
}

fn status_string(status: u8) -> &'static str {
    match status {
        1 => "ready",
        2 => "end",
        3 => "connecting",
        _ => "wait",
    }
}

impl RedisHealthClient for FakeRedis {
    fn status(&self) -> &str {
        status_string(self.status.load(Ordering::Relaxed))
    }

    fn connect(&self) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>> {
        Box::pin(async move {
            self.connect_calls.fetch_add(1, Ordering::Relaxed);
            if self.should_connect.load(Ordering::Relaxed) {
                self.set_status(1);
                self.emit("ready");
                Ok(())
            } else {
                self.set_status(2);
                self.emit("end");
                Err("ECONNREFUSED".to_string())
            }
        })
    }

    fn on(&self, event: &'static str, callback: Box<dyn Fn() + Send + Sync>) -> usize {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let mut listeners = self.listeners.lock().unwrap();
        let slot = listeners.entry(event).or_default();
        slot.push((id, Arc::from(callback)));
        id
    }

    fn off(&self, event: &'static str, id: usize) {
        if let Some(callbacks) = self.listeners.lock().unwrap().get_mut(event) {
            callbacks.retain(|(listener_id, _)| *listener_id != id);
        }
    }
}

const PROBE_INTERVAL_MS: u64 = 1000;

fn health(client: Arc<FakeRedis>, auto_recheck: bool) -> Arc<RedisHealth> {
    create_redis_health(
        client,
        RedisHealthOptions {
            probe_interval_ms: PROBE_INTERVAL_MS,
            auto_recheck,
        },
    )
}

/// Advances the paused clock by `ms` and lets woken tasks run.
async fn advance(ms: u64) {
    tokio::time::advance(Duration::from_millis(ms)).await;
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
}

/// Advances just past a probe-interval boundary, firing any deadline at or
/// before it (the controller's sleep fires only once the clock crosses the
/// wake deadline).
async fn advance_past_interval(additional: u64) {
    advance(PROBE_INTERVAL_MS + additional).await;
}

#[tokio::test(start_paused = true)]
async fn starts_unhealthy_and_flips_healthy_on_ready() {
    let client = FakeRedis::new();
    let health = health(client.clone(), true);
    assert!(!health.is_healthy());
    client.emit("ready");
    assert!(health.is_healthy());
}

#[tokio::test(start_paused = true)]
async fn flips_back_unhealthy_on_close_error_or_end() {
    let client = FakeRedis::new();
    let health = health(client.clone(), true);
    client.emit("ready");
    assert!(health.is_healthy());
    client.emit("close");
    assert!(!health.is_healthy());
    client.emit("ready");
    client.emit("error");
    assert!(!health.is_healthy());
    client.emit("ready");
    client.emit("end");
    assert!(!health.is_healthy());
}

#[tokio::test(start_paused = true)]
async fn dispose_unsubscribes_and_cancels_pending_probes() {
    let client = FakeRedis::new();
    let health = health(client.clone(), true);
    client.emit("end");
    advance(500).await; // timer armed, not yet fired
    health.dispose();
    let calls_after_dispose = client.connect_calls();
    advance(PROBE_INTERVAL_MS * 2 + 10).await;
    assert_eq!(
        client.connect_calls(),
        calls_after_dispose,
        "disposed controller must not probe"
    );
    client.emit("ready");
    assert!(!health.is_healthy(), "disposed controller hears nothing");
}

#[tokio::test(start_paused = true)]
async fn an_unreachable_client_is_rechecked_on_the_interval() {
    let client = FakeRedis::new();
    client.set_should_connect(false);
    let health = health(client.clone(), true);
    client.emit("end");
    assert_eq!(client.connect_calls(), 0, "no probe before the interval");
    advance(PROBE_INTERVAL_MS - 1).await;
    assert_eq!(client.connect_calls(), 0);
    advance_past_interval(2).await;
    assert_eq!(client.connect_calls(), 1, "probing after the interval");
    assert!(!health.is_healthy());
}

#[tokio::test(start_paused = true)]
async fn probes_repeat_while_down_and_wake_when_recovered() {
    let client = FakeRedis::new();
    client.set_should_connect(false);
    let health = health(client.clone(), true);
    client.emit("end");
    // The first advance after spawning is a "prime": timers fire only on
    // advances that cross a deadline, so bring the clock back inside the
    // first interval before the real crossing.
    advance(PROBE_INTERVAL_MS - 1).await;
    advance_past_interval(2).await;
    assert_eq!(client.connect_calls(), 1);
    assert!(!health.is_healthy());
    advance_past_interval(2).await;
    assert_eq!(client.connect_calls(), 2, "still down: probes again");
    client.set_should_connect(true);
    advance_past_interval(2).await;
    assert_eq!(client.connect_calls(), 3);
    assert!(health.is_healthy(), "recovered on the successful probe");
}

#[tokio::test(start_paused = true)]
async fn does_not_recheck_when_auto_recheck_is_disabled() {
    let client = FakeRedis::new();
    client.set_should_connect(false);
    let health = health(client.clone(), false);
    client.emit("end");
    advance(PROBE_INTERVAL_MS * 3 + 10).await;
    assert_eq!(client.connect_calls(), 0, "no auto-recheck in manual mode");
    assert!(!health.is_healthy());
}

#[tokio::test(start_paused = true)]
async fn ready_cancels_a_pending_probe() {
    let client = FakeRedis::new();
    client.set_should_connect(false);
    let health = health(client.clone(), true);
    client.emit("end");
    advance(PROBE_INTERVAL_MS / 2).await;
    client.emit("ready"); // server came back on its own before the probe fired
    assert!(health.is_healthy());
    advance(PROBE_INTERVAL_MS * 2 + 10).await;
    assert_eq!(client.connect_calls(), 0, "cancelled probe never fires");
}
