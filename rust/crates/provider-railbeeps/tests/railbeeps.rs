//! Tests for the railbeeps (NDTV) JSON adapter, driven through
//! [`MockTransport`]. Fixtures mirror the documented station-list shape for
//! train 12301 (HWH → ASN → NDLS).

use std::sync::Arc;

use serde_json::{json, Value};
use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::MockTransport;
use tt_provider_railbeeps::{
    create_railbeeps_provider, map_railbeeps_payload, to_railbeeps_date, RailBeepsProvider,
};

const ENDPOINT_PATH: &str =
    "/api/getRunningStatus/api-key/eP5e2k1aJq4oV9fA/trainno/12301/date/10%20Aug";

fn railbeeps_raw() -> Value {
    json!({
        "trainNo": "12301",
        "trainName": "RAJDHANI EXPRES",
        "currentStationCode": "HWH",
        "message": "Train is running on time",
        "lastUpdated": "10 Aug 2026 00:05",
        "stations": [
            {
                "stationCode": "HWH",
                "stationName": "HOWRAH JN",
                "schDep": "16:50",
                "actDep": "16:50",
                "schArr": "",
                "actArr": "",
                "platform": "9",
                "day": 1
            },
            {
                "stationCode": "ASN",
                "stationName": "ASANSOL JN",
                "schArr": "18:47",
                "schDep": "18:49",
                "actArr": "18:47",
                "actDep": "18:49",
                "delay": 10,
                "distance": 200,
                "platform": "4",
                "day": 1
            },
            {
                "stationCode": "NDLS",
                "stationName": "NEW DELHI",
                "schArr": "10:05",
                "schDep": "",
                "actArr": "10:05",
                "actDep": "",
                "delay": 2,
                "platform": "14",
                "day": 2
            }
        ]
    })
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
fn to_railbeeps_date_converts_yyyymmdd_to_d_mmm() {
    assert_eq!(to_railbeeps_date("20260810"), Some("10 Aug".to_string()));
    assert_eq!(to_railbeeps_date("20260101"), Some("1 Jan".to_string()));
    assert_eq!(to_railbeeps_date("20261231"), Some("31 Dec".to_string()));
}

#[test]
fn to_railbeeps_date_returns_none_for_malformed_dates() {
    assert_eq!(to_railbeeps_date("2026-08-10"), None);
    assert_eq!(to_railbeeps_date("20261301"), None);
    assert_eq!(to_railbeeps_date("notadate"), None);
}

#[test]
fn maps_a_full_payload() {
    let status = map_railbeeps_payload(&railbeeps_raw(), &assemble_options()).expect("maps");

    assert_eq!(status.train_number, "12301");
    assert_eq!(status.train_name, "Rajdhani Express");
    assert_eq!(status.source_station_code, "HWH");
    assert_eq!(status.destination_station_code, "NDLS");
    assert_eq!(status.current_station_code.as_deref(), Some("HWH"));
    assert_eq!(status.stations.len(), 3);

    let first = &status.stations[0];
    assert_eq!(first.station_code, "HWH");
    assert_eq!(first.scheduled_departure.as_deref(), Some("16:50"));
    assert_eq!(first.actual_departure.as_deref(), Some("16:50"));
    assert_eq!(first.scheduled_arrival, None);
    assert_eq!(first.platform.as_deref(), Some("9"));
    assert_eq!(first.delay_minutes, None);

    let second = &status.stations[1];
    assert_eq!(second.station_code, "ASN");
    assert_eq!(second.delay_minutes, Some(10));
    assert_eq!(second.distance_from_source, Some(200));

    let last = &status.stations[2];
    assert_eq!(last.scheduled_arrival.as_deref(), Some("10:05"));
    assert_eq!(last.scheduled_departure, None);
    assert_eq!(last.day, 2);
}

#[test]
fn reads_the_station_array_from_the_data_key() {
    let mut raw = railbeeps_raw();
    raw["data"] = raw["stations"].clone();
    raw.as_object_mut().unwrap().remove("stations");
    let status = map_railbeeps_payload(&raw, &assemble_options()).expect("maps");
    assert_eq!(status.stations.len(), 3);
}

#[test]
fn reports_upstream_error_when_shape_is_missing() {
    let err = map_railbeeps_payload(&json!({ "trainNo": "12301" }), &assemble_options())
        .expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn reports_upstream_error_when_no_stations_are_parseable() {
    let raw = json!({ "stations": [{ "name": "no code here" }] });
    let err = map_railbeeps_payload(&raw, &assemble_options()).expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn tolerates_a_malformed_station_entry() {
    let mut raw = railbeeps_raw();
    raw["stations"] = json!([{ "broken": true }, railbeeps_raw()["stations"][0]]);
    let status = map_railbeeps_payload(&raw, &assemble_options()).expect("maps");
    assert_eq!(status.stations.len(), 1);
}

#[test]
fn issues_a_get_with_the_web_key_and_date_in_the_path() {
    let mut transport = MockTransport::new();
    transport.push_json(ENDPOINT_PATH, &railbeeps_raw());
    let transport = Arc::new(transport);
    let provider = RailBeepsProvider::new(transport.clone());

    let status = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(provider.fetch_train_status(
            "12301",
            "20260810",
            &ProviderFetchOptions::default(),
            Some(&known_train()),
        ))
        .expect("fetch");

    assert_eq!(status.current_station_code.as_deref(), Some("HWH"));

    let request = &transport.requests()[0];
    assert_eq!(request.method.as_str(), "GET");
    let parsed = url::Url::parse(&request.url).expect("valid url");
    assert_eq!(parsed.scheme(), "https");
    assert_eq!(parsed.host_str(), Some("api.railbeeps.com"));
    assert_eq!(parsed.path(), ENDPOINT_PATH);
    assert!(parsed.query().is_none());
}

#[test]
fn rejects_an_unsupported_date() {
    let provider = create_railbeeps_provider(Arc::new(MockTransport::new()));
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

#[test]
fn factory_returns_the_provider_with_the_right_name() {
    let provider = create_railbeeps_provider(Arc::new(MockTransport::new()));
    assert_eq!(provider.name(), "railbeeps");
    assert!(provider.enabled());
}
