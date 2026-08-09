//! Port of `lib/providers/whereismytrain.test.ts`, with the fetch leg driven
//! through [`MockTransport`].

use std::sync::Arc;

use serde_json::{json, Value};
use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::MockTransport;
use tt_provider_wimt::{
    create_whereismytrain_provider, map_wimt_payload, to_wimt_date, WhereIsMyTrainProvider,
};

const ENDPOINT_PATH: &str = "/cache/live_status";

fn wimt_raw() -> Value {
    json!({
        "start_date": "02-08-2026",
        "source_station": "HWH",
        "destination_station": "NDLS",
        "curStn": "CNB",
        "eta": "3 mins",
        "train_name": "Howrah Rajdhani Express",
        "lastUpdateIsoDate": "2026-08-06T13:18:01.578613+05:30",
        "days_schedule": [
            {
                "station_code": "HWH",
                "station_name": "",
                "sch_arrival_time": "17:00",
                "actual_arrival_time": "17:00",
                "sch_departure_time": "17:15",
                "actual_departure_time": "17:15",
                "delay_in_arrival": 0,
                "delay_in_departure": 0,
                "platform": "10",
                "distance": 0,
                "sno": 1,
                "departed": true,
            },
            {
                "station_code": "CNB",
                "station_name": "",
                "sch_arrival_time": "08:00",
                "actual_arrival_time": "08:05",
                "sch_departure_time": "08:05",
                "actual_departure_time": null,
                "delay_in_arrival": 5,
                "delay_in_departure": 5,
                "platform": "4",
                "distance": 1200,
                "sno": 2,
                "departed": false,
            },
            {
                "station_code": "NDLS",
                "station_name": "",
                "sch_arrival_time": "08:25",
                "actual_arrival_time": null,
                "sch_departure_time": "08:35",
                "actual_departure_time": null,
                "delay_in_arrival": null,
                "delay_in_departure": null,
                "platform": null,
                "distance": 1447,
                "sno": 3,
                "departed": false,
            },
        ],
    })
}

fn known_train() -> KnownTrain {
    KnownTrain {
        number: "12301".to_string(),
        name: "Howrah Rajdhani Express".to_string(),
    }
}

fn assemble_options() -> AssembleOptions {
    AssembleOptions {
        train_number: "12301".to_string(),
        departure_date: "20260806".to_string(),
        known_train: Some(known_train()),
        ..AssembleOptions::default()
    }
}

#[test]
fn to_wimt_date_converts_yyyymmdd_to_dd_mm_yyyy() {
    assert_eq!(to_wimt_date("20260806").as_deref(), Some("06-08-2026"));
}

#[test]
fn to_wimt_date_returns_none_for_a_malformed_date() {
    assert_eq!(to_wimt_date("bogus"), None);
}

#[test]
fn maps_the_days_schedule_with_explicit_departed_flags() {
    let status = map_wimt_payload(&wimt_raw(), &assemble_options()).expect("maps");

    assert_eq!(status.current_station_code.as_deref(), Some("CNB"));
    assert_eq!(
        status.last_updated.as_deref(),
        Some("2026-08-06T13:18:01.578613+05:30")
    );
    assert_eq!(status.stations.len(), 3);

    let first = &status.stations[0];
    assert_eq!(first.station_code, "HWH");
    assert_eq!(first.scheduled_arrival.as_deref(), Some("17:00"));
    assert_eq!(first.actual_departure.as_deref(), Some("17:15"));
    assert_eq!(first.delay_minutes, Some(0));
    assert_eq!(first.platform.as_deref(), Some("10"));
    assert_eq!(first.distance_from_source, Some(0));
    assert!(first.has_departed);

    let current = &status.stations[1];
    assert_eq!(current.station_code, "CNB");
    assert!(current.is_current);
    assert_eq!(current.delay_minutes, Some(5));
    assert!(!current.has_departed);
    assert_eq!(current.distance_from_source, Some(1200));

    assert!(!status.stations[2].has_departed);
}

#[test]
fn leaves_station_names_empty_for_the_name_lookup_layer() {
    let status = map_wimt_payload(&wimt_raw(), &assemble_options()).expect("maps");
    assert_eq!(status.stations[0].station_name, "");
    assert_eq!(status.source_station_name, "");
}

#[test]
fn reports_not_found_for_an_empty_schedule() {
    let mut raw = wimt_raw();
    raw["days_schedule"] = json!([]);
    let err = map_wimt_payload(&raw, &assemble_options()).expect_err("must be not-found");
    assert!(matches!(err, ProviderError::NotFound { .. }));
}

#[test]
fn reports_an_upstream_error_when_days_schedule_is_missing() {
    let err = map_wimt_payload(&json!({ "start_date": "02-08-2026" }), &assemble_options())
        .expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn builds_the_expected_url_and_returns_mapped_status() {
    let mut transport = MockTransport::new();
    transport.push_json(ENDPOINT_PATH, &wimt_raw());
    let transport = Arc::new(transport);
    let provider = WhereIsMyTrainProvider::new(transport.clone());

    let status = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(provider.fetch_train_status(
            "12301",
            "20260806",
            &ProviderFetchOptions::default(),
            Some(&known_train()),
        ))
        .expect("fetch");

    assert_eq!(status.current_station_code.as_deref(), Some("CNB"));
    let url = &transport.requests()[0].url;
    let parsed = url::Url::parse(url).expect("valid url");
    assert_eq!(
        parsed.origin().ascii_serialization(),
        "https://whereismytrain.in"
    );
    assert_eq!(parsed.path(), "/cache/live_status");
    let query: Vec<(String, String)> = parsed.query_pairs().into_owned().collect();
    assert!(query.contains(&("train_no".to_string(), "12301".to_string())));
    assert!(query.contains(&("date".to_string(), "06-08-2026".to_string())));
    assert!(query.contains(&("lang".to_string(), "en".to_string())));
}

#[test]
fn rejects_an_unsupported_date() {
    let provider = create_whereismytrain_provider(Arc::new(MockTransport::new()));
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
