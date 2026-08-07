//! [`QosRegistry`]: the per-provider QoS state machine and its snapshots,
//! ported 1:1 from the `QosRegistry` class in `lib/providers/qos.ts`.

use std::collections::HashMap;
use std::sync::Mutex;

use chrono::{SecondsFormat, Utc};

use crate::{QosOptions, QosOutcome, QosRecord, QosSnapshot, QosStatus, DEFAULT_QOS_OPTIONS};

/// Everything inside the registry mutex: the per-provider data plus an
/// insertion-ordered name list so `snapshot_all` mirrors the JS `Map` iteration
/// order exactly.
#[derive(Default)]
struct Inner {
    data: HashMap<String, QosData>,
    order: Vec<String>,
}

/// `ProviderQosData` in `qos.ts`.
#[derive(Clone, Default)]
struct QosData {
    requests: u64,
    successes: u64,
    not_found: u64,
    upstream_errors: u64,
    timeouts: u64,
    consecutive_failures: u64,
    last_error: Option<String>,
    last_error_at: Option<String>,
    /// Epoch-ms of `last_error_at`, kept so availability is exact and matches
    /// the JS `Date.now() - Date.parse(lastErrorAt)` arithmetic.
    last_error_at_ms: Option<i64>,
    last_success_at: Option<String>,
    latencies: Vec<f64>,
}

/// Thread-safe per-provider quality-of-service tracker.
///
/// *Thread-safety note:* the JS class is single-threaded; the Rust registry
/// guards its state with a `Mutex` so the orchestrator (and the route shared
/// across requests) can record and snapshot concurrently. The per-call
/// semantics are otherwise identical to the TS implementation.
pub struct QosRegistry {
    options: QosOptions,
    inner: Mutex<Inner>,
}

impl Default for QosRegistry {
    fn default() -> Self {
        Self::new(QosOptions::default())
    }
}

impl QosRegistry {
    /// `new QosRegistry(options)` — partial options merge over
    /// [`DEFAULT_QOS_OPTIONS`].
    pub fn new(options: QosOptions) -> Self {
        Self {
            options,
            inner: Mutex::new(Inner::default()),
        }
    }

    /// `QosRegistry.record` — records one provider call. See the TS for the
    /// exact per-outcome bookkeeping; the timestamps here are captured once
    /// with `Utc::now()` so the stored epoch-ms and the emitted ISO string
    /// round-trip exactly.
    pub fn record(&self, name: &str, event: &QosRecord) {
        let mut inner = self.inner.lock().expect("qos registry lock not poisoned");
        if !inner.data.contains_key(name) {
            inner.order.push(name.to_string());
        }
        let entry = inner.data.entry(name.to_string()).or_default();
        entry.requests += 1;
        entry.latencies.push(event.latency_ms);
        if entry.latencies.len() > self.options.max_latency_samples {
            entry.latencies.remove(0);
        }

        match event.outcome {
            QosOutcome::Success => {
                entry.successes += 1;
                entry.consecutive_failures = 0;
                entry.last_success_at = Some(now_iso());
            }
            QosOutcome::NotFound => {
                // An authoritative "no data" answer is a healthy response.
                entry.not_found += 1;
                entry.consecutive_failures = 0;
            }
            QosOutcome::UpstreamError => {
                let now = Utc::now();
                let now_ms = now.timestamp_millis();
                entry.upstream_errors += 1;
                entry.consecutive_failures += 1;
                entry.last_error = Some(
                    event
                        .error
                        .clone()
                        .unwrap_or_else(|| "upstream error".to_string()),
                );
                entry.last_error_at = Some(now.to_rfc3339_opts(SecondsFormat::Millis, true));
                entry.last_error_at_ms = Some(now_ms);
                if event.timeout {
                    entry.timeouts += 1;
                }
            }
        }
    }

    /// `QosRegistry.isAvailable` — true when the provider may be consulted.
    ///
    /// `now_ms` is taken explicitly instead of defaulted to `Date.now()` so the
    /// decision is deterministic under test.
    pub fn is_available(&self, name: &str, now_ms: i64) -> bool {
        let inner = self.inner.lock().expect("Qos registry lock not poisoned");
        available(inner.data.get(name), &self.options, now_ms)
    }

    /// `QosRegistry.snapshot` — the per-provider metrics snapshot.
    pub fn snapshot(&self, name: &str, now_ms: i64) -> QosSnapshot {
        let inner = self.inner.lock().expect("Qos registry lock not poisoned");
        self.snapshot_locked(&inner, name, now_ms)
    }

