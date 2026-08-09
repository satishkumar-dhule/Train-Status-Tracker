//! Port of `lib/providers/railradar.test.ts`, with the fetch leg driven
//! through [`MockTransport`].

use std::sync::Arc;

use serde_json::{json, Value};
use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::MockTransport;
use tt_provider_railradar::{
    create_railradar_provider, map_railradar_payload, to_railradar_date, RailRadarProvider,
};

const ENDPOINT_PATH: &str = "/rest/v1/trains/status";

fn railradar_raw() -> Value {
    json!({
        "success": true,
        "data": {
            "trainNumber": "12301",
            "trainName": "Howrah Rajdhani Express",
            "startDate": "2026-08-06",
            "lastUpdatedAt": "2026-08-06T13:00:00+05:30",
            "status": "Running on time",
            "delayMinutes": 0,
            "train": {
                "source": { "code": "HWH", "name": "Howrah Jn" },
                "destination": { "code": "NDLS", "name": "New Delhi" },
            },
            "currentLocation": { "stationCode": "CNB", "sequence": 2, "status": "arrived" },
            "route": [
                {
                    "sequence": 1,
                    "stationCode": "HWH",
                    "stationName": "Howrah Jn",
                    "isHalt": true,
                    "scheduledArrival": "2026-08-06T17:00:00+05:30",
                    "scheduledDeparture": "2026-08-06T17:15:00+05:30",
                    "actualArrival": "2026-08-06T17:00:00+05:30",
                    "actualDeparture": "2026-08-06T17:15:00+05:30",
                    "delayArrival": 0,
                    "delayDeparture": 0,
                    "status": "departed",
                    "distance": 0,
                    "platform": "10",
                },
                {
                    "sequence": 2,
                    "stationCode": "CNB",
                    "stationName": "Kanpur Central",
                    "isHalt": true,
                    "scheduledArrival": "2026-08-06T08:00:00+05:30",
                    "scheduledDeparture": "2026-08-06T08:05:00+05:30",
                    "actualArrival": "2026-08-06T08:05:00+05:30",
                    "actualDeparture": null,
                    "delayArrival": 5,
                    "delayDeparture": 5,
                    "status": "arrived",
                    "distance": 1200,
                    "platform": "4",
                },
                {
                    "sequence": 3,
                    "stationCode": "NDLS",
                    "stationName": "New Delhi",
                    "isHalt": true,
                    "scheduledArrival": "2026-08-06T08:25:00+05:30",
                    "scheduledDeparture": "2026-08-06T08:35:00+05:30",
                    "actualArrival": null,
                    "actualDeparture": null,
                    "delayArrival": null,
                    "delayDeparture": null,
                    "status": "scheduled",
                    "distance": 1447,
                    "platform": null,
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
fn to_railradar_date_converts_yyyymmdd_to_dd_mm_yyyy() {
    assert_eq!(to_railradar_date("20260806").as_deref(), Some("06-08-2026"));
}

#[test]
fn to_railradar_date_returns_none_for_a_malformed_date() {
    assert_eq!(to_railradar_date("bogus"), None);
}

#[test]
fn maps_the_route_into_stations() {
    let status = map_railradar_payload(&railradar_raw(), &assemble_options()).expect("maps");

    assert_eq!(status.current_station_code.as_deref(), Some("CNB"));
    assert_eq!(status.status_message.as_deref(), Some("Running on time"));
    assert_eq!(
        status.last_updated.as_deref(),
        Some("2026-08-06T13:00:00+05:30")
    );
    assert_eq!(status.stations.len(), 3);

    let first = &status.stations[0];
    assert_eq!(first.station_code, "HWH");
    assert_eq!(first.station_name, "Howrah Jn");
    assert_eq!(first.scheduled_arrival.as_deref(), Some("17:00"));
    assert_eq!(first.actual_departure.as_deref(), Some("17:15"));
    assert_eq!(first.delay_minutes, Some(0));
    assert_eq!(first.platform.as_deref(), Some("10"));
    assert!(first.has_departed);

    let current = &status.stations[1];
    assert_eq!(current.station_code, "CNB");
    assert!(current.is_current);
    assert_eq!(current.delay_minutes, Some(5));
    assert!(!current.has_departed);

    let last = &status.stations[2];
    assert_eq!(last.station_code, "NDLS");
    assert_eq!(last.scheduled_arrival.as_deref(), Some("08:25"));
    assert!(!last.has_departed);
    assert_eq!(last.delay_minutes, None);
}

#[test]
fn reports_not_found_on_a_not_found_error_code() {
    let err = map_railradar_payload(
        &json!({ "success": false, "error": { "code": "NOT_FOUND", "message": "Train not found" } }),
        &assemble_options(),
    )
    .expect_err("must be not-found");
    assert!(matches!(err, ProviderError::NotFound { .. }));
}

#[test]
fn reports_an_upstream_error_on_other_failures() {
    let err = map_railradar_payload(
        &json!({ "success": false, "error": { "code": "INTERNAL", "message": "boom" } }),
        &assemble_options(),
    )
    .expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn reports_an_upstream_error_when_the_response_shape_is_missing() {
    let err = map_railradar_payload(&json!({ "success": true, "data": {} }), &assemble_options())
        .expect_err("must be upstream");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn is_disabled_without_an_api_key_and_enabled_with_one() {
    let transport = Arc::new(MockTransport::new());
    assert!(!create_railradar_provider(transport.clone(), None).enabled());
    assert!(create_railradar_provider(transport, Some("secret".to_string())).enabled());
}

#[test]
fn sends_the_api_key_header_and_builds_the_expected_url() {
    let mut transport = MockTransport::new();
    transport.push_json(ENDPOINT_PATH, &railradar_raw());
    let transport = Arc::new(transport);
    let provider = RailRadarProvider::new(transport.clone(), Some("secret-key".to_string()));

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
    let request = &transport.requests()[0];
    assert_eq!(
        request
            .headers
            .iter()
            .find(|(name, _)| name == "x-api-key")
            .map(|(_, value)| value.as_str()),
        Some("secret-key")
    );
    let parsed = url::Url::parse(&request.url).expect("valid url");
    let query: Vec<(String, String)> = parsed.query_pairs().into_owned().collect();
    assert!(query.contains(&("trainNumber".to_string(), "12301".to_string())));
    assert!(query.contains(&("dateOfJourney".to_string(), "06-08-2026".to_string())));
}

#[test]
fn rejects_an_unsupported_date() {
    let provider =
        create_railradar_provider(Arc::new(MockTransport::new()), Some("key".to_string()));
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
