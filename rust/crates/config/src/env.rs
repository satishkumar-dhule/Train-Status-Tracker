//! Pure environment-parsing helpers, ported from `lib/env.ts`
//! (`envPositiveNumber`) and the fail-open parse rules used across the
//! TypeScript server. A missing, empty, or unparseable value never crashes
//! startup — it falls back to its default.

use std::collections::BTreeMap;

/// Reads the process environment into a sorted, deterministic `BTreeMap`.
pub(crate) fn process_env() -> BTreeMap<String, String> {
    std::env::vars().collect()
}

/// Trimmed value for `key`, or `None` when the variable is missing or blank.
pub(crate) fn trimmed<'a>(env: &'a BTreeMap<String, String>, key: &str) -> Option<&'a str> {
    env.get(key)
        .map(String::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Port of `envPositiveNumber`: parses a positive finite number.
///
/// `Some(value)` when the raw value trims to something `Number()` would accept
/// as finite and greater than zero; `None` otherwise (including `NaN`,
/// `Infinity`, `-Infinity`, `0`, negatives, and garbage).
fn positive_f64(raw: Option<&str>) -> Option<f64> {
    let raw = raw.map(str::trim).filter(|s| !s.is_empty())?;
    let value = raw.parse::<f64>().ok()?;
    (value.is_finite() && value > 0.0).then_some(value)
}

/// Port of `envPositiveNumber` for integer fields. The parsed value is floored
/// (matching `Number(...)` + later integer coercion) and saturates on overflow.
pub(crate) fn positive_u64(env: &BTreeMap<String, String>, key: &str, fallback: u64) -> u64 {
    positive_f64(env.get(key).map(String::as_str))
        .map(f64::floor)
        .map(|v| v as u64)
        .unwrap_or(fallback)
}

/// `positive_u64` narrowed to 32 bits (used for the QoS failure threshold).
pub(crate) fn positive_u32(env: &BTreeMap<String, String>, key: &str, fallback: u32) -> u32 {
    positive_f64(env.get(key).map(String::as_str))
        .map(f64::floor)
        .and_then(|v| u32::try_from(v as u64).ok())
        .unwrap_or(fallback)
}

/// Port of `envPositiveNumber` for the port, narrowed to `u16`.
pub(crate) fn port(env: &BTreeMap<String, String>, key: &str, fallback: u16) -> u16 {
    positive_f64(env.get(key).map(String::as_str))
        .map(f64::floor)
        .and_then(|v| u16::try_from(v as u64).ok())
        .unwrap_or(fallback)
}

/// Whether a raw flag should be treated as true. Accepts the common truthy
/// spellings (`true`, `1`, `yes`, `on`) case-insensitively, matching the
/// `ENABLED_VALUE_PATTERN` in `lib/telemetry.ts`.
pub(crate) fn truthy(raw: Option<&str>) -> bool {
    matches!(
        raw.map(str::trim).map(str::to_ascii_lowercase).as_deref(),
        Some("true" | "1" | "yes" | "on")
    )
}

/// Port of `parseHeaders` in `lib/telemetry.ts`: parses `k1=v1,k2=v2` into
/// ordered pairs. Malformed pairs (no `=`, or an empty key) are skipped; empty
/// input yields `None`.
pub(crate) fn parse_headers(raw: Option<&str>) -> Option<Vec<(String, String)>> {
    let raw = raw.map(str::trim).filter(|s| !s.is_empty())?;
    let mut headers = Vec::new();
    for pair in raw.split(',') {
        let pair = pair.trim();
        let Some(eq) = pair.find('=') else { continue };
        if eq == 0 {
            continue;
        }
        headers.push((
            pair[..eq].trim().to_string(),
            pair[eq + 1..].trim().to_string(),
        ));
    }
    (!headers.is_empty()).then_some(headers)
}

/// Port of `parseSampleRatio` in `lib/telemetry.ts`: a float in `[0, 1]`,
/// otherwise `1.0`.
pub(crate) fn sample_ratio(raw: Option<&str>) -> f64 {
    let Ok(ratio) = raw.map(str::trim).unwrap_or("").parse::<f64>() else {
        return DEFAULT_SAMPLE_RATIO;
    };
    if ratio.is_finite() && (0.0..=1.0).contains(&ratio) {
        ratio
    } else {
        DEFAULT_SAMPLE_RATIO
    }
}

/// Comma-separated origin list, trimmed, empty entries dropped; `None` when the
/// result is empty (port of the `buildCorsOptions` split in `app.ts`).
pub(crate) fn origin_list(raw: Option<&str>) -> Option<Vec<String>> {
    let raw = raw.map(str::trim).filter(|s| !s.is_empty())?;
    let origins: Vec<String> = raw
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    (!origins.is_empty()).then_some(origins)
}

/// Fraction in `[0, 1)` — used for `STATUS_CACHE_TTL_JITTER`. Anything else
/// (non-numeric, negative, `>= 1`) falls back; `0` is valid (disables jitter).
pub(crate) fn fraction(env: &BTreeMap<String, String>, key: &str, fallback: f64) -> f64 {
    let Ok(raw) = env
        .get(key)
        .map(String::as_str)
        .map(str::trim)
        .unwrap_or("")
        .parse::<f64>()
    else {
        return fallback;
    };
    if raw.is_finite() && (0.0..1.0).contains(&raw) {
        raw
    } else {
        fallback
    }
}

const DEFAULT_SAMPLE_RATIO: f64 = 1.0;

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    // Port of `env.test.ts` — `envPositiveNumber`.
    #[test]
    fn positive_number_returns_fallback_when_unset() {
        assert_eq!(positive_u64(&BTreeMap::new(), "TTL", 42), 42);
    }

    #[test]
    fn positive_number_parses_a_valid_value() {
        assert_eq!(positive_u64(&env(&[("TTL", "5000")]), "TTL", 42), 5000);
    }

    #[test]
    fn positive_number_ignores_surrounding_whitespace() {
        assert_eq!(positive_u64(&env(&[("TTL", "  5000  ")]), "TTL", 42), 5000);
    }

    #[test]
    fn positive_number_falls_back_for_invalid_values() {
        for value in ["0", "-1", "abc", "NaN", "Infinity", "-Infinity", ""] {
            assert_eq!(
                positive_u64(&env(&[("TTL", value)]), "TTL", 42),
                42,
                "value {value:?} should fall back"
            );
        }
    }

    #[test]
    fn port_narrows_to_u16() {
        assert_eq!(port(&env(&[("PORT", "8080")]), "PORT", 5000), 8080);
        assert_eq!(port(&env(&[("PORT", "99999")]), "PORT", 5000), 5000);
        assert_eq!(port(&env(&[("PORT", "0")]), "PORT", 5000), 5000);
    }

    #[test]
    fn truthy_accepts_common_spellings_case_insensitively() {
        for value in ["true", "TRUE", "1", "yes", "on"] {
            assert!(truthy(Some(value)), "{value:?} should be truthy");
        }
        for value in ["false", "0", "no", "off", "2", ""] {
            assert!(!truthy(Some(value)), "{value:?} should not be truthy");
        }
        assert!(!truthy(None));
    }

    #[test]
    fn headers_parse_pairs_and_skip_malformed() {
        assert_eq!(
            parse_headers(Some("Authorization=Bearer token, X-Key=a=b")),
            Some(vec![
                ("Authorization".to_string(), "Bearer token".to_string()),
                ("X-Key".to_string(), "a=b".to_string()),
            ])
        );
        assert_eq!(
            parse_headers(Some("=novalue,novalue,ok=yes")),
            Some(vec![("ok".to_string(), "yes".to_string())])
        );
    }

    #[test]
    fn headers_are_none_for_empty_input() {
        assert_eq!(parse_headers(None), None);
        assert_eq!(parse_headers(Some("")), None);
        assert_eq!(parse_headers(Some("  ")), None);
        assert_eq!(parse_headers(Some("=novalue")), None);
    }

    #[test]
    fn sample_ratio_bounds() {
        assert_eq!(sample_ratio(Some("0")), 0.0);
        assert_eq!(sample_ratio(Some("0.5")), 0.5);
        assert_eq!(sample_ratio(Some("1")), 1.0);
        assert_eq!(sample_ratio(Some("abc")), 1.0);
        assert_eq!(sample_ratio(Some("-1")), 1.0);
        assert_eq!(sample_ratio(Some("1.5")), 1.0);
        assert_eq!(sample_ratio(Some("NaN")), 1.0);
        assert_eq!(sample_ratio(None), 1.0);
    }

    #[test]
    fn fraction_stays_in_half_open_range() {
        let fallback = 0.2;
        assert_eq!(fraction(&env(&[("J", "0")]), "J", fallback), 0.0);
        assert_eq!(fraction(&env(&[("J", "0.25")]), "J", fallback), 0.25);
        assert_eq!(fraction(&BTreeMap::new(), "J", fallback), fallback);
        for value in ["1", "1.0", "-0.5", "abc", "NaN", "Infinity", "", "  "] {
            assert_eq!(
                fraction(&env(&[("J", value)]), "J", fallback),
                fallback,
                "value {value:?} should fall back"
            );
        }
    }
}
