//! Port of `lib/providers/goibibo.test.ts`, with the fetch leg driven through
//! [`MockTransport`].

use std::sync::Arc;

use serde_json::{json, Value};
use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_goibibo::{
    create_goibibo_provider, map_goibibo_payload, to_goibibo_date, GoibiboProvider,
};
use tt_provider_http::MockTransport;

const ENDPOINT: &str = "https://rails-ris.makemytrip.com/api/ris/train/livestatus/v2";
const ENDPOINT_PATH: &str = "/api/ris/train/livestatus/v2";

fn goibibo_raw() -> Value {
    json!({
        "success": true,
        "response": {
            "metaDetails": {
                "curStnData": {
                    "station": { "name": "New Delhi", "code": "NDLS" },
                    "arrivalDetails": {
                        "schArrTime": "08:05",
                        "actArrTime": "08:35",
                        "arrDelay": 30,
                        "arrived": true,
                    },
                    "departureDetails": {
                        "schDepTime": "08:10",
                        "actDepTime": "08:12",
                        "depDelay": 2,
                        "departed": true,
                    },
                },
                "othrDetails": {
                    "timeDetail": "Running on time",
                    "distanceDetail": "880 km",
                    "delay": "30",
                },
            },
            "trainDetails": {
                "trainNumber": "12301",
                "trainName": "Howrah Rajdhani Express",
                "currentStation": { "name": "New Delhi", "code": "NDLS" },
            },
            "lastUpdated": "06-08-2026 12:54:00",
            "stations": [
                {
                    "Station": { "name": "Howrah Jn", "code": "HWH", "expectedPlatformNumber": 10 },
                    "HaltMinutes": 15,
                    "ArrivalDetails": {
                        "scheduledArrivalTime": "17:00",
                        "actualArrivalTime": "17:00",
                    },
                    "DepartureDetails": {
                        "scheduledDepartureTime": "17:15",
                        "actualDepartureTime": "17:15",
                    },
                    "DayDetails": { "dayCount": 1 },
                    "Distance": 0,
                },
                {
                    "Station": { "name": "New Delhi", "code": "NDLS", "expectedPlatformNumber": "3" },
                    "HaltMinutes": 10,
                    "ArrivalDetails": {
                        "scheduledArrivalTime": "08:05",
                        "actualArrivalTime": "08:35",
                    },
                    "DepartureDetails": {
                        "scheduledDepartureTime": "08:10",
                        "actualDepartureTime": null,
                        "departed": false,
                    },
                    "DayDetails": { "dayCount": 2 },
                    "Distance": 1447,
                },
            ],
        },
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
fn to_goibibo_date_converts_yyyymmdd_to_dd_mm_yyyy() {
    assert_eq!(to_goibibo_date("20260806"), Some("06-08-2026".to_string()));
}

#[test]
fn to_goibibo_date_returns_none_for_malformed_dates() {
    assert_eq!(to_goibibo_date("2026-08-06"), None);
    assert_eq!(to_goibibo_date("notadate"), None);
}

#[test]
fn maps_a_full_payload() {
    let status = map_goibibo_payload(&goibibo_raw(), &assemble_options()).expect("maps");

    assert_eq!(status.train_name, "Howrah Rajdhani Express");
    assert_eq!(status.source_station_code, "HWH");
    assert_eq!(status.destination_station_code, "NDLS");
    assert_eq!(status.current_station_code.as_deref(), Some("NDLS"));
    assert_eq!(status.current_station_name.as_deref(), Some("New Delhi"));
    assert_eq!(status.current_delay_minutes, Some(30));
    assert_eq!(status.status_message.as_deref(), Some("Running on time"));
    assert_eq!(status.last_updated.as_deref(), Some("06-08-2026 12:54:00"));
    assert_eq!(status.stations.len(), 2);

    let current = &status.stations[1];
    assert_eq!(current.station_code, "NDLS");
    assert!(current.is_current);
    assert_eq!(current.scheduled_arrival.as_deref(), Some("08:05"));
    assert_eq!(current.actual_arrival.as_deref(), Some("08:35"));
    assert_eq!(current.delay_minutes, Some(30));
    assert_eq!(current.day, 2);
    assert_eq!(current.platform.as_deref(), Some("3"));
    assert_eq!(current.distance_from_source, Some(1447));
    assert!(!current.has_departed);

    let first = &status.stations[0];
    assert!(first.has_departed);
    assert_eq!(first.halt_minutes, Some(15));
}

#[test]
fn reports_not_found_when_success_is_not_true() {
    let err = map_goibibo_payload(
        &json!({ "success": false, "error": {} }),
        &AssembleOptions {
            train_number: "1".to_string(),
            departure_date: "20260806".to_string(),
            ..AssembleOptions::default()
        },
    )
    .expect_err("must be not-found");
    assert!(matches!(err, ProviderError::NotFound { .. }));
}

#[test]
fn reports_upstream_error_when_response_shape_is_missing() {
    let err = map_goibibo_payload(
        &json!({ "success": true }),
        &AssembleOptions {
            train_number: "1".to_string(),
            departure_date: "20260806".to_string(),
            ..AssembleOptions::default()
        },
    )
    .expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn tolerates_a_malformed_station_entry() {
    let raw = json!({
        "success": true,
        "response": { "stations": [
            { "broken": true },
            goibibo_raw()["response"]["stations"][0],
            goibibo_raw()["response"]["stations"][1],
        ] },
    });
    let status = map_goibibo_payload(&raw, &assemble_options()).expect("maps");
    assert_eq!(status.stations.len(), 2);
}

#[test]
fn posts_the_expected_body_and_returns_mapped_status() {
    let mut transport = MockTransport::new();
    transport.push_json(ENDPOINT_PATH, &goibibo_raw());
    let transport = Arc::new(transport);
    let provider = GoibiboProvider::new(transport.clone());

    let status = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(provider.fetch_train_status(
            "12301",
            "20260806",
            &ProviderFetchOptions::default(),
            Some(&known_train()),
        ))
        .expect("fetch");

    assert_eq!(status.current_station_code.as_deref(), Some("NDLS"));

    let request = &transport.requests()[0];
    assert_eq!(request.method.as_str(), "POST");
    assert_eq!(request.url, ENDPOINT);
    let body: Value =
        serde_json::from_slice(request.body.as_deref().expect("body set")).expect("valid json");
    assert_eq!(
        body,
        json!({
            "trainNumber": "12301",
            "dateOfJourney": "06-08-2026",
            "findNextRunningDate": true,
        })
    );
}

#[test]
fn rejects_an_unsupported_date() {
    let provider = create_goibibo_provider(Arc::new(MockTransport::new()));
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
