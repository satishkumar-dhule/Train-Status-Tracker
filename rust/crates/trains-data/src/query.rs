//! Query normalization / matching helpers, ported 1:1 from `lib/trains-data/src/query.ts`.

use crate::search::TrainEntry;

/// Queries shorter than this are never searched. Ported from `MIN_QUERY_LENGTH`.
pub const MIN_QUERY_LENGTH: usize = 2;

/// `" 22943 "` -> `"22943"`; `"raj"` -> `"RAJ"`.
/// Strips all whitespace and uppercases, exactly like the TS `normalizeTrainNumber`.
pub fn normalize_train_number(raw: &str) -> String {
    raw.chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_uppercase()
}

fn normalize_name(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_lowercase()
}

/// Exact number comparison on normalized values.
pub fn matches_train_number(suggestion_number: &str, normalized_input: &str) -> bool {
    normalize_train_number(suggestion_number) == normalized_input
}

/// Case/space-insensitive exact name comparison.
pub fn matches_train_name(suggestion_name: &str, normalized_input: &str) -> bool {
    normalize_name(suggestion_name) == normalize_name(normalized_input)
}

/// First occurrence wins per train number. Returns owned clones in input order.
pub fn unique_by_number(trains: &[TrainEntry]) -> Vec<TrainEntry> {
    let mut seen = std::collections::HashSet::new();
    let mut unique: Vec<TrainEntry> = Vec::with_capacity(trains.len());
    for train in trains {
        if !seen.insert(&train.number) {
            continue;
        }
        unique.push(train.clone());
    }
    unique
}

/// Find a train by exact normalized number (dedupe-aware, first match wins).
/// The returned reference borrows from `trains`, never from `number`.
pub fn find_train_by_number<'a>(trains: &'a [TrainEntry], number: &str) -> Option<&'a TrainEntry> {
    let normalized = normalize_train_number(number);
    trains
        .iter()
        .find(|train| normalize_train_number(&train.number) == normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<TrainEntry> {
        vec![
            TrainEntry {
                number: "22943".to_string(),
                name: "Indore Intercity SF Express".to_string(),
            },
            TrainEntry {
                number: "22943".to_string(),
                name: "Duplicate Intercity".to_string(),
            },
            TrainEntry {
                number: "12001".to_string(),
                name: "Bhopal Shatabdi Express".to_string(),
            },
        ]
    }

    // Port of `normalizeTrainNumber` in query.test.ts.
    #[test]
    fn normalize_strips_whitespace_and_uppercases() {
        assert_eq!(normalize_train_number(" 22943 "), "22943");
        assert_eq!(normalize_train_number("raJ "), "RAJ");
    }

    // Port of `matchesTrainNumber` in query.test.ts.
    #[test]
    fn matches_number_compares_normalized_values() {
        assert!(matches_train_number("22943", "22943"));
        assert!(!matches_train_number("22943", "22944"));
    }

    // Port of `matchesTrainName` in query.test.ts.
    #[test]
    fn matches_name_is_case_and_space_insensitive() {
        assert!(matches_train_name(
            "Indore Intercity SF Express",
            "INDORE INTERCITY SF EXPRESS",
        ));
        assert!(!matches_train_name(
            "Indore Intercity SF Express",
            "IndoreExpress"
        ));
    }

    // Port of `uniqueByNumber` in query.test.ts.
    #[test]
    fn unique_keeps_first_occurrence_per_number() {
        let unique = unique_by_number(&sample());
        assert_eq!(unique.len(), 2);
        assert_eq!(unique[0].name, "Indore Intercity SF Express");
    }

    // Port of `findTrainByNumber` in query.test.ts.
    #[test]
    fn find_by_number_returns_first_entry() {
        assert_eq!(
            find_train_by_number(&sample(), "22943").map(|t| t.name.as_str()),
            Some("Indore Intercity SF Express")
        );
    }

    #[test]
    fn find_by_number_returns_none_when_unknown() {
        assert!(find_train_by_number(&sample(), "99999").is_none());
    }

    #[test]
    fn find_by_number_normalizes_the_input() {
        assert_eq!(
            find_train_by_number(&sample(), " 22 943 ").map(|t| t.name.as_str()),
            Some("Indore Intercity SF Express")
        );
    }

    #[test]
    fn min_query_length_is_two() {
        assert_eq!(MIN_QUERY_LENGTH, 2);
    }
}
