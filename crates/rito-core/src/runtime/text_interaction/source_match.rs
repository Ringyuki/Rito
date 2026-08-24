pub(super) fn source_segments_match(normalized_source_text: &str, segments: &[String]) -> bool {
    let Some((first, remaining_segments)) = segments.split_first() else {
        return normalized_source_text.is_empty();
    };
    let Some(mut remaining) = normalized_source_text.strip_prefix(first) else {
        return false;
    };
    for segment in remaining_segments {
        while !remaining.starts_with(segment) {
            let Some(character) = remaining.chars().next() else {
                return false;
            };
            if !is_html_collapsible_whitespace(character) {
                return false;
            }
            remaining = &remaining[character.len_utf8()..];
        }
        remaining = &remaining[segment.len()..];
    }
    remaining.is_empty()
        || (segments.last().is_some_and(String::is_empty)
            && remaining.chars().all(is_html_collapsible_whitespace))
}

fn is_html_collapsible_whitespace(character: char) -> bool {
    matches!(character, '\t' | '\n' | '\u{000C}' | '\r' | ' ')
}

#[cfg(test)]
mod tests {
    use super::source_segments_match;

    #[test]
    fn accepts_only_whitespace_between_exact_source_segments() {
        let segments = ["first".to_owned(), "second".to_owned()];

        assert!(source_segments_match(
            "first \t\n\u{000C}\r second",
            &segments
        ));
        assert!(!source_segments_match("first hidden second", &segments));
        assert!(!source_segments_match("firstthird", &segments));
        assert!(!source_segments_match("first\u{00A0}second", &segments));
        assert!(!source_segments_match("first\u{3000}second", &segments));
    }
}
