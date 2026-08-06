//! Static train dataset + duck-typed (fuzzy) ranking, ported 1:1 from
//! `lib/trains-data/src/search.ts`.

use std::sync::LazyLock;

use crate::data::RAW_TRAINS;
use crate::query::{normalize_train_number, unique_by_number, MIN_QUERY_LENGTH};

/// A single train as `{ number, name }`, mirroring the TS `TrainEntry`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct TrainEntry {
    pub number: String,
    pub name: String,
}

/// Curated static list of Indian Railways trains (368 entries, order preserved
/// from the TS source). Built lazily on first access.
pub static TRAINS: LazyLock<Vec<TrainEntry>> = LazyLock::new(|| {
    RAW_TRAINS
        .iter()
        .map(|&(number, name)| TrainEntry {
            number: number.to_string(),
            name: name.to_string(),
        })
        .collect()
});

/// A train scored against a normalized query. Lower `rank` wins; `tiebreak`
/// keeps deterministic ordering for equal ranks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Score {
    pub rank: u32,
    pub tiebreak: u32,
}

fn is_fully_numeric(query: &str) -> bool {
    !query.is_empty() && query.chars().all(|c| c.is_ascii_digit())
}

/// Space-separated words of a normalized string.
fn words_of(s: &str) -> Vec<&str> {
    s.split_whitespace().filter(|w| !w.is_empty()).collect()
}

/// True when `sub` appears as a character subsequence of `str`.
fn is_subsequence(sub: &str, str: &str) -> bool {
    if sub.is_empty() {
        return true;
    }
    let sub_chars: Vec<char> = sub.chars().collect();
    let mut j = 0usize;
    for c in str.chars() {
        if c == sub_chars[j] {
            j += 1;
            if j == sub_chars.len() {
                break;
            }
        }
    }
    j == sub_chars.len()
}

/// Rank a single train against a normalized query. Returns `Some(score)` only
/// when the train duck-types the query. Ported exactly from `scoreTrain`.
pub fn score_train(train: &TrainEntry, normalized_query: &str) -> Option<Score> {
    let number = normalize_train_number(&train.number);
    let name = normalize_train_number(&train.name);
    let tokens: Vec<&str> = words_of(normalized_query);
    let name_words: Vec<&str> = words_of(&name);

    if is_fully_numeric(normalized_query) {
        if number.starts_with(normalized_query) {
            return Some(Score {
                rank: 0,
                tiebreak: number.len() as u32,
            });
        }
        if number.contains(normalized_query) {
            return Some(Score {
                rank: 1,
                tiebreak: number.find(normalized_query).unwrap_or(0) as u32,
            });
        }
        return None;
    }

    if tokens.len() == 1 {
        let token = tokens[0];
        if name.starts_with(token) {
            return Some(Score {
                rank: 0,
                tiebreak: name.len() as u32,
            });
        }
        if name.contains(token) {
            return Some(Score {
                rank: 1,
                tiebreak: name.find(token).unwrap_or(0) as u32,
            });
        }
        if name_words.iter().any(|word| word.starts_with(token)) {
            return Some(Score {
                rank: 2,
                tiebreak: name.len() as u32,
            });
        }
        if is_subsequence(token, &name) {
            return Some(Score {
                rank: 3,
                tiebreak: name.len() as u32,
            });
        }
        if number.starts_with(token) {
            return Some(Score {
                rank: 4,
                tiebreak: number.len() as u32,
            });
        }
        if number.contains(token) {
            return Some(Score {
                rank: 5,
                tiebreak: number.find(token).unwrap_or(0) as u32,
            });
        }
        return None;
    }

    // Multi-word queries: the concatenated query must read through the name.
    let joined = name.contains(normalized_query);
    let all_tokens = tokens
        .iter()
        .all(|token| name_words.iter().any(|word| word.contains(token)));
    if joined {
        return Some(Score {
            rank: 0,
            tiebreak: name.len() as u32,
        });
    }
    if all_tokens {
        return Some(Score {
            rank: 1,
            tiebreak: name.len() as u32,
        });
    }
    if is_subsequence(normalized_query, &name) {
        return Some(Score {
            rank: 2,
            tiebreak: name.len() as u32,
        });
    }
    None
}

/// Search `trains` by number prefix or name using duck-typed (fuzzy) matching,
/// ranked best-first (max `limit` results). Ported exactly from `searchTrains`.
pub fn search_trains(query: &str, limit: usize, trains: &[TrainEntry]) -> Vec<TrainEntry> {
    let q = normalize_train_number(query);
    if q.is_empty() || q.chars().count() < MIN_QUERY_LENGTH {
        return Vec::new();
    }

    let mut scored: Vec<(TrainEntry, Score)> = Vec::new();
    for train in unique_by_number(trains) {
        if let Some(score) = score_train(&train, &q) {
            scored.push((train, score));
        }
    }

    // Stable sort mirroring the TS comparator: rank, then tiebreak, then the
    // train number (lexicographic, replicating `localeCompare`).
    scored.sort_by(|a, b| {
        a.1.rank
            .cmp(&b.1.rank)
            .then_with(|| a.1.tiebreak.cmp(&b.1.tiebreak))
            .then_with(|| a.0.number.cmp(&b.0.number))
    });

    scored
        .into_iter()
        .take(limit)
        .map(|(train, _)| train)
        .collect()
}

/// Search over the bundled static dataset with a `limit` (defaults to 10 in the
/// TS; callers pass the limit explicitly here).
pub fn search_trains_bundled(query: &str, limit: usize) -> Vec<TrainEntry> {
    search_trains(query, limit, &TRAINS)
}
