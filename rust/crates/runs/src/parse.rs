//! Schedule-note parsing, ported 1:1 from `parseScheduleWeekdays` in
//! `lib/train-runs.ts`.
//!
//! On a day a train does NOT run, the Paytm status API answers `success` with a
//! fallback schedule and a message like "This train runs only on MON,FRI". That
//! message is the authoritative running schedule, so the probe parses it and
//! trusts it over weekday inference.
//!
//! The JS regex `/runs only on\s+([A-Za-z,\s]+)/i` is matched by hand: the
//! phrase is located case-insensitively, at least one whitespace must follow,
//! and then one or more of letters/comma/whitespace are captured greedily. A
//! message that cannot match (e.g. a bare trailing space with nothing after
//! "on") yields `None` — exactly where the regex returns `null` — and so does
//! a matched note with no weekday tokens after trimming
//! (`tokens.length === 0`), or with any unrecognized token
//! (`weekdays.some(w => w === undefined)`). A successful parse yields
//! non-empty weekday indices, deduplicated and sorted ascending.

const NEEDLE: &str = "runs only on";

const WEEKDAY_TO_INDEX: [(&str, usize); 7] = [
    ("SUN", 0),
    ("MON", 1),
    ("TUE", 2),
    ("WED", 3),
    ("THU", 4),
    ("FRI", 5),
    ("SAT", 6),
];

/// Day-of-week index for a 3-letter token, or `None` when unrecognized.
pub(crate) fn weekday_token_to_index(token: &str) -> Option<usize> {
    WEEKDAY_TO_INDEX
        .iter()
        .find(|(name, _)| *name == token)
        .map(|(_, index)| *index)
}

/// Parse a provider schedule note into weekday indices (0 = Sunday .. 6 =
/// Saturday), deduplicated and sorted ascending. `None` when the message does
/// not contain a `runs only on` note, when the capture trims down to no
/// tokens, or when any token is unrecognized.
pub fn parse_schedule_weekdays(message: &str) -> Option<Vec<usize>> {
    let needle_index = message.to_ascii_lowercase().find(NEEDLE)?;
    let after = &message[needle_index + NEEDLE.len()..];
    let after = after.as_bytes();

    // `\s+` — at least one ASCII whitespace.
    let leading_ws = after.iter().take_while(|b| b.is_ascii_whitespace()).count();
    if leading_ws == 0 {
        return None;
    }

    // `[A-Za-z,\s]+` — one or more of letters/comma/whitespace.
    let capture_len = after[leading_ws..]
        .iter()
        .take_while(|b| b.is_ascii_alphabetic() || **b == b',' || b.is_ascii_whitespace())
        .count();
    if capture_len == 0 {
        return None;
    }
    let capture = &after[leading_ws..leading_ws + capture_len];

    // `match[1].split(",").map(trim).map(toUpperCase).filter(Boolean)`.
    let tokens: Vec<String> = String::from_utf8_lossy(capture)
        .split(',')
        .map(|token| token.trim().to_ascii_uppercase())
        .filter(|token| !token.is_empty())
        .collect();

    // `if (tokens.length === 0) return null;`
    if tokens.is_empty() {
        return None;
    }

    // `if (weekdays.some(w => w === undefined)) return null;` — any
    // unrecognized token invalidates the whole parse.
    let mut weekdays: Vec<usize> = Vec::with_capacity(tokens.len());
    for token in &tokens {
        weekdays.push(weekday_token_to_index(token)?);
    }

    // `[...new Set(weekdays)].sort((a, b) => a - b)` — dedupe, then sort
    // ascending.
    weekdays.sort_unstable();
    weekdays.dedup();
    Some(weekdays)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_weekday_list() {
        assert_eq!(
            parse_schedule_weekdays("This train runs only on MON,FRI"),
            Some(vec![1, 5])
        );
        assert_eq!(
            parse_schedule_weekdays("This train runs only on WED"),
            Some(vec![3])
        );
    }

    #[test]
    fn is_case_insensitive_and_trims_tokens() {
        assert_eq!(
            parse_schedule_weekdays("This train runs only on mon, thu"),
            Some(vec![1, 4])
        );
        assert_eq!(
            parse_schedule_weekdays("This train runs only on  SAT"),
            Some(vec![6])
        );
    }

    #[test]
    fn captures_trailing_whitespace_and_dedupes() {
        assert_eq!(
            parse_schedule_weekdays("This train runs only on MON,MON,FRI "),
            Some(vec![1, 5])
        );
        assert_eq!(
            parse_schedule_weekdays("This train runs only on MON, FRI"),
            Some(vec![1, 5])
        );
    }

    #[test]
    fn unmatched_messages_yield_none() {
        // A trailing space after "on" with nothing else cannot match the JS
        // regex (`\s+` then `[A-Za-z,\s]+` needs one more character).
        assert_eq!(parse_schedule_weekdays("This train runs only on "), None);
        // No whitespace after "on".
        assert_eq!(parse_schedule_weekdays("This train runs only on"), None);
        // No note at all.
        assert_eq!(parse_schedule_weekdays("Running on time"), None);
        assert_eq!(parse_schedule_weekdays(""), None);
    }

    #[test]
    fn an_unknown_weekday_token_makes_the_whole_parse_none() {
        assert_eq!(
            parse_schedule_weekdays("This train runs only on XYZ"),
            None
        );
    }

    #[test]
    fn an_out_of_order_list_sorts_ascending() {
        assert_eq!(
            parse_schedule_weekdays("This train runs only on FRI,MON"),
            Some(vec![1, 5])
        );
        assert_eq!(
            parse_schedule_weekdays("This train runs only on SAT,TUE,MON"),
            Some(vec![1, 2, 6])
        );
    }
}
