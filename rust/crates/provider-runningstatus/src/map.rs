//! Scrape a runningstatus.in status page into station rows and a
//! [`MappedStatus`].
//!
//! runningstatus.in is Cloudflare-guarded from this sandbox, so there is no
//! live fixture; the page structure is documented from Wayback snapshots and
//! the RSTGCN paper's scrape (§6 of `docs/providers-research.md`). The page is
//! a plain status `<table>` whose rows carry, per station, the station code,
//! name, scheduled arrival/departure, actual arrival/departure, and platform —
//! a layout very close to the RSTGCN scrape shape.
//!
//! The scraper is position-based and conservative (ZTA): a row is kept only
//! when a plausible station code (3–5 uppercase letters) is found, and any
//! cell that does not look like its expected value is left `None`. A page that
//! yields no rows surfaces as [`ProviderError::Upstream`], never a confirmed
//! not-found.

use std::sync::LazyLock;

use regex::Regex;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus, ProviderStationRow};
use tt_provider_core::ProviderError;

/// One table row: the inner HTML of a `<tr>`.
static ROW_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<tr[^>]*>(.*?)</tr>").unwrap());

/// A cell: its raw inner HTML (tags stripped later).
static CELL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>").unwrap());

/// A station code: 3–5 uppercase letters (the broadest safe pattern for Indian
/// railway codes — e.g. `HWH`, `ASN`, `NDLS`).
static STATION_CODE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z]{3,5}$").unwrap());

/// A 24-hour `HH:mm` time.
static TIME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{2}:\d{2}$").unwrap());

/// The journey day: a standalone small integer.
static DAY_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{1,2}$").unwrap());

/// A platform: a standalone integer (1–3 digits).
static PLATFORM_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{1,3}$").unwrap());

static TAGS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]*>").unwrap());

/// Drop every `<...>` and trim.
fn strip_tags(html: &str) -> String {
    TAGS_RE.replace_all(html, "").trim().to_string()
}

/// `YYYYMMDD` passthrough: `Some(departure_date)` only when it is 8 digits.
pub fn to_runningstatus_date(departure_date: &str) -> Option<String> {
    if departure_date.len() == 8 && departure_date.bytes().all(|b| b.is_ascii_digit()) {
        Some(departure_date.to_string())
    } else {
        None
    }
}

/// A `HH:mm` time, else `None`. `--`, empty, and non-time cells are absent.
fn nullable_time(text: &str) -> Option<String> {
    let time = text.trim();
    if TIME_RE.is_match(time) {
        Some(time.to_string())
    } else {
        None
    }
}

/// One status-row fragment into a row, or `None` when no plausible station
/// code is present.
///
/// The row is interpreted positionally (the runningstatus table has no
/// semantic cell classes): after the station code, the typical column order is
/// `name, sch-arr, sch-dep, act-arr, act-dep, platform`. Any layout drift is
/// absorbed by matching each cell against its expected pattern.
fn station_from_row(inner: &str) -> Option<ProviderStationRow> {
    let cells: Vec<String> = CELL_RE
        .captures_iter(inner)
        .filter_map(|caps| caps.get(1))
        .map(|m| strip_tags(m.as_str()))
        .collect();

    // Skip the header row (cells that are all words, no code).
    let code_index = cells
        .iter()
        .position(|cell| STATION_CODE_RE.is_match(cell.trim()))?;
    let code = cells[code_index].trim().to_string();

    let rest = &cells[code_index + 1..];

    // The first two `HH:mm`-looking cells are scheduled; the next two are
    // actuals when they are times or `--`/blank placeholders.
    let mut times = rest.iter().filter(|cell| {
        let c = cell.trim();
        TIME_RE.is_match(c) || c.is_empty() || c == "--"
    });

    let scheduled_arrival = times.next().and_then(|c| nullable_time(c));
    let scheduled_departure = times.next().and_then(|c| nullable_time(c));
    let actual_arrival = times.next().and_then(|c| nullable_time(c));
    let actual_departure = times.next().and_then(|c| nullable_time(c));

    let platform = rest.iter().find_map(|cell| {
        let cell = cell.trim();
        if PLATFORM_RE.is_match(cell) {
            Some(cell.to_string())
        } else {
            None
        }
    });

    let day = rest.iter().find_map(|cell| {
        let cell = cell.trim();
        if DAY_RE.is_match(cell) {
            cell.parse().ok()
        } else {
            None
        }
    });

    Some(ProviderStationRow {
        station_code: code,
        station_name: String::new(),
        scheduled_arrival,
        actual_arrival,
        scheduled_departure,
        actual_departure,
        has_departed: None,
        delay_minutes: None,
        distance: None,
        platform,
        halt_minutes: None,
        day,
    })
}

/// Parse the status page into normalized station rows. Rows without a
/// plausible station code are dropped.
pub fn parse_runningstatus_html(html: &str) -> Vec<ProviderStationRow> {
    ROW_RE
        .captures_iter(html)
        .filter_map(|caps| caps.get(1))
        .filter_map(|m| station_from_row(m.as_str()))
        .collect()
}

/// Map the status page to a `MappedStatus`.
///
/// Error taxonomy: a page yielding no station rows is an upstream error — a
/// blocked (Cloudflare) response, an anti-bot body, and a layout change all
/// look like this. There is no positively-confirmed not-found signal in the
/// runningstatus shape, so nothing maps to `NotFound`.
pub fn map_runningstatus_html(
    html: &str,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    let rows = parse_runningstatus_html(html);
    if rows.is_empty() {
        return Err(ProviderError::upstream(
            "runningstatus",
            "No stations parsed from runningstatus page",
        ));
    }

    Ok(assemble_mapped_status(
        &rows,
        &AssembleOptions {
            train_number: options.train_number.clone(),
            departure_date: options.departure_date.clone(),
            known_train: options.known_train.clone(),
            current_station_code: None,
            status_message: None,
            last_updated: None,
        },
    ))
}
