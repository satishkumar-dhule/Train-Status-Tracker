//! Port of `providers/normalize.test.ts` + wire-conversion golden tests.

use tt_mapper::{
    assemble_mapped_status, compute_row_current_serial, to_mapped_station, to_wire_status,
    AssembleOptions, KnownTrain, ProviderStationRow,
};

fn row(overrides: Option<&dyn Fn(&mut ProviderStationRow)>) -> ProviderStationRow {
    let mut row = ProviderStationRow {
        station_code: "NDLS".to_string(),
        station_name: "New Delhi".to_string(),
        scheduled_arrival: Some("08:00".to_string()),
        actual_arrival: Some("08:20".to_string()),
        scheduled_departure: Some("08:05".to_string()),
        actual_departure: None,
        has_departed: None,
        delay_minutes: None,
        distance: Some(391),
        platform: Some("5".to_string()),
        halt_minutes: Some(5),
        day: Some(1),
    };
    if let Some(f) = overrides {
        f(&mut row);
    }
    row
}

fn station_row(code: &str) -> ProviderStationRow {
    let mut r = row(None);
    r.station_code = code.to_string();
    r
}

#[test]
fn compute_row_current_serial_returns_1_based_position() {
    let rows = [station_row("ADI"), station_row("NDLS")];
    assert_eq!(compute_row_current_serial(&rows, Some("NDLS")), 2);
}

#[test]
fn compute_row_current_serial_returns_0_when_no_match() {
    assert_eq!(compute_row_current_serial(&[row(None)], Some("BPL")), 0);
}

#[test]
fn compute_row_current_serial_returns_0_for_null_code() {
    assert_eq!(compute_row_current_serial(&[row(None)], None), 0);
}

#[test]
fn to_mapped_station_maps_a_fully_populated_row() {
    let mapped = to_mapped_station(&row(None), 0, Some("NDLS"), 1);
    assert_eq!(mapped.station_code, "NDLS");
    assert_eq!(mapped.station_name, "New Delhi");
    assert_eq!(mapped.scheduled_arrival.as_deref(), Some("08:00"));
    assert_eq!(mapped.actual_arrival.as_deref(), Some("08:20"));
    assert_eq!(mapped.scheduled_departure.as_deref(), Some("08:05"));
    assert_eq!(mapped.actual_departure, None);
    assert_eq!(mapped.delay_minutes, Some(20));
    assert_eq!(mapped.distance_from_source, Some(391));
    assert_eq!(mapped.platform.as_deref(), Some("5"));
    assert_eq!(mapped.halt_minutes, Some(5));
    assert!(!mapped.has_departed);
    assert!(mapped.is_current);
    assert_eq!(mapped.day, 1);
}

#[test]
fn to_mapped_station_applies_defaults_for_missing_fields() {
    let mut r = row(None);
    r.distance = None;
    let mapped = to_mapped_station(&r, 5, None, 0);
    assert_eq!(mapped.station_code, "NDLS");
    assert_eq!(mapped.delay_minutes, Some(20));
    assert_eq!(mapped.distance_from_source, None);
    assert!(!mapped.has_departed);
    assert!(!mapped.is_current);
    assert_eq!(mapped.day, 1);
}

#[test]
fn marks_rows_before_the_current_serial_as_departed() {
    let mut r = row(None);
    r.actual_departure = None;
    let mapped = to_mapped_station(&r, 0, Some("NDLS"), 4);
    assert!(mapped.has_departed);
}

#[test]
fn keeps_future_rows_undeparted() {
    let mut r = row(None);
    r.actual_departure = None;
    let mapped = to_mapped_station(&r, 5, Some("NDLS"), 4);
    assert!(!mapped.has_departed);
}

#[test]
fn marks_current_station_departed_only_once_it_has_left() {
    let mut at_station = row(None);
    at_station.actual_departure = None;
    let at_station = to_mapped_station(&at_station, 3, Some("NDLS"), 4);
    assert!(!at_station.has_departed);

    let mut departed = row(None);
    departed.actual_departure = Some("08:05".to_string());
    let departed = to_mapped_station(&departed, 3, Some("NDLS"), 4);
    assert!(departed.has_departed);
}

#[test]
fn honors_explicit_has_departed_flag() {
    let mut r = row(None);
    r.has_departed = Some(true);
    let mapped = to_mapped_station(&r, 5, Some("NDLS"), 4);
    assert!(mapped.has_departed);
}

#[test]
fn uses_explicit_delay_minutes_over_computed_delay() {
    let mut r = row(None);
    r.delay_minutes = Some(99);
    let mapped = to_mapped_station(&r, 0, None, 0);
    assert_eq!(mapped.delay_minutes, Some(99));
}

#[test]
fn falls_back_to_null_for_a_missing_distance() {
    let mut r = row(None);
    r.distance = None;
    let mapped = to_mapped_station(&r, 0, None, 0);
    assert_eq!(mapped.distance_from_source, None);
}

