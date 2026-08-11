//! Port of the NTES (CRIS official) live-status adapter, with the fetch leg
//! driven through [`MockTransport`]. The response envelope fixture is the real
//! live capture from 10-Aug-2026 for train 12301, re-encrypted so the decode
//! leg is exercised end-to-end.

use std::sync::Arc;

use serde_json::{json, Value};
use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::MockTransport;
use tt_provider_ntes::{create_ntes_provider, map_ntes_payload, to_ntes_date, NtesProvider};

const ENDPOINT_PATH: &str = "/crisns/AppServAnd";

fn ntes_decrypted() -> Value {
    let raw = include_str!("../../../fixtures/ntes-live-10Aug2026.json");
    serde_json::from_str(raw).expect("ntes fixture is valid JSON")
}

fn ntes_envelope() -> Value {
    let raw = include_str!("../../../fixtures/ntes_response_envelope.json");
    serde_json::from_str(raw).expect("ntes envelope fixture is valid JSON")
}

fn known_train() -> KnownTrain {
    KnownTrain {
        number: "12301".to_string(),
        name: "Rajdhani Express".to_string(),
    }
}

fn assemble_options() -> AssembleOptions {
    AssembleOptions {
        train_number: "12301".to_string(),
        departure_date: "20260810".to_string(),
        known_train: Some(known_train()),
        ..AssembleOptions::default()
    }
}

#[test]
fn to_ntes_date_converts_yyyymmdd_to_dd_mmm_yyyy() {
    assert_eq!(to_ntes_date("20260810"), Some("10-Aug-2026".to_string()));
}

#[test]
fn to_ntes_date_returns_none_for_malformed_dates() {
    assert_eq!(to_ntes_date("2026-08-10"), None);
    assert_eq!(to_ntes_date("notadate"), None);
    assert_eq!(to_ntes_date("20261310"), None);
}

#[test]
fn maps_a_full_payload() {
    let status = map_ntes_payload(&ntes_decrypted(), &assemble_options()).expect("maps");

    assert_eq!(status.train_number, "12301");
    assert_eq!(status.train_name, "Rajdhani Express");
    assert_eq!(status.source_station_code, "HWH");
    assert_eq!(status.destination_station_code, "NDLS");
    assert_eq!(
        status.status_message.as_deref(),
        Some("Yet to start from its source")
    );
    assert_eq!(status.stations.len(), 9);

    let first = &status.stations[0];
    assert_eq!(first.station_code, "HWH");
    assert_eq!(first.scheduled_arrival, None);
    assert_eq!(first.scheduled_departure.as_deref(), Some("16:50"));
    assert_eq!(first.actual_arrival, None);
    assert_eq!(first.actual_departure, None);
    assert_eq!(first.platform.as_deref(), Some("9"));
    assert_eq!(first.day, 1);

    let second = &status.stations[1];
    assert_eq!(second.station_code, "ASN");
    assert_eq!(second.scheduled_arrival.as_deref(), Some("18:47"));
    assert_eq!(second.scheduled_departure.as_deref(), Some("18:49"));
    assert_eq!(second.actual_arrival, None);
    assert_eq!(second.platform.as_deref(), Some("4"));
    assert_eq!(second.distance_from_source, Some(200));

    let last = &status.stations[8];
    assert_eq!(last.station_code, "NDLS");
    assert_eq!(last.scheduled_arrival.as_deref(), Some("10:05"));
    assert_eq!(last.scheduled_departure, None);
    assert_eq!(last.platform.as_deref(), Some("14"));
}

#[test]
fn treats_on_time_actuals_as_absent() {
    // In the live fixture every DARR/DDEP is "On Time"/blank — actuals must be
    // None, and delays must be recomputed to None (no scheduled-vs-actual pair).
    let status = map_ntes_payload(&ntes_decrypted(), &assemble_options()).expect("maps");
    for station in &status.stations {
        assert_eq!(station.actual_arrival, None);
        assert_eq!(station.actual_departure, None);
    }
}

#[test]
fn reports_upstream_error_when_shape_is_missing() {
    let err = map_ntes_payload(
        &json!({ "TN": "12301" }),
        &AssembleOptions {
            train_number: "1".to_string(),
            departure_date: "20260810".to_string(),
            ..AssembleOptions::default()
        },
    )
    .expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn issues_a_post_with_json_body_and_maps_decrypted_status() {
    let mut transport = MockTransport::new();
    transport.push_json(ENDPOINT_PATH, &ntes_envelope());
    let transport = Arc::new(transport);
    let provider = NtesProvider::new(transport.clone());

    let status = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(provider.fetch_train_status(
            "12301",
            "20260810",
            &ProviderFetchOptions::default(),
            Some(&known_train()),
        ))
        .expect("fetch");

    assert_eq!(status.source_station_code, "HWH");
    assert_eq!(status.destination_station_code, "NDLS");
    assert_eq!(status.stations.len(), 9);

    let request = &transport.requests()[0];
    assert_eq!(request.method.as_str(), "POST");
    let parsed = url::Url::parse(&request.url).expect("valid url");
    assert_eq!(parsed.path(), ENDPOINT_PATH);
    let body: Value =
        serde_json::from_slice(request.body.as_deref().expect("has body")).expect("body is JSON");
    assert!(body.get("jsonIn").and_then(Value::as_str).is_some());
    let envelope = body["jsonIn"].as_str().unwrap();
    assert!(envelope.contains('#'));
    let encoded = envelope.split('#').next_back().unwrap();
    assert!(encoded.len() > 100);
}

#[test]
fn rejects_an_unsupported_date() {
    let provider = create_ntes_provider(Arc::new(MockTransport::new()));
    let err = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(provider.fetch_train_status(
            "12301",
            "bogus",
            &ProviderFetchOptions::default(),
            None,
        ))
        .expect_err("must fail");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}
