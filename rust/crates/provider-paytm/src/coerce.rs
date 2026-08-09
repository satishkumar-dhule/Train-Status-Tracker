//! JS value-coercion helpers, ported from the semantics the Paytm adapter
//! relies on (`String(...)`, `Number(...)`, `parseInt(..., 10)`, truthiness).
//!
//! These mirror the exact behaviors of the reference server's `toRow`:
//! JSON truthiness treats `0` and `""` as falsy while `"0"` is truthy,
//! `Number`/`String`/`parseInt` follow the ECMAScript coercions, and a missing
//! key is `undefined` (distinct from JSON `null`).
//!
//! The JS `String(value)` and `Number(string)` coercions live once in
//! [`tt_provider_core`] (they are shared with the other adapters via
//! `providers/parse.ts`); they are re-exported here so Paytm call sites keep
//! their local names.

use serde_json::Value;

pub(super) use tt_provider_core::{js_number_from_string, js_string};

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
