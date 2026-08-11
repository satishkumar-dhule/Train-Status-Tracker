//! Map an erail.in train-enquiry page to a [`MappedStatus`].
//!
//! # Scrape target
//!
//! erail.in serves an ASP.NET-rendered HTML page at
//! `https://erail.in/train-enquiry/{train_no}` carrying the full *schedule* of
//! the train. Live status on erail runs over a SignalR peer network, so the
//! server page is a schedule source: actual arrival/departure fields are left
//! `None` unless the embedded data carries them (it usually does not), and the
//! shared assembler computes delay only where an actual is present.
//!
//! This adapter targets the documented *structure* below rather than a
//! vendor-specific layout — erail has no verified stable markers from this
//! sandbox — and stays conservative (ZTA): any page that yields no stations by
//! either path surfaces as [`ProviderError::Upstream`], never a confirmed
//! not-found.
//!
//! # Documented markers
//!
//! ## 1. Embedded JSON (tried first)
//!
//! The page renders a JS blob assigning an array of station objects, captured
//! with the regex `var\s+\w+\s*=\s*(\[.*?\]);` (DOTALL) and parsed with
//! `serde_json`. The first match that parses as a JSON array whose entries
//! carry a station-code key is used. Documented station-object keys:
//!
//! | Key | Fallback | Meaning |
//! |---|---|---|
//! | `stnCode` | `stationCode` | station code (`[A-Z]{3,5}`) |
//! | `stnName` | `stationName` | station name |
//! | `schArr` | `scheduledArrival` | scheduled arrival `HH:mm` |
//! | `schDep` | `scheduledDeparture` | scheduled departure `HH:mm` |
//! | `actArr` | `actualArrival` | actual arrival (usually absent) |
//! | `actDep` | `actualDeparture` | actual departure (usually absent) |
//! | `pf` | `platform` | platform |
//! | `day` | `dayCount` | journey day |
//!
//! ## 2. Schedule `<table>` (fallback)
//!
//! A `<table>` carrying the class `erail-train-schedule`, containing one
//! `<tr class="schedule-row">` per station with `<td>` cells carrying
//! semantic classes: `stn`, `stn-name`, `sch-arr`, `sch-dep`, `pf`, `day`.
//!
//! Field parsing is defensive: any cell/value that does not match its expected
//! pattern leaves that field `None`; a row is kept only when its station code
//! looks like one. The current station is inferred as the last row carrying a
//! non-empty actual time (none on a schedule-only page).

use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus, ProviderStationRow};
use tt_provider_core::{as_nullable_string, is_record, to_finite_number, ProviderError};

/// The exact embedded-JSON marker: a JS `var` assignment whose value is an
/// array, up to its terminating `;` (DOTALL). The captured group is the raw
/// array text handed to `serde_json`.
static EMBEDDED_JSON_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)var\s+\w+\s*=\s*(\[.*?\]);").unwrap());

/// The `<table>` marker: a `<table>` whose `class` contains
/// `erail-train-schedule`.
static TABLE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<table[^>]*class="[^"]*erail-train-schedule[^"]*"[^>]*>"#).unwrap()
});

/// One schedule row: the inner HTML of a `<tr class="schedule-row">`.
static ROW_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<tr[^>]*class="schedule-row"[^>]*>(.*?)</tr>"#).unwrap());

/// A cell: captures its semantic class name and raw inner HTML.
static CELL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<td[^>]*class="([a-z0-9-]+)"[^>]*>(.*?)</td>"#).unwrap());

/// Station codes are 3–5 uppercase letters (the broadest safe pattern for
/// Indian railway codes — e.g. `HWH`, `ASN`, `NDLS`).
static STATION_CODE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z]{3,5}$").unwrap());

/// A 24-hour `HH:mm` time.
static TIME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{2}:\d{2}$").unwrap());

static TAGS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]*>").unwrap());

/// Drop every `<...>` and trim.
fn strip_tags(html: &str) -> String {
    TAGS_RE.replace_all(html, "").trim().to_string()
}

/// A `HH:mm` time, else `None`. `--` and empty values are treated as absent.
fn nullable_time(text: &str) -> Option<String> {
    let time = text.trim();
    if TIME_RE.is_match(time) {
        Some(time.to_string())
    } else {
        None
    }
}

/// The first present key among `keys` (unknown/missing keys are `None`).
fn first_alias<'a>(entry: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|key| entry.get(*key))
}

/// A scheduled/actual time from the embedded JSON, else `None`.
fn json_time(entry: &Value, keys: &[&str]) -> Option<String> {
    let text = as_nullable_string(first_alias(entry, keys))?;
    nullable_time(&text)
}

/// A platform value that may be a string or a number, else `None`.
fn json_platform(entry: &Value) -> Option<String> {
    as_nullable_string(first_alias(entry, &["pf", "platform"])).or_else(|| {
        to_finite_number(first_alias(entry, &["pf", "platform"])).map(|n| (n as i64).to_string())
    })
}

