//! JS value-coercion helpers, ported from the semantics the Paytm adapter
//! relies on (`String(...)`, `Number(...)`, `parseInt(..., 10)`, truthiness).
//!
//! These mirror the exact behaviors of the reference server's `toRow`:
//! JSON truthiness treats `0` and `""` as falsy while `"0"` is truthy,
//! `Number`/`String`/`parseInt` follow the ECMAScript coercions, and a missing
//! key is `undefined` (distinct from JSON `null`).

use serde_json::Value;

/// JS truthiness: `false`, `0`, `""`, `null` (and `undefined`) are falsy;
/// everything else — including `"0"` and `[]` — is truthy.
pub(super) fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|n| n != 0.0).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// JS `String(value)` coercion.
pub(super) fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => js_number_string(n),
        Value::String(s) => s.clone(),
        Value::Array(items) => items.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

/// JS `Number(value)` coercion.
pub(super) fn js_number(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => js_number_from_string(s),
        Value::Array(_) | Value::Object(_) => f64::NAN,
    }
}

/// JS `Number(string)` coercion. Empty/whitespace and `null`/`undefined`-ish
/// inputs coerce to `0`; hex/binary/octal prefixes are honored; `inf`/`nan`
/// spellings that Rust's `f64` parser would accept are rejected like JS.
fn js_number_from_string(s: &str) -> f64 {
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

/// JS `parseInt(string, 10)`: optional sign, leading decimal digits, stop at
/// the first non-digit; `None` when no digits follow (the JS `NaN`).
pub(super) fn js_parse_int(s: &str) -> Option<i64> {
    let s = s.trim_start();
    let (negative, rest) = match s.as_bytes().first() {
        Some(b'-') => (true, &s[1..]),
        Some(b'+') => (false, &s[1..]),
        _ => (false, s),
    };
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    let magnitude: i128 = digits.parse().ok()?;
    let value = if negative { -magnitude } else { magnitude };
    Some(value as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truthiness_matches_js() {
        assert!(!js_truthy(&Value::Null));
        assert!(!js_truthy(&Value::Bool(false)));
        assert!(js_truthy(&Value::Bool(true)));
        assert!(!js_truthy(&serde_json::json!(0)));
        assert!(js_truthy(&serde_json::json!("0")));
        assert!(!js_truthy(&serde_json::json!("")));
        assert!(js_truthy(&serde_json::json!([])));
        assert!(js_truthy(&serde_json::json!({})));
    }

    #[test]
    fn string_coercion_matches_js() {
        assert_eq!(js_string(&Value::Null), "null");
        assert_eq!(js_string(&Value::Bool(true)), "true");
        assert_eq!(js_string(&Value::Bool(false)), "false");
        assert_eq!(js_string(&serde_json::json!(3)), "3");
        assert_eq!(js_string(&serde_json::json!("x")), "x");
        assert_eq!(js_string(&serde_json::json!([1, "a", null])), "1,a,null");
        assert_eq!(js_string(&serde_json::json!({})), "[object Object]");
    }

    #[test]
    fn number_coercion_matches_js() {
        assert_eq!(js_number(&Value::Null), 0.0);
        assert_eq!(js_number(&Value::Bool(true)), 1.0);
        assert_eq!(js_number(&Value::Bool(false)), 0.0);
        assert_eq!(js_number(&serde_json::json!(938)), 938.0);
        assert!(js_number(&serde_json::json!("100")).is_finite());
        assert_eq!(js_number(&serde_json::json!("100")), 100.0);
        assert_eq!(js_number(&serde_json::json!("")), 0.0);
        assert_eq!(js_number(&serde_json::json!("   ")), 0.0);
        assert!(js_number(&serde_json::json!("abc")).is_nan());
        assert_eq!(js_number(&serde_json::json!("0x10")), 16.0);
        assert_eq!(js_number(&serde_json::json!("1e3")), 1000.0);
        assert!(js_number(&serde_json::json!("inf")).is_nan());
        assert_eq!(js_number(&serde_json::json!("Infinity")), f64::INFINITY);
        assert!(js_number(&serde_json::json!({})).is_nan());
    }

    #[test]
    fn parse_int_matches_js() {
        assert_eq!(js_parse_int("2x"), Some(2));
        assert_eq!(js_parse_int("0"), Some(0));
        assert_eq!(js_parse_int(""), None);
        assert_eq!(js_parse_int("null"), None);
        assert_eq!(js_parse_int("1.5"), Some(1));
        assert_eq!(js_parse_int("  -17"), Some(-17));
        assert_eq!(js_parse_int("007"), Some(7));
        assert_eq!(js_parse_int("+42"), Some(42));
        assert_eq!(js_parse_int("1e2"), Some(1));
        assert_eq!(js_parse_int("0x10"), Some(0));
    }
}
