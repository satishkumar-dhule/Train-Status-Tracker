//! Time/date domain helpers, ported 1:1 from `lib/trains-data/src/time.ts`.
//! Single source of truth for HH:MM parsing, delay math and date formatting.

const SHORT_MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// A calendar date as `{ year, month, day }`. `now` parameters on the date
/// helpers take this shape so tests can pin the clock without network/IO.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct LocalDate {
    pub year: i32,
    pub month: u32,
    pub day: u32,
}

impl LocalDate {
    /// Validate that `(year, month, day)` is a real calendar date.
    pub fn new(year: i32, month: u32, day: u32) -> Option<LocalDate> {
        if !(1..=12).contains(&month) {
            return None;
        }
        if day < 1 || day > days_in_month(year, month) {
            return None;
        }
        Some(LocalDate { year, month, day })
    }

    /// Parse `"YYYY-MM-DD"`. Returns `None` when malformed or not a real date.
    pub fn from_iso(iso: &str) -> Option<LocalDate> {
        let mut parts = iso.split('-');
        let (year, month, day) = (parts.next()?, parts.next()?, parts.next()?);
        if parts.next().is_some() {
            return None;
        }
        let year = year.parse().ok()?;
        let month = month.parse().ok()?;
        let day = day.parse().ok()?;
        LocalDate::new(year, month, day)
    }

    /// Today's date. Mirrors the TS `new Date()` default; uses UTC rather than
    /// the local timezone (tests always pass an explicit `now`).
    pub fn today() -> LocalDate {
        let seconds = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let (y, m, d) = civil_from_days(seconds.div_euclid(86_400));
        LocalDate {
            year: y,
            month: m,
            day: d,
        }
    }

