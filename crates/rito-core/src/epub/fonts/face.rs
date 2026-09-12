//! `@font-face` descriptor normalization and `font-family` list parsing.

const INITIAL_FONT_STYLE: &str = "normal";
const INITIAL_FONT_WEIGHT: u16 = 400;

pub(super) fn normalized_font_style(value: Option<&str>) -> &'static str {
    let keyword = value
        .unwrap_or(INITIAL_FONT_STYLE)
        .split_ascii_whitespace()
        .next()
        .unwrap_or(INITIAL_FONT_STYLE);
    if keyword.eq_ignore_ascii_case("italic") {
        "italic"
    } else if keyword.eq_ignore_ascii_case("oblique") {
        "oblique"
    } else {
        "normal"
    }
}

pub(super) fn normalized_font_weight(value: Option<u16>) -> u16 {
    value
        .filter(|weight| (1..=1000).contains(weight))
        .unwrap_or(INITIAL_FONT_WEIGHT)
}

pub(crate) fn parse_font_family_list(value: &str) -> Vec<String> {
    let mut families = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for character in value.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        match quote {
            Some(active_quote) if character == active_quote => quote = None,
            Some(_) => current.push(character),
            None if character == '"' || character == '\'' => quote = Some(character),
            None if character == ',' => push_font_family_part(&mut families, &mut current),
            None => current.push(character),
        }
    }
    if escaped {
        current.push('\\');
    }
    push_font_family_part(&mut families, &mut current);
    families
}

fn push_font_family_part(families: &mut Vec<String>, current: &mut String) {
    let family = current.trim();
    if !family.is_empty() {
        families.push(family.to_owned());
    }
    current.clear();
}

#[cfg(test)]
mod tests {
    use super::{normalized_font_style, normalized_font_weight, parse_font_family_list};

    #[test]
    fn font_family_lists_split_on_unquoted_commas_only() {
        assert_eq!(
            parse_font_family_list("\"Noto Serif, CJK\", 'Book', serif"),
            vec!["Noto Serif, CJK", "Book", "serif"]
        );
        assert_eq!(parse_font_family_list(" , "), Vec::<String>::new());
        assert_eq!(parse_font_family_list("A\\,B"), vec!["A,B"]);
    }

    #[test]
    fn missing_face_descriptors_normalize_to_normal_400() {
        assert_eq!(normalized_font_style(None), "normal");
        assert_eq!(normalized_font_style(Some("Italic")), "italic");
        assert_eq!(normalized_font_style(Some("oblique 14deg")), "oblique");
        assert_eq!(normalized_font_weight(None), 400);
        assert_eq!(normalized_font_weight(Some(0)), 400);
        assert_eq!(normalized_font_weight(Some(700)), 700);
    }
}
