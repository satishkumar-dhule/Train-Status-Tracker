//! The fixed-window limiter, ported 1:1 from `lib/rate-limit.ts`.
//!
//! Each key gets a `{ start, count }` window; a request within `window_ms` of
//! `start` bumps `count`, and once it exceeds `limit` the key is blocked until
//! the window rolls over. Tracked keys are bounded by `max_keys` with expired
//! entries pruned first and then the oldest-inserted entries evicted, so a
//! key-spraying attacker cannot grow the map without bound.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

/// Default upper bound on tracked keys (`DEFAULT_MAX_KEYS`).
const DEFAULT_MAX_KEYS: usize = 10_000;

/// Outcome of a [`RateLimiter::check`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RateLimitResult {
    /// Whether the request is within the limit.
    pub allowed: bool,
    /// Milliseconds until a blocked key can retry.
    pub retry_after_ms: i64,
}

/// Options for [`create_rate_limiter`].
pub struct RateLimitOptions {
    /// Max requests per `window_ms` per key. Must be a positive finite number.
    pub limit: u64,
    /// Window length in milliseconds. Must be a positive finite number.
    pub window_ms: i64,
    /// Injectable clock returning epoch milliseconds (defaults to the real
    /// clock, mirroring `now = options.now ?? Date.now`).
    pub now: Option<Arc<dyn Fn() -> i64 + Send + Sync>>,
    /// Upper bound on tracked keys; oldest entries are evicted beyond it.
    pub max_keys: Option<usize>,
}

impl RateLimitOptions {
    /// Shorthand for the args the runs route needs: a positive window with the
    /// real clock and the default key cap.
    pub fn new(limit: u64, window_ms: i64) -> RateLimitOptions {
        RateLimitOptions {
            limit,
            window_ms,
            now: None,
            max_keys: None,
        }
    }
}

struct Entry {
    start: i64,
    count: u64,
}

struct State {
    windows: HashMap<String, Entry>,
    /// Insertion order (oldest first) so capacity eviction is deterministic,
    /// mirroring the JS `Map` iteration order.
    order: VecDeque<String>,
}

/// A fixed-window rate limiter, port of `createRateLimiter` in
/// `lib/rate-limit.ts`. Shares state across the process via interior
/// mutability, so handlers can call [`check`](RateLimiter::check) on an `Arc`.
pub struct RateLimiter {
    limit: u64,
    window_ms: i64,
    now: Arc<dyn Fn() -> i64 + Send + Sync>,
    max_keys: usize,
    state: Arc<Mutex<State>>,
}

/// Creates a limiter. Returns `Err` for the same invalid inputs that make the
/// TS factory throw (`limit` / `windowMs` non-positive or non-finite).
pub fn create_rate_limiter(options: RateLimitOptions) -> Result<Arc<RateLimiter>, String> {
    if options.limit == 0 {
        return Err("limit must be a positive finite number".to_string());
    }
    if options.window_ms <= 0 {
        return Err("windowMs must be a positive finite number".to_string());
    }
    Ok(Arc::new(RateLimiter {
        limit: options.limit,
        window_ms: options.window_ms,
        now: options.now.unwrap_or_else(default_now),
        max_keys: options.max_keys.unwrap_or(DEFAULT_MAX_KEYS),
        state: Arc::new(Mutex::new(State {
            windows: HashMap::new(),
            order: VecDeque::new(),
        })),
    }))
}

impl RateLimiter {
    /// Registers one request for `key` and reports whether it is allowed.
    ///
    /// A blocked result carries the milliseconds until the current window
    /// rolls over. When the tracked-key count exceeds the cap, expired
    /// entries are pruned first and then the oldest-inserted live entries are
    /// evicted — mirroring the TS `windows.size > maxKeys` path.
    pub fn check(&self, key: &str) -> RateLimitResult {
        let t = (self.now)();
        let mut state = self.state.lock().unwrap();

        let stale = state
            .windows
            .get(key)
            .map(|entry| entry.start <= t - self.window_ms)
            .unwrap_or(true);
        if stale {
            state.windows.insert(key.to_string(), Entry { start: t, count: 0 });
            if !state.order.contains(&key.to_string()) {
                state.order.push_back(key.to_string());
            }
        }
        let entry = state.windows.get_mut(key).expect("key present after reset");
        entry.count += 1;

        if entry.count > self.limit {
            return RateLimitResult {
                allowed: false,
                retry_after_ms: (entry.start + self.window_ms - t).max(0),
            };
        }

        if state.windows.len() > self.max_keys {
            let expired: Vec<String> = state
                .windows
                .iter()
                .filter(|(_, entry)| entry.start <= t - self.window_ms)
                .map(|(key, _)| key.clone())
                .collect();
            for key in expired {
                state.windows.remove(&key);
            }
            while state.windows.len() > self.max_keys {
                match state.order.pop_front() {
                    // Keys already pruned as expired above never appear again.
                    Some(oldest) if state.windows.remove(&oldest).is_some() => {}
                    Some(_) => {}
                    None => break,
                }
            }
        }
        RateLimitResult {
            allowed: true,
            retry_after_ms: 0,
        }
    }
}

