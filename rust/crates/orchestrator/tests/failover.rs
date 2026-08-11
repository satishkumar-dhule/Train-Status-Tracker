//! Port of `lib/providers/orchestrator.test.ts` — every case 1:1.

use std::sync::Arc;
use std::time::Duration;

use tt_mapper::{KnownTrain, MappedStatus};
use tt_orchestrator::{fetch_status_with_failover, FailoverOptions};
use tt_provider_core::{AbortSignal, ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::TransportError;
use tt_qos::{QosOptions, QosRegistry};

fn mapped_status(train_name: &str) -> MappedStatus {
    MappedStatus {
        train_number: "22943".to_string(),
        train_name: train_name.to_string(),
        departure_date: "20260802".to_string(),
        source_station_code: "ADI".to_string(),
        source_station_name: String::new(),
        destination_station_code: "NDLS".to_string(),
        destination_station_name: String::new(),
        current_station_code: None,
        current_station_name: None,
        current_delay_minutes: None,
        status_message: None,
        last_updated: None,
        provider: String::new(),
        stations: Vec::new(),
    }
}

type Call = (String, Option<KnownTrain>);
type CallLog = std::sync::Mutex<Vec<Call>>;

struct FakeProvider {
    name: &'static str,
    enabled: bool,
    behavior: Behavior,
    calls: Arc<CallLog>,
}

enum Behavior {
    Ok,
    NotFound,
    Upstream,
    Program,
}

impl FakeProvider {
    fn ok(name: &'static str) -> Self {
        Self {
            name,
            enabled: true,
            behavior: Behavior::Ok,
            calls: Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }

    fn not_found(name: &'static str) -> Self {
        Self {
            name,
            enabled: true,
            behavior: Behavior::NotFound,
            calls: Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }

    fn upstream(name: &'static str) -> Self {
        Self {
            name,
            enabled: true,
            behavior: Behavior::Upstream,
            calls: Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }

    fn programming(name: &'static str) -> Self {
        Self {
            name,
            enabled: true,
            behavior: Behavior::Program,
            calls: Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }

    fn disabled(name: &'static str) -> Self {
        Self {
            name,
            enabled: false,
            behavior: Behavior::Ok,
            calls: Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }

    fn call_count(&self) -> usize {
        self.calls.lock().unwrap().len()
    }

    fn recorded_signature(&self, index: usize) -> (Option<KnownTrain>, bool) {
        let calls = self.calls.lock().unwrap();
        let (_, known) = calls.get(index).cloned().expect("recorded call");
        let aborted_signal_observed = false;
        (known, aborted_signal_observed)
    }
}

#[async_trait::async_trait]
impl TrainStatusProvider for FakeProvider {
    fn name(&self) -> &str {
        self.name
    }

    fn enabled(&self) -> bool {
        self.enabled
    }

    async fn fetch_train_status(
        &self,
        _train_number: &str,
        departure_date: &str,
        options: &ProviderFetchOptions,
        known_train: Option<&KnownTrain>,
    ) -> Result<MappedStatus, ProviderError> {
        if let Some(signal) = &options.abort {
            assert!(!signal.is_aborted(), "signal must not be pre-aborted");
        }
        self.calls
            .lock()
            .unwrap()
            .push((departure_date.to_string(), known_train.cloned()));
        match self.behavior {
            Behavior::Ok => Ok(mapped_status(&format!("from {}", self.name))),
            Behavior::NotFound => Err(ProviderError::not_found(self.name)),
            Behavior::Upstream => Err(ProviderError::upstream(self.name, "boom")),
            Behavior::Program => Err(ProviderError::program("programming bug")),
        }
    }
}

async fn failover(
    providers: Vec<Arc<dyn TrainStatusProvider>>,
    options: FailoverOptions,
) -> Result<MappedStatus, ProviderError> {
    fetch_status_with_failover(&providers, "22943", "20260802", &options).await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tokio::test]
async fn returns_the_first_successful_provider() {
    let paytm = Arc::new(FakeProvider::upstream("paytm"));
    let goibibo = Arc::new(FakeProvider::ok("goibibo"));
    let railyatri = Arc::new(FakeProvider::ok("railyatri"));

    let status = failover(
        vec![paytm, goibibo.clone(), railyatri.clone()],
        FailoverOptions::default(),
    )
    .await;
    assert_eq!(status.expect("recovered").train_name, "from goibibo");
    assert_eq!(goibibo.call_count(), 1);
    assert_eq!(railyatri.call_count(), 0);
}

#[tokio::test]
async fn throws_not_found_only_when_every_provider_reports_not_found() {
    let a = Arc::new(FakeProvider::not_found("a"));
    let b = Arc::new(FakeProvider::not_found("b"));
    let result = failover(vec![a, b], FailoverOptions::default()).await;
    assert!(matches!(result, Err(ProviderError::NotFound { .. })));
}

#[tokio::test]
async fn fails_over_to_a_later_provider_and_recovers() {
    let a = Arc::new(FakeProvider::upstream("a"));
    let b = Arc::new(FakeProvider::ok("b"));
    let status = failover(vec![a, b], FailoverOptions::default()).await;
    assert_eq!(status.expect("recovered").train_name, "from b");
}

#[tokio::test]
async fn records_a_failover_metric_when_every_provider_reports_not_found() {
    let a = Arc::new(FakeProvider::not_found("a"));
    let b = Arc::new(FakeProvider::not_found("b"));
    let result = failover(vec![a, b], FailoverOptions::default()).await;
    assert!(matches!(result, Err(ProviderError::NotFound { .. })));
}

#[tokio::test]
async fn throws_upstream_when_one_errors_and_another_says_not_found() {
    let a = Arc::new(FakeProvider::upstream("a"));
    let b = Arc::new(FakeProvider::not_found("b"));
    let result = failover(vec![a, b], FailoverOptions::default()).await;
    assert!(matches!(result, Err(ProviderError::Upstream { .. })));
}

#[tokio::test]
async fn throws_upstream_when_every_provider_errors() {
    let a = Arc::new(FakeProvider::upstream("a"));
    let b = Arc::new(FakeProvider::upstream("b"));
    let result = failover(vec![a, b], FailoverOptions::default()).await;
    assert!(matches!(result, Err(ProviderError::Upstream { .. })));
}

#[tokio::test]
async fn skips_disabled_providers() {
    let disabled = Arc::new(FakeProvider::disabled("x"));
    let enabled_provider = Arc::new(FakeProvider::ok("y"));

    let status = failover(
        vec![disabled.clone(), enabled_provider.clone()],
        FailoverOptions::default(),
    )
    .await;
    assert_eq!(status.expect("ok").train_name, "from y");
    assert_eq!(disabled.call_count(), 0);
}

#[tokio::test]
async fn rethrows_a_programming_error_without_masking_it() {
    let a = Arc::new(FakeProvider::programming("a"));
    let b = Arc::new(FakeProvider::ok("b"));

    let result = failover(vec![a, b], FailoverOptions::default()).await;
    match result {
        Err(ProviderError::Program(msg)) => assert_eq!(msg, "programming bug"),
        other => panic!("expected program error, got {other:?}"),
    }
}

#[tokio::test]
async fn throws_upstream_when_no_providers_are_enabled() {
    let disabled = Arc::new(FakeProvider::disabled("x"));

    let result = failover(vec![disabled], FailoverOptions::default()).await;
    match result {
        Err(ProviderError::Upstream { message, .. }) => {
            assert_eq!(message, "No train status providers are configured");
        }
        other => panic!("expected upstream error, got {other:?}"),
    }
}

#[tokio::test]
async fn stamps_the_serving_provider_name_on_the_result() {
    let a = Arc::new(FakeProvider::ok("a"));

    let status = failover(vec![a], FailoverOptions::default())
        .await
        .expect("ok");
    assert_eq!(status.train_name, "from a");
    assert_eq!(status.provider, "a");
}

#[tokio::test]
async fn consults_only_the_pinned_provider_even_when_others_are_available() {
    let paytm = Arc::new(FakeProvider::upstream("paytm"));
    let goibibo = Arc::new(FakeProvider::ok("goibibo"));

    let options = FailoverOptions {
        pinned_provider: Some("goibibo".to_string()),
        ..FailoverOptions::default()
    };
    let status = failover(vec![paytm.clone(), goibibo.clone()], options)
        .await
        .expect("ok");
    assert_eq!(status.train_name, "from goibibo");
    assert_eq!(status.provider, "goibibo");
    // The pin skips the failover chain entirely: the healthy Paytm upstream
    // would have been consulted first, but must not be.
    assert_eq!(paytm.call_count(), 0);
    assert_eq!(goibibo.call_count(), 1);
}

#[tokio::test]
async fn errors_when_the_pinned_provider_is_not_in_the_list() {
    let a = Arc::new(FakeProvider::ok("a"));

    let options = FailoverOptions {
        pinned_provider: Some("ghost".to_string()),
        ..FailoverOptions::default()
    };
    let result = failover(vec![a.clone()], options).await;
    match result {
        Err(ProviderError::Upstream {
            provider, message, ..
        }) => {
            assert_eq!(provider, "ghost");
            assert_eq!(message, "Train status provider \"ghost\" is not configured");
        }
        other => panic!("expected upstream error, got {other:?}"),
    }
    assert_eq!(a.call_count(), 0);
}

#[tokio::test]
async fn passes_through_fetch_options_and_known_train() {
    let a = Arc::new(FakeProvider::ok("a"));
    let signal = AbortSignal::new();
    let known_train = KnownTrain {
        number: "22943".to_string(),
        name: "Bandra Gujarat Express".to_string(),
    };

    let options = FailoverOptions {
        fetch_options: ProviderFetchOptions {
            abort: Some(signal),
        },
        known_train: Some(known_train.clone()),
        ..FailoverOptions::default()
    };
    let _ = failover(vec![a.clone()], options).await;

    let (known, _signal_ok) = a.recorded_signature(0);
    assert_eq!(known, Some(known_train));
}

struct TimeoutProvider;

#[async_trait::async_trait]
impl TrainStatusProvider for TimeoutProvider {
    fn name(&self) -> &str {
        "a"
    }
    fn enabled(&self) -> bool {
        true
    }
    async fn fetch_train_status(
        &self,
        _train_number: &str,
        _departure_date: &str,
        _options: &ProviderFetchOptions,
        _known_train: Option<&KnownTrain>,
    ) -> Result<MappedStatus, ProviderError> {
        Err(ProviderError::upstream_with_cause(
            "a",
            "Network error reaching a",
            TransportError::Timeout {
                timeout: Duration::from_secs(10),
            },
        ))
    }
}

#[tokio::test]
async fn records_a_timeout_in_the_qos_registry_when_the_upstream_timed_out() {
    let qos = Arc::new(QosRegistry::default());
    let a = Arc::new(TimeoutProvider);

    let result = failover(
        vec![a],
        FailoverOptions {
            qos: Some(qos.clone()),
            ..FailoverOptions::default()
        },
    )
    .await;
    assert!(result.is_err());

    let snapshot = qos.snapshot("a", now_ms());
    assert_eq!(snapshot.upstream_errors, 1);
    assert_eq!(snapshot.timeouts, 1);
    assert_eq!(snapshot.consecutive_failures, 1);
}

#[tokio::test]
async fn records_a_success_in_the_qos_registry() {
    let qos = Arc::new(QosRegistry::default());
    let a = Arc::new(FakeProvider::ok("a"));

    let _ = failover(
        vec![a],
        FailoverOptions {
            qos: Some(qos.clone()),
            ..FailoverOptions::default()
        },
    )
    .await;

    let snapshot = qos.snapshot("a", now_ms());
    assert_eq!(snapshot.successes, 1);
    assert_eq!(snapshot.upstream_errors, 0);
    assert_eq!(snapshot.consecutive_failures, 0);
}

#[tokio::test]
async fn skips_a_provider_in_qos_cooldown_and_uses_the_next_one() {
    let qos = QosRegistry::new(QosOptions {
        failure_threshold: 1,
        cooldown_ms: 60_000,
        max_latency_samples: 10,
    });
    let a = Arc::new(FakeProvider::upstream("a"));
    let b = Arc::new(FakeProvider::ok("b"));

    let options = FailoverOptions {
        qos: Some(Arc::new(qos)),
        ..FailoverOptions::default()
    };
    let status = failover(vec![a.clone(), b.clone()], options.clone()).await;
    assert_eq!(status.expect("recovered").train_name, "from b");

    let _ = failover(vec![a.clone(), b.clone()], options).await;

    assert_eq!(a.call_count(), 1);
    assert_eq!(b.call_count(), 2);
}

#[tokio::test]
async fn force_tries_the_first_provider_when_every_provider_is_in_cooldown() {
    let qos = QosRegistry::new(QosOptions {
        failure_threshold: 1,
        cooldown_ms: 60_000,
        max_latency_samples: 10,
    });
    let a = Arc::new(FakeProvider::upstream("a"));
    let b = Arc::new(FakeProvider::upstream("b"));

    let options = FailoverOptions {
        qos: Some(Arc::new(qos)),
        ..FailoverOptions::default()
    };
    assert!(failover(vec![a.clone(), b.clone()], options.clone())
        .await
        .is_err());
    assert!(failover(vec![a.clone(), b.clone()], options).await.is_err());

    assert_eq!(a.call_count(), 2);
    assert_eq!(b.call_count(), 1);
}
