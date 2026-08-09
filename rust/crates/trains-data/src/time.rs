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

/// Day-of-week index for a civil date: 0 = Sunday .. 6 = Saturday, matching
/// `Date.prototype.getDay()` on a date whose local timezone is UTC.
pub fn weekday_of(date: LocalDate) -> usize {
    // 1970-01-01 was a Thursday (4 when 0 = Sunday).
    ((days_from_civil(date.year, date.month, date.day) + 4).rem_euclid(7)) as usize
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
/// All intermediate arithmetic is `i64` so the mixed-sign day-of-year math
/// (`yoe * 365 + ... + doy`) never truncates or wraps.
fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = i64::from(if m <= 2 { y - 1 } else { y });
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (i64::from(m) + 9) % 12;
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Inverse of `days_from_civil`: civil date from days since 1970-01-01.
/// The year/month/day are only narrowed back to `(i32, u32, u32)` once the
/// full computation has settled in `i64`.
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
    (y as i32, m as u32, d as u32)
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
    runs.iter()
        .find(|date| date.as_str() > today_api.as_str())
        .cloned()
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
///
/// Mirrors the TS `formatShortDate` exactly: only the shape (`YYYY-MM-DD`)
/// and the coarse month/day ranges are checked — no real-calendar validation,
/// so `"2026-02-31"` formats as `"31 Feb"` just like the reference.
pub fn format_short_date(date_iso: &str) -> String {
    if !is_iso_date_format(date_iso) {
        return date_iso.to_string();
    }
    let month: u32 = date_iso[5..7].parse().unwrap_or(0);
    let day: u32 = date_iso[8..10].parse().unwrap_or(0);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return date_iso.to_string();
    }
    format!("{} {}", day, SHORT_MONTHS[(month - 1) as usize])
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

#[cfg(test)]
mod tests {
    use super::*;

    fn aug5() -> LocalDate {
        LocalDate {
            year: 2026,
            month: 8,
            day: 5,
        }
    }

    // Port of `toMinutes` in time.test.ts.
    #[test]
    fn to_minutes_parses_hh_mm() {
        assert_eq!(to_minutes(Some("08:30")), Some(510));
        assert_eq!(to_minutes(Some("00:05")), Some(5));
        assert_eq!(to_minutes(Some("23:59")), Some(1439));
    }

    #[test]
    fn to_minutes_returns_none_for_malformed_input() {
        assert_eq!(to_minutes(None), None);
        assert_eq!(to_minutes(Some("")), None);
        assert_eq!(to_minutes(Some("8")), None);
        assert_eq!(to_minutes(Some("08:30:00")), None);
        assert_eq!(to_minutes(Some("abc")), None);
    }

    // Port of `calcDelay` in time.test.ts.
    #[test]
    fn calc_delay_computes_a_positive_delay() {
        assert_eq!(calc_delay(Some("08:00"), Some("08:20")), Some(20));
    }

    #[test]
    fn calc_delay_computes_a_negative_delay() {
        assert_eq!(calc_delay(Some("08:20"), Some("08:00")), Some(-20));
    }

    #[test]
    fn calc_delay_handles_midnight_roll_over() {
        assert_eq!(calc_delay(Some("23:50"), Some("00:10")), Some(20));
    }

    #[test]
    fn calc_delay_handles_roll_over_in_the_other_direction() {
        assert_eq!(calc_delay(Some("00:10"), Some("23:50")), Some(-20));
    }

    #[test]
    fn calc_delay_returns_none_when_either_time_is_missing() {
        assert_eq!(calc_delay(None, Some("08:00")), None);
        assert_eq!(calc_delay(Some("08:00"), None), None);
    }

    // Port of the `date helpers` block in time.test.ts.
    #[test]
    fn is_valid_departure_date_rejects_malformed_and_nonexistent_dates() {
        assert!(!is_valid_departure_date("2026-13-01", Some(aug5())));
        assert!(!is_valid_departure_date("2026-00-10", Some(aug5())));
        assert!(!is_valid_departure_date("2026-02-30", Some(aug5())));
        assert!(!is_valid_departure_date("not-a-date", Some(aug5())));
    }

    #[test]
    fn is_valid_departure_date_requires_today_or_later() {
        assert!(is_valid_departure_date("2026-08-05", Some(aug5())));
        assert!(is_valid_departure_date("2026-08-06", Some(aug5())));
        assert!(!is_valid_departure_date("2026-08-04", Some(aug5())));
    }

    #[test]
    fn is_valid_api_date_accepts_only_real_dates() {
        assert!(is_valid_api_date("20260805"));
        assert!(!is_valid_api_date("20261399"));
        assert!(!is_valid_api_date("20260230"));
        assert!(!is_valid_api_date("2026085"));
        assert!(!is_valid_api_date("abcd"));
    }

    #[test]
    fn to_api_date_strips_dashes() {
        assert_eq!(to_api_date("2026-08-05"), "20260805");
    }

    #[test]
    fn from_api_date_inserts_dashes() {
        assert_eq!(from_api_date("20260805"), "2026-08-05");
        assert_eq!(from_api_date("garbage"), "garbage");
        assert_eq!(from_api_date("2026085"), "2026085");
    }

    #[test]
    fn pick_default_run_date_prefers_today_when_it_is_a_run() {
        let runs: Vec<String> = vec!["20260803", "20260805", "20260812"]
            .into_iter()
            .map(str::to_string)
            .collect();
        assert_eq!(
            pick_default_run_date(&runs, Some(aug5())).as_deref(),
            Some("20260805"),
        );
    }

    #[test]
    fn pick_default_run_date_falls_back_to_most_recent_past_run() {
        let runs: Vec<String> = vec!["20260804", "20260806"]
            .into_iter()
            .map(str::to_string)
            .collect();
        assert_eq!(
            pick_default_run_date(&runs, Some(aug5())).as_deref(),
            Some("20260804"),
        );
    }

    #[test]
    fn pick_default_run_date_falls_back_to_next_run_when_none_are_past() {
        let runs: Vec<String> = vec!["20260806".to_string()];
        assert_eq!(
            pick_default_run_date(&runs, Some(aug5())).as_deref(),
            Some("20260806"),
        );
    }

    #[test]
    fn pick_default_run_date_returns_none_without_runs() {
        assert_eq!(pick_default_run_date(&[], Some(aug5())), None);
    }

    #[test]
    fn get_upcoming_dates_returns_n_consecutive_local_dates() {
        assert_eq!(get_upcoming_dates(0, Some(aug5())), Vec::<String>::new());
        assert_eq!(
            get_upcoming_dates(3, Some(aug5())),
            vec!["2026-08-05", "2026-08-06", "2026-08-07"],
        );
        let eoy = LocalDate {
            year: 2026,
            month: 12,
            day: 31,
        };
        assert_eq!(
            get_upcoming_dates(2, Some(eoy)),
            vec!["2026-12-31", "2027-01-01"],
        );
    }

    #[test]
    fn get_date_window_returns_a_symmetric_window_centered_on_today() {
        assert_eq!(
            get_date_window(3, 3, Some(aug5())),
            vec![
                "2026-08-02",
                "2026-08-03",
                "2026-08-04",
                "2026-08-05",
                "2026-08-06",
                "2026-08-07",
                "2026-08-08",
            ],
        );
        assert_eq!(get_date_window(0, 0, Some(aug5())), vec!["2026-08-05"]);
        assert_eq!(
            get_date_window(1, 0, Some(aug5())),
            vec!["2026-08-04", "2026-08-05"],
        );
    }

    #[test]
    fn get_date_window_crosses_month_and_year_boundaries() {
        let jan2 = LocalDate {
            year: 2026,
            month: 1,
            day: 2,
        };
        assert_eq!(
            get_date_window(3, 3, Some(jan2)),
            vec![
                "2025-12-30",
                "2025-12-31",
                "2026-01-01",
                "2026-01-02",
                "2026-01-03",
                "2026-01-04",
                "2026-01-05",
            ],
        );
    }

    #[test]
    fn get_date_window_rejects_negative_ranges() {
        assert_eq!(get_date_window(-1, 3, Some(aug5())), Vec::<String>::new());
        assert_eq!(get_date_window(3, -1, Some(aug5())), Vec::<String>::new());
    }

    // Port of `formatShortDate` in time.test.ts.
    #[test]
    fn format_short_date_formats_as_day_month() {
        assert_eq!(format_short_date("2026-08-02"), "2 Aug");
    }

    #[test]
    fn format_short_date_returns_input_unchanged_when_malformed() {
        assert_eq!(format_short_date("garbage"), "garbage");
        assert_eq!(format_short_date("2026-13-40"), "2026-13-40");
    }

    // Port of `formatDuration` in time.test.ts.
    #[test]
    fn format_duration_formats_minutes_and_hours() {
        assert_eq!(format_duration(45.0), "45m");
        assert_eq!(format_duration(480.0), "8h");
        assert_eq!(format_duration(510.0), "8h 30m");
    }

    #[test]
    fn format_duration_handles_invalid_input() {
        assert_eq!(format_duration(-1.0), "--");
        assert_eq!(format_duration(f64::NAN), "--");
        assert_eq!(format_duration(f64::INFINITY), "--");
    }

    #[test]
    fn local_date_add_days_round_trips() {
        // Guards the civil <-> days arithmetic used by every date helper.
        for (y, m, d) in [
            (1970, 1, 1),
            (2024, 2, 29),
            (2025, 12, 31),
            (2026, 1, 1),
            (2026, 8, 5),
            (2027, 1, 1),
            (2099, 12, 31),
        ] {
            let date = LocalDate::new(y, m, d).unwrap();
            assert_eq!(date.add_days(0), date);
            assert_eq!(date.add_days(1).add_days(-1), date);
            assert_eq!(date.add_days(-1).add_days(1), date);
            // Walking a whole year forward and back lands on the same date.
            assert_eq!(date.add_days(366).add_days(-366), date);
        }
    }

    #[test]
    fn weekday_of_matches_date_getday() {
        // 1970-01-01 was a Thursday (4 when 0 = Sunday).
        assert_eq!(weekday_of(LocalDate::new(1970, 1, 1).unwrap()), 4);
        // Known anchor: 2026-08-05 is a Wednesday.
        assert_eq!(weekday_of(LocalDate::new(2026, 8, 5).unwrap()), 3);
        assert_eq!(weekday_of(LocalDate::new(2026, 8, 9).unwrap()), 0);
        assert_eq!(weekday_of(LocalDate::new(2026, 8, 10).unwrap()), 1);
        // A full week returns to the same weekday.
        let start = LocalDate::new(2026, 1, 1).unwrap();
        assert_eq!(weekday_of(start.add_days(7)), weekday_of(start));
    }

    #[test]
    fn leap_year_days_are_correct() {
        assert!(LocalDate::new(2024, 2, 29).is_some());
        assert!(LocalDate::new(2023, 2, 29).is_none());
        assert!(LocalDate::new(2000, 2, 29).is_some());
        assert!(LocalDate::new(1900, 2, 29).is_none());
    }
}
