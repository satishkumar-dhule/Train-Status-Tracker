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

#[cfg(test)]
mod tests {
    use super::*;

    // Port of `stripHtml` in text.test.ts.
    #[test]
    fn removes_html_tags() {
        assert_eq!(
            strip_html(Some("<b>Hello</b> <i>world</i>")).as_deref(),
            Some("Hello world"),
        );
    }

    #[test]
    fn trims_surrounding_whitespace() {
        assert_eq!(strip_html(Some("  <p>text</p>  ")).as_deref(), Some("text"));
    }

    #[test]
    fn returns_none_for_empty_results() {
        assert_eq!(strip_html(Some("<b></b>")), None);
        assert_eq!(strip_html(Some("   ")), None);
    }

    #[test]
    fn returns_none_for_falsy_input() {
        assert_eq!(strip_html(None), None);
        assert_eq!(strip_html(Some("")), None);
    }

    #[test]
    fn unmatched_angle_brackets_survive_like_the_js_regex() {
        assert_eq!(strip_html(Some("a<b")), Some("a<b".to_string()));
        assert_eq!(strip_html(Some("a<>b")), Some("a<>b".to_string()));
    }
}
