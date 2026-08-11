//! Map a railmitra.com live-train-running-status page to a [`MappedStatus`].
//!
//! The page is server-rendered HTML at
//! `https://www.railmitra.com/live-train-running-status/{train_no}` (no date in
//! the URL). From this sandbox the `<title>` is reachable
//! (`"12301 Train Running Status (RAJDHANI EXPRES)"`); the full station table is
//! embedded server-side but not captured here, so the extraction is built
//! against the documented shape below and kept conservative (ZTA): a page that
//! does not look like a RailMitra status page, or that yields no parseable
//! station rows, is a [`ProviderError::Upstream`].
//!
//! Documented markers:
//!
//! - `TITLE_RE` — `"<title>…12301 Train Running Status (RAJDHANI EXPRES)</title>"`,
//!   the reachable page title. Recognizes the page as a RailMitra status page.
//! - `ROW_OPEN` — every station is a `<tr class="station-row">`; the page is
//!   split on this marker and each fragment is matched cell-wise.
//! - Per-row cells, matched inside the row fragment:
//!   - `station-code` — uppercase 4–5 letter station code (required).
//!   - `station-name` — station name.
//!   - `scheduled-arrival` / `scheduled-departure` — `HH:mm`, or a dash/empty
//!     cell for the origin's arrival / destination's departure.
//!   - `actual-arrival` / `actual-departure` — `HH:mm`, empty until reached.
//!   - `platform` — platform number (`0`/dash/empty → absent).
//!   - `day` — journey day number (default 1).
//!   - `delay` — `"On Time"`, `"Late by N min"`, `"Early by N min"`, `"N min"`,
//!     `0` or a dash.
//!   - `status` — the per-row reached/expected token: `Yet to start` /
//!     `Expected` (not yet passed), `Reached` / `Departed` (passed).
//!
//! The current station is the first row that has not yet been passed (status
//! `Yet to start` / `Expected`); when every row has been passed the last row is
//! current (the journey has terminated).

use std::sync::LazyLock;

use regex::Regex;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus, ProviderStationRow};
use tt_provider_core::ProviderError;

const ROW_OPEN: &str = r#"<tr class="station-row">"#;

static TITLE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)<title>\s*\d{4,5}\s+Train Running Status"#).unwrap());
static STATION_CODE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<td class="station-code">([^<]*)</td>"#).unwrap());
static STATION_NAME_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<td class="station-name">([^<]*)</td>"#).unwrap());
static SCHEDULED_ARRIVAL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<td class="scheduled-arrival">([^<]*)</td>"#).unwrap());
static SCHEDULED_DEPARTURE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<td class="scheduled-departure">([^<]*)</td>"#).unwrap());
static ACTUAL_ARRIVAL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<td class="actual-arrival">([^<]*)</td>"#).unwrap());
static ACTUAL_DEPARTURE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<td class="actual-departure">([^<]*)</td>"#).unwrap());
static PLATFORM_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<td class="platform">([^<]*)</td>"#).unwrap());
static DAY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<td class="day">([^<]*)</td>"#).unwrap());
static DELAY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<td class="delay">([^<]*)</td>"#).unwrap());
static STATUS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<td class="status">([^<]*)</td>"#).unwrap());

static TIME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{2}:\d{2}$").unwrap());
static ON_TIME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)on time").unwrap());
static LATE_BY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)late by\s*(\d+)\s*min").unwrap());
static EARLY_BY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)early by\s*(\d+)\s*min").unwrap());
static MINUTES_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(\d+)\s*min").unwrap());

/// The first capture group of `re` inside `fragment`, if present.
fn cell<'a>(re: &Regex, fragment: &'a str) -> Option<&'a str> {
    re.captures(fragment)
        .and_then(|captures| captures.get(1))
        .map(|m| m.as_str())
}

/// A station time: a non-blank `HH:mm` cell, else `None`. Dash/empty cells for
/// the origin's arrival / destination's departure are treated as absent.
fn nullable_time(cell: Option<&str>) -> Option<String> {
    let time = cell.unwrap_or("").trim();
    TIME_RE.is_match(time).then(|| time.to_string())
}

