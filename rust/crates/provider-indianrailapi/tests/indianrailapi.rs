//! Tests for the key-gated IndianRailAPI adapter, driven through
//! [`MockTransport`]. Fixtures use the vendor-documented payload shape for
//! train 12301 (HWH → ASN → NDLS).

use std::sync::Arc;

use serde_json::{json, Value};
use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::MockTransport;
use tt_provider_indianrailapi::{
    create_indianrailapi_provider, map_indianrailapi_payload, to_indianrailapi_date,
    IndianRailApiProvider,
};

const ENDPOINT_PATH: &str =
    "/api/v2/livetrainstatus/apikey/test-key/trainnumber/12301/date/20260810/";

fn indianrailapi_raw() -> Value {
    json!({
        "TrainName": "RAJDHANI EXPRES",
        "CurrentStationCode": "HWH",
        "CurrentStationName": "HOWRAH JN",
        "DelayInMin": 0,
        "UpdateTime": "10-Aug-2026 00:05",
        "Data": [
            {
                "StationCode": "HWH",
                "StationName": "HOWRAH JN",
                "ScheduleArrival": "",
                "ScheduleDeparture": "16:50",
                "ActualArrival": "",
                "ActualDeparture": "16:50",
                "Delay": 0,
                "DayCount": 1,
                "Distance": 0,
                "Platform": "9"
            },
            {
                "StationCode": "ASN",
                "StationName": "ASANSOL JN",
                "ScheduleArrival": "18:47",
                "ScheduleDeparture": "18:49",
                "ActualArrival": "18:47",
                "ActualDeparture": "18:49",
                "Delay": 10,
                "DayCount": 1,
                "Distance": 200,
                "Platform": "4"
            },
            {
                "StationCode": "NDLS",
                "StationName": "NEW DELHI",
                "ScheduleArrival": "10:05",
                "ScheduleDeparture": "",
                "ActualArrival": "10:05",
                "ActualDeparture": "",
                "Delay": 2,
                "DayCount": 2,
                "Distance": 1449,
                "Platform": "14"
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
fn to_indianrailapi_date_passes_yyyymmdd_through() {
    assert_eq!(
        to_indianrailapi_date("20260810"),
        Some("20260810".to_string())
    );
}

#[test]
fn to_indianrailapi_date_returns_none_for_malformed_dates() {
    assert_eq!(to_indianrailapi_date("2026-08-10"), None);
    assert_eq!(to_indianrailapi_date("notadate"), None);
}

#[test]
fn maps_a_full_payload() {
    let status =
        map_indianrailapi_payload(&indianrailapi_raw(), &assemble_options()).expect("maps");

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
    assert_eq!(first.delay_minutes, Some(0));

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
fn reports_upstream_error_when_shape_is_missing() {
    let err = map_indianrailapi_payload(
        &json!({ "TrainName": "RAJDHANI EXPRES" }),
        &assemble_options(),
    )
    .expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn reports_upstream_error_when_no_stations_are_parseable() {
    let raw = json!({
        "TrainName": "RAJDHANI EXPRES",
        "Data": [{ "StationName": "no code here" }]
    });
    let err = map_indianrailapi_payload(&raw, &assemble_options()).expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn tolerates_a_malformed_station_entry() {
    let mut raw = indianrailapi_raw();
    raw["Data"] = json!([{ "broken": true }, indianrailapi_raw()["Data"][0]]);
    let status = map_indianrailapi_payload(&raw, &assemble_options()).expect("maps");
    assert_eq!(status.stations.len(), 1);
}

#[test]
fn issues_a_get_with_the_key_in_the_path_and_returns_mapped_status() {
    let mut transport = MockTransport::new();
    transport.push_json(ENDPOINT_PATH, &indianrailapi_raw());
    let transport = Arc::new(transport);
    let provider = IndianRailApiProvider::new(transport.clone(), Some("test-key".to_string()));

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
    assert_eq!(parsed.host_str(), Some("indianrailapi.com"));
    assert_eq!(parsed.path(), ENDPOINT_PATH);
    assert!(parsed.query().is_none());
}

#[test]
fn is_disabled_without_an_api_key() {
    let provider = create_indianrailapi_provider(Arc::new(MockTransport::new()), None);
    assert_eq!(provider.name(), "indianrailapi");
    assert!(!provider.enabled());
}

#[test]
fn rejects_an_unsupported_date() {
    let provider =
        create_indianrailapi_provider(Arc::new(MockTransport::new()), Some("test-key".to_string()));
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
