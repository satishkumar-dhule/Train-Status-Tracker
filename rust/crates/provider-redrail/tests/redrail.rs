//! Port of the RedRail (RedBus Rail) live-status adapter, with the fetch leg
//! driven through [`MockTransport`]. Fixtures mirror the live payload captured
//! for train 12301 (10-Aug-2026).

use std::sync::Arc;

use serde_json::{json, Value};
use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::MockTransport;
use tt_provider_redrail::{
    create_redrail_provider, map_redrail_payload, to_redrail_date, RedRailProvider,
};

const ENDPOINT_PATH: &str = "/api/Rails/v2/RIS/GetLiveTrainStatus";

fn redrail_raw() -> Value {
    json!({
        "trainNumber": "12301",
        "trainName": "RAJDHANI EXPRES",
        "consideredRunningDate": "20260810",
        "currentlyAt": "HOWRAH JN",
        "currentlyAtCode": "HWH",
        "runningStatus": {
            "header": "SCHEDULED",
            "status": "Scheduled",
            "runningStatusMessage": "Scheduled to depart"
        },
        "totalLateMins": 0,
        "ltsLastUpdatedTime": "3:43 PM August 10",
        "stations": [
            {
                "stationName": "HOWRAH JN",
                "stationCode": "HWH",
                "distanceFromOrigin": "0 kms",
                "platform": "PLATFORM 9",
                "scheduledArrivalTime": "SOURCE",
                "arrivalTime": "SOURCE",
                "scheduledDepartureTime": "16:50",
                "departureTime": "16:50",
                "dayCount": 1,
                "arrivalDate": "20260810",
                "departureDate": "20260810",
                "delayArr": 0,
                "delayDep": 0,
                "hasArrived": false,
                "hasDeparted": false
            },
            {
                "stationName": "ASANSOL JN.",
                "stationCode": "ASN",
                "distanceFromOrigin": "200 kms",
                "platform": "PLATFORM 4",
                "scheduledArrivalTime": "18:47",
                "arrivalTime": "18:57",
                "scheduledDepartureTime": "18:49",
                "departureTime": "19:02",
                "dayCount": 1,
                "arrivalDate": "20260810",
                "departureDate": "20260810",
                "delayArr": 10,
                "delayDep": 13,
                "hasArrived": false,
                "hasDeparted": false
            },
            {
                "stationName": "NEW DELHI",
                "stationCode": "NDLS",
                "distanceFromOrigin": "1449 kms",
                "platform": "PLATFORM 14",
                "scheduledArrivalTime": "10:05",
                "arrivalTime": "10:07",
                "scheduledDepartureTime": "DESTINATION",
                "departureTime": "DESTINATION",
                "dayCount": 2,
                "arrivalDate": "20260811",
                "departureDate": "20260811",
                "delayArr": 2,
                "delayDep": 3,
                "hasArrived": false,
                "hasDeparted": false
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
fn to_redrail_date_converts_yyyymmdd_to_iso() {
    assert_eq!(to_redrail_date("20260810"), Some("2026-08-10".to_string()));
}

#[test]
fn to_redrail_date_returns_none_for_malformed_dates() {
    assert_eq!(to_redrail_date("2026-08-10"), None);
    assert_eq!(to_redrail_date("notadate"), None);
}

#[test]
fn maps_a_full_payload() {
    let status = map_redrail_payload(&redrail_raw(), &assemble_options()).expect("maps");

    assert_eq!(status.train_number, "12301");
    assert_eq!(status.train_name, "Rajdhani Express");
    assert_eq!(status.source_station_code, "HWH");
    assert_eq!(status.destination_station_code, "NDLS");
    assert_eq!(status.current_station_code.as_deref(), Some("HWH"));
    assert_eq!(
        status.status_message.as_deref(),
        Some("Scheduled to depart")
    );
    assert_eq!(status.stations.len(), 3);

    let first = &status.stations[0];
    assert_eq!(first.station_code, "HWH");
    assert!(first.is_current);
    assert_eq!(first.scheduled_arrival, None);
    assert_eq!(first.scheduled_departure.as_deref(), Some("16:50"));
    assert_eq!(first.actual_departure.as_deref(), Some("16:50"));
    assert_eq!(first.platform.as_deref(), Some("9"));
    assert_eq!(first.delay_minutes, Some(0));
    assert_eq!(first.distance_from_source, Some(0));

    let second = &status.stations[1];
    assert_eq!(second.station_code, "ASN");
    assert_eq!(second.scheduled_arrival.as_deref(), Some("18:47"));
    assert_eq!(second.actual_arrival.as_deref(), Some("18:57"));
    assert_eq!(second.scheduled_departure.as_deref(), Some("18:49"));
    assert_eq!(second.actual_departure.as_deref(), Some("19:02"));
    assert_eq!(second.delay_minutes, Some(10));
    assert_eq!(second.distance_from_source, Some(200));
    assert_eq!(second.platform.as_deref(), Some("4"));

    let last = &status.stations[2];
    assert_eq!(last.scheduled_arrival.as_deref(), Some("10:05"));
    assert_eq!(last.scheduled_departure, None);
    assert_eq!(last.day, 2);
    assert_eq!(last.distance_from_source, Some(1449));
}

#[test]
fn drops_stations_without_a_station_code() {
    let mut raw = redrail_raw();
    raw["stations"] = json!([{ "stationName": "ghost" }, redrail_raw()["stations"][0]]);
    let status = map_redrail_payload(&raw, &assemble_options()).expect("maps");
    assert_eq!(status.stations.len(), 1);
}

#[test]
fn reports_upstream_error_when_shape_is_missing() {
    let err = map_redrail_payload(
        &json!({ "trainNumber": "12301" }),
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
fn issues_a_get_with_query_params_headers_and_returns_mapped_status() {
    let mut transport = MockTransport::new();
    transport.push_json(ENDPOINT_PATH, &redrail_raw());
    let transport = Arc::new(transport);
    let provider = RedRailProvider::new(transport.clone());

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
    assert_eq!(query.get("trainNo").map(String::as_str), Some("12301"));
    assert_eq!(query.get("date").map(String::as_str), Some("2026-08-10"));

    let headers: std::collections::HashMap<_, _> = request
        .headers
        .iter()
        .map(|(k, v)| (k.to_lowercase(), v.to_lowercase()))
        .collect();
    assert_eq!(headers.get("country_name").map(String::as_str), Some("ind"));
    assert_eq!(
        headers.get("channel_name").map(String::as_str),
        Some("mobile_app")
    );
}

#[test]
fn rejects_an_unsupported_date() {
    let provider = create_redrail_provider(Arc::new(MockTransport::new()));
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
