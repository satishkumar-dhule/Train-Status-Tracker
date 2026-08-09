//! Map an EaseMyTrip running-status page to a [`MappedStatus`], ported 1:1
//! from `parseEaseMyTripHtml` / `mapEaseMyTripHtml` in
//! `lib/providers/easemytrip.ts`. The page is scraped with the exact regexes
//! from the reference implementation (no HTML parser — the layout-dependent
//! extraction is pinned by the ported fixtures).

use std::sync::LazyLock;

use regex::Regex;
use tt_mapper::{assemble_mapped_status, AssembleOptions, MappedStatus, ProviderStationRow};
use tt_provider_core::ProviderError;

const STATION_BLOCK_OPEN: &str = "<div class=\"station-item \">";

static CODE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<div class="code">([^<]*)</div>"#).unwrap());
static KM_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<div class="km">([^<]*)</div>"#).unwrap());
static CURRENT_DOT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"class="dot[^"]*blink blue"#).unwrap());
static STATION_NAME_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"<div class="[^"]*station-name[^"]*">([\s\S]*?)</div>"#).unwrap()
});
static STRONG_NAME_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<strong>([^<]*)</strong>"#).unwrap());
static ANCHOR_NAME_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<a[^>]*>\s*<span>([^<]*)</span>"#).unwrap());
static SPAN_NAME_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<span>([^<]*)</span>"#).unwrap());
static PLATFORM_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"PF\s*([^<\s]*)<"#).unwrap());
static DELAY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<div class="delay">([\s\S]*?)</div>"#).unwrap());
static ARRIVAL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<div class="avl_times">[\s\S]*?<span>([^<]*)</span>"#).unwrap());
static DEPARTURE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"<div class="dprt_times">[\s\S]*?<span>([^<]*)</span>"#).unwrap()
});
static TITLE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<h2[^>]*>\s*(\d{4,5})\s+([\s\S]*?)Running Status"#).unwrap());
static LAST_UPDATED_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<strong>Last Updated:</strong>\s*([\s\S]*?)</p>"#).unwrap());
static ON_TIME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)On Time").unwrap());
static LATE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Late by\s*(\d+)\s*min").unwrap());
static EARLY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Early by\s*(\d+)\s*min").unwrap());

/// `stripTags` — drop every `<...>` and trim.
fn strip_tags(html: &str) -> String {
    static TAGS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"<[^>]*>"#).unwrap());
    TAGS_RE.replace_all(html, "").trim().to_string()
}

struct ParsedStation {
    code: String,
    name: String,
    platform: Option<String>,
    delay_minutes: Option<i64>,
    arrival: Option<String>,
    departure: Option<String>,
    distance: Option<i64>,
    is_current: bool,
}

/// `parseDelay`: `On Time` → 0, `Late by N min` → +N, `Early by N min` → −N,
/// anything else → null.
fn parse_delay(inner: &str) -> Option<i64> {
    if ON_TIME_RE.is_match(inner) {
        return Some(0);
    }
    if let Some(late) = LATE_RE.captures(inner) {
        return late.get(1).and_then(|m| m.as_str().parse().ok());
    }
    if let Some(early) = EARLY_RE.captures(inner) {
        return early
            .get(1)
            .and_then(|m| m.as_str().parse::<i64>().ok())
            .map(|n| -n);
    }
    None
}

/// `parseTime`: trim; empty becomes null.
fn parse_time(inner: Option<&str>) -> Option<String> {
    let time = inner.unwrap_or("").trim();
    if time.is_empty() {
        None
    } else {
        Some(time.to_string())
    }
}

