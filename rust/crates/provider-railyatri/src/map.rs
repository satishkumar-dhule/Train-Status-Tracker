//! Map an untrusted RailYatri livestatus body to a [`MappedStatus`], ported
//! 1:1 from `computeStartDay` / `mapRailYatriPayload` in
//! `lib/providers/railyatri.ts`.

use chrono::NaiveDate;
use serde_json::Value;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus, ProviderStationRow};
use tt_provider_core::{
    as_nullable_string, as_string, is_record, js_string, to_finite_number, to_positive_int,
    ProviderError,
};

/// `YYYYMMDD` -> `YYYY-MM-DD`, or `None` when not a valid 8-digit date.
fn to_iso_date(departure_date: &str) -> Option<String> {
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

/// The today/yesterday window check. RailYatri's endpoint has no date
/// parameter — it serves "today" (`start_day=0`) or "yesterday"
/// (`start_day=1`) relative to the server's local time. Anything outside that
/// window is rejected rather than silently returning a wrong date.
pub fn compute_start_day(departure_date: &str, now: NaiveDate) -> Result<i64, ProviderError> {
    let Some(iso) = to_iso_date(departure_date) else {
        return Err(ProviderError::upstream(
            "railyatri",
            format!("Unsupported date format: {departure_date}"),
        ));
    };

    let date_key = |date: NaiveDate| date.format("%Y-%m-%d").to_string();
    let today = date_key(now);
    if iso == today {
        return Ok(0);
    }
    let yesterday = date_key(now.pred_opt().expect("now has a previous day"));
    if iso == yesterday {
        return Ok(1);
    }
    Err(ProviderError::upstream(
        "railyatri",
        format!("RailYatri only supports today or yesterday (requested {departure_date})"),
    ))
}

fn to_row(entry: &Value) -> ProviderStationRow {
    let platform = match entry.get("platform_number") {
        Some(value) if !value.is_null() => Some(js_string(value)),
        _ => None,
    };
    ProviderStationRow {
        station_code: as_string(entry.get("station_code")),
        station_name: as_string(entry.get("station_name")),
        scheduled_arrival: as_nullable_string(entry.get("sta")),
        actual_arrival: as_nullable_string(entry.get("eta")),
        scheduled_departure: as_nullable_string(entry.get("std")),
        actual_departure: as_nullable_string(entry.get("etd")),
        has_departed: None,
        delay_minutes: to_finite_number(entry.get("arrival_delay"))
            .or_else(|| to_finite_number(entry.get("departure_delay")))
            .map(|n| n as i64),
        distance: to_finite_number(entry.get("distance_from_source")).map(|n| n as i64),
        platform,
        halt_minutes: None,
        day: Some(to_positive_int(entry.get("day"), 1)),
    }
}

/// Map an untrusted RailYatri livestatus body to a `MappedStatus`, adapting
/// its error taxonomy into [`ProviderError`]: a `success !== true` verdict is
/// a positively-confirmed not-found.
pub fn map_railyatri_payload(
    raw: &Value,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    if !is_record(Some(raw)) || raw.get("success").and_then(Value::as_bool) != Some(true) {
        return Err(ProviderError::not_found("railyatri"));
    }

    let previous: Vec<&Value> = raw
        .get("previous_stations")
        .and_then(Value::as_array)
        .map(|stations| {
            stations
                .iter()
                .filter(|entry| is_record(Some(*entry)))
                .collect()
        })
        .unwrap_or_default();
    let upcoming: Vec<&Value> = raw
        .get("upcoming_stations")
        .and_then(Value::as_array)
        .map(|stations| {
            stations
                .iter()
                .filter(|entry| is_record(Some(*entry)))
                .collect()
        })
        .unwrap_or_default();

    let platform = match raw.get("platform_number") {
        Some(value) if !value.is_null() => Some(js_string(value)),
        _ => None,
    };
    let current = ProviderStationRow {
        station_code: as_string(raw.get("current_station_code")),
        station_name: as_string(raw.get("current_station_name")),
        scheduled_arrival: as_nullable_string(raw.get("cur_stn_sta")),
        actual_arrival: as_nullable_string(raw.get("eta")),
        scheduled_departure: as_nullable_string(raw.get("cur_stn_std")),
        actual_departure: as_nullable_string(raw.get("etd")),
        // The current station is where the train is right now; `etd` is an
        // estimate, not proof it has left.
        has_departed: Some(false),
        delay_minutes: to_finite_number(raw.get("delay")).map(|n| n as i64),
        distance: to_finite_number(raw.get("distance_from_source")).map(|n| n as i64),
        platform,
        halt_minutes: None,
        day: Some(to_positive_int(raw.get("day"), 1)),
    };

    let mut rows: Vec<ProviderStationRow> = previous.iter().map(|entry| to_row(entry)).collect();
    rows.push(current);
    rows.extend(upcoming.iter().map(|entry| to_row(entry)));

    let status_message = as_nullable_string(raw.get("status_as_of")).or_else(|| {
        raw.get("current_location_info")
            .and_then(Value::as_array)
            .and_then(|list| list.first())
            .filter(|entry| is_record(Some(*entry)))
            .and_then(|entry| as_nullable_string(entry.get("message")))
    });

    Ok(assemble_mapped_status(
        &rows,
        &AssembleOptions {
            train_number: options.train_number.clone(),
            departure_date: options.departure_date.clone(),
            known_train: options.known_train.clone(),
            current_station_code: as_nullable_string(raw.get("current_station_code")),
            status_message,
            last_updated: as_nullable_string(raw.get("update_time")),
        },
    ))
}
