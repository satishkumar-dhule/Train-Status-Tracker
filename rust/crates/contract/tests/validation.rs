//! Query-param validation tests, ported 1:1 from
//! `lib/api-zod/src/generated/api.test.ts` (plus departure-date and limit
//! cases covering the exact Zod coercion semantics in `generated/api.ts`).

use tt_contract::{
    is_valid_departure_date, is_valid_train_number, parse_search_limit, parse_search_q,
    SearchLimitError, SearchQueryError, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX, SEARCH_LIMIT_MIN,
    SEARCH_Q_MAX_LENGTH,
};

mod constants {
    use super::*;

    #[test]
    fn search_bounds_match_the_generated_api() {
        assert_eq!(SEARCH_Q_MAX_LENGTH, 64); // searchTrainsQueryQMax
        assert_eq!(SEARCH_LIMIT_MAX, 100); // searchTrainsQueryLimitMax
        assert_eq!(SEARCH_LIMIT_MIN, 1);
        assert_eq!(SEARCH_LIMIT_DEFAULT, 10);
    }
}

mod get_train_status_query_params {
    use super::*;

    #[test]
    fn accepts_a_5_digit_train_number() {
        assert!(is_valid_train_number("22943"));
        assert!(is_valid_departure_date("20260802"));
    }

    // it.each(["", "abc", "2294", "229430", "22943:20260802", "22 943", "\x1b]0;evil"])
    #[test]
    fn rejects_a_non_5_digit_train_number() {
        for bad in [
            "",
            "abc",
            "2294",
            "229430",
            "22943:20260802",
            "22 943",
            "\x1b]0;evil",
        ] {
            assert!(!is_valid_train_number(bad), "{bad:?} must be rejected");
        }
    }

    #[test]
    fn rejects_a_train_number_that_is_not_numeric() {
        assert!(!is_valid_train_number("abcde"));
    }
}

mod get_train_runs_query_params {
    use super::*;

    #[test]
    fn accepts_a_5_digit_train_number() {
        assert!(is_valid_train_number("22943"));
    }

    // it.each(["abc", "2294", "229430", "22943:20260802"])
    #[test]
    fn rejects_a_non_5_digit_train_number() {
        for bad in ["abc", "2294", "229430", "22943:20260802"] {
            assert!(!is_valid_train_number(bad), "{bad:?} must be rejected");
        }
    }
}

mod departure_date {
    use super::*;

    #[test]
    fn accepts_an_8_digit_date() {
        assert!(is_valid_departure_date("20260802"));
    }

    #[test]
    fn rejects_non_8_digit_or_non_digit_dates() {
        for bad in [
            "",
            "abc",
            "2026080",
            "202608021",
            "2026-0802",
            "abcdefgh",
            "٢٠٢٦٠٨٠٢",
        ] {
            assert!(!is_valid_departure_date(bad), "{bad:?} must be rejected");
        }
    }

    // The route (`routes/trains.ts`) checks calendar validity separately
    // (isValidApiDate); the query schema only enforces the ^\d{8}$ shape.
    #[test]
    fn checks_shape_only_not_calendar_validity() {
        assert!(is_valid_departure_date("20261399"));
    }
}

mod search_trains_query_params {
    use super::*;

    #[test]
    fn accepts_a_short_query() {
        assert_eq!(parse_search_q("rajdhani"), Ok("rajdhani".to_string()));
    }

    // it("rejects an over-long query") — "x".repeat(65)
    #[test]
    fn rejects_an_over_long_query() {
        assert_eq!(
            parse_search_q(&"x".repeat(65)),
            Err(SearchQueryError::TooLong)
        );
    }

    #[test]
    fn accepts_a_query_exactly_at_the_max_length() {
        assert_eq!(
            parse_search_q(&"x".repeat(SEARCH_Q_MAX_LENGTH)),
            Ok("x".repeat(SEARCH_Q_MAX_LENGTH))
        );
    }

    // it("trims surrounding whitespace from the query")
    #[test]
    fn trims_surrounding_whitespace_from_the_query() {
        assert_eq!(parse_search_q("  rajdhani  "), Ok("rajdhani".to_string()));
    }

    #[test]
    fn trims_before_length_checking() {
        // 64 x's padded with spaces would exceed max(64) if length were
        // checked before trim; Zod trims first, so it must pass.
        assert_eq!(
            parse_search_q(&format!("  {}  ", "x".repeat(SEARCH_Q_MAX_LENGTH))),
            Ok("x".repeat(SEARCH_Q_MAX_LENGTH))
        );
    }

    #[test]
    fn rejects_empty_after_trim() {
        for bad in ["", "   ", "\t\n"] {
            assert_eq!(parse_search_q(bad), Err(SearchQueryError::Empty), "{bad:?}");
        }
    }
}

mod search_limit {
    use super::*;

    #[test]
    fn defaults_to_10_when_absent() {
        assert_eq!(parse_search_limit(None), Ok(SEARCH_LIMIT_DEFAULT));
    }

    #[test]
    fn coerces_a_numeric_string() {
        assert_eq!(parse_search_limit(Some("2")), Ok(2));
    }

    #[test]
    fn accepts_the_boundaries() {
        assert_eq!(parse_search_limit(Some("1")), Ok(1));
        assert_eq!(parse_search_limit(Some("100")), Ok(100));
    }

    #[test]
    fn trims_surrounding_whitespace_like_js_number() {
        assert_eq!(parse_search_limit(Some(" 7 ")), Ok(7));
    }

    #[test]
    fn accepts_scientific_notation_like_js_number() {
        assert_eq!(parse_search_limit(Some("1e2")), Ok(100));
    }

    #[test]
    fn rejects_values_outside_the_inclusive_range() {
        assert_eq!(
            parse_search_limit(Some("0")),
            Err(SearchLimitError::OutOfRange)
        );
        assert_eq!(
            parse_search_limit(Some("101")),
            Err(SearchLimitError::OutOfRange)
        );
        assert_eq!(
            parse_search_limit(Some("-5")),
            Err(SearchLimitError::OutOfRange)
        );
    }

    #[test]
    fn rejects_non_integers() {
        for bad in ["abc", "", "2.5", ".5", "Infinity", "NaN"] {
            assert_eq!(
                parse_search_limit(Some(bad)),
                Err(SearchLimitError::NotAnInteger),
                "{bad:?}"
            );
        }
    }
}
