//! Map an untrusted RailRadar train status body to a [`MappedStatus`], ported
//! 1:1 from `mapRailRadarPayload` in `lib/providers/railradar.ts`.

use serde_json::Value;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus, ProviderStationRow};
use tt_provider_core::{
    as_nullable_string, as_string, is_record, iso_time_of_day, js_string, to_finite_number,
    to_positive_int, ProviderError,
};

/// `YYYYMMDD` -> `DD-MM-YYYY`, or `None` when not a valid 8-digit date.
pub fn to_railradar_date(departure_date: &str) -> Option<String> {
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
    let has_departed = match entry.get("status").and_then(Value::as_str) {
        Some("departed") => Some(true),
        _ => None,
    };
    let platform = match entry.get("platform") {
        Some(value) if !value.is_null() => Some(js_string(value)),
        _ => None,
    };
    ProviderStationRow {
        station_code: as_string(entry.get("stationCode")),
        station_name: as_string(entry.get("stationName")),
        scheduled_arrival: iso_time_of_day(entry.get("scheduledArrival")),
        actual_arrival: iso_time_of_day(entry.get("actualArrival")),
        scheduled_departure: iso_time_of_day(entry.get("scheduledDeparture")),
        actual_departure: iso_time_of_day(entry.get("actualDeparture")),
        has_departed,
        delay_minutes: to_finite_number(entry.get("delayArrival"))
            .or_else(|| to_finite_number(entry.get("delayDeparture")))
            .map(|n| n as i64),
        distance: to_finite_number(entry.get("distance")).map(|n| n as i64),
        platform,
        halt_minutes: None,
        day: Some(to_positive_int(entry.get("day"), 1)),
    }
}

/// Map an untrusted RailRadar train status body to a `MappedStatus`, adapting
/// its error taxonomy into [`ProviderError`]: a `NOT_FOUND` error code is a
/// positively-confirmed not-found, anything else is an upstream problem.
pub fn map_railradar_payload(
    raw: &Value,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    if !is_record(Some(raw)) {
        return Err(ProviderError::upstream(
            "railradar",
            "Unexpected response shape",
        ));
    }
    if raw.get("success").and_then(Value::as_bool) != Some(true) {
        let error = raw.get("error").filter(|value| is_record(Some(value)));
        if error.is_some_and(|error| as_string(error.get("code")) == "NOT_FOUND") {
            return Err(ProviderError::not_found("railradar"));
        }
        let message = as_nullable_string(error.and_then(|error| error.get("message")))
            .or_else(|| as_nullable_string(raw.get("message")))
            .unwrap_or_default();
        return Err(ProviderError::upstream(
            "railradar",
            format!("RailRadar reported failure: {message}"),
        ));
    }

    let Some(data) = raw.get("data").filter(|value| is_record(Some(value))) else {
        return Err(ProviderError::upstream(
            "railradar",
            "Unexpected response shape",
        ));
    };
    let Some(route) = data.get("route").and_then(Value::as_array) else {
        return Err(ProviderError::upstream(
            "railradar",
            "Unexpected response shape",
        ));
    };

    let rows: Vec<ProviderStationRow> = route
        .iter()
        .filter(|entry| is_record(Some(*entry)))
        .map(to_row)
        .collect();

    if rows.is_empty() {
        return Err(ProviderError::not_found("railradar"));
    }

    let current_location = data
        .get("currentLocation")
        .filter(|value| is_record(Some(value)));

    Ok(assemble_mapped_status(
        &rows,
        &AssembleOptions {
            train_number: options.train_number.clone(),
            departure_date: options.departure_date.clone(),
            known_train: options.known_train.clone(),
            current_station_code: as_nullable_string(
                current_location.and_then(|location| location.get("stationCode")),
            ),
            status_message: as_nullable_string(data.get("status")),
            last_updated: as_nullable_string(data.get("lastUpdatedAt")),
        },
    ))
}
