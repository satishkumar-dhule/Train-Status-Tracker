//! Text helpers, ported 1:1 from `lib/trains-data/src/text.ts`.

/// Strip HTML tags from a string (`<[^>]+>`), then trim.
/// Returns `None` for falsy input or when nothing remains.
pub fn strip_html(s: Option<&str>) -> Option<String> {
    let s = s?;
    if s.is_empty() {
        return None;
    }

    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] == '<' {
            let mut j = i + 1;
            while j < chars.len() && chars[j] != '>' {
                j += 1;
            }
            if j < chars.len() && j > i + 1 {
                // `<>` is not a tag; a `<` with no closing `>` is kept as-is.
                i = j + 1;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }

    let trimmed = out.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
