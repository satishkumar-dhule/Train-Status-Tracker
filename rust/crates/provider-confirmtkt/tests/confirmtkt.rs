//! Port of the ConfirmTkt live-status adapter, with the fetch leg driven
//! through [`MockTransport`]. Fixtures mirror the live payload captured for
//! train 12301 (10-Aug-2026).

use std::sync::Arc;

use serde_json::{json, Value};
use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_confirmtkt::{
    create_confirmtkt_provider, map_confirmtkt_payload, to_confirmtkt_date, ConfirmTktProvider,
};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::MockTransport;

const ENDPOINT_PATH: &str = "/api/trains/livestatusall";

fn confirmtkt_raw() -> Value {
    json!({
        "fromIxigo": true,
        "trainDataFound": "trainRunningDataFound",
        "trainNo": "12301",
        "trainName": "RAJDHANI EXPRES",
        "HasPantry": false,
        "distanceCovered": 0,
        "CacheTime": 120,
        "startDate": "10-08-2026",
        "startDayDiff": 0,
        "departed": false,
        "curStn": "HWH",
        "curStnName": "Howrah Jn",
        "terminated": false,
        "idMsg": "",
        "cncldFrmStn": "",
        "cncldToStn": "",
        "totalJourney": 1449,
        "lastUpdated": "09 Aug 2026 00:05, (Disclaimer: ...)",
        "totalLateMins": 0,
        "isRunningDataAvailable": true,
        "stations": [
            {
                "stnCode": "HWH",
                "stnCodeName": "Howrah Jn",
                "haltMinutes": 0,
                "actArr": "",
                "actDep": "16:50",
                "dayCnt": 1,
                "schArrTime": "",
                "schDepTime": "16:50",
                "schDayCnt": 1,
                "delayArr": 0,
                "delayDep": 0,
                "arr": true,
                "dep": false,
                "distance": 0,
                "ExpectedPlatformNo": "9",
                "stoppingStn": true,
                "travelled": false
            },
            {
                "stnCode": "ASN",
                "stnCodeName": "Asansol Jn",
                "haltMinutes": 2,
                "actArr": "18:47",
                "actDep": "18:49",
                "dayCnt": 1,
                "schArrTime": "18:47",
                "schDepTime": "18:49",
                "schDayCnt": 1,
                "delayArr": 10,
                "delayDep": 13,
                "arr": true,
                "dep": true,
                "distance": 200,
                "ExpectedPlatformNo": "4",
                "stoppingStn": true,
                "travelled": true
            },
            {
                "stnCode": "NDLS",
                "stnCodeName": "New Delhi",
                "haltMinutes": 5,
                "actArr": "10:05",
                "actDep": "",
                "dayCnt": 2,
                "schArrTime": "10:05",
                "schDepTime": "",
                "schDayCnt": 2,
                "delayArr": 2,
                "delayDep": 3,
                "arr": true,
                "dep": false,
                "distance": 1449,
                "ExpectedPlatformNo": "14",
                "stoppingStn": true,
                "travelled": false
            }
        ],
        "Error": false,
        "CancelledRoutes": [],
        "DivertedRoutes": []
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
fn to_confirmtkt_date_converts_yyyymmdd_to_dd_mm_yyyy() {
    assert_eq!(
        to_confirmtkt_date("20260810"),
        Some("10-08-2026".to_string())
    );
}

#[test]
fn to_confirmtkt_date_returns_none_for_malformed_dates() {
    assert_eq!(to_confirmtkt_date("2026-08-10"), None);
    assert_eq!(to_confirmtkt_date("notadate"), None);
}

#[test]
fn maps_a_full_payload() {
    let status = map_confirmtkt_payload(&confirmtkt_raw(), &assemble_options()).expect("maps");

    assert_eq!(status.train_number, "12301");
    assert_eq!(status.train_name, "Rajdhani Express");
    assert_eq!(status.source_station_code, "HWH");
    assert_eq!(status.destination_station_code, "NDLS");
    assert_eq!(status.current_station_code.as_deref(), Some("HWH"));
    assert_eq!(status.stations.len(), 3);

    let first = &status.stations[0];
    assert_eq!(first.station_code, "HWH");
    assert!(first.is_current);
    assert_eq!(first.scheduled_departure.as_deref(), Some("16:50"));
    assert_eq!(first.actual_departure.as_deref(), Some("16:50"));
    assert_eq!(first.scheduled_arrival, None);
    assert_eq!(first.platform.as_deref(), Some("9"));
    assert_eq!(first.delay_minutes, Some(0));
    assert!(!first.has_departed);

    let second = &status.stations[1];
    assert_eq!(second.station_code, "ASN");
    assert!(second.has_departed);
    assert_eq!(second.delay_minutes, Some(10));
    assert_eq!(second.halt_minutes, Some(2));
    assert_eq!(second.distance_from_source, Some(200));

    let last = &status.stations[2];
    assert_eq!(last.scheduled_arrival.as_deref(), Some("10:05"));
    assert_eq!(last.scheduled_departure, None);
    assert_eq!(last.day, 2);
}

#[test]
fn falls_back_to_known_train_name_when_upstream_name_is_null() {
    let mut raw = confirmtkt_raw();
    raw["trainName"] = Value::Null;
    let status = map_confirmtkt_payload(&raw, &assemble_options()).expect("maps");
    assert_eq!(status.train_name, "Rajdhani Express");
}

#[test]
fn reports_not_found_when_train_data_flag_says_not_found() {
    let err = map_confirmtkt_payload(
        &json!({ "trainDataFound": "trainDataNotFound", "stations": [] }),
        &AssembleOptions {
            train_number: "1".to_string(),
            departure_date: "20260810".to_string(),
            ..AssembleOptions::default()
        },
    )
    .expect_err("must be not-found");
    assert!(matches!(err, ProviderError::NotFound { .. }));
}

#[test]
fn reports_upstream_error_when_shape_is_missing() {
    let err = map_confirmtkt_payload(
        &json!({ "trainDataFound": "trainRunningDataFound" }),
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
fn tolerates_a_malformed_station_entry() {
    let mut raw = confirmtkt_raw();
    raw["stations"] = json!([{ "broken": true }, confirmtkt_raw()["stations"][0]]);
    let status = map_confirmtkt_payload(&raw, &assemble_options()).expect("maps");
    assert_eq!(status.stations.len(), 1);
}

#[test]
fn issues_a_get_with_query_params_and_returns_mapped_status() {
    let mut transport = MockTransport::new();
    transport.push_json(ENDPOINT_PATH, &confirmtkt_raw());
    let transport = Arc::new(transport);
    let provider = ConfirmTktProvider::new(transport.clone());

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
    assert_eq!(parsed.path(), ENDPOINT_PATH);
    let query: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
    assert_eq!(query.get("trainno").map(String::as_str), Some("12301"));
    assert_eq!(query.get("doj").map(String::as_str), Some("10-08-2026"));
    assert_eq!(query.get("locale").map(String::as_str), Some("en"));
    assert!(query.contains_key("session"));
    assert!(!query["session"].is_empty());
}

#[test]
fn rejects_an_unsupported_date() {
    let provider = create_confirmtkt_provider(Arc::new(MockTransport::new()));
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
