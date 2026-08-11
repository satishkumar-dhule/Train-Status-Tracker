//! Map an untrusted RedRail (RedBus Rail) live-status body to a
//! [`MappedStatus`].
//!
//! The payload mirrors the RedBus Rail app's `/api/Rails/v2/RIS/
//! GetLiveTrainStatus` response (captured live for train 12301): per-station
//! scheduled/actual times as `HH:mm` strings (with `"SOURCE"` /
//! `"DESTINATION"` sentinels at the endpoints), nullable delay minutes,
//! distance/`platform` as `"N kms"` / `"PLATFORM N"` strings, and a top-level
//! `currentlyAtCode` for the current station.

use serde_json::Value;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus, ProviderStationRow};
use tt_provider_core::{as_nullable_string, as_string, is_record, to_finite_number, ProviderError};

/// `YYYYMMDD` -> `YYYY-MM-DD`, or `None` when not a valid 8-digit date.
pub fn to_redrail_date(departure_date: &str) -> Option<String> {
    if departure_date.len() == 8 && departure_date.bytes().all(|b| b.is_ascii_digit()) {
        Some(format!(
            "{}-{}-{}",
            &departure_date[0..4],
            &departure_date[4..6],
            &departure_date[6..8]
        ))
    } else {
        None
    }
}

/// A station time: a `HH:mm` string (24h), else `None`. The `"SOURCE"` /
/// `"DESTINATION"` sentinels and blank values are treated as absent.
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

/// The delay in minutes: `delayArr` when present, else `delayDep`.
fn delay_minutes(entry: &Value) -> Option<i64> {
    to_finite_number(entry.get("delayArr"))
        .or_else(|| to_finite_number(entry.get("delayDep")))
        .map(|n| n as i64)
}

/// Distance from `"200 kms"` — leading integer, else `None`.
fn distance_km(value: Option<&Value>) -> Option<i64> {
    let text = as_nullable_string(value)?;
    let digits: String = text
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

/// Platform from `"PLATFORM 4"` — trailing integer, else `None`.
fn platform(value: Option<&Value>) -> Option<String> {
    let text = as_nullable_string(value)?;
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let digits: String = text
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        None
    } else {
        Some(digits)
    }
}

/// Map an untrusted RedRail live-status body to a `MappedStatus`.
///
/// Error taxonomy: a body with no parseable stations is an upstream error;
/// there is no positively-confirmed not-found signal in the RedRail shape, so
/// nothing maps to `NotFound`.
pub fn map_redrail_payload(
    raw: &Value,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    if !is_record(Some(raw)) {
        return Err(ProviderError::upstream(
            "redrail",
            "Unexpected response shape",
        ));
    }

    let Some(raw_stations) = raw.get("stations").and_then(Value::as_array) else {
        return Err(ProviderError::upstream(
            "redrail",
            "Unexpected response shape",
        ));
    };

    let rows: Vec<ProviderStationRow> = raw_stations
        .iter()
        .filter(|entry| is_record(Some(*entry)))
        .filter_map(|entry| {
            let station_code = as_string(entry.get("stationCode"));
            if station_code.is_empty() {
                return None;
            }
            let day = to_finite_number(entry.get("dayCount")).map(|n| n as i64);
            Some(ProviderStationRow {
                station_code,
                station_name: as_string(entry.get("stationName")),
                scheduled_arrival: nullable_time(entry.get("scheduledArrivalTime")),
                actual_arrival: nullable_time(entry.get("arrivalTime")),
                scheduled_departure: nullable_time(entry.get("scheduledDepartureTime")),
                actual_departure: nullable_time(entry.get("departureTime")),
                has_departed: tt_provider_core::as_boolean(entry.get("hasDeparted")),
                delay_minutes: delay_minutes(entry),
                distance: distance_km(entry.get("distanceFromOrigin")),
                platform: platform(entry.get("platform")),
                halt_minutes: None,
                day,
            })
        })
        .collect();

    if rows.is_empty() {
        return Err(ProviderError::upstream(
            "redrail",
            "No stations parsed from RedRail response",
        ));
    }

    let current_station_code = as_nullable_string(raw.get("currentlyAtCode"));
    let status_message = raw
        .get("runningStatus")
        .filter(|v| is_record(Some(v)))
        .and_then(|status| as_nullable_string(status.get("runningStatusMessage")));

    Ok(assemble_mapped_status(
        &rows,
        &AssembleOptions {
            train_number: options.train_number.clone(),
            departure_date: options.departure_date.clone(),
            known_train: options.known_train.clone(),
            current_station_code,
            status_message,
            last_updated: as_nullable_string(raw.get("ltsLastUpdatedTime")),
        },
    ))
}
