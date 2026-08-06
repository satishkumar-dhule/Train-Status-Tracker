//! Translate one raw Paytm station into a [`ProviderStationRow`], ported 1:1
//! from `toRow` in `lib/providers/paytm.ts`.
//!
//! The JS coercions are load-bearing: scheduled times only count when the
//! station has a truthy day count, `distance` goes through `Number(...)`,
//! `day` through `parseInt(String(dayCount ?? "1"), 10)`, and every
//! `String(...)` call follows the ECMAScript coercion.

use serde_json::Value;

use crate::coerce::{js_number, js_parse_int, js_string, js_truthy};
use tt_mapper::ProviderStationRow;

/// Convert one raw Paytm station object to a normalized row.
pub(super) fn to_row(station: &Value) -> ProviderStationRow {
    let arrival = station.get("arrivalTime");
    let day_count = station.get("dayCount");

    // Legacy semantics: scheduled times only count when the station has a day
    // count, otherwise the entry is a "through" station with no times.
    let scheduled_arrival = if arrival.is_some_and(js_truthy) && day_count.is_some_and(js_truthy) {
        Some(js_string(arrival.expect("checked above")))
    } else {
        None
    };
    let departure = station.get("departureTime");
    let scheduled_departure =
        if departure.is_some_and(js_truthy) && day_count.is_some_and(js_truthy) {
            Some(js_string(departure.expect("checked above")))
        } else {
            None
        };

    // `typeof station.actual_arrival_time === "string" ? it : null`.
    let actual_arrival = match station.get("actual_arrival_time") {
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    };
    let actual_departure = match station.get("actual_departure_time") {
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    };

    // `const distance = Number(station.distance)` — missing is `undefined` ->
    // `NaN`; `Number.isFinite(distance) ? distance : null`.
    let distance = match station.get("distance") {
        Some(v) => js_number(v),
        None => f64::NAN,
    };
    let distance = if distance.is_finite() {
        Some(distance as i64)
    } else {
        None
    };

    // `station.expected_platform !== undefined ? String(...) : null`.
    let platform = station.get("expected_platform").map(js_string);

    // `typeof station.haltTime === "number" ? station.haltTime : null`.
    let halt_minutes = match station.get("haltTime") {
        Some(Value::Number(n)) => n.as_i64(),
        _ => None,
    };

    // `parseInt(String(station.dayCount ?? "1"), 10)`; `NaN` falls back to 1.
    // The `?? "1"` (nullish coalescing) turns missing/null into `"1"` but
    // leaves `0` as `0`.
    let day_count_str = match day_count {
        Some(Value::Null) | None => "1".to_string(),
        Some(day_count) => js_string(day_count),
    };
    let day = js_parse_int(&day_count_str).unwrap_or(1);

    // `String(station.stationCode ?? "")` — missing/null become `""`.
    let station_code = match station.get("stationCode") {
        Some(Value::Null) | None => String::new(),
        Some(code) => js_string(code),
    };
    let station_name = match station.get("stationName") {
        Some(Value::Null) | None => String::new(),
        Some(name) => js_string(name),
    };

    ProviderStationRow {
        station_code,
        station_name,
        scheduled_arrival,
        actual_arrival,
        scheduled_departure,
        actual_departure,
        has_departed: None,
        delay_minutes: None,
        distance,
        platform,
        halt_minutes,
        day: Some(day),
    }
}