/// `parseDelay`: `On Time` → 0, `Late by N min` → +N, `Early by N min` → −N,
/// `N min` → N, a bare integer → itself; anything else → `None`.
fn parse_delay(cell: Option<&str>) -> Option<i64> {
    let inner = cell.unwrap_or("").trim();
    if ON_TIME_RE.is_match(inner) {
        return Some(0);
    }
    if let Some(late) = LATE_BY_RE.captures(inner) {
        return late.get(1).and_then(|m| m.as_str().parse().ok());
    }
    if let Some(early) = EARLY_BY_RE.captures(inner) {
        return early
            .get(1)
            .and_then(|m| m.as_str().parse::<i64>().ok())
            .map(|n| -n);
    }
    if let Some(minutes) = MINUTES_RE.captures(inner) {
        return minutes.get(1).and_then(|m| m.as_str().parse().ok());
    }
    inner.parse().ok()
}

/// Platform number: a non-blank, non-zero, non-dash cell, else `None`.
fn platform(cell: Option<&str>) -> Option<String> {
    match cell.unwrap_or("").trim() {
        "" | "0" | "-" | "--" => None,
        pf => Some(pf.to_string()),
    }
}

/// The per-row reached/expected status token → explicit departed flag.
fn has_departed(cell: Option<&str>) -> Option<bool> {
    match cell.unwrap_or("").trim() {
        "Yet to start" | "Expected" => Some(false),
        "Reached" | "Departed" => Some(true),
        _ => None,
    }
}

struct ParsedStationRow {
    code: String,
    name: String,
    scheduled_arrival: Option<String>,
    scheduled_departure: Option<String>,
    actual_arrival: Option<String>,
    actual_departure: Option<String>,
    platform: Option<String>,
    day: i64,
    delay_minutes: Option<i64>,
    has_departed: Option<bool>,
}

fn parse_station_row(fragment: &str) -> Option<ParsedStationRow> {
    let code = cell(&STATION_CODE_RE, fragment)?.trim().to_string();
    if code.is_empty() {
        return None;
    }
    let day = cell(&DAY_RE, fragment)
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(1);
    Some(ParsedStationRow {
        code,
        name: cell(&STATION_NAME_RE, fragment)
            .unwrap_or("")
            .trim()
            .to_string(),
        scheduled_arrival: nullable_time(cell(&SCHEDULED_ARRIVAL_RE, fragment)),
        scheduled_departure: nullable_time(cell(&SCHEDULED_DEPARTURE_RE, fragment)),
        actual_arrival: nullable_time(cell(&ACTUAL_ARRIVAL_RE, fragment)),
        actual_departure: nullable_time(cell(&ACTUAL_DEPARTURE_RE, fragment)),
        platform: platform(cell(&PLATFORM_RE, fragment)),
        day,
        delay_minutes: parse_delay(cell(&DELAY_RE, fragment)),
        has_departed: has_departed(cell(&STATUS_RE, fragment)),
    })
}

/// `YYYYMMDD` -> `YYYYMMDD`: a passthrough validator. The RailMitra URL
/// (`/live-train-running-status/{train_no}`) has no date parameter, so unlike
/// the sibling adapters this converter does not reformat — it only validates,
/// for symmetry with the other crates.
pub fn to_railmitra_date(departure_date: &str) -> Option<String> {
    if departure_date.len() == 8 && departure_date.bytes().all(|b| b.is_ascii_digit()) {
        Some(departure_date.to_string())
    } else {
        None
    }
}

/// Map a RailMitra running-status page to a `MappedStatus`.
///
/// Error taxonomy: RailMitra has no positively-confirmed not-found signal, so
/// every unrecognized page (missing title, or a title with no parseable station
/// rows) is a [`ProviderError::Upstream`].
pub fn map_railmitra_payload(
    html: &str,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    let mut rows: Vec<ProviderStationRow> = Vec::new();
    for fragment in html.split(ROW_OPEN) {
        let Some(parsed) = parse_station_row(fragment) else {
            continue;
        };
        rows.push(ProviderStationRow {
            station_code: parsed.code,
            station_name: parsed.name,
            scheduled_arrival: parsed.scheduled_arrival,
            actual_arrival: parsed.actual_arrival,
            scheduled_departure: parsed.scheduled_departure,
            actual_departure: parsed.actual_departure,
            has_departed: parsed.has_departed,
            delay_minutes: parsed.delay_minutes,
            distance: None,
            platform: parsed.platform,
            halt_minutes: None,
            day: Some(parsed.day),
        });
    }

    if rows.is_empty() {
        let message = if TITLE_RE.is_match(html) {
            "no station table parsed"
        } else {
            "No RailMitra status page markers found (missing 'Train Running Status' title)"
        };
        return Err(ProviderError::upstream("railmitra", message));
    }

    let current_station_code = rows
        .iter()
        .find(|row| row.has_departed == Some(false))
        .or_else(|| rows.last())
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
