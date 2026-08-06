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
pub fn find_train_by_number(trains: &[TrainEntry], number: &str) -> Option<&TrainEntry> {
    let normalized = normalize_train_number(number);
    trains
        .iter()
        .find(|train| normalize_train_number(&train.number) == normalized)
}