/// `parseStationBlock` — one station-item block into a [`ParsedStation`], or
/// `None` when the block has no station code (headers, intermediate-station
/// toggles).
fn parse_station_block(block: &str) -> Option<ParsedStation> {
    let code_match = CODE_RE.captures(block)?;
    let code = code_match.get(1)?.as_str().trim().to_string();

    let name_match = STATION_NAME_RE.captures(block);
    let mut name = String::new();
    let mut platform = None;
    if let Some(name_match) = &name_match {
        let inner = name_match.get(1).map(|m| m.as_str()).unwrap_or("");
        name = STRONG_NAME_RE
            .captures(inner)
            .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
            .or_else(|| {
                ANCHOR_NAME_RE
                    .captures(inner)
                    .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
            })
            .or_else(|| {
                SPAN_NAME_RE
                    .captures(inner)
                    .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
            })
            .unwrap_or_else(|| strip_tags(inner));
        let pf = PLATFORM_RE.captures(inner);
        platform = pf
            .and_then(|c| c.get(1))
            .filter(|m| !m.as_str().is_empty())
            .map(|m| m.as_str().trim().to_string());
    }

    let delay_minutes = DELAY_RE
        .captures(block)
        .and_then(|c| c.get(1))
        .and_then(|m| parse_delay(m.as_str()));

    let arrival = ARRIVAL_RE
        .captures(block)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()));
    let departure = DEPARTURE_RE
        .captures(block)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()));

    // `Number(kmMatch[1].replace("Km", "").trim())`, finite only.
    let distance = KM_RE
        .captures(block)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().replace("Km", "").trim().to_string())
        .and_then(|km| km.parse::<f64>().ok())
        .filter(|km| km.is_finite())
        .map(|km| km as i64);

    Some(ParsedStation {
        code,
        name: name.trim().to_string(),
        platform,
        delay_minutes,
        arrival: parse_time(arrival.as_deref()),
        departure: parse_time(departure.as_deref()),
        distance,
        is_current: CURRENT_DOT_RE.is_match(block),
    })
}

/// The page-level facts extracted by `parseEaseMyTripHtml`.
#[derive(Debug, Default)]
pub struct ParsedEaseMyTripPage {
    /// Normalized station rows in page order (intermediate stations skipped).
    pub rows: Vec<ProviderStationRow>,
    /// Code of the station carrying the current-location dot, if any.
    pub current_station_code: Option<String>,
    /// Train number from the `<h2>…Running Status` title, if present.
    pub title_train_number: Option<String>,
    /// `Last Updated:` text (tags stripped), if present.
    pub last_updated: Option<String>,
}

/// Parse the EaseMyTrip running-status page into normalized rows.
pub fn parse_easemytrip_html(html: &str) -> ParsedEaseMyTripPage {
    let title_train_number = TITLE_RE
        .captures(html)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()));

    let last_updated = LAST_UPDATED_RE
        .captures(html)
        .and_then(|c| c.get(1).map(|m| strip_tags(m.as_str())));

    let mut current_station_code = None;
    let mut rows = Vec::new();
    for block in html.split(STATION_BLOCK_OPEN) {
        let Some(parsed) = parse_station_block(block) else {
            continue;
        };
        if parsed.is_current {
            current_station_code = Some(parsed.code.clone());
        }
        rows.push(ProviderStationRow {
            station_code: parsed.code,
            station_name: parsed.name,
            scheduled_arrival: parsed.arrival,
            actual_arrival: None,
            scheduled_departure: parsed.departure,
            actual_departure: None,
            has_departed: None,
            delay_minutes: parsed.delay_minutes,
            distance: parsed.distance,
            platform: parsed.platform,
            halt_minutes: None,
            day: Some(1),
        });
    }

    ParsedEaseMyTripPage {
        rows,
        current_station_code,
        title_train_number,
        last_updated,
    }
}

/// `YYYYMMDD` -> `DD/MM/YYYY`, or `None` when the input is not a valid 8-digit
/// date. Mirrors `toEaseMyTripDate`.
pub fn to_easemytrip_date(departure_date: &str) -> Option<String> {
    if departure_date.len() == 8 && departure_date.bytes().all(|b| b.is_ascii_digit()) {
        Some(format!(
            "{}/{}/{}",
            &departure_date[6..8],
            &departure_date[4..6],
            &departure_date[0..4]
        ))
    } else {
        None
    }
}

/// Map the EaseMyTrip page to a `MappedStatus`. A page that does not even name
/// the requested train is a positively-confirmed not-found; a page that names
/// it but yields no stations means the layout likely changed and surfaces as
/// an upstream error rather than a cached false 404.
pub fn map_easemytrip_html(
    html: &str,
    options: &AssembleOptions,
) -> Result<MappedStatus, ProviderError> {
    let parsed = parse_easemytrip_html(html);

    if parsed.rows.is_empty() {
        if parsed.title_train_number.is_none() {
            return Err(ProviderError::not_found("easemytrip"));
        }
        return Err(ProviderError::upstream(
            "easemytrip",
            "No stations parsed from EaseMyTrip page",
        ));
    }

    Ok(assemble_mapped_status(
        &parsed.rows,
        &AssembleOptions {
            train_number: options.train_number.clone(),
            departure_date: options.departure_date.clone(),
            known_train: options.known_train.clone(),
            current_station_code: parsed.current_station_code,
            status_message: None,
            last_updated: parsed.last_updated,
        },
    ))
}