fn default_now() -> Arc<dyn Fn() -> i64 + Send + Sync> {
    Arc::new(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A controllable clock: `now` returns the current tick; `advance` moves it.
    fn make_now() -> (Arc<dyn Fn() -> i64 + Send + Sync>, Arc<std::sync::Mutex<i64>>) {
        let t = Arc::new(std::sync::Mutex::new(1_000_000_i64));
        let clock = {
            let t = Arc::clone(&t);
            Arc::new(move || *t.lock().unwrap()) as Arc<dyn Fn() -> i64 + Send + Sync>
        };
        (clock, t)
    }

    fn advance(t: &Arc<std::sync::Mutex<i64>>, ms: i64) {
        *t.lock().unwrap() += ms;
    }

    #[test]
    fn allows_requests_up_to_the_limit_within_a_window() {
        let (clock, _t) = make_now();
        let limiter = create_rate_limiter(RateLimitOptions {
            limit: 3,
            window_ms: 60_000,
            now: Some(clock),
            max_keys: None,
        })
        .unwrap();
        for _ in 0..3 {
            assert!(limiter.check("ip").allowed);
        }
    }

    #[test]
    fn blocks_requests_beyond_the_limit() {
        let (clock, _t) = make_now();
        let limiter = create_rate_limiter(RateLimitOptions {
            limit: 3,
            window_ms: 60_000,
            now: Some(clock),
            max_keys: None,
        })
        .unwrap();
        for _ in 0..3 {
            limiter.check("ip");
        }
        let blocked = limiter.check("ip");
        assert!(!blocked.allowed);
        assert!(blocked.retry_after_ms > 0);
    }

    #[test]
    fn resets_the_window_after_it_elapses() {
        let (clock, t) = make_now();
        let limiter = create_rate_limiter(RateLimitOptions {
            limit: 2,
            window_ms: 60_000,
            now: Some(clock),
            max_keys: None,
        })
        .unwrap();
        limiter.check("ip");
        limiter.check("ip");
        assert!(!limiter.check("ip").allowed);
        advance(&t, 60_000);
        assert!(limiter.check("ip").allowed);
    }

    #[test]
    fn tracks_keys_independently() {
        let (clock, _t) = make_now();
        let limiter = create_rate_limiter(RateLimitOptions {
            limit: 1,
            window_ms: 60_000,
            now: Some(clock),
            max_keys: None,
        })
        .unwrap();
        assert!(limiter.check("a").allowed);
        assert!(limiter.check("b").allowed);
        assert!(!limiter.check("a").allowed);
        assert!(!limiter.check("b").allowed);
    }

    #[test]
    fn rejects_invalid_limits_and_windows() {
        assert!(create_rate_limiter(RateLimitOptions {
            limit: 0,
            window_ms: 1_000,
            now: None,
            max_keys: None,
        })
        .is_err());
        assert!(create_rate_limiter(RateLimitOptions {
            limit: 1,
            window_ms: 0,
            now: None,
            max_keys: None,
        })
        .is_err());
        assert!(create_rate_limiter(RateLimitOptions {
            limit: 1,
            window_ms: -1,
            now: None,
            max_keys: None,
        })
        .is_err());
    }

    #[test]
    fn evicts_the_oldest_entry_beyond_the_key_cap() {
        let (clock, _t) = make_now();
        let limiter = create_rate_limiter(RateLimitOptions {
            limit: 1,
            window_ms: 60_000,
            now: Some(clock),
            max_keys: Some(2),
        })
        .unwrap();
        assert!(limiter.check("a").allowed);
        assert!(limiter.check("b").allowed);
        assert!(limiter.check("c").allowed);
        assert!(!limiter.check("b").allowed, "b still tracked");
        assert!(
            limiter.check("a").allowed,
            "a was evicted as the oldest so its window resets"
        );
    }
}