/// One embedded-JSON station object into a row, or `None` when the entry is
/// not a record or has no plausible station code.
fn station_from_json(entry: &Value) -> Option<ProviderStationRow> {
    if !is_record(Some(entry)) {
        return None;
    }
    let station_code = as_nullable_string(first_alias(entry, &["stnCode", "stationCode"]))?;
    let station_code = station_code.trim();
    if !STATION_CODE_RE.is_match(station_code) {
        return None;
    }
    Some(ProviderStationRow {
        station_code: station_code.to_string(),
        station_name: as_nullable_string(first_alias(entry, &["stnName", "stationName"]))
            .unwrap_or_default(),
        scheduled_arrival: json_time(entry, &["schArr", "scheduledArrival"]),
        actual_arrival: json_time(entry, &["actArr", "actualArrival"]),
        scheduled_departure: json_time(entry, &["schDep", "scheduledDeparture"]),
        actual_departure: json_time(entry, &["actDep", "actualDeparture"]),
        has_departed: None,
        delay_minutes: None,
        distance: None,
        platform: json_platform(entry),
        halt_minutes: None,
        day: to_finite_number(first_alias(entry, &["day", "dayCount"])).map(|n| n as i64),
    })
}

/// Try the embedded JSON first: scan every `var ... = [...];` blob and use the
/// first one that parses as a JSON array yielding station rows.
fn embedded_json_rows(html: &str) -> Vec<ProviderStationRow> {
    for caps in EMBEDDED_JSON_RE.captures_iter(html) {
        let Some(block) = caps.get(1) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(block.as_str()) else {
            continue;
        };
        let Some(stations) = value.as_array() else {
            continue;
        };
        let rows: Vec<ProviderStationRow> = stations.iter().filter_map(station_from_json).collect();
        if !rows.is_empty() {
            return rows;
        }
    }
    Vec::new()
}

/// Build a row from the cells of one `<tr>`. Any miss leaves that field
/// `None`; the whole row is dropped when the `stn` cell is absent or is not a
/// plausible station code.
fn row_from_cells(cells: &[(String, String)]) -> Option<ProviderStationRow> {
    let get = |class: &str| {
        cells
            .iter()
            .find(|(key, _)| key == class)
            .map(|(_, v)| v.as_str())
    };

    let code = get("stn")?.trim();
    if !STATION_CODE_RE.is_match(code) {
        return None;
    }

    let platform = get("pf").map(|p| p.trim().to_string());

    Some(ProviderStationRow {
        station_code: code.to_string(),
        station_name: get("stn-name")
            .map(|name| name.trim().to_string())
            .unwrap_or_default(),
        scheduled_arrival: get("sch-arr").and_then(nullable_time),
        actual_arrival: get("act-arr").and_then(nullable_time),
        scheduled_departure: get("sch-dep").and_then(nullable_time),
        actual_departure: get("act-dep").and_then(nullable_time),
        has_departed: None,
        delay_minutes: None,
        distance: None,
        platform: platform.filter(|p| !p.is_empty() && p != "--"),
        halt_minutes: None,
        day: get("day").and_then(|d| d.trim().parse().ok()),
    })
}

/// Scrape the schedule `<table>` (the fallback path when no embedded JSON
/// yields stations).
fn table_rows(html: &str) -> Vec<ProviderStationRow> {
    let mut rows = Vec::new();
    if !TABLE_RE.is_match(html) {
        return rows;
    }
    for caps in ROW_RE.captures_iter(html) {
        let Some(inner) = caps.get(1) else {
            continue;
        };
        let mut cells = Vec::new();
        for cell in CELL_RE.captures_iter(inner.as_str()) {
            if let (Some(class), Some(content)) = (cell.get(1), cell.get(2)) {
                cells.push((class.as_str().to_string(), strip_tags(content.as_str())));
            }
        }
        if let Some(row) = row_from_cells(&cells) {
            rows.push(row);
        }
    }
    rows
}

/// `YYYYMMDD` passthrough: `Some(departure_date)` only when it is 8 digits.
/// The page date derives from the request context; no re-formatting or extra
/// query parameter is needed.
pub fn to_erail_date(departure_date: &str) -> Option<String> {
    if departure_date.len() == 8 && departure_date.bytes().all(|b| b.is_ascii_digit()) {
        Some(departure_date.to_string())
    } else {
        None
    }
}

/// Map the erail train-enquiry page to a `MappedStatus`.
///
/// Error taxonomy (ZTA): a page with no stations by either path (embedded JSON
/// or schedule table) is an upstream error — the anti-bot body, a blocked
/// response and a layout change all look like this. There is no
/// positively-confirmed not-found signal in the erail shape, so nothing maps
/// to `NotFound`.
pub fn map_erail_payload(
    html: &str,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    let rows = embedded_json_rows(html);
    let rows = if rows.is_empty() {
        table_rows(html)
    } else {
        rows
    };

    if rows.is_empty() {
        return Err(ProviderError::upstream(
            "erail",
            "No stations parsed from erail page",
        ));
    }

    let current_station_code = rows
        .iter()
        .rev()
        .find(|row| row.actual_arrival.is_some() || row.actual_departure.is_some())
        .map(|row| row.station_code.clone());

    Ok(assemble_mapped_status(
        &rows,
        &AssembleOptions {
            train_number: options.train_number.clone(),
            departure_date: options.departure_date.clone(),
            known_train: options.known_train.clone(),
            current_station_code,
            status_message: None,
            last_updated: None,
        },
    ))
}