    /// `"YYYY-MM-DD"` (zero-padded).
    pub fn to_iso(&self) -> String {
        format!("{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }

    /// Shift by `offset` calendar days (negative goes back).
    pub fn add_days(&self, offset: i64) -> LocalDate {
        let (y, m, d) = civil_from_days(days_from_civil(self.year, self.month, self.day) + offset);
        LocalDate {
            year: y,
            month: m,
            day: d,
        }
    }
}

fn is_leap_year(year: i32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Hinnant's algorithm).
fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    i64::from(era) * 146_097 + i64::from(doe) - 719_468
}

/// Inverse of `days_from_civil`: civil date from days since 1970-01-01.
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

fn is_iso_date_format(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() == 10
        && bytes[0].is_ascii_digit()
        && bytes[1].is_ascii_digit()
        && bytes[2].is_ascii_digit()
        && bytes[3].is_ascii_digit()
        && bytes[4] == b'-'
        && bytes[5].is_ascii_digit()
        && bytes[6].is_ascii_digit()
        && bytes[7] == b'-'
        && bytes[8].is_ascii_digit()
        && bytes[9].is_ascii_digit()
}

/// Parse `"HH:MM"` and return total minutes since midnight, or `None`.
pub fn to_minutes(t: Option<&str>) -> Option<i32> {
    let t = t?;
    let mut parts = t.split(':');
    let (h, m) = (parts.next()?, parts.next()?);
    if parts.next().is_some() {
        return None;
    }
    let h: i32 = h.parse().ok()?;
    let m: i32 = m.parse().ok()?;
    Some(h * 60 + m)
}

/// Signed delay (actual - scheduled) in minutes, accounting for day roll-overs
/// (e.g. scheduled 23:50, actual 00:10 -> +20 min).
pub fn calc_delay(scheduled: Option<&str>, actual: Option<&str>) -> Option<i32> {
    let s = to_minutes(scheduled)?;
    let a = to_minutes(actual)?;
    let mut diff = a - s;
    if diff < -720 {
        diff += 1440;
    }
    if diff > 720 {
        diff -= 1440;
    }
    Some(diff)
}

/// `"YYYY-MM-DD"` must be a real calendar date and >= today.
pub fn is_valid_departure_date(date_iso: &str, now: Option<LocalDate>) -> bool {
    if !is_iso_date_format(date_iso) {
        return false;
    }
    let Some(date) = LocalDate::from_iso(date_iso) else {
        return false;
    };
    let today = now.unwrap_or_else(LocalDate::today);
    date >= today
}

/// `"YYYYMMDD"` must be a real calendar date (server-side gate).
pub fn is_valid_api_date(api_date: &str) -> bool {
    if !(api_date.len() == 8 && api_date.bytes().all(|b| b.is_ascii_digit())) {
        return false;
    }
    let y: i32 = api_date[0..4].parse().unwrap_or(0);
    let m: u32 = api_date[4..6].parse().unwrap_or(0);
    let d: u32 = api_date[6..8].parse().unwrap_or(0);
    LocalDate::new(y, m, d).is_some()
}

/// `"YYYY-MM-DD"` -> `"YYYYMMDD"`.
pub fn to_api_date(date_iso: &str) -> String {
    date_iso.replace('-', "")
}

/// `"YYYYMMDD"` -> `"YYYY-MM-DD"`; returns the input unchanged when malformed.
pub fn from_api_date(api_date: &str) -> String {
    if api_date.len() == 8 && api_date.bytes().all(|b| b.is_ascii_digit()) {
        format!(
            "{}-{}-{}",
            &api_date[0..4],
            &api_date[4..6],
            &api_date[6..8]
        )
    } else {
        api_date.to_string()
    }
}

/// Best default departure date (`YYYYMMDD`) for a train whose run dates are
/// known: today when the train runs today, otherwise the most recent past run,
/// otherwise the next upcoming run. Returns `None` when there are no runs.
/// `runs` must be sorted ascending.
pub fn pick_default_run_date(runs: &[String], now: Option<LocalDate>) -> Option<String> {
    if runs.is_empty() {
        return None;
    }
    let today_api = to_api_date(&get_upcoming_dates(1, now)[0]);
    if runs.contains(&today_api) {
        return Some(today_api);
    }
    for date in runs.iter().rev() {
        if date.as_str() < today_api.as_str() {
            return Some(date.clone());
        }
    }
    runs.iter().find(|date| date.as_str() > today_api.as_str()).cloned()
}

/// `"YYYY-MM-DD"` for today .. today+count-1.
pub fn get_upcoming_dates(count: usize, now: Option<LocalDate>) -> Vec<String> {
    if count == 0 {
        return Vec::new();
    }
    let base = now.unwrap_or_else(LocalDate::today);
    (0..count as i64)
        .map(|i| base.add_days(i).to_iso())
        .collect()
}

/// `"YYYY-MM-DD"` for a window centered on today: today-before .. today+after.
pub fn get_date_window(before: i32, after: i32, now: Option<LocalDate>) -> Vec<String> {
    if before < 0 || after < 0 {
        return Vec::new();
    }
    let base = now.unwrap_or_else(LocalDate::today);
    (-before..=after)
        .map(|offset| base.add_days(i64::from(offset)).to_iso())
        .collect()
}

/// `"YYYY-MM-DD"` -> `"2 Aug"`; returns the input unchanged when malformed.
pub fn format_short_date(date_iso: &str) -> String {
    let Some(date) = LocalDate::from_iso(date_iso) else {
        return date_iso.to_string();
    };
    if date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31 {
        return date_iso.to_string();
    }
    format!("{} {}", date.day, SHORT_MONTHS[(date.month - 1) as usize])
}

/// 510 -> `"8h 30m"`; 45 -> `"45m"`; 480 -> `"8h"`; invalid -> `"--"`.
pub fn format_duration(total_minutes: f64) -> String {
    if !total_minutes.is_finite() || total_minutes < 0.0 {
        return "--".to_string();
    }
    let hours = (total_minutes / 60.0).floor() as i64;
    let minutes = (total_minutes % 60.0).round() as i64;
    if hours == 0 {
        return format!("{}m", minutes);
    }
    if minutes == 0 {
        return format!("{}h", hours);
    }
    format!("{}h {}m", hours, minutes)
}
