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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn train(number: &str, name: &str) -> TrainEntry {
        TrainEntry {
            number: number.to_string(),
            name: name.to_string(),
        }
    }

    fn render(results: &[TrainEntry]) -> Vec<String> {
        results
            .iter()
            .map(|t| format!("{} {}", t.number, t.name))
            .collect()
    }

    fn assert_contains(results: &[TrainEntry], number: &str, name: &str) {
        assert!(
            results.iter().any(|t| t.number == number && t.name == name),
            "expected {:?} to contain {} {}",
            render(results),
            number,
            name,
        );
    }

    // Port of the `searchTrains` describe block in search.test.ts.
    #[test]
    fn matches_by_exact_number() {
        let results = search_trains("22943", 10, &TRAINS);
        assert_contains(&results, "22943", "Indore Intercity SF Express");
    }

    #[test]
    fn matches_by_number_prefix() {
        let results = search_trains("120", 10, &TRAINS);
        assert!(!results.is_empty());
        assert!(results.iter().all(|t| t.number.starts_with("120")));
    }

    #[test]
    fn matches_by_name_fragment_case_insensitively() {
        let results = search_trains("rajdhani", 10, &TRAINS);
        assert!(!results.is_empty());
        assert!(results
            .iter()
            .any(|t| t.name.to_lowercase().contains("rajdhani")));
    }

    #[test]
    fn matches_multi_word_names_despite_spaces_in_the_query() {
        let results = search_trains("mumbai rajdhani", 10, &TRAINS);
        assert_contains(&results, "12951", "Mumbai Rajdhani Express");
    }

    #[test]
    fn matches_multi_word_names_when_spaces_are_stripped_from_the_query() {
        let results = search_trains("MUMBAIRAJDHANI", 10, &TRAINS);
        assert_contains(&results, "12951", "Mumbai Rajdhani Express");
    }

    #[test]
    fn matches_when_query_is_a_space_free_fragment_spanning_words() {
        let results = search_trains("indore intercity", 10, &TRAINS);
        assert_contains(&results, "22943", "Indore Intercity SF Express");
    }

    #[test]
    fn returns_no_duplicates_for_the_same_number() {
        let results = search_trains("123", 10, &TRAINS);
        let numbers: HashSet<&str> = results.iter().map(|t| t.number.as_str()).collect();
        assert_eq!(numbers.len(), results.len());
    }

    #[test]
    fn limits_results_to_10_by_default() {
        let results = search_trains("1", 10, &TRAINS);
        assert!(results.len() <= 10);
    }

    #[test]
    fn honours_a_custom_limit() {
        let results = search_trains("1", 3, &TRAINS);
        assert!(results.len() <= 3);
    }

    #[test]
    fn returns_nothing_for_queries_shorter_than_2_chars() {
        assert_eq!(search_trains("2", 10, &TRAINS), Vec::new());
        assert_eq!(search_trains("", 10, &TRAINS), Vec::new());
        assert_eq!(search_trains("   ", 10, &TRAINS), Vec::new());
    }

    #[test]
    fn returns_nothing_for_unknown_queries() {
        assert_eq!(search_trains("999999", 10, &TRAINS), Vec::new());
    }

    // Dataset invariants (search.test.ts).
    #[test]
    fn dataset_numbers_are_all_5_digits() {
        for t in TRAINS.iter() {
            assert_eq!(t.number.len(), 5);
            assert!(t.number.bytes().all(|b| b.is_ascii_digit()));
        }
    }

    #[test]
    fn dataset_numbers_are_unique() {
        let numbers: HashSet<&str> = TRAINS.iter().map(|t| t.number.as_str()).collect();
        assert_eq!(numbers.len(), TRAINS.len());
    }

    #[test]
    fn dataset_entries_have_non_empty_names() {
        for t in TRAINS.iter() {
            assert!(!t.name.trim().is_empty());
        }
    }

    #[test]
    fn known_corrected_entries_resolve_to_the_right_names() {
        let by_number = |n: &str| {
            TRAINS
                .iter()
                .find(|t| t.number == n)
                .unwrap_or_else(|| panic!("missing train {n}"))
                .name
                .as_str()
        };
        assert_eq!(by_number("12311"), "Netaji Express");
        assert_eq!(by_number("20901"), "Mumbai Central Vande Bharat Express");
    }

    #[test]
    fn dataset_has_exactly_the_curated_entry_count() {
        // 368 entries, matching the reference TRAINS array in search.ts
        // (the "370" quoted in earlier plans was inaccurate).
        assert_eq!(TRAINS.len(), 368);
    }

    #[test]
    fn dataset_preserves_the_ts_source_order() {
        // Spot checks across the four "sections" of the TS array.
        assert_eq!(TRAINS[0].number, "12301");
        assert_eq!(TRAINS[0].name, "Howrah Rajdhani Express");
        assert_eq!(TRAINS[19].number, "12454");
        assert_eq!(TRAINS[19].name, "Hazrat Nizamuddin Rajdhani Express");
        assert_eq!(TRAINS[45].number, "12030");
        assert_eq!(TRAINS[45].name, "New Delhi Shatabdi Express");
        assert_eq!(TRAINS[100].number, "12127");
        assert_eq!(TRAINS[100].name, "Intercity Express");
        assert_eq!(TRAINS[367].number, "12422");
        assert_eq!(TRAINS[367].name, "Pataliputra Express");
    }

    // Port of the `searchTrains duck-typed matching` describe block.
    #[test]
    fn ranks_number_prefix_matches_above_number_contains_matches() {
        let results = search_trains("2294", 10, &TRAINS);
        assert!(results[0].number.starts_with("2294"));
    }

    #[test]
    fn surfaces_trains_whose_word_starts_with_the_query() {
        let results = search_trains("shatabdi", 10, &TRAINS);
        assert!(results.iter().any(|t| t.name.contains("Shatabdi")));
    }

    #[test]
    fn matches_fuzzy_subsequences_for_the_name() {
        // "rjdn" is a subsequence of "RAJDHANI" but not a substring.
        let results = search_trains("rjdn", 10, &TRAINS);
        assert!(results
            .iter()
            .any(|t| t.name.to_lowercase().contains("rajdhani")));
    }

    #[test]
    fn surfaces_typos_as_subsequence_matches() {
        // "rajhani" is a subsequence (not substring) of "HOWRAHRAJDHANIEXPRESS".
        let results = search_trains("rajhani", 10, &TRAINS);
        assert!(results
            .iter()
            .any(|t| t.name.to_lowercase().contains("rajdhani")));
    }

    #[test]
    fn accepts_an_explicit_dataset_instead_of_the_bundled_list() {
        let custom = vec![
            train("99901", "Custom Rocket"),
            train("12001", "Bhopal Shatabdi Express"),
        ];
        let results = search_trains("rocket", 10, &custom);
        assert_eq!(render(&results), vec!["99901 Custom Rocket"]);
    }

    #[test]
    fn dedupes_a_dataset_with_repeated_numbers() {
        let custom = vec![
            train("12001", "Bhopal Shatabdi Express"),
            train("12001", "Dup"),
            train("12002", "New Delhi Shatabdi Express"),
        ];
        let results = search_trains("shatabdi", 10, &custom);
        let numbers: Vec<&str> = results.iter().map(|t| t.number.as_str()).collect();
        assert_eq!(numbers, vec!["12001", "12002"]);
    }

    #[test]
    fn does_not_match_numbers_for_non_numeric_queries() {
        let results = search_trains("mumbai", 10, &TRAINS);
        assert!(results
            .iter()
            .all(|t| !t.name.bytes().all(|b| b.is_ascii_digit())));
    }

    #[test]
    fn fully_numeric_queries_only_match_train_numbers() {
        let results = search_trains("12951", 10, &TRAINS);
        assert_contains(&results, "12951", "Mumbai Rajdhani Express");
        assert!(results.iter().all(|t| t.number.starts_with("12951")));
    }

    // scoreTrain comparator pins: rank then tiebreak, mirrored from scoreTrain.
    #[test]
    fn score_train_numeric_prefix_beats_contains() {
        let t = train("22943", "Indore Intercity SF Express");
        assert_eq!(
            score_train(&t, "2294"),
            Some(Score {
                rank: 0,
                tiebreak: 5
            }),
        );
        let t2 = train("12294", "Some Other Train");
        assert_eq!(
            score_train(&t2, "2294"),
            Some(Score {
                rank: 1,
                tiebreak: 1
            }),
        );
    }

    #[test]
    fn score_train_single_token_rankings() {
        let t = train("12001", "Bhopal Shatabdi Express");
        // name prefix (rank 0), tiebreak = normalized name length.
        assert_eq!(
            score_train(&t, "BHOPAL"),
            Some(Score {
                rank: 0,
                tiebreak: 21
            }),
        );
        // name contains (rank 1), tiebreak = index of the token.
        assert_eq!(
            score_train(&t, "SHATABDI"),
            Some(Score {
                rank: 1,
                tiebreak: 6
            }),
        );
        // subsequence (rank 3).
        assert_eq!(
            score_train(&t, "SHTBDX"),
            Some(Score {
                rank: 3,
                tiebreak: 21
            }),
        );
        // no match.
        assert_eq!(score_train(&t, "XYZ"), None);
    }

    // Golden ordered-result fixtures. Expected output was generated from the
    // reference TS `searchTrains` (same comparator) against the TS dataset, so
    // this pins cross-language order determinism, including the number tiebreak.
    #[test]
    fn golden_search_number_prefix_120() {
        assert_eq!(
            render(&search_trains("120", 10, &TRAINS)),
            vec![
                "12001 Bhopal Shatabdi Express",
                "12002 New Delhi Shatabdi Express",
                "12003 Lucknow Swaran Shatabdi Express",
                "12004 New Delhi Shatabdi Express",
                "12005 Kalka Shatabdi Express",
                "12006 New Delhi Shatabdi Express",
                "12011 Kalka Shatabdi Express",
                "12012 New Delhi Shatabdi Express",
                "12013 Amritsar Shatabdi Express",
                "12014 New Delhi Shatabdi Express",
            ],
        );
    }

    #[test]
    fn golden_search_number_contains_2294() {
        assert_eq!(
            render(&search_trains("2294", 10, &TRAINS)),
            vec![
                "22943 Indore Intercity SF Express",
                "22944 Daund Intercity SF Express"
            ],
        );
    }

    #[test]
    fn golden_search_rajdhani() {
        let expected = vec![
            "12352 Patna Rajdhani Express",
            "12301 Howrah Rajdhani Express",
            "12305 Howrah Rajdhani Express",
            "12439 Ranchi Rajdhani Express",
            "12453 Ranchi Rajdhani Express",
            "12951 Mumbai Rajdhani Express",
            "12313 Sealdah Rajdhani Express",
            "12434 Chennai Rajdhani Express",
            "12302 New Delhi Rajdhani Express",
            "12306 New Delhi Rajdhani Express",
        ];
        assert_eq!(render(&search_trains("rajdhani", 10, &TRAINS)), expected);
        assert_eq!(render(&search_trains("rjdn", 10, &TRAINS)), expected);
        assert_eq!(render(&search_trains("rajhani", 10, &TRAINS)), expected);
    }

    #[test]
    fn golden_search_mumbai_rajdhani_multi_word() {
        assert_eq!(
            render(&search_trains("mumbai rajdhani", 10, &TRAINS)),
            vec![
                "12951 Mumbai Rajdhani Express",
                "22221 CSMT Mumbai Rajdhani Express",
            ],
        );
    }

    #[test]
    fn golden_search_shatabdi() {
        assert_eq!(
            render(&search_trains("shatabdi", 10, &TRAINS)),
            vec![
                "12023 Pune Shatabdi Express",
                "12025 Pune Shatabdi Express",
                "12005 Kalka Shatabdi Express",
                "12011 Kalka Shatabdi Express",
                "12015 Ajmer Shatabdi Express",
                "12001 Bhopal Shatabdi Express",
                "12019 Howrah Shatabdi Express",
                "12020 Ranchi Shatabdi Express",
                "12021 Howrah Shatabdi Express",
                "12028 Chennai Shatabdi Express",
            ],
        );
    }

    #[test]
    fn golden_search_intercity() {
        assert_eq!(
            render(&search_trains("intercity", 10, &TRAINS)),
            vec![
                "12127 Intercity Express",
                "12128 Intercity Express",
                "22944 Daund Intercity SF Express",
                "12827 Howrah Intercity Express",
                "12828 Howrah Intercity Express",
                "22943 Indore Intercity SF Express",
                "12609 Chennai Intercity Express",
                "12610 Chennai Intercity Express",
            ],
        );
    }

    #[test]
    fn golden_search_vande_bharat() {
        assert_eq!(
            render(&search_trains("vande bharat", 10, &TRAINS)),
            vec![
                "20613 Howrah Vande Bharat Express",
                "22401 New Delhi Vande Bharat Express",
                "22402 New Delhi Vande Bharat Express",
                "22435 New Delhi Vande Bharat Express",
                "22436 Varanasi Vande Bharat Express",
                "22437 New Delhi Vande Bharat Express",
                "20902 Gandhinagar Vande Bharat Express",
                "22549 Secunderabad Vande Bharat Express",
                "20614 New Jalpaiguri Vande Bharat Express",
                "20901 Mumbai Central Vande Bharat Express",
            ],
        );
    }

    #[test]
    fn golden_search_garib_rath() {
        assert_eq!(
            render(&search_trains("garib rath", 10, &TRAINS)),
            vec![
                "12210 Patna Garib Rath Express",
                "12203 Saharsa Garib Rath Express",
                "12909 Bandra T Garib Rath Express",
                "12910 Bandra T Garib Rath Express",
                "12202 New Delhi Garib Rath Express",
                "12204 Amritsar Garib Rath Express",
                "12201 Mumbai LTT Garib Rath Express",
                "12207 Jammu Tawi Garib Rath Express",
                "12208 Mumbai LTT Garib Rath Express",
                "12209 Mumbai LTT Garib Rath Express",
            ],
        );
    }

    #[test]
    fn golden_search_jan() {
        assert_eq!(
            render(&search_trains("jan", 10, &TRAINS)),
            vec![
                "12805 Janmabhoomi Express",
                "12806 Janmabhoomi Express",
                "12059 Kota Jan Shatabdi Express",
                "12051 Dadar Jan Shatabdi Express",
                "12052 Madgaon Jan Shatabdi Express",
                "12053 Haridwar Jan Shatabdi Express",
                "12054 New Delhi Jan Shatabdi Express",
                "12055 Dehradun Jan Shatabdi Express",
                "12056 New Delhi Jan Shatabdi Express",
                "12058 New Delhi Jan Shatabdi Express",
            ],
        );
    }

    #[test]
    fn golden_search_duronto() {
        assert_eq!(
            render(&search_trains("duronto", 10, &TRAINS)),
            vec![
                "12245 Howrah Duronto Express",
                "12259 Sealdah Duronto Express",
                "12269 Chennai Duronto Express",
                "12214 New Delhi Duronto Express",
                "12260 New Delhi Duronto Express",
                "12213 Mumbai LTT Duronto Express",
                "12283 Ernakulam Duronto Express",
                "12219 Mumbai CSMT Duronto Express",
                "12223 Mumbai CSMT Duronto Express",
                "12246 Yesvantpur Duronto Express",
            ],
        );
    }

    #[test]
    fn golden_search_unknown_fully_numeric_queries_are_empty() {
        assert_eq!(search_trains("12786", 10, &TRAINS), Vec::new());
        assert_eq!(search_trains("00000", 10, &TRAINS), Vec::new());
    }
}
