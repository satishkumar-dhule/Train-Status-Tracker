//! Map an untrusted Goibibo/MMT livestatus body to a [`MappedStatus`], ported
//! 1:1 from `mapGoibiboPayload` in `lib/providers/goibibo.ts`.

use serde_json::Value;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus, ProviderStationRow};
use tt_provider_core::{
    as_nullable_string, as_string, is_record, js_string, to_finite_number, to_positive_int,
    ProviderError,
};

/// `YYYYMMDD` -> `DD-MM-YYYY`, or `None` when the input is not a valid 8-digit
/// date. Mirrors `toGoibiboDate`.
pub fn to_goibibo_date(departure_date: &str) -> Option<String> {
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

/// Map an untrusted Goibibo/MMT livestatus body to a `MappedStatus`, adapting
/// its error taxonomy into [`ProviderError`]: a `success !== true` verdict is a
/// positively-confirmed not-found; every other shape rejection is an upstream
/// error.
pub fn map_goibibo_payload(
    raw: &Value,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    // `!isRecord(raw) || raw.success !== true`.
    if !is_record(Some(raw)) || raw.get("success").and_then(Value::as_bool) != Some(true) {
        return Err(ProviderError::not_found("goibibo"));
    }
    let Some(response) = raw.get("response").filter(|value| is_record(Some(value))) else {
        return Err(ProviderError::upstream(
            "goibibo",
            "Unexpected response shape",
        ));
    };
    let Some(raw_stations) = response.get("stations").and_then(Value::as_array) else {
        return Err(ProviderError::upstream(
            "goibibo",
            "Unexpected response shape",
        ));
    };

    // Per-entry field bags default to `{}`; `null` stands in for the empty
    // object because every access below goes through `.get()`.
    let null = Value::Null;
    let rows: Vec<ProviderStationRow> = raw_stations
        .iter()
        .filter_map(|entry| {
            if !is_record(Some(entry)) {
                return None;
            }
            let station = entry
                .get("Station")
                .filter(|value| is_record(Some(value)))
                .unwrap_or(&null);
            let arrival = entry
                .get("ArrivalDetails")
                .filter(|value| is_record(Some(value)))
                .unwrap_or(&null);
            let departure = entry
                .get("DepartureDetails")
                .filter(|value| is_record(Some(value)))
                .unwrap_or(&null);
            let day = entry
                .get("DayDetails")
                .filter(|value| is_record(Some(value)))
                .unwrap_or(&null);

            // `filter((row) => row !== null && row.station_code !== "")`.
            let station_code = as_string(station.get("code"));
            if station_code.is_empty() {
                return None;
            }

            // `station.expectedPlatformNumber !== undefined && !== null ?
            // String(...) : null`.
            let platform = match station.get("expectedPlatformNumber") {
                Some(value) if !value.is_null() => Some(js_string(value)),
                _ => None,
            };

            Some(ProviderStationRow {
                station_code,
                station_name: as_string(station.get("name")),
                scheduled_arrival: as_nullable_string(arrival.get("scheduledArrivalTime")),
                actual_arrival: as_nullable_string(arrival.get("actualArrivalTime")),
                scheduled_departure: as_nullable_string(departure.get("scheduledDepartureTime")),
                actual_departure: as_nullable_string(departure.get("actualDepartureTime")),
                has_departed: tt_provider_core::as_boolean(departure.get("departed")),
                delay_minutes: None,
                distance: to_finite_number(entry.get("Distance")).map(|n| n as i64),
                platform,
                halt_minutes: to_finite_number(entry.get("HaltMinutes")).map(|n| n as i64),
                day: Some(to_positive_int(day.get("dayCount"), 1)),
            })
        })
        .collect();

    let meta = response
        .get("metaDetails")
        .filter(|value| is_record(Some(value)));
    let train_details = response
        .get("trainDetails")
        .filter(|value| is_record(Some(value)));

    // `asNullableString(meta?.curStnData?.station?.code) ?? asNullableString(
    // trainDetails?.currentStation?.code)` — with JS `?.` semantics: a
    // non-object link in the chain short-circuits to `null`, and `??` falls
    // through to the second candidate only when the first is null.
    let mut current_station_code = None;
    if let Some(meta) = meta {
        if let Some(cur) = meta
            .get("curStnData")
            .filter(|value| is_record(Some(value)))
        {
            if let Some(station) = cur.get("station").filter(|value| is_record(Some(value))) {
                current_station_code = as_nullable_string(station.get("code"));
            }
        }
    }
    if current_station_code.is_none() {
        if let Some(train_details) = train_details {
            if let Some(station) = train_details
                .get("currentStation")
                .filter(|value| is_record(Some(value)))
            {
                current_station_code = as_nullable_string(station.get("code"));
            }
        }
    }

    let other_details = meta
        .and_then(|m| m.get("othrDetails"))
        .filter(|value| is_record(Some(value)));
    let status_message = other_details
        .and_then(|details| as_nullable_string(details.get("timeDetail")))
        .or_else(|| other_details.and_then(|details| as_nullable_string(details.get("delay"))));

    Ok(assemble_mapped_status(
        &rows,
        &AssembleOptions {
            train_number: options.train_number.clone(),
            departure_date: options.departure_date.clone(),
            known_train: options.known_train.clone(),
            current_station_code,
            status_message,
            last_updated: as_nullable_string(response.get("lastUpdated")),
        },
    ))
}
