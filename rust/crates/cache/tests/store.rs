//! Ports of `lib/redis-client.test.ts` (config parsing) and
//! `lib/redis-health.test.ts` (the availability controller) — every case 1:1.

use std::collections::BTreeMap;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use tt_cache::{
    create_redis_health, parse_redis_config, RedisHealth, RedisHealthClient, RedisHealthOptions,
    RedisMode,
};

const DEFAULT_PROBE_MS: u64 = 15 * 60 * 1000;

fn env(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

mod config {
    use super::*;

    #[test]
    fn defaults_to_auto_mode_when_a_url_is_configured() {
        let cfg = parse_redis_config(&env(&[("REDIS_URL", "redis://cache.internal:6379")]));
        assert_eq!(cfg.mode, RedisMode::Auto);
    }

    #[test]
    fn disables_redis_when_no_url_is_configured() {
        let cfg = parse_redis_config(&BTreeMap::new());
        assert_eq!(cfg.mode, RedisMode::Disabled);
        assert_eq!(cfg.url, "");
    }

    #[test]
    fn disables_redis_when_the_url_is_blank() {
        let cfg = parse_redis_config(&env(&[("REDIS_URL", "   ")]));
        assert_eq!(cfg.mode, RedisMode::Disabled);
    }

    #[test]
    fn disables_redis_when_the_url_scheme_is_not_redis_or_rediss() {
        assert_eq!(
            parse_redis_config(&env(&[("REDIS_URL", "http://evil:6379")])).mode,
            RedisMode::Disabled
        );
        assert_eq!(
            parse_redis_config(&env(&[("REDIS_URL", "foo://host")])).mode,
            RedisMode::Disabled
        );
        assert_eq!(
            parse_redis_config(&env(&[("REDIS_URL", "//no-scheme")])).mode,
            RedisMode::Disabled
        );
    }

    #[test]
    fn accepts_explicit_auto_via_redis_mode() {
        let cfg = parse_redis_config(&env(&[
            ("REDIS_URL", "redis://cache.internal:6379"),
            ("REDIS_MODE", "auto"),
        ]));
        assert_eq!(cfg.mode, RedisMode::Auto);
        let cfg = parse_redis_config(&env(&[
            ("REDIS_URL", "redis://cache.internal:6379"),
            ("REDIS_MODE", "AUTO"),
        ]));
        assert_eq!(cfg.mode, RedisMode::Auto);
    }

    #[test]
    fn maps_redis_mode_enabled_on_to_enabled_and_disabled_off_to_disabled() {
        let with_url = ("REDIS_URL", "redis://cache.internal:6379");
        assert_eq!(
            parse_redis_config(&env(&[with_url, ("REDIS_MODE", "enabled")])).mode,
            RedisMode::Enabled
        );
        assert_eq!(
            parse_redis_config(&env(&[with_url, ("REDIS_MODE", "on")])).mode,
            RedisMode::Enabled
        );
        assert_eq!(
            parse_redis_config(&env(&[with_url, ("REDIS_MODE", "disabled")])).mode,
            RedisMode::Disabled
        );
        assert_eq!(
            parse_redis_config(&env(&[with_url, ("REDIS_MODE", "off")])).mode,
            RedisMode::Disabled
        );
    }

    #[test]
    fn falls_back_to_auto_for_unknown_redis_mode_values() {
        let cfg = parse_redis_config(&env(&[
            ("REDIS_URL", "redis://cache.internal:6379"),
            ("REDIS_MODE", "sometimes"),
        ]));
        assert_eq!(cfg.mode, RedisMode::Auto);
    }

    #[test]
    fn honors_redis_enabled_for_backward_compatibility() {
        let with_url = ("REDIS_URL", "redis://cache.internal:6379");
        assert_eq!(
            parse_redis_config(&env(&[with_url, ("REDIS_ENABLED", "true")])).mode,
            RedisMode::Enabled
        );
        assert_eq!(
            parse_redis_config(&env(&[with_url, ("REDIS_ENABLED", "false")])).mode,
            RedisMode::Disabled
        );
    }

    #[test]
    fn treats_a_non_boolean_redis_enabled_as_auto() {
        let with_url = ("REDIS_URL", "redis://cache.internal:6379");
        assert_eq!(
            parse_redis_config(&env(&[with_url, ("REDIS_ENABLED", "1")])).mode,
            RedisMode::Auto
        );
        assert_eq!(
            parse_redis_config(&env(&[with_url, ("REDIS_ENABLED", "TRUE")])).mode,
            RedisMode::Auto
        );
    }

    #[test]
    fn lets_redis_mode_take_precedence_over_redis_enabled() {
        let cfg = parse_redis_config(&env(&[
            ("REDIS_URL", "redis://cache.internal:6379"),
            ("REDIS_MODE", "disabled"),
            ("REDIS_ENABLED", "true"),
        ]));
        assert_eq!(cfg.mode, RedisMode::Disabled);
    }

    #[test]
    fn honors_an_explicit_redis_url_override() {
        assert_eq!(
            parse_redis_config(&env(&[("REDIS_URL", "redis://cache.internal:6379")])).url,
            "redis://cache.internal:6379"
        );
    }

    #[test]
    fn honors_a_rediss_url_for_tls_connections() {
        assert_eq!(
            parse_redis_config(&env(&[("REDIS_URL", "rediss://cache.internal:6380")])).url,
            "rediss://cache.internal:6380"
        );
    }

    #[test]
    fn defaults_the_reprobe_interval_to_15_minutes() {
        assert_eq!(
            parse_redis_config(&BTreeMap::new()).probe_interval_ms,
            DEFAULT_PROBE_MS
        );
    }

    #[test]
    fn honors_redis_probe_interval_ms_and_rejects_non_positive_values() {
        assert_eq!(
            parse_redis_config(&env(&[("REDIS_PROBE_INTERVAL_MS", "60000")])).probe_interval_ms,
            60_000
        );
        assert_eq!(
            parse_redis_config(&env(&[("REDIS_PROBE_INTERVAL_MS", "0")])).probe_interval_ms,
            DEFAULT_PROBE_MS
        );
        assert_eq!(
            parse_redis_config(&env(&[("REDIS_PROBE_INTERVAL_MS", "abc")])).probe_interval_ms,
            DEFAULT_PROBE_MS
        );
    }

    #[test]
    fn defaults_the_command_timeout_and_honors_an_override() {
        assert_eq!(parse_redis_config(&BTreeMap::new()).command_timeout_ms, 200);
        assert_eq!(
            parse_redis_config(&env(&[("REDIS_COMMAND_TIMEOUT_MS", "1500")])).command_timeout_ms,
            1500
        );
    }

    #[test]
    fn rejects_non_finite_command_timeouts() {
        assert_eq!(
            parse_redis_config(&env(&[("REDIS_COMMAND_TIMEOUT_MS", "abc")])).command_timeout_ms,
            200
        );
        assert_eq!(
            parse_redis_config(&env(&[("REDIS_COMMAND_TIMEOUT_MS", "-5")])).command_timeout_ms,
            200
        );
    }
}

/// The TS test's `FakeRedis`: a `RedisHealthClient` with mutable status,
/// connect behavior, and id-based event listeners.
type ListenerMap = HashMap<(&'static str, usize), Box<dyn Fn() + Send + Sync>>;

struct FakeRedis {
    status: Mutex<FakeStatus>,
    connect_calls: AtomicUsize,
    should_connect: AtomicBool,
    listeners: Mutex<ListenerMap>,
    next_id: AtomicUsize,
}

/// ioredis connection-status strings the controller compares against.
#[derive(Clone, Copy, PartialEq, Eq)]
enum FakeStatus {
    Wait,
    Ready,
    End,
}

impl FakeStatus {
    fn as_str(self) -> &'static str {
        match self {
            FakeStatus::Wait => "wait",
            FakeStatus::Ready => "ready",
            FakeStatus::End => "end",
        }
    }
}

impl FakeRedis {
    fn new() -> FakeRedis {
        FakeRedis {
            status: Mutex::new(FakeStatus::Wait),
            connect_calls: AtomicUsize::new(0),
            should_connect: AtomicBool::new(true),
            listeners: Mutex::new(HashMap::new()),
            next_id: AtomicUsize::new(0),
        }
    }

    fn connect_calls(&self) -> usize {
        self.connect_calls.load(Ordering::Relaxed)
    }

    fn emit(&self, event: &'static str) {
        let listeners: Vec<usize> = self
            .listeners
            .lock()
            .unwrap()
            .iter()
            .filter(|((e, _), _)| *e == event)
            .map(|((_, id), _)| *id)
            .collect();
        for id in listeners {
            if let Some(cb) = self.listeners.lock().unwrap().get(&(event, id)) {
                cb();
            }
        }
    }

    fn set_should_connect(&self, value: bool) {
        self.should_connect.store(value, Ordering::Relaxed);
    }
}

impl RedisHealthClient for FakeRedis {
    fn status(&self) -> &str {
        self.status.lock().unwrap().as_str()
    }

    fn connect(&self) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>> {
        Box::pin(async move {
            self.connect_calls.fetch_add(1, Ordering::Relaxed);
            if !self.should_connect.load(Ordering::Relaxed) {
                *self.status.lock().unwrap() = FakeStatus::End;
                self.emit("end");
                return Err("ECONNREFUSED".to_string());
            }
            *self.status.lock().unwrap() = FakeStatus::Ready;
            self.emit("ready");
            Ok(())
        })
    }

    fn on(&self, event: &'static str, callback: Box<dyn Fn() + Send + Sync>) -> usize {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.listeners.lock().unwrap().insert((event, id), callback);
        id
    }

    fn off(&self, event: &'static str, id: usize) {
        self.listeners.lock().unwrap().remove(&(event, id));
    }
}

fn make_health(auto_recheck: bool) -> (Arc<FakeRedis>, Arc<RedisHealth>) {
    let client: Arc<FakeRedis> = Arc::new(FakeRedis::new());
    let dyn_client: Arc<dyn RedisHealthClient> = client.clone();
    let health = create_redis_health(
        dyn_client,
        RedisHealthOptions {
            probe_interval_ms: DEFAULT_PROBE_MS,
            auto_recheck,
        },
    );
    (client, health)
}

mod health {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn starts_unhealthy_and_becomes_healthy_on_ready() {
        let (client, health) = make_health(true);
        assert!(!health.is_healthy());
        client.emit("ready");
        assert!(health.is_healthy());
    }

    #[tokio::test(start_paused = true)]
    async fn marks_unhealthy_on_close_and_error() {
        let (client, health) = make_health(true);
        client.emit("ready");
        assert!(health.is_healthy());

        client.emit("close");
        assert!(!health.is_healthy());

        client.emit("ready");
        assert!(health.is_healthy());

        client.emit("error");
        assert!(!health.is_healthy());
    }

    #[tokio::test(start_paused = true)]
    async fn reconnects_after_the_reprobe_interval_when_redis_returns() {
        let (client, health) = make_health(true);
        client.emit("ready");
        assert!(health.is_healthy());

        client.emit("end");
        assert!(!health.is_healthy());
        assert_eq!(client.connect_calls(), 0);
        // Let the re-probe task register its timer at the current (paused)
        // time; a timer registered mid-`advance` would never fire.
        tokio::task::yield_now().await;

        tokio::time::advance(std::time::Duration::from_millis(DEFAULT_PROBE_MS - 1)).await;
        assert_eq!(client.connect_calls(), 0);

        tokio::time::advance(std::time::Duration::from_millis(1)).await;
        tokio::task::yield_now().await;
        assert_eq!(client.connect_calls(), 1);
        assert_eq!(client.status(), "ready");
        assert!(health.is_healthy());
    }

    #[tokio::test(start_paused = true)]
    async fn stays_unhealthy_and_reprobes_again_while_redis_stays_down() {
        let (client, health) = make_health(true);
        client.emit("end");
        client.set_should_connect(false);
        tokio::task::yield_now().await;

        tokio::time::advance(std::time::Duration::from_millis(DEFAULT_PROBE_MS)).await;
        tokio::task::yield_now().await;
        assert_eq!(client.connect_calls(), 1);
        assert!(!health.is_healthy());

        tokio::time::advance(std::time::Duration::from_millis(DEFAULT_PROBE_MS)).await;
        tokio::task::yield_now().await;
        assert_eq!(client.connect_calls(), 2);
        assert!(!health.is_healthy());

        client.set_should_connect(true);
        tokio::time::advance(std::time::Duration::from_millis(DEFAULT_PROBE_MS)).await;
        tokio::task::yield_now().await;
        assert_eq!(client.connect_calls(), 3);
        assert!(health.is_healthy());
    }

    #[tokio::test(start_paused = true)]
    async fn does_not_schedule_reprobes_when_autorecheck_is_disabled() {
        let (client, health) = make_health(false);
        client.emit("end");

        tokio::time::advance(std::time::Duration::from_millis(DEFAULT_PROBE_MS * 3)).await;
        assert_eq!(client.connect_calls(), 0);
        assert!(!health.is_healthy());
        health.dispose();
    }

    #[tokio::test(start_paused = true)]
    async fn treats_an_already_ready_client_during_a_probe_as_healthy() {
        let (client, health) = make_health(true);
        client.emit("end");
        client.emit("ready");
        tokio::time::advance(std::time::Duration::from_millis(DEFAULT_PROBE_MS * 2)).await;
        assert_eq!(client.connect_calls(), 0);
        assert!(health.is_healthy());
        health.dispose();
    }

    #[tokio::test(start_paused = true)]
    async fn does_not_schedule_duplicate_probes_when_unhealthy_events_fire_while_one_is_pending() {
        let (client, health) = make_health(true);
        client.set_should_connect(false);
        client.emit("end");
        client.emit("error");
        client.emit("close");
        tokio::task::yield_now().await;

        tokio::time::advance(std::time::Duration::from_millis(DEFAULT_PROBE_MS)).await;
        tokio::task::yield_now().await;
        assert_eq!(client.connect_calls(), 1);

        client.emit("ready");
        tokio::time::advance(std::time::Duration::from_millis(DEFAULT_PROBE_MS * 2)).await;
        assert_eq!(client.connect_calls(), 1);
        assert!(health.is_healthy());
        health.dispose();
    }

    #[tokio::test(start_paused = true)]
    async fn stops_probing_and_unsubscribes_after_dispose() {
        let (client, health) = make_health(true);
        client.emit("ready");
        assert!(health.is_healthy());

        health.dispose();
        client.emit("end");
        assert!(health.is_healthy());

        tokio::time::advance(std::time::Duration::from_millis(DEFAULT_PROBE_MS * 2)).await;
        assert_eq!(client.connect_calls(), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn removes_the_close_and_error_listeners_on_dispose() {
        let (client, health) = make_health(true);
        client.emit("ready");
        assert!(health.is_healthy());

        health.dispose();
        client.emit("close");
        assert!(health.is_healthy());
        client.emit("error");
        assert!(health.is_healthy());
    }
}
