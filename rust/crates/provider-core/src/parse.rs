//! Tiny, defensive value coercions shared by every provider adapter, ported
//! 1:1 from `providers/parse.ts`.
//!
//! All upstream payloads are treated as untrusted (ZTA): unknown shapes become
//! `None`/`""`/`false` rather than erroring, so a single malformed station
//! never takes down the whole response.
//!
//! The helpers take `Option<&Value>` — a missing key maps to JS `undefined`,
//! which `parse.ts` coerces exactly like any other non-matching value.

use serde_json::Value;

/// TS `isRecord`: a plain object (not `null`, not an array).
pub fn is_record(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Object(_)))
}

/// TS `asString`: the value when it is a string, else `""`.
pub fn as_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    }
}

/// TS `asNullableString`: the value when it is a string, else `null`.
pub fn as_nullable_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

/// TS `asBoolean`: the value when it is a boolean, else `undefined`.
pub fn as_boolean(value: Option<&Value>) -> Option<bool> {
    match value {
        Some(Value::Bool(b)) => Some(*b),
        _ => None,
    }
}

/// TS `toFiniteNumber`: a finite JSON number, or a non-blank string whose JS
/// `Number(...)` coercion is finite; anything else is `null`.
pub fn to_finite_number(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(n)) => n.as_f64().filter(|n| n.is_finite()),
        Some(Value::String(s)) if !s.trim().is_empty() => {
            let parsed = js_number_from_string(s);
            parsed.is_finite().then_some(parsed)
        }
        _ => None,
    }
}

/// TS `toPositiveInt`: `Math.trunc` of a finite `toFiniteNumber` result when
/// positive, else `fallback` (covers `null`/`NaN`/`0`/negatives).
pub fn to_positive_int(value: Option<&Value>, fallback: i64) -> i64 {
    match to_finite_number(value) {
        Some(parsed) => {
            let int = parsed.trunc() as i64;
            if int > 0 {
                int
            } else {
                fallback
            }
        }
        None => fallback,
    }
}

/// TS `toNullableInt`: `Math.trunc` of a finite `toFiniteNumber` result, else
/// `null` (JS `Number.isFinite(int)` is a no-op after the trunc gate).
pub fn to_nullable_int(value: Option<&Value>) -> Option<i64> {
    Some(to_finite_number(value)?.trunc() as i64)
}

/// TS `isoTimeOfDay`: the `HH:MM` slice of the first `THH:MM` inside an
/// ISO-ish timestamp string, else `null`. The regex `/T(\d{2}):(\d{2})/` is
/// ported as a byte scan — no regex dependency in this crate.
pub fn iso_time_of_day(value: Option<&Value>) -> Option<String> {
    let s = match value {
        Some(Value::String(s)) => s,
        _ => return None,
    };
    let bytes = s.as_bytes();
    for i in 0..bytes.len().saturating_sub(5) {
        if bytes[i] == b'T'
            && bytes[i + 1].is_ascii_digit()
            && bytes[i + 2].is_ascii_digit()
            && bytes[i + 3] == b':'
            && bytes[i + 4].is_ascii_digit()
            && bytes[i + 5].is_ascii_digit()
        {
            return Some(s[i + 1..i + 6].to_string());
        }
    }
    None
}

/// JS `String(value)` coercion, ported from the exact semantics the adapters
/// rely on (`String(station.expectedPlatformNumber)` etc.): numbers render
/// without a decimal point, arrays join with `,`, objects are
/// `[object Object]`, `null`/`undefined` become the string `"null"`/`"undefined"`.
pub fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => js_number_string(n),
        Value::String(s) => s.clone(),
        Value::Array(items) => items.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

/// JS `Number(string)` coercion. Empty/whitespace and `null`-ish inputs coerce
/// to `0`; hex/binary/octal prefixes are honored; `inf`/`nan` spellings that
/// Rust's `f64` parser would accept are rejected like JS.
pub fn js_number_from_string(s: &str) -> f64 {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    match trimmed {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0b", 2),
        ("0B", 2),
        ("0o", 8),
        ("0O", 8),
    ] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            return i128::from_str_radix(rest, radix)
                .ok()
                .map(|n| n as f64)
                .unwrap_or(f64::NAN);
        }
    }
    match trimmed.to_ascii_lowercase().as_str() {
        "inf" | "infinity" | "nan" => f64::NAN,
        _ => trimmed.parse::<f64>().unwrap_or(f64::NAN),
    }
}

