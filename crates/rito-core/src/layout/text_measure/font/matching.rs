use super::super::TextMeasurementStyle;
use super::TextMeasurementFontFace;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct FontFaceMatchScore {
    style_distance: u8,
    weight_score: FontWeightMatchScore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct FontWeightMatchScore {
    phase: u8,
    distance: u16,
}

const INITIAL_FONT_STYLE: &str = "normal";
const INITIAL_FONT_WEIGHT: u16 = 400;

impl TextMeasurementFontFace<'_> {
    pub(super) fn match_score(&self, style: &TextMeasurementStyle) -> FontFaceMatchScore {
        FontFaceMatchScore {
            style_distance: font_style_distance(
                normalized_font_style(style.font_style.as_deref()),
                self.normalized_style(),
            ),
            weight_score: font_weight_score(
                normalized_font_weight(style.font_weight),
                self.normalized_weight(),
            ),
        }
    }

    pub(crate) fn normalized_style(&self) -> &'static str {
        normalized_font_style(self.style.as_deref())
    }

    pub(crate) fn normalized_weight(&self) -> u16 {
        normalized_font_weight(self.weight)
    }
}

fn font_style_distance(requested: &str, candidate: &str) -> u8 {
    if requested == candidate {
        return 0;
    }
    if requested == "normal" {
        return if candidate == "oblique" { 1 } else { 2 };
    }
    if requested == "italic" && candidate == "oblique"
        || requested == "oblique" && candidate == "italic"
    {
        return 1;
    }
    2
}

fn normalized_font_style(value: Option<&str>) -> &'static str {
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

fn normalized_font_weight(value: Option<u16>) -> u16 {
    value
        .filter(|weight| (1..=1000).contains(weight))
        .unwrap_or(INITIAL_FONT_WEIGHT)
}

fn font_weight_score(requested: u16, candidate: u16) -> FontWeightMatchScore {
    if (400..=500).contains(&requested) {
        if candidate >= requested && candidate <= 500 {
            return FontWeightMatchScore {
                phase: 0,
                distance: candidate - requested,
            };
        }
        if candidate < requested {
            return FontWeightMatchScore {
                phase: 1,
                distance: requested - candidate,
            };
        }
        return FontWeightMatchScore {
            phase: 2,
            distance: candidate - 500,
        };
    }
    if requested < 400 {
        return FontWeightMatchScore {
            phase: u8::from(candidate > requested),
            distance: requested.abs_diff(candidate),
        };
    }
    FontWeightMatchScore {
        phase: u8::from(candidate < requested),
        distance: requested.abs_diff(candidate),
    }
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
