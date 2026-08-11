//! Map an untrusted IndianRailAPI live-status body to a [`MappedStatus`].
//!
//! The vendor-documented payload shape (see `docs/providers-research.md` §4.1):
//! top-level `TrainName`, `CurrentStationCode`, `CurrentStationName`,
//! `DelayInMin`, `UpdateTime`, and a `Data` array with per-station
//! `StationCode`, `StationName`, `ScheduleArrival`, `ScheduleDeparture`,
//! `ActualArrival`, `ActualDeparture`, `Delay`, `DayCount`, `Distance`,
//! `Platform`. The API is key-gated; the fixture is constructed from the
//! documented shape for train 12301 (HWH → ASN → NDLS).

use serde_json::Value;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus, ProviderStationRow};
use tt_provider_core::{
    as_nullable_string, as_string, is_record, to_finite_number, to_nullable_int, ProviderError,
};

/// `YYYYMMDD` passthrough: `Some(departure_date)` only when it is 8 digits.
pub fn to_indianrailapi_date(departure_date: &str) -> Option<String> {
    if departure_date.len() == 8 && departure_date.bytes().all(|b| b.is_ascii_digit()) {
        Some(departure_date.to_string())
    } else {
        None
    }
}

/// A `HH:mm` time (24h), else `None`. Blank and non-time strings are absent.
fn nullable_time(value: Option<&Value>) -> Option<String> {
    let time = as_nullable_string(value)?;
    let time = time.trim();
    if time.len() == 5
        && time.as_bytes().get(2) == Some(&b':')
        && time.as_bytes()[0].is_ascii_digit()
        && time.as_bytes()[1].is_ascii_digit()
        && time.as_bytes()[3].is_ascii_digit()
        && time.as_bytes()[4].is_ascii_digit()
    {
        Some(time.to_string())
    } else {
        None
    }
}

/// Map an untrusted IndianRailAPI live-status body to a `MappedStatus`.
///
/// Error taxonomy: a body with no parseable stations is an upstream error;
/// there is no positively-confirmed not-found signal in the vendor shape, so
/// nothing maps to `NotFound`.
pub fn map_indianrailapi_payload(
    raw: &Value,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    if !is_record(Some(raw)) {
        return Err(ProviderError::upstream(
            "indianrailapi",
            "Unexpected response shape",
        ));
    }

    let Some(raw_stations) = raw.get("Data").and_then(Value::as_array) else {
        return Err(ProviderError::upstream(
            "indianrailapi",
            "Unexpected response shape",
        ));
    };

    let rows: Vec<ProviderStationRow> = raw_stations
        .iter()
        .filter(|entry| is_record(Some(*entry)))
        .filter_map(|entry| {
            let station_code = as_string(entry.get("StationCode"));
            if station_code.is_empty() {
                return None;
            }
            Some(ProviderStationRow {
                station_code,
                station_name: as_string(entry.get("StationName")),
                scheduled_arrival: nullable_time(entry.get("ScheduleArrival")),
                actual_arrival: nullable_time(entry.get("ActualArrival")),
                scheduled_departure: nullable_time(entry.get("ScheduleDeparture")),
                actual_departure: nullable_time(entry.get("ActualDeparture")),
                has_departed: None,
                delay_minutes: to_nullable_int(entry.get("Delay")),
                distance: to_nullable_int(entry.get("Distance")),
                platform: as_nullable_string(entry.get("Platform"))
                    .filter(|p| !p.is_empty() && p != "--"),
                halt_minutes: None,
                day: to_finite_number(entry.get("DayCount")).map(|n| n as i64),
            })
        })
        .collect();

    if rows.is_empty() {
        return Err(ProviderError::upstream(
            "indianrailapi",
            "No stations parsed from IndianRailAPI response",
        ));
    }

    let current_station_code = as_nullable_string(raw.get("CurrentStationCode"));
    let status_message = as_nullable_string(raw.get("CurrentStationName"));

    Ok(assemble_mapped_status(
        &rows,
        &AssembleOptions {
            train_number: options.train_number.clone(),
            departure_date: options.departure_date.clone(),
            known_train: options.known_train.clone(),
            current_station_code,
            status_message,
            last_updated: as_nullable_string(raw.get("UpdateTime")),
        },
    ))
}
