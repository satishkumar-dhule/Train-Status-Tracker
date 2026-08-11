//! Map an untrusted railbeeps (NDTV) live-status body to a [`MappedStatus`].
//!
//! The upstream endpoint (`api.railbeeps.com/api/getRunningStatus/...`) is a
//! long-lived NDTV backend whose JSON shape is documented in
//! `docs/providers-research.md` §5.4 but could not be captured live from this
//! sandbox (no public DNS for the host). The station array is therefore read
//! defensively: the first array found under a documented key (`data`,
//! `station`, `stations`, or a top-level array) is used, and per-station fields
//! are read with the shared parse helpers so any shape drift degrades to
//! `None`/empty rather than a panic.

use serde_json::Value;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus, ProviderStationRow};
use tt_provider_core::{
    as_nullable_string, as_string, is_record, to_finite_number, to_nullable_int, ProviderError,
};

/// `YYYYMMDD` → `D MMM`, e.g. `20260810` → `10 Aug`. Returns `None` when the
/// input is not a valid 8-digit date.
pub fn to_railbeeps_date(departure_date: &str) -> Option<String> {
    if departure_date.len() == 8 && departure_date.bytes().all(|b| b.is_ascii_digit()) {
        let day = &departure_date[6..8];
        let month = &departure_date[4..6];
        let month = match month {
            "01" => "Jan",
            "02" => "Feb",
            "03" => "Mar",
            "04" => "Apr",
            "05" => "May",
            "06" => "Jun",
            "07" => "Jul",
            "08" => "Aug",
            "09" => "Sep",
            "10" => "Oct",
            "11" => "Nov",
            "12" => "Dec",
            _ => return None,
        };
        Some(format!("{} {month}", day.parse::<u8>().ok()?))
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

/// The station array of the payload: the first array found under a documented
/// key, else the top-level array, else `None`.
fn station_array(raw: &Value) -> Option<&Vec<Value>> {
    for key in ["data", "station", "stations", "trainStations"] {
        if let Some(array) = raw.get(key).and_then(Value::as_array) {
            return Some(array);
        }
    }
    raw.as_array()
}

/// The first non-`None` value among `keys` (unknown/missing keys are `None`).
fn first<'a>(entry: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|key| entry.get(*key))
}

/// Map an untrusted railbeeps live-status body to a `MappedStatus`.
///
/// Error taxonomy: a body with no parseable station array (or no parseable
/// station rows) is an upstream error; there is no positively-confirmed
/// not-found signal in the documented shape, so nothing maps to `NotFound`.
pub fn map_railbeeps_payload(
    raw: &Value,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    if !is_record(Some(raw)) {
        return Err(ProviderError::upstream(
            "railbeeps",
            "Unexpected response shape",
        ));
    }

    let Some(raw_stations) = station_array(raw) else {
        return Err(ProviderError::upstream(
            "railbeeps",
            "Unexpected response shape",
        ));
    };

    let rows: Vec<ProviderStationRow> = raw_stations
        .iter()
        .filter(|entry| is_record(Some(*entry)))
        .filter_map(|entry| {
            let station_code = as_string(first(entry, &["stationCode", "StationCode", "code"]));
            if station_code.is_empty() {
                return None;
            }
            Some(ProviderStationRow {
                station_code,
                station_name: as_string(first(entry, &["stationName", "StationName", "name"])),
                scheduled_arrival: nullable_time(first(entry, &["scheduledArrival", "schArr"])),
                actual_arrival: nullable_time(first(entry, &["actualArrival", "actArr"])),
                scheduled_departure: nullable_time(first(entry, &["scheduledDeparture", "schDep"])),
                actual_departure: nullable_time(first(entry, &["actualDeparture", "actDep"])),
                has_departed: None,
                delay_minutes: to_nullable_int(first(entry, &["delay", "Delay"])),
                distance: to_nullable_int(first(entry, &["distance", "Distance"])),
                platform: as_nullable_string(first(entry, &["platform", "Platform"]))
                    .filter(|p| !p.is_empty() && p != "--"),
                halt_minutes: None,
                day: to_finite_number(first(entry, &["day", "DayCount", "dayCount"]))
                    .map(|n| n as i64),
            })
        })
        .collect();

    if rows.is_empty() {
        return Err(ProviderError::upstream(
            "railbeeps",
            "No stations parsed from railbeeps response",
        ));
    }

    Ok(assemble_mapped_status(
        &rows,
        &AssembleOptions {
            train_number: options.train_number.clone(),
            departure_date: options.departure_date.clone(),
            known_train: options.known_train.clone(),
            current_station_code: as_nullable_string(first(
                raw,
                &["currentStationCode", "CurrentStation"],
            )),
            status_message: as_nullable_string(first(raw, &["message", "Message"])),
            last_updated: as_nullable_string(first(raw, &["lastUpdated", "LastUpdated"])),
        },
    ))
}
