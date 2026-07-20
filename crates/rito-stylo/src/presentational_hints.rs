use style::{color::AbsoluteColor, servo::attr::parse_legacy_color};

/// Reports whether a `body@bgcolor` value can be represented exactly by the
/// DOM-independent Stylo adapter.
///
/// This follows HTML's legacy colour algorithm rather than CSS declaration
/// parsing. Callers can therefore use the same fail-closed predicate before
/// selecting the Stylo path without depending on a browser DOM or Stylo type.
pub fn supports_body_bgcolor_presentational_hint(value: &str) -> bool {
    parse_body_bgcolor_presentational_hint(value).is_some()
}

pub(crate) fn parse_body_bgcolor_presentational_hint(value: &str) -> Option<AbsoluteColor> {
    // Stylo implements the WHATWG algorithm exactly, but its 0.19 parser
    // assumes that stripping HTML spaces cannot make a non-empty input empty.
    // Guard that invalid edge case so hostile input fails closed instead of
    // reaching its first-code-point step with an empty string.
    if value.trim_matches(is_html_space).is_empty() {
        return None;
    }
    parse_legacy_color(value).ok()
}

fn is_html_space(character: char) -> bool {
    matches!(character, '\t' | '\n' | '\u{000c}' | '\r' | ' ')
}

#[cfg(test)]
mod tests {
    use super::{
        parse_body_bgcolor_presentational_hint, supports_body_bgcolor_presentational_hint,
    };

    #[test]
    fn accepts_exact_html_legacy_colour_forms() {
        for value in [
            "#fff",        // book-08 corpus value
            "#ED7A81",     // six-digit simple colour
            " ReD\t",      // named colour and HTML spaces
            "chucknorris", // legacy error-recovery algorithm
            "\u{00a0}",    // non-HTML whitespace is legacy input
            "#",           // legacy error recovery produces black
        ] {
            assert!(
                supports_body_bgcolor_presentational_hint(value),
                "expected exact support for {value:?}"
            );
            assert!(parse_body_bgcolor_presentational_hint(value).is_some());
        }
    }

    #[test]
    fn rejects_values_for_which_html_produces_no_colour() {
        for value in ["", " \t\n\u{000c}\r", "transparent", " TRANSPARENT\t"] {
            assert!(
                !supports_body_bgcolor_presentational_hint(value),
                "expected fail-closed rejection for {value:?}"
            );
            assert!(parse_body_bgcolor_presentational_hint(value).is_none());
        }
    }

    #[test]
    fn preserves_exact_legacy_rgb_results() {
        for (value, expected) in [
            ("#fff", [1.0, 1.0, 1.0, 1.0]),
            (
                "#ED7A81",
                [237.0 / 255.0, 122.0 / 255.0, 129.0 / 255.0, 1.0],
            ),
            ("ReD", [1.0, 0.0, 0.0, 1.0]),
            ("chucknorris", [192.0 / 255.0, 0.0, 0.0, 1.0]),
        ] {
            let color = parse_body_bgcolor_presentational_hint(value).expect("legacy colour");
            assert_eq!(*color.raw_components(), expected, "value {value:?}");
        }
    }
}