#[test]
fn keeps_a_zero_distance() {
    let mut r = row(None);
    r.distance = Some(0);
    let mapped = to_mapped_station(&r, 0, None, 0);
    assert_eq!(mapped.platform.as_deref(), Some("5"));
    assert_eq!(mapped.distance_from_source, Some(0));
}

fn assemble_rows() -> Vec<ProviderStationRow> {
    let mut source = station_row("ADI");
    source.station_name = "Ahmedabad Jn".to_string();
    source.distance = Some(0);
    let mut current = station_row("NDLS");
    current.station_name = "New Delhi".to_string();
    current.distance = Some(938);
    current.day = Some(2);
    vec![source, current]
}

#[test]
fn assemble_maps_full_status() {
    let status = assemble_mapped_status(
        &assemble_rows(),
        &AssembleOptions {
            train_number: "12301".to_string(),
            departure_date: "20260805".to_string(),
            known_train: Some(KnownTrain {
                number: "12301".to_string(),
                name: "Howrah Rajdhani Express".to_string(),
            }),
            current_station_code: Some("NDLS".to_string()),
            status_message: Some("Running <b>on time</b>".to_string()),
            last_updated: Some("2026-08-05T12:00:00Z".to_string()),
        },
    );
    assert_eq!(status.train_number, "12301");
    assert_eq!(status.train_name, "Howrah Rajdhani Express");
    assert_eq!(status.departure_date, "20260805");
    assert_eq!(status.source_station_code, "ADI");
    assert_eq!(status.source_station_name, "Ahmedabad Jn");
    assert_eq!(status.destination_station_code, "NDLS");
    assert_eq!(status.destination_station_name, "New Delhi");
    assert_eq!(status.current_station_code.as_deref(), Some("NDLS"));
    assert_eq!(status.current_station_name.as_deref(), Some("New Delhi"));
    assert_eq!(status.current_delay_minutes, Some(20));
    assert_eq!(status.status_message.as_deref(), Some("Running on time"));
    assert_eq!(status.last_updated.as_deref(), Some("2026-08-05T12:00:00Z"));
    assert_eq!(status.stations.len(), 2);
    assert!(status.stations[1].is_current);
    assert!(!status.stations[1].has_departed);
    assert_eq!(status.stations[1].day, 2);
    assert!(status.stations[0].has_departed);
}

#[test]
fn assemble_uses_fallback_train_name_when_unknown() {
    let status = assemble_mapped_status(
        &assemble_rows(),
        &AssembleOptions {
            train_number: "12301".to_string(),
            departure_date: "20260805".to_string(),
            ..Default::default()
        },
    );
    assert_eq!(status.train_name, "Train 12301");
}

#[test]
fn assemble_handles_empty_station_list() {
    let status = assemble_mapped_status(
        &[],
        &AssembleOptions {
            train_number: "12301".to_string(),
            departure_date: "20260805".to_string(),
            ..Default::default()
        },
    );
    assert!(status.stations.is_empty());
    assert_eq!(status.source_station_code, "");
    assert_eq!(status.current_station_code, None);
}

#[test]
fn assemble_leaves_current_station_null_when_none_matches() {
    let status = assemble_mapped_status(
        &assemble_rows(),
        &AssembleOptions {
            train_number: "12301".to_string(),
            departure_date: "20260805".to_string(),
            current_station_code: Some("ABC".to_string()),
            ..Default::default()
        },
    );
    assert_eq!(status.current_station_name, None);
    assert_eq!(status.current_delay_minutes, None);
}

#[test]
fn to_wire_status_is_identity_with_explicit_nulls() {
    let status = assemble_mapped_status(
        &assemble_rows(),
        &AssembleOptions {
            train_number: "12301".to_string(),
            departure_date: "20260805".to_string(),
            known_train: Some(KnownTrain {
                number: "12301".to_string(),
                name: "Howrah Rajdhani Express".to_string(),
            }),
            current_station_code: Some("NDLS".to_string()),
            last_updated: Some("2026-08-05T12:00:00Z".to_string()),
            ..Default::default()
        },
    );
    let wire = to_wire_status(&status);
    assert_eq!(wire.train_number, "12301");
    assert_eq!(wire.train_name, "Howrah Rajdhani Express");
    assert_eq!(wire.stations.len(), 2);
    assert_eq!(wire.stations[0].delay_minutes, Some(20));
    assert_eq!(wire.stations[0].actual_departure, None);
    assert!(wire.stations[1].is_current);

    let json = serde_json::to_value(&wire).expect("serialize wire status");
    assert_eq!(
        json.get("status_message"),
        Some(&serde_json::Value::Null),
        "nullish status_message must serialize as explicit null, not be omitted"
    );
    assert_eq!(
        json.pointer("/stations/0/actual_departure"),
        Some(&serde_json::Value::Null),
        "nullish station fields must be explicit null"
    );
}