    /// `QosRegistry.snapshotFor` — snapshots for the given names, in order,
    /// unknowns getting empty data.
    pub fn snapshot_for(&self, names: &[&str], now_ms: i64) -> Vec<QosSnapshot> {
        let inner = self.inner.lock().expect("Qos registry lock not poisoned");
        names
            .iter()
            .map(|name| self.snapshot_locked(&inner, name, now_ms))
            .collect()
    }

    /// `QosRegistry.snapshotAll` — one snapshot per recorded provider, in
    /// first-recorded order.
    pub fn snapshot_all(&self, now_ms: i64) -> Vec<QosSnapshot> {
        let inner = self.inner.lock().expect("Qos registry lock not poisoned");
        inner
            .order
            .iter()
            .map(|name| self.snapshot_locked(&inner, name, now_ms))
            .collect()
    }

    /// `QosRegistry.reset` — clears all recorded state.
    pub fn reset(&self) {
        let mut inner = self.inner.lock().expect("Qos registry lock not poisoned");
        inner.data.clear();
        inner.order.clear();
    }

    fn snapshot_locked(&self, inner: &Inner, name: &str, now_ms: i64) -> QosSnapshot {
        let entry = inner.data.get(name);
        let available = available(entry, &self.options, now_ms);
        let entry = entry.cloned().unwrap_or_default();

        let total = entry.requests;
        let error_rate = if total == 0 {
            0.0
        } else {
            entry.upstream_errors as f64 / total as f64
        };
        let mut sorted = entry.latencies.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let avg_latency_ms = if entry.latencies.is_empty() {
            0.0
        } else {
            entry.latencies.iter().sum::<f64>() / entry.latencies.len() as f64
        };

        let status = if entry.consecutive_failures >= u64::from(self.options.failure_threshold) {
            QosStatus::Down
        } else if error_rate > 0.1 || entry.upstream_errors > 0 {
            QosStatus::Degraded
        } else {
            QosStatus::Ok
        };

        QosSnapshot {
            name: name.to_string(),
            requests: entry.requests,
            successes: entry.successes,
            not_found: entry.not_found,
            upstream_errors: entry.upstream_errors,
            timeouts: entry.timeouts,
            consecutive_failures: entry.consecutive_failures,
            error_rate,
            avg_latency_ms,
            p95_latency_ms: percentile(&sorted, 0.95),
            status,
            available,
            last_success_at: entry.last_success_at,
            last_error: entry.last_error,
            last_error_at: entry.last_error_at,
        }
    }
}

/// `QosRegistry.isAvailable` logic over an optional entry, shared by
/// `is_available` and `snapshot` so the two can never drift.
fn available(entry: Option<&QosData>, options: &QosOptions, now_ms: i64) -> bool {
    let Some(entry) = entry else {
        return true;
    };
    if entry.consecutive_failures < u64::from(options.failure_threshold) {
        return true;
    }
    let Some(last_error_at_ms) = entry.last_error_at_ms else {
        return true;
    };
    now_ms - last_error_at_ms >= options.cooldown_ms as i64
}

/// `percentile` in `qos.ts`: `min(len - 1, max(0, ceil(p * len) - 1))` into the
/// sorted window; `None` when the window is empty. The `max(0, ...)` is
/// guaranteed no-op here (`len >= 1` and `ceil(p * len) >= 1`), hence the
/// `saturating_sub`.
fn percentile(sorted: &[f64], p: f64) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    let index = (sorted.len() - 1)
        .min(((p * sorted.len() as f64).ceil() as usize).saturating_sub(1));
    sorted.get(index).copied()
}

/// `new Date().toISOString()` — ms precision, `Z` suffix.
fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Build a registry from the process environment, so QoS tuning is deployable
/// without code changes — mirrors `createQosRegistryFromEnv` in `qos.ts`,
/// which reads `process.env` directly (never `tt-config`).
pub fn create_qos_registry_from_env() -> QosRegistry {
    let threshold = u64::from(DEFAULT_QOS_OPTIONS.failure_threshold);
    QosRegistry::new(QosOptions {
        failure_threshold: env_positive_number("TRAIN_STATUS_QOS_FAILURE_THRESHOLD", threshold)
            as u32,
        cooldown_ms: env_positive_number(
            "TRAIN_STATUS_QOS_COOLDOWN_MS",
            DEFAULT_QOS_OPTIONS.cooldown_ms,
        ),
        max_latency_samples: env_positive_number(
            "TRAIN_STATUS_QOS_LATENCY_SAMPLES",
            DEFAULT_QOS_OPTIONS.max_latency_samples as u64,
        ) as usize,
    })
}

/// Port of `envPositiveNumber`: a positive finite value falls back to
/// `DEFAULT` for garbage (including `NaN`, `Infinity`, negatives, and `0`).
fn env_positive_number(name: &str, fallback: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|raw| raw.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(f64::floor)
        .map(|value| value as u64)
        .unwrap_or(fallback)
}
