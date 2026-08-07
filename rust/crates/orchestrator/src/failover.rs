//! `fetch_status_with_failover`, ported 1:1 from `orchestrator.ts`.
//!
//! Classification policy (ZTA): 404 only when every consulted provider agrees
//! not-found; upstream error when all fail; program errors rethrown. QoS
//! circuit breaking skips down providers during their cooldown, with an
//! all-cooldown force-try of the first provider so a healthy upstream is never
//! hidden by the breaker.

use std::error::Error;
use std::sync::Arc;
use std::time::Instant;

use tracing::{warn, Span};

use tt_mapper::{KnownTrain, MappedStatus};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::TransportError;
use tt_qos::{QosOutcome, QosRecord, QosRegistry};
use tt_telemetry::Telemetry;

/// Options threaded through [`fetch_status_with_failover`], mirroring
/// `FailoverOptions` in `orchestrator.ts` plus a telemetry handle (the TS uses
/// globals; Rust passes it explicitly so tests stay hermetic).
#[derive(Clone, Default)]
pub struct FailoverOptions {
    /// Per-request fetch options passed to every provider.
    pub fetch_options: ProviderFetchOptions,
    /// Known-train context passed to every provider.
    pub known_train: Option<KnownTrain>,
    /// QoS registry consulted for circuit breaking. `None` = a fresh
    /// registry (no shared cooldown state).
    pub qos: Option<Arc<QosRegistry>>,
    /// Telemetry handle for the `app.provider.failover` counter. `None` =
    /// no metrics recorded (inert).
    pub telemetry: Option<Arc<Telemetry>>,
}

/// Try each enabled provider in order until one returns a status.
pub async fn fetch_status_with_failover(
    providers: &[Arc<dyn TrainStatusProvider>],
    train_number: &str,
    departure_date: &str,
    options: &FailoverOptions,
) -> Result<MappedStatus, ProviderError> {
    let qos: Arc<QosRegistry> = options.qos.clone().unwrap_or_default();
    let now_ms = now_millis();

    let enabled: Vec<Arc<dyn TrainStatusProvider>> = providers
        .iter()
        .filter(|provider| provider.enabled())
        .cloned()
        .collect();

    let available: Vec<Arc<dyn TrainStatusProvider>> = enabled
        .iter()
        .filter(|provider| qos.is_available(provider.name(), now_ms))
        .cloned()
        .collect();

    let to_consult: Vec<Arc<dyn TrainStatusProvider>> = if available.is_empty() {
        // `enabled.slice(0, 1)` — the first provider, or an empty list when
        // nothing is enabled (falls through to "no providers configured").
        enabled[..1.min(enabled.len())].to_vec()
    } else {
        available
    };

    for provider in &enabled {
        if !to_consult
            .iter()
            .any(|consulted| consulted.name() == provider.name())
            && !qos.is_available(provider.name(), now_millis())
        {
            warn!(
                provider = provider.name(),
                "Skipping train status provider in QoS cooldown"
            );
        }
    }

    let mut not_found_providers: Vec<String> = Vec::new();
    let mut upstream_errors: Vec<ProviderError> = Vec::new();

    for provider in &to_consult {
        let started_at = Instant::now();
        match provider
            .fetch_train_status(
                train_number,
                departure_date,
                &options.fetch_options,
                options.known_train.as_ref(),
            )
            .await
        {
            Ok(status) => {
                qos.record(
                    provider.name(),
                    &QosRecord {
                        outcome: QosOutcome::Success,
                        latency_ms: started_at.elapsed().as_secs_f64() * 1000.0,
                        timeout: false,
                        error: None,
                    },
                );
                if !upstream_errors.is_empty() {
                    let attempts = upstream_errors.len() + 1;
                    record_failover(options, "recovered", attempts);
                    Span::current().record("providers_consulted", attempts as u64);
                    warn!(
                        train_number,
                        departure_date,
                        provider = provider.name(),
                        failed_providers = ?upstream_errors
                            .iter()
                            .filter_map(|err| match err {
                                ProviderError::Upstream { provider, .. } => Some(provider.as_str()),
                                _ => None,
                            })
                            .collect::<Vec<_>>(),
                        "Train status failover recovered"
                    );
                }
                return Ok(status);
            }
            Err(ProviderError::NotFound { .. }) => {
                qos.record(
                    provider.name(),
                    &QosRecord {
                        outcome: QosOutcome::NotFound,
                        latency_ms: started_at.elapsed().as_secs_f64() * 1000.0,
                        timeout: false,
                        error: None,
                    },
                );
                not_found_providers.push(provider.name().to_string());
                continue;
            }
            Err(err @ ProviderError::Upstream { .. }) => {
                let latency_ms = started_at.elapsed().as_secs_f64() * 1000.0;
                let message = err.to_string();
                qos.record(
                    provider.name(),
                    &QosRecord {
                        outcome: QosOutcome::UpstreamError,
                        latency_ms,
                        timeout: is_timeout_error(&err),
                        error: Some(message.clone()),
                    },
                );
                upstream_errors.push(err);
                warn!(
                    train_number,
                    departure_date,
                    provider = provider.name(),
                    message = %message,
                    "Train status provider failed, trying next"
                );
                continue;
            }
            Err(other) => return Err(other),
        }
    }

    if !to_consult.is_empty() && not_found_providers.len() == to_consult.len() {
        record_failover(options, "not_found", to_consult.len());
        return Err(ProviderError::not_found("all"));
    }
    if !upstream_errors.is_empty() {
        record_failover(options, "upstream_error", upstream_errors.len());
        return Err(ProviderError::upstream(
            "all",
            "All train status providers failed",
        ));
    }
    Err(ProviderError::upstream(
        "all",
        "No train status providers are configured",
    ))
}

/// `isTimeoutError` in `orchestrator.ts`: walk the cause chain (max 3 levels)
/// looking for a `TransportError::Timeout` — the Rust analogue of an error
/// whose `name === "TimeoutError"`.
fn is_timeout_error(err: &ProviderError) -> bool {
    let ProviderError::Upstream { cause, .. } = err else {
        return false;
    };
    let Some(mut current) = cause.as_ref().map(|cause| cause.as_ref() as &dyn Error) else {
        return false;
    };
    for _depth in 0..3 {
        if current
            .downcast_ref::<TransportError>()
            .is_some_and(|transport| matches!(transport, TransportError::Timeout { .. }))
        {
            return true;
        }
        let Some(source) = current.source() else {
            return false;
        };
        current = source;
    }
    false
}

/// `recordFailover` in `orchestrator.ts` — counter `app.provider.failover`
/// with `outcome` and `attempts` attributes. No-op when telemetry is absent
/// or inert.
fn record_failover(options: &FailoverOptions, outcome: &str, attempts: usize) {
    if let Some(telemetry) = &options.telemetry {
        telemetry
            .provider_metrics()
            .record_failover(outcome, attempts as u64);
    }
}

/// `Date.now()` — current epoch milliseconds.
fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
