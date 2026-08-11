//! Port of the trainspnrstatus.com live-status adapter, with the fetch leg
//! driven through [`MockTransport`]. The upstream is Cloudflare
//! Turnstile-guarded from this sandbox (Tier C), so the fixture is built from
//! the documented payload shape (their React bundle) rather than a live
//! capture: top-level train name/number, a running-day message, and a station
//! table for train 12301 (HWH, ASN, NDLS).

use std::sync::Arc;

use serde_json::{json, Value};
use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::MockTransport;
use tt_provider_trainspnrstatus::{
    create_trainspnrstatus_provider, map_trainspnrstatus_payload, to_trainspnrstatus_date,
    TrainSpnrStatusProvider,
};

const ENDPOINT_PATH: &str = "/api/fetch-live-status";

fn trainspnrstatus_raw() -> Value {
    json!({
        "trainNumber": "12301",
        "trainName": "RAJDHANI EXPRES",
        "currentStationCode": "HWH",
        "message": "Scheduled to depart",
        "lastUpdated": "10 Aug 2026 16:45",
        "stations": [
            {
                "stationCode": "HWH",
                "stationName": "HOWRAH JN",
                "scheduledArrival": "",
                "actualArrival": "",
                "scheduledDeparture": "16:50",
                "actualDeparture": "16:50",
                "platform": "9",
                "day": 1
            },
            {
                "stationCode": "ASN",
                "stationName": "ASANSOL JN.",
                "scheduledArrival": "18:47",
                "actualArrival": "18:57",
                "scheduledDeparture": "18:49",
                "actualDeparture": "19:02",
                "platform": "4",
                "day": 1
            },
            {
                "stationCode": "NDLS",
                "stationName": "NEW DELHI",
                "scheduledArrival": "10:05",
                "actualArrival": "10:07",
                "scheduledDeparture": "",
                "actualDeparture": "",
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
fn to_trainspnrstatus_date_converts_yyyymmdd_to_iso() {
    assert_eq!(
        to_trainspnrstatus_date("20260810"),
        Some("2026-08-10".to_string())
    );
}

#[test]
fn to_trainspnrstatus_date_returns_none_for_malformed_dates() {
    assert_eq!(to_trainspnrstatus_date("2026-08-10"), None);
    assert_eq!(to_trainspnrstatus_date("notadate"), None);
}

#[test]
fn maps_a_full_payload() {
    let status =
        map_trainspnrstatus_payload(&trainspnrstatus_raw(), &assemble_options()).expect("maps");

    assert_eq!(status.train_number, "12301");
    assert_eq!(status.train_name, "Rajdhani Express");
    assert_eq!(status.source_station_code, "HWH");
    assert_eq!(status.destination_station_code, "NDLS");
    assert_eq!(status.current_station_code.as_deref(), Some("HWH"));
    assert_eq!(
        status.status_message.as_deref(),
        Some("Scheduled to depart")
    );
    assert_eq!(status.last_updated.as_deref(), Some("10 Aug 2026 16:45"));
    assert_eq!(status.stations.len(), 3);

    let first = &status.stations[0];
    assert_eq!(first.station_code, "HWH");
    assert!(first.is_current);
    assert_eq!(first.scheduled_arrival, None);
    assert_eq!(first.scheduled_departure.as_deref(), Some("16:50"));
    assert_eq!(first.actual_departure.as_deref(), Some("16:50"));
    assert_eq!(first.platform.as_deref(), Some("9"));
    assert_eq!(first.delay_minutes, None);

    let second = &status.stations[1];
    assert_eq!(second.station_code, "ASN");
    assert_eq!(second.scheduled_arrival.as_deref(), Some("18:47"));
    assert_eq!(second.actual_arrival.as_deref(), Some("18:57"));
    assert_eq!(second.scheduled_departure.as_deref(), Some("18:49"));
    assert_eq!(second.actual_departure.as_deref(), Some("19:02"));
    assert_eq!(second.delay_minutes, Some(10));
    assert_eq!(second.platform.as_deref(), Some("4"));
    assert_eq!(second.day, 1);

    let last = &status.stations[2];
    assert_eq!(last.station_code, "NDLS");
    assert_eq!(last.scheduled_arrival.as_deref(), Some("10:05"));
    assert_eq!(last.actual_arrival.as_deref(), Some("10:07"));
    assert_eq!(last.scheduled_departure, None);
    assert_eq!(last.actual_departure, None);
    assert_eq!(last.delay_minutes, Some(2));
    assert_eq!(last.platform.as_deref(), Some("14"));
    assert_eq!(last.day, 2);
}

#[test]
fn infers_current_station_from_last_actual_departure() {
    let mut raw = trainspnrstatus_raw();
    raw.as_object_mut()
        .expect("object")
        .remove("currentStationCode");
    let status = map_trainspnrstatus_payload(&raw, &assemble_options()).expect("maps");
    assert_eq!(status.current_station_code.as_deref(), Some("ASN"));
}

#[test]
fn tolerates_a_malformed_station_entry() {
    let mut raw = trainspnrstatus_raw();
    raw["stations"] = json!([{ "broken": true }, trainspnrstatus_raw()["stations"][0]]);
    let status = map_trainspnrstatus_payload(&raw, &assemble_options()).expect("maps");
    assert_eq!(status.stations.len(), 1);
}

#[test]
fn reports_upstream_error_when_shape_is_missing() {
    let err = map_trainspnrstatus_payload(
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
fn issues_a_post_with_json_body_and_returns_mapped_status() {
    let mut transport = MockTransport::new();
    transport.push_json(ENDPOINT_PATH, &trainspnrstatus_raw());
    let transport = Arc::new(transport);
    let provider = TrainSpnrStatusProvider::new(transport.clone());

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
    assert_eq!(status.current_station_code.as_deref(), Some("HWH"));

    let request = &transport.requests()[0];
    assert_eq!(request.method.as_str(), "POST");
    let parsed = url::Url::parse(&request.url).expect("valid url");
    assert_eq!(parsed.path(), ENDPOINT_PATH);
    assert_eq!(
        request.header_value("content-type"),
        Some("application/json")
    );
    let body: Value =
        serde_json::from_slice(request.body.as_deref().expect("has body")).expect("body is JSON");
    assert_eq!(body["train_no"], "12301");
    assert_eq!(body["date"], "2026-08-10");
}

#[test]
fn rejects_an_unsupported_date() {
    let provider = create_trainspnrstatus_provider(Arc::new(MockTransport::new()));
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
