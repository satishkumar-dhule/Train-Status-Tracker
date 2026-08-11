//! Map an untrusted trainspnrstatus.com live-status body to a [`MappedStatus`].
//!
//! The payload shape is documented from the site's React bundle (the endpoint
//! itself is Cloudflare Turnstile-guarded and unreachable from CI — Tier C):
//! top-level train name/number, a running-day message, and a station table with
//! scheduled/actual `HH:mm` timestamps and a platform. Blank `HH:mm` values
//! mark the origin's arrival and destination's departure, so blank times are
//! treated as absent.

use serde_json::Value;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus, ProviderStationRow};
use tt_provider_core::{as_nullable_string, as_string, is_record, to_finite_number, ProviderError};

/// `YYYYMMDD` -> `YYYY-MM-DD`, or `None` when not a valid 8-digit date.
pub fn to_trainspnrstatus_date(departure_date: &str) -> Option<String> {
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

/// A station time: a `HH:mm` string (24h), else `None`. Blank values (the
/// origin's arrival, the destination's departure) are treated as absent.
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

/// Platform from the station's `platform` field: a non-blank, non-zero value,
/// else `None`.
fn platform(value: Option<&Value>) -> Option<String> {
    let pf = as_nullable_string(value)?;
    let pf = pf.trim();
    if pf.is_empty() || pf == "0" {
        None
    } else {
        Some(pf.to_string())
    }
}

/// Map an untrusted trainspnrstatus.com live-status body to a `MappedStatus`.
///
/// Error taxonomy: a body with no parseable stations is an upstream error; the
/// documented shape carries no positively-confirmed not-found signal, so
/// nothing maps to `NotFound`.
pub fn map_trainspnrstatus_payload(
    raw: &Value,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    if !is_record(Some(raw)) {
        return Err(ProviderError::upstream(
            "trainspnrstatus",
            "Unexpected response shape",
        ));
    }

    let Some(raw_stations) = raw.get("stations").and_then(Value::as_array) else {
        return Err(ProviderError::upstream(
            "trainspnrstatus",
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
            Some(ProviderStationRow {
                station_code,
                station_name: as_string(entry.get("stationName")),
                scheduled_arrival: nullable_time(entry.get("scheduledArrival")),
                actual_arrival: nullable_time(entry.get("actualArrival")),
                scheduled_departure: nullable_time(entry.get("scheduledDeparture")),
                actual_departure: nullable_time(entry.get("actualDeparture")),
                has_departed: None,
                delay_minutes: None,
                distance: None,
                platform: platform(entry.get("platform")),
                halt_minutes: None,
                day: to_finite_number(entry.get("day")).map(|n| n as i64),
            })
        })
        .collect();

    if rows.is_empty() {
        return Err(ProviderError::upstream(
            "trainspnrstatus",
            "No stations parsed from trainspnrstatus response",
        ));
    }

    let current_station_code = as_nullable_string(raw.get("currentStationCode")).or_else(|| {
        rows.iter()
            .rfind(|row| row.actual_departure.is_some())
            .map(|row| row.station_code.clone())
    });

    let status_message = as_nullable_string(raw.get("message"))
        .or_else(|| as_nullable_string(raw.get("runningDay")));

    Ok(assemble_mapped_status(
        &rows,
        &AssembleOptions {
            train_number: options.train_number.clone(),
            departure_date: options.departure_date.clone(),
            known_train: options.known_train.clone(),
            current_station_code,
            status_message,
            last_updated: as_nullable_string(raw.get("lastUpdated")),
        },
    ))
}
