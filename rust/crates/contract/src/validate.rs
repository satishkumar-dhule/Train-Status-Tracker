/// Max query length for `GET /trains/search?q=` (`searchTrainsQueryQMax`).
pub const SEARCH_Q_MAX_LENGTH: usize = 64;
/// Inclusive lower bound for `GET /trains/search?limit=`.
pub const SEARCH_LIMIT_MIN: i64 = 1;
/// Inclusive upper bound for `GET /trains/search?limit=` (`searchTrainsQueryLimitMax`).
pub const SEARCH_LIMIT_MAX: i64 = 100;
/// Applied when `limit` is absent (matches `searchTrains(query, limit = 10)`).
pub const SEARCH_LIMIT_DEFAULT: i64 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchQueryError {
    Empty,
    TooLong,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchLimitError {
    NotAnInteger,
    OutOfRange,
}

/// `^\d{5}$` — exactly 5 ASCII digits (e.g. 22943).
///
/// Deliberately stricter than the JS regex `^\\d{5}$`, which also admits
/// non-ASCII decimal digits; the query params the server actually serves are
/// ASCII.
pub fn is_valid_train_number(raw: &str) -> bool {
    is_exactly_n_ascii_digits(raw, 5)
}

/// `^\d{8}$` — exactly 8 ASCII digits in YYYYMMDD shape (e.g. 20260802).
///
/// Shape-only: calendar validity is checked by the route layer
/// (`isValidApiDate` in the TS server), not by the query schema.
pub fn is_valid_departure_date(raw: &str) -> bool {
    is_exactly_n_ascii_digits(raw, 8)
}

/// `^\d{10}$` — exactly 10 ASCII digits (e.g. 2315455889). PNR queries.
pub fn is_valid_pnr(raw: &str) -> bool {
    is_exactly_n_ascii_digits(raw, 10)
}

/// Station code used by the between-stations / at-station endpoints:
/// 1–10 ASCII alphanumeric characters (Indian Railway codes are short
/// uppercase mixtures of letters and digits, e.g. `NDLS`).
pub fn is_valid_station_code(raw: &str) -> bool {
    !raw.is_empty() && raw.len() <= 10 && raw.bytes().all(|b| b.is_ascii_alphanumeric())
}

fn is_exactly_n_ascii_digits(raw: &str, n: usize) -> bool {
    raw.len() == n && raw.bytes().all(|b| b.is_ascii_digit())
}

/// `zod.coerce.string().trim().max(64)` — trim first, then length-check the
/// trimmed value. A query that is empty after trimming is rejected.
pub fn parse_search_q(raw: &str) -> Result<String, SearchQueryError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(SearchQueryError::Empty);
    }
    if utf16_len(trimmed) > SEARCH_Q_MAX_LENGTH {
        return Err(SearchQueryError::TooLong);
    }
    Ok(trimmed.to_string())
}

/// JS string length counts UTF-16 code units; `str::chars` counts code points.
/// `encode_utf16` reproduces the Zod `max` check exactly.
fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// `zod.coerce.number().int().min(1).max(100).optional()` — absent becomes
/// `SEARCH_LIMIT_DEFAULT`; present values are coerced from a string, must be
/// an integer in the inclusive range, and out-of-range values are rejected
/// (never clamped), matching Zod.
///
/// Coercion follows JS `Number()` for the cases that matter in practice:
/// surrounding whitespace is ignored, and scientific notation such as `1e2`
/// is accepted. Hexadecimal/binary/octal prefixes (`0x10`) that JS `Number()`
/// also accepts are not supported.
pub fn parse_search_limit(raw: Option<&str>) -> Result<i64, SearchLimitError> {
    let Some(raw) = raw else {
        return Ok(SEARCH_LIMIT_DEFAULT);
    };
    let n: f64 = raw
        .trim()
        .parse()
        .map_err(|_| SearchLimitError::NotAnInteger)?;
    if !n.is_finite() || n.fract() != 0.0 {
        return Err(SearchLimitError::NotAnInteger);
    }
    if !(SEARCH_LIMIT_MIN as f64..=SEARCH_LIMIT_MAX as f64).contains(&n) {
        return Err(SearchLimitError::OutOfRange);
    }
    Ok(n as i64)
}
