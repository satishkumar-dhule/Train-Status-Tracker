//! Port of `lib/providers/qos.test.ts` — every case 1:1.

use tt_qos::{
    create_qos_registry_from_env, QosOptions, QosOutcome, QosRecord, QosRegistry, QosStatus,
    DEFAULT_QOS_OPTIONS,
};

const NOW: i64 = 1_700_000_000_000;

fn error_event(latency_ms: f64) -> QosRecord {
    QosRecord {
        outcome: QosOutcome::UpstreamError,
        latency_ms,
        timeout: false,
        error: None,
    }
}

#[test]
fn starts_empty_and_reports_healthy_for_unknown_providers() {
    let qos = QosRegistry::default();
    assert!(qos.is_available("paytm", NOW));
    let snapshot = qos.snapshot("paytm", NOW);
    assert_eq!(snapshot.requests, 0);
    assert_eq!(snapshot.status, QosStatus::Ok);
    assert!(snapshot.available);
    assert_eq!(snapshot.error_rate, 0.0);
}

#[test]
fn tracks_successes_and_resets_consecutive_failures() {
    let qos = QosRegistry::default();
    qos.record("a", &error_event(100.0));
    qos.record("a", &error_event(100.0));
    qos.record(
        "a",
        &QosRecord {
            outcome: QosOutcome::Success,
            latency_ms: 50.0,
            timeout: false,
            error: None,
        },
    );

    let snapshot = qos.snapshot("a", NOW);
    assert_eq!(snapshot.requests, 3);
    assert_eq!(snapshot.successes, 1);
    assert_eq!(snapshot.upstream_errors, 2);
    assert_eq!(snapshot.consecutive_failures, 0);
    assert!(snapshot.last_success_at.is_some());
}

#[test]
fn treats_not_found_as_a_healthy_authoritative_answer() {
    let qos = QosRegistry::default();
    qos.record(
        "a",
        &QosRecord {
            outcome: QosOutcome::NotFound,
            latency_ms: 200.0,
            timeout: false,
            error: None,
        },
    );

    let snapshot = qos.snapshot("a", NOW);
    assert_eq!(snapshot.not_found, 1);
    assert_eq!(snapshot.consecutive_failures, 0);
    assert!(snapshot.available);
    assert_eq!(snapshot.status, QosStatus::Ok);
}

#[test]
fn computes_error_rate_and_degrades_status_on_repeated_failures() {
    let qos = QosRegistry::default();
    qos.record("a", &error_event(10.0));
    qos.record("a", &error_event(10.0));
    qos.record(
        "a",
        &QosRecord {
            outcome: QosOutcome::Success,
            latency_ms: 10.0,
            timeout: false,
            error: None,
        },
    );

    let snapshot = qos.snapshot("a", NOW);
    assert!((snapshot.error_rate - 2.0 / 3.0).abs() < 1e-9);
    assert_eq!(snapshot.status, QosStatus::Degraded);
}

#[test]
fn marks_a_provider_down_after_the_failure_threshold() {
    let qos = QosRegistry::new(QosOptions {
        failure_threshold: 3,
        cooldown_ms: 60_000,
        max_latency_samples: 10,
    });

    qos.record("a", &error_event(10.0));
    qos.record("a", &error_event(10.0));
    assert!(qos.is_available("a", NOW));

    qos.record("a", &error_event(10.0));
    assert!(!qos.is_available("a", NOW));
    assert_eq!(qos.snapshot("a", NOW).status, QosStatus::Down);
}

#[test]
fn reopens_a_provider_after_the_cooldown_elapses() {
    let qos = QosRegistry::new(QosOptions {
        failure_threshold: 1,
        cooldown_ms: 60_000,
        max_latency_samples: 10,
    });

    qos.record("a", &error_event(10.0));
    let last_error_at = qos.snapshot("a", NOW).last_error_at.expect("recorded");
    let failed_at = chrono::DateTime::parse_from_rfc3339(&last_error_at)
        .expect("ISO-8601")
        .timestamp_millis();

    assert!(!qos.is_available("a", failed_at));
    assert!(qos.is_available("a", failed_at + 60_000));
}

