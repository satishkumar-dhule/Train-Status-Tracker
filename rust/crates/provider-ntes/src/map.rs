//! Map a decrypted NTES (CRIS) run body to a [`MappedStatus`].
//!
//! The body mirrors the official CRIS mobile `ShowFullRunJson` response
//! (captured live for train 12301, 10-Aug-2026): a `STNS[]` station list plus
//! a handful of train-level keys. Scheduled times are `HH:mm DD-MMM` strings
//! (with `"Source"` / `"DESTINATION"` sentinels); expected times `ETA`/`ETD`
//! are live-projected; actuals `DARR`/`DDEP` render as `"On Time"`/empty and
//! are not clock times.

use serde_json::Value;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus, ProviderStationRow};
use tt_provider_core::{as_nullable_string, as_string, is_record, ProviderError};

/// `YYYYMMDD` -> `DD-MMM-YYYY`, or `None` when not a valid 8-digit date.
/// Month names match NTES's `startDate` convention (`10-Aug-2026`).
pub fn to_ntes_date(departure_date: &str) -> Option<String> {
    if departure_date.len() != 8 || !departure_date.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let month = match &departure_date[4..6] {
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
    Some(format!(
        "{}-{}-{}",
        &departure_date[6..8],
        month,
        &departure_date[0..4]
    ))
}

/// A CRIS schedule/expected time: `HH:mm DD-MMM` (e.g. `18:47 10-Aug`), else
/// `None`. Sentinels (`Source`, `DESTINATION`, blank) are treated as absent.
fn scheduled_time(value: Option<&Value>) -> Option<String> {
    let time = as_nullable_string(value)?;
    let time = time.trim();
    if time.len() >= 5
        && time.as_bytes().get(2) == Some(&b':')
        && time.as_bytes()[0].is_ascii_digit()
        && time.as_bytes()[1].is_ascii_digit()
        && time.as_bytes()[3].is_ascii_digit()
        && time.as_bytes()[4].is_ascii_digit()
    {
        Some(time[0..5].to_string())
    } else {
        None
    }
}

/// An actual time: only a real `HH:mm` string counts. `"On Time"`/blank are
/// NOT clock times, so actuals are usually absent from NTES.
fn actual_time(value: Option<&Value>) -> Option<String> {
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

/// Map a decrypted NTES run body to a `MappedStatus`.
///
/// Error taxonomy: a body that is not a record, or lacks a `STNS` array, is an
/// upstream error (the service occasionally returns `{}`).
pub fn map_ntes_payload(
    raw: &Value,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    if !is_record(Some(raw)) {
        return Err(ProviderError::upstream("ntes", "Unexpected response shape"));
    }

    let Some(raw_stations) = raw.get("STNS").and_then(Value::as_array) else {
        return Err(ProviderError::upstream("ntes", "Unexpected response shape"));
    };

    let rows: Vec<ProviderStationRow> = raw_stations
        .iter()
        .filter(|entry| is_record(Some(*entry)))
        .filter_map(|entry| {
            let station_code = as_string(entry.get("SC"));
            if station_code.is_empty() {
                return None;
            }
            Some(ProviderStationRow {
                station_code,
                station_name: as_string(entry.get("SN")),
                scheduled_arrival: scheduled_time(entry.get("STA")),
                actual_arrival: actual_time(entry.get("DARR")),
                scheduled_departure: scheduled_time(entry.get("STD")),
                actual_departure: actual_time(entry.get("DDEP")),
                has_departed: None,
                delay_minutes: None,
                distance: tt_provider_core::to_finite_number(entry.get("DIST")).map(|n| n as i64),
                platform: {
                    let pf = as_nullable_string(entry.get("PF"));
                    pf.filter(|pf| !pf.trim().is_empty())
                },
                halt_minutes: None,
                day: tt_provider_core::to_finite_number(entry.get("DF"))
                    .map(|n| n as i64 + 1)
                    .or(Some(1)),
            })
        })
        .collect();

    if rows.is_empty() {
        return Err(ProviderError::upstream(
            "ntes",
            "No stations parsed from NTES response",
        ));
    }

    let current_station_code = as_nullable_string(raw.get("LSTN")).filter(|code| !code.is_empty());
    let status_message = as_nullable_string(raw.get("CPOS"));
    let last_updated = as_nullable_string(raw.get("LUPDT"))
        .or_else(|| as_nullable_string(raw.get("LUPDFULL")))
        .or_else(|| as_nullable_string(raw.get("LASTUPD")));

    Ok(assemble_mapped_status(
        &rows,
        &AssembleOptions {
            train_number: options.train_number.clone(),
            departure_date: options.departure_date.clone(),
            known_train: options.known_train.clone(),
            current_station_code,
            status_message,
            last_updated,
        },
    ))
}
