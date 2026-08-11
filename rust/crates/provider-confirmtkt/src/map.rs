//! Map an untrusted ConfirmTkt livestatus body to a [`MappedStatus`].
//!
//! The payload mirrors the ConfirmTkt Android app's `/api/trains/livestatusall`
//! response (captured live for train 12301): per-station scheduled/actual times
//! as `HH:mm` strings (empty for the origin's arrival / destination's
//! departure), precomputed delay minutes, a `travelled` per-station flag, and a
//! top-level `curStn`/`curStnName` for the current station.

use serde_json::Value;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus, ProviderStationRow};
use tt_provider_core::{as_nullable_string, as_string, is_record, ProviderError};

/// `YYYYMMDD` -> `DD-MM-YYYY`, or `None` when not a valid 8-digit date.
pub fn to_confirmtkt_date(departure_date: &str) -> Option<String> {
    if departure_date.len() == 8 && departure_date.bytes().all(|b| b.is_ascii_digit()) {
        Some(format!(
            "{}-{}-{}",
            &departure_date[6..8],
            &departure_date[4..6],
            &departure_date[0..4]
        ))
    } else {
        None
    }
}

/// A station time: a non-blank `HH:mm` string, else `None` (the origin's
/// arrival and destination's departure arrive blank).
fn nullable_time(value: Option<&Value>) -> Option<String> {
    let time = as_nullable_string(value)?;
    let time = time.trim();
    if time.is_empty() {
        None
    } else {
        Some(time.to_string())
    }
}

/// The delay in minutes: `delayArr` when present, else `delayDep`.
fn delay_minutes(entry: &Value) -> Option<i64> {
    tt_provider_core::to_finite_number(entry.get("delayArr"))
        .or_else(|| tt_provider_core::to_finite_number(entry.get("delayDep")))
        .map(|n| n as i64)
}

/// Platform from `ExpectedPlatformNo`: a non-blank, non-zero value, else `None`.
fn platform(entry: &Value) -> Option<String> {
    let pf = as_nullable_string(entry.get("ExpectedPlatformNo"))?;
    let pf = pf.trim();
    if pf.is_empty() || pf == "0" {
        None
    } else {
        Some(pf.to_string())
    }
}

/// Map an untrusted ConfirmTkt livestatus body to a `MappedStatus`.
///
/// Error taxonomy: `trainDataFound === "trainDataNotFound"` (or an empty
/// station list under that flag) is a positively-confirmed not-found; any
/// other shape rejection is an upstream error.
pub fn map_confirmtkt_payload(
    raw: &Value,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    if !is_record(Some(raw)) {
        return Err(ProviderError::upstream(
            "confirmtkt",
            "Unexpected response shape",
        ));
    }

    let not_found_flag = as_string(raw.get("trainDataFound")) == "trainDataNotFound";

    let Some(raw_stations) = raw.get("stations").and_then(Value::as_array) else {
        if not_found_flag {
            return Err(ProviderError::not_found("confirmtkt"));
        }
        return Err(ProviderError::upstream(
            "confirmtkt",
            "Unexpected response shape",
        ));
    };

    let rows: Vec<ProviderStationRow> = raw_stations
        .iter()
        .filter(|entry| is_record(Some(*entry)))
        .filter_map(|entry| {
            let station_code = as_string(entry.get("stnCode"));
            if station_code.is_empty() {
                return None;
            }
            Some(ProviderStationRow {
                station_code,
                station_name: as_string(entry.get("stnCodeName")),
                scheduled_arrival: nullable_time(entry.get("schArrTime")),
                actual_arrival: nullable_time(entry.get("actArr")),
                scheduled_departure: nullable_time(entry.get("schDepTime")),
                actual_departure: nullable_time(entry.get("actDep")),
                has_departed: tt_provider_core::as_boolean(entry.get("travelled")),
                delay_minutes: delay_minutes(entry),
                distance: tt_provider_core::to_finite_number(entry.get("distance"))
                    .map(|n| n as i64),
                platform: platform(entry),
                halt_minutes: tt_provider_core::to_finite_number(entry.get("haltMinutes"))
                    .map(|n| n as i64),
                day: Some(tt_provider_core::to_positive_int(entry.get("dayCnt"), 1)),
            })
        })
        .collect();

    if rows.is_empty() {
        if not_found_flag {
            return Err(ProviderError::not_found("confirmtkt"));
        }
        return Err(ProviderError::upstream(
            "confirmtkt",
            "No stations parsed from ConfirmTkt response",
        ));
    }

    let current_station_code = as_nullable_string(raw.get("curStn"));

    Ok(assemble_mapped_status(
        &rows,
        &AssembleOptions {
            train_number: options.train_number.clone(),
            departure_date: options.departure_date.clone(),
            known_train: options.known_train.clone(),
            current_station_code,
            status_message: None,
            last_updated: as_nullable_string(raw.get("lastUpdated")),
        },
    ))
}
