//! Map an etrain.info running-status page to a [`MappedStatus`].
//!
//! # Scrape target
//!
//! The page is server-rendered HTML from
//! `https://etrain.info/train/{train_no}/live?date=YYYYMMDD` (the slug-less
//! form this adapter uses as primary; etrain redirects it in practice). This
//! adapter targets the documented *structure* below rather than a
//! vendor-specific class list — etrain has no verified stable markers from
//! this sandbox — and stays conservative: any page that does not carry the
//! running-status table marker surfaces as [`ProviderError::Upstream`] (ZTA:
//! anti-bot blocks and layout changes are upstream problems, never confirmed
//! not-founds).
//!
//! # Documented markers
//!
//! The fixture this mapper is pinned to is a `<table>` carrying the class
//! `etrain-running-status`, containing one `<tr class="status-row">` per
//! station with `<td>` cells carrying semantic classes:
//!
//! | Cell class | Value | Notes |
//! |---|---|---|
//! | `stn` | station code | `[A-Z]{3,5}` — a row without it is skipped |
//! | `stn-name` | station name | optional |
//! | `sch-arr` / `sch-dep` | scheduled arrival / departure | `HH:mm`, `--`, or empty |
//! | `act-arr` / `act-dep` | actual arrival / departure | `HH:mm`, `--`, or empty |
//! | `pf` | platform | digits |
//! | `day` | journey day | integer |
//! | `delay` | delay text | `On time`, `Late by N min`, `Early by N min`, or `--` |
//!
//! Field parsing is defensive: any cell that does not match its expected
//! pattern (time must be `HH:mm`, delay must parse via
//! [`parse_delay`]) leaves that field `None`; the row is kept as long as the
//! `stn` cell looks like a station code. The current station is inferred
//! conservatively as the last row carrying a non-empty actual time, mirroring
//! the sibling JSON adapters.

use std::sync::LazyLock;

use regex::Regex;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus, ProviderStationRow};
use tt_provider_core::ProviderError;

/// The `<table>` class that marks an etrain running-status page.
const TABLE_CLASS: &str = "etrain-running-status";

/// The `<table>` marker: a `<table>` whose `class` contains
/// `etrain-running-status`.
static TABLE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r#"(?is)<table[^>]*class="[^"]*{}[^"]*"[^>]*>"#,
        TABLE_CLASS
    ))
    .unwrap()
});

/// One station row: the inner HTML of a `<tr class="status-row">`.
static ROW_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<tr[^>]*class="status-row"[^>]*>(.*?)</tr>"#).unwrap());

/// A cell: captures its semantic class name and raw inner HTML.
static CELL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<td[^>]*class="([a-z0-9-]+)"[^>]*>(.*?)</td>"#).unwrap());

/// Station codes are 3–5 uppercase letters (the broadest safe pattern for
/// Indian railway codes — e.g. `HWH`, `ASN`, `NDLS`).
static STATION_CODE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z]{3,5}$").unwrap());

/// A 24-hour `HH:mm` time.
static TIME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{2}:\d{2}$").unwrap());

/// A platform number (digits).
static PLATFORM_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{1,3}$").unwrap());

static ON_TIME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)on time").unwrap());
static LATE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)late by\s*(\d+)\s*min").unwrap());
static EARLY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)early by\s*(\d+)\s*min").unwrap());
static TAGS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]*>").unwrap());

/// Drop every `<...>` and trim.
fn strip_tags(html: &str) -> String {
    TAGS_RE.replace_all(html, "").trim().to_string()
}

/// A `HH:mm` time, else `None`. `--` and empty cells are treated as absent.
fn nullable_time(text: &str) -> Option<String> {
    let time = text.trim();
    if TIME_RE.is_match(time) {
        Some(time.to_string())
    } else {
        None
    }
}

/// `On time` → 0, `Late by N min` → +N, `Early by N min` → −N, a bare integer
/// → that number, anything else → `None`.
fn parse_delay(text: &str) -> Option<i64> {
    let text = text.trim();
    if text.is_empty() || text == "--" {
        return None;
    }
    if ON_TIME_RE.is_match(text) {
        return Some(0);
    }
    if let Some(late) = LATE_RE.captures(text) {
        return late.get(1).and_then(|m| m.as_str().parse().ok());
    }
    if let Some(early) = EARLY_RE.captures(text) {
        return early
            .get(1)
            .and_then(|m| m.as_str().parse::<i64>().ok())
            .map(|n| -n);
    }
    text.parse().ok()
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
    let day = get("day").and_then(|d| d.trim().parse().ok());

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
        delay_minutes: get("delay").and_then(parse_delay),
        distance: None,
        platform: platform.filter(|p| !p.is_empty() && PLATFORM_RE.is_match(p)),
        halt_minutes: None,
        day,
    })
}

/// `YYYYMMDD` passthrough: `Some(departure_date)` only when it is 8 digits.
/// etrain's `/live` page takes the date as a `YYYYMMDD` query parameter
/// (`?date=YYYYMMDD`), so no re-formatting is needed.
pub fn to_etrain_date(departure_date: &str) -> Option<String> {
    if departure_date.len() == 8 && departure_date.bytes().all(|b| b.is_ascii_digit()) {
        Some(departure_date.to_string())
    } else {
        None
    }
}

/// Map the etrain running-status page to a `MappedStatus`.
///
/// Error taxonomy (ZTA): a page without the running-status table marker, or
/// with the marker but no parseable station rows, is an upstream error — the
/// anti-bot body, a blocked response and a layout change all look like this.
/// There is no positively-confirmed not-found signal in the etrain shape, so
/// nothing maps to `NotFound`.
pub fn map_etrain_payload(
    html: &str,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    if !TABLE_RE.is_match(html) {
        return Err(ProviderError::upstream(
            "etrain",
            "etrain page did not contain a running-status table",
        ));
    }

    let mut rows = Vec::new();
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

    if rows.is_empty() {
        return Err(ProviderError::upstream(
            "etrain",
            "No stations parsed from etrain page",
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
