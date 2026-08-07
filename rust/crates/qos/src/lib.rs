//! Rail Saarthi — `tt-qos` crate.
//!
//! Seam: QosRegistry: failure threshold, cooldown, all-cooldown force-try.
//!
//! Port of `lib/providers/qos.ts`: per-provider quality-of-service tracking for
//! train status upstreams. Every provider call made through the orchestrator is
//! recorded here (outcome, latency, timeout) so each upstream can be watched
//! independently and the orchestrator can skip providers that keep failing
//! instead of burning a timeout on every request.
//!
//! Deep module: keep the public surface in this file small and hide the
//! implementation in private submodules. The interface here is the test surface.

mod registry;

pub use registry::{create_qos_registry_from_env, QosRegistry};

/// Per-registry tuning, mirroring `QosRegistryOptions` in `qos.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QosOptions {
    /// Consecutive upstream failures after which a provider is treated as down
    /// and skipped by the orchestrator (until `cooldown_ms` elapses).
    pub failure_threshold: u32,
    /// How long a down provider is skipped before being tried again.
    pub cooldown_ms: u64,
    /// Rolling latency window kept per provider (drives avg/p95).
    pub max_latency_samples: usize,
}

/// `DEFAULT_QOS_OPTIONS` in `qos.ts`: 3 failures, 60 s cooldown, 100 samples.
pub const DEFAULT_QOS_OPTIONS: QosOptions = QosOptions {
    failure_threshold: 3,
    cooldown_ms: 60_000,
    max_latency_samples: 100,
};

impl Default for QosOptions {
    fn default() -> Self {
        DEFAULT_QOS_OPTIONS
    }
}

/// `ProviderQosOutcome` in `qos.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QosOutcome {
    Success,
    NotFound,
    UpstreamError,
}

/// A single provider call recorded in the registry (`QosRecord` in `qos.ts`).
#[derive(Debug, Clone, PartialEq)]
pub struct QosRecord {
    pub outcome: QosOutcome,
    /// Raw milliseconds float, exactly like the TS `latencyMs`.
    pub latency_ms: f64,
    /// Only meaningful for `UpstreamError`; distinguishes timeouts.
    pub timeout: bool,
    /// Last upstream error message, for diagnostics.
    pub error: Option<String>,
}

/// `ProviderQosStatus` in `qos.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QosStatus {
    Ok,
    Degraded,
    Down,
}

/// `ProviderQosSnapshot` in `qos.ts`, field for field.
#[derive(Debug, Clone, PartialEq)]
pub struct QosSnapshot {
    pub name: String,
    pub requests: u64,
    pub successes: u64,
    pub not_found: u64,
    pub upstream_errors: u64,
    pub timeouts: u64,
    pub consecutive_failures: u64,
    pub error_rate: f64,
    pub avg_latency_ms: f64,
    pub p95_latency_ms: Option<f64>,
    pub status: QosStatus,
    /// Whether the provider is currently being consulted by the orchestrator.
    pub available: bool,
    pub last_success_at: Option<String>,
    pub last_error: Option<String>,
    pub last_error_at: Option<String>,
}
