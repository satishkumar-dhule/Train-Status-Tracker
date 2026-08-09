//! Map an untrusted WhereIsMyTrain livestatus body to a [`MappedStatus`],
//! ported 1:1 from `mapWimtPayload` in `lib/providers/whereismytrain.ts`.

use serde_json::Value;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus, ProviderStationRow};
use tt_provider_core::{
    as_boolean, as_nullable_string, as_string, is_record, js_string, to_finite_number,
    to_nullable_int, ProviderError,
};

/// `YYYYMMDD` -> `DD-MM-YYYY`, or `None` when not a valid 8-digit date.
pub fn to_wimt_date(departure_date: &str) -> Option<String> {
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

fn to_row(entry: &Value) -> ProviderStationRow {
    let platform = match entry.get("platform") {
        Some(value) if !value.is_null() => Some(js_string(value)),
        _ => None,
    };
    ProviderStationRow {
        station_code: as_string(entry.get("station_code")),
        // WIMT does not expose station names; leave empty for the name
        // lookup layer to fill in.
        station_name: String::new(),
        scheduled_arrival: as_nullable_string(entry.get("sch_arrival_time")),
        actual_arrival: as_nullable_string(entry.get("actual_arrival_time")),
        scheduled_departure: as_nullable_string(entry.get("sch_departure_time")),
        actual_departure: as_nullable_string(entry.get("actual_departure_time")),
        has_departed: as_boolean(entry.get("departed")),
        delay_minutes: to_finite_number(entry.get("delay_in_arrival"))
            .or_else(|| to_finite_number(entry.get("delay_in_departure")))
            .map(|n| n as i64),
        distance: to_finite_number(entry.get("distance")).map(|n| n as i64),
        platform,
        halt_minutes: to_nullable_int(entry.get("stops")),
        day: Some(1),
    }
}

/// Map an untrusted WhereIsMyTrain body to a `MappedStatus`, adapting its
/// error taxonomy into [`ProviderError`]: a missing or empty `days_schedule`
/// is an upstream shape problem, a schedule with no mapped rows is a
/// positively-confirmed not-found.
pub fn map_wimt_payload(
    raw: &Value,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    if !is_record(Some(raw)) {
        return Err(ProviderError::upstream(
            "whereismytrain",
            "Unexpected response shape",
        ));
    }

    let Some(days_schedule) = raw.get("days_schedule").and_then(Value::as_array) else {
        return Err(ProviderError::upstream(
            "whereismytrain",
            "Unexpected response shape",
        ));
    };
    if days_schedule.is_empty() {
        return Err(ProviderError::not_found("whereismytrain"));
    }

    let rows: Vec<ProviderStationRow> = days_schedule
        .iter()
        .filter(|entry| is_record(Some(*entry)))
        .map(to_row)
        .collect();

    if rows.is_empty() {
        return Err(ProviderError::not_found("whereismytrain"));
    }

    Ok(assemble_mapped_status(
        &rows,
        &AssembleOptions {
            train_number: options.train_number.clone(),
            departure_date: options.departure_date.clone(),
            known_train: options.known_train.clone(),
            current_station_code: as_nullable_string(raw.get("curStn")),
            status_message: None,
            last_updated: as_nullable_string(raw.get("lastUpdateIsoDate")),
        },
    ))
}