/// JS `String(number)` — integers render without a decimal point, non-integers
/// in their decimal form.
fn js_number_string(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    let f = n.as_f64().unwrap_or(f64::NAN);
    if f.is_finite() && f.fract() == 0.0 && f.abs() < 1e21 {
        (f as i64).to_string()
    } else {
        f.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn is_record_accepts_only_plain_objects() {
        assert!(is_record(Some(&json!({ "a": 1 }))));
        assert!(!is_record(Some(&json!(null))));
        assert!(!is_record(Some(&json!([1]))));
        assert!(!is_record(Some(&json!("x"))));
        assert!(!is_record(None));
    }

    #[test]
    fn string_coercions_match_js() {
        assert_eq!(as_string(Some(&json!("abc"))), "abc");
        assert_eq!(as_string(Some(&json!(7))), "");
        assert_eq!(as_string(Some(&json!(null))), "");
        assert_eq!(as_string(None), "");
        assert_eq!(
            as_nullable_string(Some(&json!("abc"))),
            Some("abc".to_string())
        );
        assert_eq!(as_nullable_string(Some(&json!(7))), None);
        assert_eq!(as_nullable_string(None), None);
    }

    #[test]
    fn boolean_coercion_matches_js() {
        assert_eq!(as_boolean(Some(&json!(true))), Some(true));
        assert_eq!(as_boolean(Some(&json!(false))), Some(false));
        assert_eq!(as_boolean(Some(&json!(1))), None);
        assert_eq!(as_boolean(None), None);
    }

    #[test]
    fn finite_number_matches_js() {
        assert_eq!(to_finite_number(Some(&json!(938))), Some(938.0));
        assert_eq!(to_finite_number(Some(&json!("100"))), Some(100.0));
        assert_eq!(to_finite_number(Some(&json!(" 42 "))), Some(42.0));
        assert_eq!(to_finite_number(Some(&json!("0x10"))), Some(16.0));
        assert_eq!(to_finite_number(Some(&json!("1e3"))), Some(1000.0));
        assert_eq!(to_finite_number(Some(&json!(""))), None);
        assert_eq!(to_finite_number(Some(&json!("   "))), None);
        assert_eq!(to_finite_number(Some(&json!("abc"))), None);
        assert_eq!(to_finite_number(Some(&json!("Infinity"))), None);
        assert_eq!(to_finite_number(Some(&json!(null))), None);
        assert_eq!(to_finite_number(None), None);
    }

    #[test]
    fn positive_int_falls_back_for_non_positive_values() {
        assert_eq!(to_positive_int(Some(&json!("5")), 1), 5);
        assert_eq!(to_positive_int(Some(&json!(2.9)), 1), 2);
        assert_eq!(to_positive_int(Some(&json!("1.5")), 1), 1);
        assert_eq!(to_positive_int(Some(&json!(0)), 1), 1);
        assert_eq!(to_positive_int(Some(&json!(-3)), 1), 1);
        assert_eq!(to_positive_int(Some(&json!("abc")), 1), 1);
        assert_eq!(to_positive_int(Some(&json!(null)), 1), 1);
        assert_eq!(to_positive_int(None, 1), 1);
    }

    #[test]
    fn nullable_int_matches_js() {
        assert_eq!(to_nullable_int(Some(&json!("5"))), Some(5));
        assert_eq!(to_nullable_int(Some(&json!(0))), Some(0));
        assert_eq!(to_nullable_int(Some(&json!(2.9))), Some(2));
        assert_eq!(to_nullable_int(Some(&json!("abc"))), None);
        assert_eq!(to_nullable_int(Some(&json!(null))), None);
        assert_eq!(to_nullable_int(None), None);
    }

    #[test]
    fn iso_time_of_day_extracts_hh_mm() {
        assert_eq!(
            iso_time_of_day(Some(&json!("2026-08-06T13:18:01.578613+05:30"))),
            Some("13:18".to_string())
        );
        assert_eq!(
            iso_time_of_day(Some(&json!("T08:05"))),
            Some("08:05".to_string())
        );
        assert_eq!(iso_time_of_day(Some(&json!("no timestamp"))), None);
        assert_eq!(iso_time_of_day(Some(&json!("T1234"))), None);
        assert_eq!(iso_time_of_day(Some(&json!(42))), None);
        assert_eq!(iso_time_of_day(None), None);
    }

    #[test]
    fn string_coercion_of_values_matches_js() {
        assert_eq!(js_string(&Value::Null), "null");
        assert_eq!(js_string(&Value::Bool(true)), "true");
        assert_eq!(js_string(&Value::Bool(false)), "false");
        assert_eq!(js_string(&json!(3)), "3");
        assert_eq!(js_string(&json!(10)), "10");
        assert_eq!(js_string(&json!(2.5)), "2.5");
        assert_eq!(js_string(&json!("x")), "x");
        assert_eq!(js_string(&json!([1, "a", null])), "1,a,null");
        assert_eq!(js_string(&json!({})), "[object Object]");
    }

    #[test]
    fn number_from_string_matches_js() {
        assert_eq!(js_number_from_string("100"), 100.0);
        assert_eq!(js_number_from_string(""), 0.0);
        assert_eq!(js_number_from_string("   "), 0.0);
        assert!(js_number_from_string("abc").is_nan());
        assert_eq!(js_number_from_string("0x10"), 16.0);
        assert_eq!(js_number_from_string("0b101"), 5.0);
        assert_eq!(js_number_from_string("0o17"), 15.0);
        assert_eq!(js_number_from_string("1e3"), 1000.0);
        assert!(js_number_from_string("inf").is_nan());
        assert!(js_number_from_string("nan").is_nan());
        assert_eq!(js_number_from_string("Infinity"), f64::INFINITY);
        assert_eq!(js_number_from_string("-Infinity"), f64::NEG_INFINITY);
    }
}