#[test]
fn computes_avg_and_p95_latency_from_the_rolling_window() {
    let qos = QosRegistry::default();
    for i in 1..=20 {
        qos.record(
            "a",
            &QosRecord {
                outcome: QosOutcome::Success,
                latency_ms: f64::from(i),
                timeout: false,
                error: None,
            },
        );
    }

    let snapshot = qos.snapshot("a", NOW);
    assert!((snapshot.avg_latency_ms - 10.5).abs() < 1e-9);
    assert_eq!(snapshot.p95_latency_ms, Some(19.0));
}

#[test]
fn caps_the_latency_window_at_max_latency_samples() {
    let qos = QosRegistry::new(QosOptions {
        max_latency_samples: 3,
        ..QosOptions::default()
    });
    for i in 1..=5 {
        qos.record(
            "a",
            &QosRecord {
                outcome: QosOutcome::Success,
                latency_ms: f64::from(i),
                timeout: false,
                error: None,
            },
        );
    }

    let snapshot = qos.snapshot("a", NOW);
    assert!((snapshot.avg_latency_ms - 4.0).abs() < 1e-9);
    assert_eq!(snapshot.p95_latency_ms, Some(5.0));
}

#[test]
fn counts_timeouts_separately() {
    let qos = QosRegistry::default();
    qos.record(
        "a",
        &QosRecord {
            outcome: QosOutcome::UpstreamError,
            latency_ms: 10_000.0,
            timeout: true,
            error: None,
        },
    );

    let snapshot = qos.snapshot("a", NOW);
    assert_eq!(snapshot.timeouts, 1);
    assert_eq!(snapshot.upstream_errors, 1);
}

#[test]
fn snapshots_for_a_list_of_names_in_order() {
    let qos = QosRegistry::default();
    qos.record(
        "b",
        &QosRecord {
            outcome: QosOutcome::Success,
            latency_ms: 1.0,
            timeout: false,
            error: None,
        },
    );
    qos.record(
        "a",
        &QosRecord {
            outcome: QosOutcome::Success,
            latency_ms: 2.0,
            timeout: false,
            error: None,
        },
    );

    let snapshots = qos.snapshot_for(&["a", "b", "c"], NOW);
    let names: Vec<&str> = snapshots.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, vec!["a", "b", "c"]);
    assert_eq!(snapshots[2].requests, 0);
}

#[test]
fn reset_clears_all_recorded_state() {
    let qos = QosRegistry::default();
    qos.record("a", &error_event(10.0));
    assert_eq!(qos.snapshot_all(NOW).len(), 1);

    qos.reset();
    assert_eq!(qos.snapshot_all(NOW).len(), 0);
    assert!(qos.is_available("a", NOW));
}

#[test]
fn defaults_match_the_typescript_defaults() {
    assert_eq!(DEFAULT_QOS_OPTIONS.failure_threshold, 3);
    assert_eq!(DEFAULT_QOS_OPTIONS.cooldown_ms, 60_000);
    assert_eq!(DEFAULT_QOS_OPTIONS.max_latency_samples, 100);
    assert_eq!(QosOptions::default(), DEFAULT_QOS_OPTIONS);
}

#[test]
fn create_from_env_reads_process_environment_and_fails_open() {
    std::env::set_var("TRAIN_STATUS_QOS_FAILURE_THRESHOLD", "5");
    std::env::set_var("TRAIN_STATUS_QOS_COOLDOWN_MS", "120000");
    std::env::set_var("TRAIN_STATUS_QOS_LATENCY_SAMPLES", "50");
    let registry = create_qos_registry_from_env();
    std::env::remove_var("TRAIN_STATUS_QOS_FAILURE_THRESHOLD");
    std::env::remove_var("TRAIN_STATUS_QOS_COOLDOWN_MS");
    std::env::remove_var("TRAIN_STATUS_QOS_LATENCY_SAMPLES");

    for _ in 0..4 {
        registry.record("a", &error_event(10.0));
    }
    assert!(registry.is_available("a", NOW), "threshold is 5, not 3");
    registry.record("a", &error_event(10.0));
    assert!(!registry.is_available("a", NOW));
}
