//! Port of `lib/providers/railyatri.test.ts`, with the fetch leg driven
//! through [`MockTransport`] and the current date injected as a fixed
//! `NaiveDate`.

use std::sync::Arc;

use chrono::NaiveDate;
use serde_json::{json, Value};
use tt_mapper::{AssembleOptions, KnownTrain};
use tt_provider_core::{ProviderError, ProviderFetchOptions, TrainStatusProvider};
use tt_provider_http::MockTransport;
use tt_provider_railyatri::{
    compute_start_day, create_railyatri_provider, map_railyatri_payload, RailYatriProvider,
};

const ENDPOINT_PATH: &str = "/api/v3/train_eta_data/12301/0.json";

fn now() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 8, 6).expect("valid date")
}

fn railyatri_raw() -> Value {
    json!({
        "success": true,
        "train_number": "12301",
        "train_name": "Howrah Rajdhani Express",
        "train_start_date": "2026-08-06",
        "update_time": "2026-08-06 13:01:00 +0530",
        "status_as_of": "As of 3 mins ago",
        "current_station_code": "CNB",
        "current_station_name": "Kanpur Central",
        "status": "A",
        "eta": "08:05",
        "etd": "08:10",
        "cur_stn_sta": "08:00",
        "cur_stn_std": "08:05",
        "delay": 5,
        "platform_number": 4,
        "distance_from_source": 1200,
        "total_distance": 1447,
        "previous_stations": [
            {
                "si_no": 1,
                "station_code": "HWH",
                "station_name": "Howrah Jn",
                "sta": "17:00",
                "std": "17:15",
                "eta": "17:00",
                "etd": "17:15",
                "arrival_delay": 0,
                "departure_delay": 0,
                "platform_number": 10,
                "distance_from_source": 0,
                "stoppage_number": 1,
                "day": 1,
            },
        ],
        "upcoming_stations": [
            {
                "si_no": 3,
                "station_code": "NDLS",
                "station_name": "New Delhi",
                "sta": "08:25",
                "std": "08:35",
                "eta": null,
                "etd": null,
                "arrival_delay": null,
                "departure_delay": null,
                "platform_number": 3,
                "distance_from_source": 1447,
                "stoppage_number": 3,
                "day": 2,
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
fn compute_start_day_returns_0_for_today() {
    assert_eq!(compute_start_day("20260806", now()).expect("today"), 0);
}

#[test]
fn compute_start_day_returns_1_for_yesterday() {
    assert_eq!(compute_start_day("20260805", now()).expect("yesterday"), 1);
}

#[test]
fn compute_start_day_rejects_dates_outside_the_window() {
    let err = compute_start_day("20260804", now()).expect_err("outside window");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn compute_start_day_rejects_malformed_dates() {
    let err = compute_start_day("bogus", now()).expect_err("malformed");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}

#[test]
fn maps_previous_current_and_upcoming_stations() {
    let status = map_railyatri_payload(&railyatri_raw(), &assemble_options()).expect("maps");

    assert_eq!(status.current_station_code.as_deref(), Some("CNB"));
    assert_eq!(
        status.current_station_name.as_deref(),
        Some("Kanpur Central")
    );
    assert_eq!(status.current_delay_minutes, Some(5));
    assert_eq!(status.status_message.as_deref(), Some("As of 3 mins ago"));
    assert_eq!(
        status.last_updated.as_deref(),
        Some("2026-08-06 13:01:00 +0530")
    );
    assert_eq!(status.stations.len(), 3);

    let first = &status.stations[0];
    assert_eq!(first.station_code, "HWH");
    assert_eq!(first.station_name, "Howrah Jn");
    assert_eq!(first.scheduled_arrival.as_deref(), Some("17:00"));
    assert_eq!(first.actual_arrival.as_deref(), Some("17:00"));
    assert_eq!(first.delay_minutes, Some(0));
    assert_eq!(first.day, 1);
    assert!(first.has_departed);

    let current = &status.stations[1];
    assert_eq!(current.station_code, "CNB");
    assert!(current.is_current);
    assert_eq!(current.platform.as_deref(), Some("4"));
    assert_eq!(current.distance_from_source, Some(1200));
    assert!(!current.has_departed);

    let upcoming = &status.stations[2];
    assert_eq!(upcoming.station_code, "NDLS");
    assert!(!upcoming.is_current);
    assert!(!upcoming.has_departed);
    assert_eq!(upcoming.platform.as_deref(), Some("3"));
    assert_eq!(status.destination_station_code, "NDLS");
}

#[test]
fn reports_not_found_when_success_is_false() {
    let err = map_railyatri_payload(
        &json!({ "success": false }),
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
fn tolerates_a_missing_current_station() {
    let mut raw = railyatri_raw();
    raw["current_station_code"] = Value::Null;
    raw["current_station_name"] = Value::Null;
    let status = map_railyatri_payload(&raw, &assemble_options()).expect("maps");
    assert_eq!(status.current_station_code, None);
    assert!(!status.stations.iter().any(|s| s.is_current));
}

#[test]
fn builds_the_expected_url_with_start_day_and_returns_mapped_status() {
    let mut transport = MockTransport::new();
    transport.push_json(ENDPOINT_PATH, &railyatri_raw());
    let transport = Arc::new(transport);
    let provider = RailYatriProvider::with_now(transport.clone(), Some(now));

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
    assert!(
        url.ends_with("/train_eta_data/12301/0.json?start_day=0"),
        "got {url}"
    );
}

#[test]
fn rejects_a_date_outside_today_yesterday() {
    let provider = create_railyatri_provider(Arc::new(MockTransport::new()), Some(now));
    let err = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(provider.fetch_train_status(
            "12301",
            "20260804",
            &ProviderFetchOptions::default(),
            None,
        ))
        .expect_err("must fail");
    assert!(matches!(err, ProviderError::Upstream { .. }));
}
