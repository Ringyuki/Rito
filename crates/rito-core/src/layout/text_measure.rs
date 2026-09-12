use ttf_parser::Face as TtfFace;

/// One publication `@font-face` binding with its parsed font program: the
/// face descriptor the font-fallback policy consults when deciding which
/// declared families a publication can actually shape.
#[derive(Clone)]
pub(crate) struct TextMeasurementFontFace<'a> {
    pub(crate) family: String,
    pub(crate) style: Option<String>,
    pub(crate) weight: Option<u16>,
    pub(crate) bytes: &'a [u8],
    ttf_face: Option<TtfFace<'a>>,
    shape_face: Option<rustybuzz::Face<'a>>,
    shape_cmap_subtable: Option<u16>,
}

impl std::fmt::Debug for TextMeasurementFontFace<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TextMeasurementFontFace")
            .field("family", &self.family)
            .field("style", &self.style)
            .field("weight", &self.weight)
            .field("bytes_len", &self.bytes.len())
            .finish()
    }
}

impl<'a> TextMeasurementFontFace<'a> {
    pub(crate) fn new(
        family: String,
        style: Option<String>,
        weight: Option<u16>,
        bytes: &'a [u8],
    ) -> Self {
        let ttf_face = TtfFace::parse(bytes, 0).ok();
        let shape_cmap_subtable = ttf_face.as_ref().and_then(preferred_shape_cmap_subtable);
        Self {
            family,
            style,
            weight,
            bytes,
            ttf_face,
            shape_face: rustybuzz::Face::from_slice(bytes, 0),
            shape_cmap_subtable,
        }
    }

    pub(crate) fn is_shapeable(&self) -> bool {
        self.ttf_face.is_some() && self.shape_face.is_some() && self.shape_cmap_subtable.is_some()
    }

    pub(crate) fn is_static_shapeable(&self) -> bool {
        self.is_shapeable()
            && self
                .ttf_face
                .as_ref()
                .is_some_and(|face| face.variation_axes().is_empty())
    }

    pub(crate) fn normalized_style(&self) -> &'static str {
        normalized_font_style(self.style.as_deref())
    }

    pub(crate) fn normalized_weight(&self) -> u16 {
        normalized_font_weight(self.weight)
    }
}

fn preferred_shape_cmap_subtable(face: &TtfFace<'_>) -> Option<u16> {
    use ttf_parser::PlatformId::{Macintosh, Unicode, Windows};

    [
        (Windows, 0),
        (Windows, 10),
        (Unicode, 6),
        (Unicode, 4),
        (Windows, 1),
        (Unicode, 3),
        (Unicode, 2),
        (Unicode, 1),
        (Unicode, 0),
        (Macintosh, 0),
    ]
    .into_iter()
    .find_map(|(platform_id, encoding_id)| {
        face.tables()
            .cmap?
            .subtables
            .into_iter()
            .position(|subtable| {
                subtable.platform_id == platform_id && subtable.encoding_id == encoding_id
            })
            .map(|index| index as u16)
    })
}

const INITIAL_FONT_STYLE: &str = "normal";
const INITIAL_FONT_WEIGHT: u16 = 400;

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
