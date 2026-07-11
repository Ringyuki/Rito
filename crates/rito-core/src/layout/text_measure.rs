use std::{cell::RefCell, collections::HashMap, rc::Rc};

use serde_json::{Map, Value};
use ttf_parser::Face as TtfFace;

use super::{
    line_break::utf16_len,
    style_values::{number_style, string_style},
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum TextMeasurementPolicy {
    #[default]
    FixtureCompatible,
    FontAware,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TextMeasurementStyle {
    pub(crate) font_size: f64,
    pub(crate) word_spacing: f64,
    pub(crate) letter_spacing: f64,
    pub(crate) font_family: Option<String>,
    pub(crate) font_style: Option<String>,
    pub(crate) font_weight: Option<u16>,
}

impl TextMeasurementStyle {
    pub(crate) fn from_style(style: &Map<String, Value>) -> Self {
        Self {
            font_size: number_style(style, "fontSize").unwrap_or(16.0),
            word_spacing: number_style(style, "wordSpacing").unwrap_or(0.0),
            letter_spacing: number_style(style, "letterSpacing").unwrap_or(0.0),
            font_family: string_style(style, "fontFamily"),
            font_style: string_style(style, "fontStyle"),
            font_weight: number_style(style, "fontWeight").map(|weight| weight.round() as u16),
        }
    }
}

impl Default for TextMeasurementStyle {
    fn default() -> Self {
        Self {
            font_size: 16.0,
            word_spacing: 0.0,
            letter_spacing: 0.0,
            font_family: None,
            font_style: None,
            font_weight: None,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct TextMeasurementInput<'a> {
    pub(crate) text: &'a str,
    pub(crate) style: TextMeasurementStyle,
    pub(crate) policy: TextMeasurementPolicy,
    pub(crate) fonts: &'a TextMeasurementFonts<'a>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct TextMeasurement {
    pub(crate) width: f64,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct TextMeasurementCache {
    widths: Rc<RefCell<HashMap<TextMeasurementCacheKey, f64>>>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct TextMeasurementFonts<'a> {
    faces: Vec<TextMeasurementFontFace<'a>>,
    cache: TextMeasurementCache,
}

impl<'a> TextMeasurementFonts<'a> {
    pub(crate) fn empty() -> Self {
        Self {
            faces: Vec::new(),
            cache: TextMeasurementCache::default(),
        }
    }

    #[cfg(test)]
    pub(crate) fn new(faces: Vec<TextMeasurementFontFace<'a>>) -> Self {
        Self {
            faces,
            cache: TextMeasurementCache::default(),
        }
    }

    pub(crate) fn new_with_cache(
        faces: Vec<TextMeasurementFontFace<'a>>,
        cache: TextMeasurementCache,
    ) -> Self {
        Self { faces, cache }
    }

    fn matching_faces<'b>(
        &'b self,
        style: &TextMeasurementStyle,
    ) -> Vec<&'b TextMeasurementFontFace<'a>> {
        let families = style
            .font_family
            .as_deref()
            .map(parse_font_family_list)
            .unwrap_or_default();
        let mut matches = Vec::new();
        for family in families {
            let best_score = self
                .faces
                .iter()
                .filter(|face| face.ttf_face.is_some() && family.eq_ignore_ascii_case(&face.family))
                .map(|face| face.match_score(style))
                .min();
            let Some(best_score) = best_score else {
                continue;
            };
            matches.extend(self.faces.iter().rev().filter(|face| {
                face.ttf_face.is_some()
                    && family.eq_ignore_ascii_case(&face.family)
                    && face.match_score(style) == best_score
            }));
        }
        matches
    }

    fn cached_width(&self, key: &TextMeasurementCacheKey) -> Option<f64> {
        self.cache.widths.borrow().get(key).copied()
    }

    fn cache_width(&self, key: TextMeasurementCacheKey, width: f64) {
        self.cache.widths.borrow_mut().insert(key, width);
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct TextMeasurementCacheKey {
    text: String,
    font_size: u64,
    word_spacing: u64,
    letter_spacing: u64,
    font_family: Option<String>,
    font_style: Option<String>,
    font_weight: Option<u16>,
}

impl TextMeasurementCacheKey {
    fn new(input: &TextMeasurementInput<'_>) -> Self {
        Self {
            text: input.text.to_owned(),
            font_size: input.style.font_size.to_bits(),
            word_spacing: input.style.word_spacing.to_bits(),
            letter_spacing: input.style.letter_spacing.to_bits(),
            font_family: input.style.font_family.clone(),
            font_style: input.style.font_style.clone(),
            font_weight: input.style.font_weight,
        }
    }
}

#[derive(Clone)]
pub(crate) struct TextMeasurementFontFace<'a> {
    pub(crate) family: String,
    pub(crate) style: Option<String>,
    pub(crate) weight: Option<u16>,
    pub(crate) bytes: &'a [u8],
    ttf_face: Option<TtfFace<'a>>,
    shape_face: Option<rustybuzz::Face<'a>>,
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
        Self {
            family,
            style,
            weight,
            bytes,
            ttf_face: TtfFace::parse(bytes, 0).ok(),
            shape_face: rustybuzz::Face::from_slice(bytes, 0),
        }
    }

    fn match_score(&self, style: &TextMeasurementStyle) -> FontFaceMatchScore {
        FontFaceMatchScore {
            style_distance: font_style_distance(style.font_style.as_deref(), self.style.as_deref()),
            weight_score: font_weight_score(
                style.font_weight.unwrap_or(INITIAL_FONT_WEIGHT),
                self.weight.unwrap_or(INITIAL_FONT_WEIGHT),
            ),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct FontFaceMatchScore {
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

fn font_style_distance(requested: Option<&str>, candidate: Option<&str>) -> u8 {
    // The supported computed-style subset normalizes requested oblique text to italic.
    let requested = font_style_keyword(requested.unwrap_or(INITIAL_FONT_STYLE));
    let candidate = font_style_keyword(candidate.unwrap_or(INITIAL_FONT_STYLE));
    if requested.eq_ignore_ascii_case(candidate) {
        return 0;
    }
    if requested.eq_ignore_ascii_case("normal") {
        return if candidate.eq_ignore_ascii_case("oblique") {
            1
        } else {
            2
        };
    }
    if requested.eq_ignore_ascii_case("italic") && candidate.eq_ignore_ascii_case("oblique")
        || requested.eq_ignore_ascii_case("oblique") && candidate.eq_ignore_ascii_case("italic")
    {
        return 1;
    }
    2
}

fn font_style_keyword(value: &str) -> &str {
    value.split_ascii_whitespace().next().unwrap_or(value)
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

pub(crate) fn measure_text(input: TextMeasurementInput<'_>) -> TextMeasurement {
    match input.policy {
        TextMeasurementPolicy::FixtureCompatible => fixture_compatible_measurement(&input),
        TextMeasurementPolicy::FontAware => {
            font_aware_measurement(&input).unwrap_or_else(|| fixture_compatible_measurement(&input))
        }
    }
}

#[cfg(test)]
pub(crate) fn measure_text_with_style(text: &str, style: &Map<String, Value>) -> TextMeasurement {
    measure_text(TextMeasurementInput {
        text,
        style: TextMeasurementStyle::from_style(style),
        policy: TextMeasurementPolicy::FixtureCompatible,
        fonts: &TextMeasurementFonts::empty(),
    })
}

fn fixture_compatible_measurement(input: &TextMeasurementInput<'_>) -> TextMeasurement {
    if input.text.is_empty() {
        return TextMeasurement { width: 0.0 };
    }

    let style = &input.style;
    let ascii_spaces = input
        .text
        .chars()
        .filter(|character| *character == ' ')
        .count();
    let scalar_gaps = input.text.chars().count().saturating_sub(1);

    TextMeasurement {
        width: utf16_len(input.text) as f64 * style.font_size * 0.6
            + ascii_spaces as f64 * style.word_spacing
            + scalar_gaps as f64 * style.letter_spacing,
    }
}

fn font_aware_measurement(input: &TextMeasurementInput<'_>) -> Option<TextMeasurement> {
    if input.text.is_empty() {
        return Some(TextMeasurement { width: 0.0 });
    }
    let cache_key = TextMeasurementCacheKey::new(input);
    if let Some(width) = input.fonts.cached_width(&cache_key) {
        return Some(TextMeasurement { width });
    }
    let faces = input.fonts.matching_faces(&input.style);
    if faces.is_empty() {
        return None;
    }
    let mut width = 0.0;
    for run in font_runs(input.text, &faces) {
        width += match run {
            FontMeasurementRun::Shaped { text, face } => {
                shaped_run_width(text, face, input.style.font_size)
                    .unwrap_or_else(|| glyph_run_width(text, &[face], input.style.font_size))
            }
            FontMeasurementRun::Fallback(character) => {
                fixture_character_width(character, input.style.font_size)
            }
        };
    }
    let ascii_spaces = input
        .text
        .chars()
        .filter(|character| *character == ' ')
        .count();
    let scalar_gaps = input.text.chars().count().saturating_sub(1);
    let width = width
        + ascii_spaces as f64 * input.style.word_spacing
        + scalar_gaps as f64 * input.style.letter_spacing;
    input.fonts.cache_width(cache_key, width);
    Some(TextMeasurement { width })
}

fn glyph_width(
    character: char,
    faces: &[&TextMeasurementFontFace<'_>],
    font_size: f64,
) -> Option<f64> {
    faces.iter().find_map(|face| {
        let parsed = face.ttf_face.as_ref()?;
        let glyph = parsed.glyph_index(character)?;
        let advance = parsed.glyph_hor_advance(glyph)?;
        Some(f64::from(advance) * font_size / f64::from(parsed.units_per_em()))
    })
}

fn glyph_run_width(text: &str, faces: &[&TextMeasurementFontFace<'_>], font_size: f64) -> f64 {
    text.chars()
        .map(|character| {
            glyph_width(character, faces, font_size)
                .unwrap_or_else(|| fixture_character_width(character, font_size))
        })
        .sum()
}

enum FontMeasurementRun<'a> {
    Shaped {
        text: &'a str,
        face: &'a TextMeasurementFontFace<'a>,
    },
    Fallback(char),
}

fn font_runs<'a>(
    text: &'a str,
    faces: &[&'a TextMeasurementFontFace<'a>],
) -> Vec<FontMeasurementRun<'a>> {
    let mut runs = Vec::new();
    let mut active_face: Option<&TextMeasurementFontFace<'_>> = None;
    let mut active_start: Option<usize> = None;
    for (index, character) in text.char_indices() {
        let face = faces
            .iter()
            .copied()
            .find(|face| face_supports_character(face, character));
        if face.is_some_and(|face| {
            active_face.is_some_and(|active_face| std::ptr::eq(face, active_face))
        }) {
            continue;
        }
        if let (Some(start), Some(face)) = (active_start.take(), active_face.take()) {
            runs.push(FontMeasurementRun::Shaped {
                text: &text[start..index],
                face,
            });
        }
        if let Some(face) = face {
            active_start = Some(index);
            active_face = Some(face);
        } else {
            runs.push(FontMeasurementRun::Fallback(character));
        }
    }
    if let (Some(start), Some(face)) = (active_start, active_face) {
        runs.push(FontMeasurementRun::Shaped {
            text: &text[start..],
            face,
        });
    }
    runs
}

fn face_supports_character(face: &TextMeasurementFontFace<'_>, character: char) -> bool {
    face.ttf_face
        .as_ref()
        .and_then(|parsed| parsed.glyph_index(character))
        .is_some()
}

fn shaped_run_width(
    text: &str,
    measurement_face: &TextMeasurementFontFace<'_>,
    font_size: f64,
) -> Option<f64> {
    let face = measurement_face.shape_face.as_ref()?;
    let mut buffer = rustybuzz::UnicodeBuffer::new();
    buffer.push_str(text);
    buffer.guess_segment_properties();
    let glyphs = rustybuzz::shape(face, &[], buffer);
    let units_per_em = f64::from(face.units_per_em());
    if units_per_em <= 0.0 {
        return None;
    }
    Some(
        glyphs
            .glyph_positions()
            .iter()
            .map(|position| f64::from(position.x_advance) * font_size / units_per_em)
            .sum(),
    )
}

fn fixture_character_width(character: char, font_size: f64) -> f64 {
    character.len_utf16() as f64 * font_size * 0.6
}

fn parse_font_family_list(value: &str) -> Vec<String> {
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
    use std::{
        fs::File,
        io::Read,
        path::{Path, PathBuf},
    };

    use serde_json::{json, Map, Value};
    use ttf_parser::Face;
    use zip::ZipArchive;

    use super::{
        face_supports_character, fixture_character_width, font_runs, measure_text,
        measure_text_with_style, parse_font_family_list, shaped_run_width, FontMeasurementRun,
        TextMeasurementFontFace, TextMeasurementFonts, TextMeasurementInput, TextMeasurementPolicy,
        TextMeasurementStyle,
    };

    fn assert_width(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 0.000_001,
            "expected width {expected}, got {actual}"
        );
    }

    fn ordered_face_weights(requested: u16, source_weights: &[u16], bytes: &[u8]) -> Vec<u16> {
        let fonts = TextMeasurementFonts::new(
            source_weights
                .iter()
                .map(|weight| {
                    TextMeasurementFontFace::new("Book".to_owned(), None, Some(*weight), bytes)
                })
                .collect(),
        );
        let style = TextMeasurementStyle {
            font_family: Some("Book".to_owned()),
            font_weight: Some(requested),
            ..TextMeasurementStyle::default()
        };

        fonts
            .matching_faces(&style)
            .iter()
            .map(|face| face.weight.expect("test face has an explicit weight"))
            .collect()
    }

    #[test]
    fn fixture_policy_counts_utf16_code_units_for_base_width() {
        let measurement = measure_text(TextMeasurementInput {
            text: "a\u{20bb7}",
            style: TextMeasurementStyle {
                font_size: 10.0,
                ..TextMeasurementStyle::default()
            },
            policy: TextMeasurementPolicy::FixtureCompatible,
            fonts: &TextMeasurementFonts::empty(),
        });

        assert_width(measurement.width, 18.0);
    }

    #[test]
    fn fixture_policy_applies_word_spacing_to_ascii_spaces_only() {
        let measurement = measure_text(TextMeasurementInput {
            text: "a b\tc",
            style: TextMeasurementStyle {
                font_size: 10.0,
                word_spacing: 2.0,
                ..TextMeasurementStyle::default()
            },
            policy: TextMeasurementPolicy::FixtureCompatible,
            fonts: &TextMeasurementFonts::empty(),
        });

        assert_width(measurement.width, 32.0);
    }

    #[test]
    fn fixture_policy_applies_letter_spacing_to_scalar_gaps() {
        let measurement = measure_text(TextMeasurementInput {
            text: "a\u{20bb7}",
            style: TextMeasurementStyle {
                font_size: 10.0,
                letter_spacing: 1.5,
                ..TextMeasurementStyle::default()
            },
            policy: TextMeasurementPolicy::FixtureCompatible,
            fonts: &TextMeasurementFonts::empty(),
        });

        assert_width(measurement.width, 19.5);
    }

    #[test]
    fn empty_text_has_zero_width() {
        let measurement = measure_text(TextMeasurementInput {
            text: "",
            style: TextMeasurementStyle {
                font_size: 10.0,
                word_spacing: 2.0,
                letter_spacing: 1.5,
                ..TextMeasurementStyle::default()
            },
            policy: TextMeasurementPolicy::FixtureCompatible,
            fonts: &TextMeasurementFonts::empty(),
        });

        assert_width(measurement.width, 0.0);
    }

    #[test]
    fn style_map_defaults_match_layout_defaults() {
        let style = Map::<String, Value>::new();

        assert_eq!(
            TextMeasurementStyle::from_style(&style),
            TextMeasurementStyle::default()
        );
    }

    #[test]
    fn style_map_values_drive_fixture_measurement() {
        let style = Map::from_iter([
            ("fontSize".to_owned(), json!(12.0)),
            ("wordSpacing".to_owned(), json!(3.0)),
            ("letterSpacing".to_owned(), json!(1.0)),
        ]);

        let measurement = measure_text_with_style("a b", &style);

        assert_width(measurement.width, 26.6);
    }

    #[test]
    fn font_family_list_keeps_commas_inside_quoted_names() {
        assert_eq!(
            parse_font_family_list("\"Fixture, Serif\", serif, 'Display \\' Name'"),
            vec!["Fixture, Serif", "serif", "Display ' Name"]
        );
    }

    #[test]
    fn font_aware_face_selection_honors_family_declaration_order() {
        let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
        let fonts = TextMeasurementFonts::new(vec![
            TextMeasurementFontFace::new("Second".to_owned(), None, None, &bytes),
            TextMeasurementFontFace::new("First".to_owned(), None, None, &bytes),
        ]);
        let style = TextMeasurementStyle {
            font_family: Some("First, Second".to_owned()),
            ..TextMeasurementStyle::default()
        };

        let faces = fonts.matching_faces(&style);

        assert_eq!(
            faces
                .iter()
                .map(|face| face.family.as_str())
                .collect::<Vec<_>>(),
            vec!["First", "Second"]
        );
    }

    #[test]
    fn font_aware_face_selection_treats_missing_descriptors_as_normal_400() {
        let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
        let fonts = TextMeasurementFonts::new(vec![
            TextMeasurementFontFace::new("Book".to_owned(), None, None, &bytes),
            TextMeasurementFontFace::new(
                "Book".to_owned(),
                Some("italic".to_owned()),
                Some(700),
                &bytes,
            ),
        ]);
        let italic_bold = TextMeasurementStyle {
            font_family: Some("Book".to_owned()),
            font_style: Some("italic".to_owned()),
            font_weight: Some(700),
            ..TextMeasurementStyle::default()
        };

        let italic_faces = fonts.matching_faces(&italic_bold);
        let regular_faces = fonts.matching_faces(&TextMeasurementStyle {
            font_family: Some("Book".to_owned()),
            ..TextMeasurementStyle::default()
        });

        assert_eq!(italic_faces[0].style.as_deref(), Some("italic"));
        assert_eq!(italic_faces[0].weight, Some(700));
        assert_eq!(regular_faces[0].style, None);
        assert_eq!(regular_faces[0].weight, None);
    }

    #[test]
    fn font_aware_face_selection_honors_css_weight_search_direction() {
        let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
        assert_eq!(ordered_face_weights(400, &[300, 500], &bytes), vec![500]);
        assert_eq!(ordered_face_weights(500, &[600, 400], &bytes), vec![400]);
        assert_eq!(ordered_face_weights(300, &[400, 200], &bytes), vec![200]);
        assert_eq!(ordered_face_weights(600, &[500, 700], &bytes), vec![700]);
    }

    #[test]
    fn font_aware_face_selection_keeps_best_composite_in_reverse_source_order() {
        let source_first = read_epub_font("OEBPS/Fonts/illus1.ttf");
        let source_second = read_epub_font("OEBPS/Fonts/illus5.ttf");
        let fonts = TextMeasurementFonts::new(vec![
            TextMeasurementFontFace::new(
                "Book".to_owned(),
                Some("italic".to_owned()),
                Some(700),
                &source_first,
            ),
            TextMeasurementFontFace::new(
                "Book".to_owned(),
                Some("italic".to_owned()),
                Some(700),
                &source_second,
            ),
            TextMeasurementFontFace::new(
                "Book".to_owned(),
                Some("normal".to_owned()),
                Some(600),
                &source_first,
            ),
        ]);
        let style = TextMeasurementStyle {
            font_family: Some("Book".to_owned()),
            font_style: Some("italic".to_owned()),
            font_weight: Some(600),
            ..TextMeasurementStyle::default()
        };

        let faces = fonts.matching_faces(&style);

        assert_eq!(faces.len(), 2);
        assert_eq!(faces[0].bytes, source_second.as_slice());
        assert_eq!(faces[1].bytes, source_first.as_slice());
    }

    #[test]
    fn font_aware_face_selection_prefers_closest_face_before_next_family() {
        let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
        let (character, _) = font_metric_sample(&bytes, 20.0);
        let text = character.to_string();
        let fonts = TextMeasurementFonts::new(vec![
            TextMeasurementFontFace::new(
                "Fallback".to_owned(),
                Some("italic".to_owned()),
                Some(700),
                &bytes,
            ),
            TextMeasurementFontFace::new("Preferred".to_owned(), None, None, &bytes),
        ]);
        let style = TextMeasurementStyle {
            font_family: Some("Preferred, Fallback".to_owned()),
            font_style: Some("italic".to_owned()),
            font_weight: Some(700),
            ..TextMeasurementStyle::default()
        };

        let faces = fonts.matching_faces(&style);
        let runs = font_runs(&text, &faces);

        let FontMeasurementRun::Shaped { face, .. } = &runs[0] else {
            panic!("supported character must produce a shaped run");
        };
        assert_eq!(face.family, "Preferred");
    }

    #[test]
    fn font_aware_face_selection_falls_back_by_glyph_across_families() {
        let preferred_bytes = read_epub_font("OEBPS/Fonts/illus1.ttf");
        let fallback_bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
        let character = character_supported_only_by(&preferred_bytes, &fallback_bytes);
        let text = character.to_string();
        let fonts = TextMeasurementFonts::new(vec![
            TextMeasurementFontFace::new("Preferred".to_owned(), None, None, &preferred_bytes),
            TextMeasurementFontFace::new("Fallback".to_owned(), None, None, &fallback_bytes),
        ]);
        let style = TextMeasurementStyle {
            font_family: Some("Preferred, Fallback".to_owned()),
            ..TextMeasurementStyle::default()
        };

        let faces = fonts.matching_faces(&style);
        let runs = font_runs(&text, &faces);

        let FontMeasurementRun::Shaped { face, .. } = &runs[0] else {
            panic!("fallback character must produce a shaped run");
        };
        assert_eq!(face.family, "Fallback");
    }

    #[test]
    fn font_aware_face_selection_ignores_invalid_exact_face() {
        let valid_bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
        let invalid_bytes = [1];
        let (character, _) = font_metric_sample(&valid_bytes, 20.0);
        let text = character.to_string();
        let fonts = TextMeasurementFonts::new(vec![
            TextMeasurementFontFace::new("Preferred".to_owned(), None, None, &valid_bytes),
            TextMeasurementFontFace::new(
                "Fallback".to_owned(),
                Some("italic".to_owned()),
                Some(700),
                &valid_bytes,
            ),
            TextMeasurementFontFace::new(
                "Preferred".to_owned(),
                Some("italic".to_owned()),
                Some(700),
                &invalid_bytes,
            ),
        ]);
        let style = TextMeasurementStyle {
            font_family: Some("Preferred, Fallback".to_owned()),
            font_style: Some("italic".to_owned()),
            font_weight: Some(700),
            ..TextMeasurementStyle::default()
        };

        let faces = fonts.matching_faces(&style);
        let runs = font_runs(&text, &faces);

        assert_eq!(
            faces
                .iter()
                .map(|face| face.family.as_str())
                .collect::<Vec<_>>(),
            vec!["Preferred", "Fallback"]
        );
        let FontMeasurementRun::Shaped { face, .. } = &runs[0] else {
            panic!("valid same-family face must provide the supported glyph");
        };
        assert_eq!(face.family, "Preferred");
    }

    #[test]
    fn font_aware_face_selection_does_not_use_descriptor_runner_up_for_missing_glyph() {
        let exact_bytes = read_epub_font("OEBPS/Fonts/illus1.ttf");
        let runner_up_bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
        let character = character_supported_only_by(&exact_bytes, &runner_up_bytes);
        let text = character.to_string();
        let fonts = TextMeasurementFonts::new(vec![
            TextMeasurementFontFace::new("Preferred".to_owned(), None, None, &runner_up_bytes),
            TextMeasurementFontFace::new(
                "Fallback".to_owned(),
                Some("italic".to_owned()),
                Some(700),
                &runner_up_bytes,
            ),
            TextMeasurementFontFace::new(
                "Preferred".to_owned(),
                Some("italic".to_owned()),
                Some(700),
                &exact_bytes,
            ),
        ]);
        let style = TextMeasurementStyle {
            font_family: Some("Preferred, Fallback".to_owned()),
            font_style: Some("italic".to_owned()),
            font_weight: Some(700),
            ..TextMeasurementStyle::default()
        };

        let faces = fonts.matching_faces(&style);
        let runs = font_runs(&text, &faces);

        assert_eq!(
            faces
                .iter()
                .map(|face| face.family.as_str())
                .collect::<Vec<_>>(),
            vec!["Preferred", "Fallback"]
        );
        let FontMeasurementRun::Shaped { face, .. } = &runs[0] else {
            panic!("next family exact face must provide the glyph");
        };
        assert_eq!(face.family, "Fallback");
    }

    #[test]
    fn font_aware_policy_uses_matching_font_advances() {
        let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
        let (character, expected_width) = font_metric_sample(&bytes, 20.0);
        let text = character.to_string();
        let fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
            "illus5".to_owned(),
            None,
            None,
            &bytes,
        )]);
        let style = TextMeasurementStyle {
            font_size: 20.0,
            font_family: Some("\"illus5\", serif".to_owned()),
            ..TextMeasurementStyle::default()
        };

        let font_aware = measure_text(TextMeasurementInput {
            text: &text,
            style: style.clone(),
            policy: TextMeasurementPolicy::FontAware,
            fonts: &fonts,
        });
        let fixture = measure_text(TextMeasurementInput {
            text: &text,
            style,
            policy: TextMeasurementPolicy::FixtureCompatible,
            fonts: &fonts,
        });

        assert_width(font_aware.width, expected_width);
        assert_width(fixture.width, fixture_character_width(character, 20.0));
    }

    #[test]
    fn font_aware_policy_matches_quoted_font_family_with_comma() {
        let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
        let (character, expected_width) = font_metric_sample(&bytes, 20.0);
        let text = character.to_string();
        let fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
            "Fixture, Serif".to_owned(),
            None,
            None,
            &bytes,
        )]);

        let measured = measure_text(TextMeasurementInput {
            text: &text,
            style: TextMeasurementStyle {
                font_size: 20.0,
                font_family: Some("\"Fixture, Serif\", serif".to_owned()),
                ..TextMeasurementStyle::default()
            },
            policy: TextMeasurementPolicy::FontAware,
            fonts: &fonts,
        });

        assert_width(measured.width, expected_width);
    }

    #[test]
    fn font_aware_policy_shapes_contiguous_font_runs() {
        let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
        let (first, _) = font_metric_sample(&bytes, 20.0);
        let second = supported_character_after(&bytes, first).expect("fixture font has two glyphs");
        let text = format!("{first}{second}");
        let font_face = TextMeasurementFontFace::new("illus5".to_owned(), None, None, &bytes);
        let expected = shaped_run_width(&text, &font_face, 20.0).expect("fixture text shapes");
        let fonts = TextMeasurementFonts::new(vec![font_face]);

        let measured = measure_text(TextMeasurementInput {
            text: &text,
            style: TextMeasurementStyle {
                font_size: 20.0,
                font_family: Some("illus5".to_owned()),
                ..TextMeasurementStyle::default()
            },
            policy: TextMeasurementPolicy::FontAware,
            fonts: &fonts,
        });

        assert_width(measured.width, expected);
    }

    #[test]
    fn font_aware_policy_falls_back_per_missing_glyph() {
        let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
        let (character, _) = font_metric_sample(&bytes, 20.0);
        let fallback = '\u{1f600}';
        let text = format!("{character}{fallback}{character}");
        let font_face = TextMeasurementFontFace::new("illus5".to_owned(), None, None, &bytes);
        let shaped = shaped_run_width(&character.to_string(), &font_face, 20.0)
            .expect("fixture character shapes");
        let fonts = TextMeasurementFonts::new(vec![font_face]);

        let measured = measure_text(TextMeasurementInput {
            text: &text,
            style: TextMeasurementStyle {
                font_size: 20.0,
                font_family: Some("illus5".to_owned()),
                ..TextMeasurementStyle::default()
            },
            policy: TextMeasurementPolicy::FontAware,
            fonts: &fonts,
        });

        assert_width(
            measured.width,
            shaped * 2.0 + fixture_character_width(fallback, 20.0),
        );
    }

    #[test]
    fn font_aware_policy_counts_leading_consecutive_missing_glyphs() {
        let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
        let (character, _) = font_metric_sample(&bytes, 20.0);
        let first_missing = '\u{1f600}';
        let second_missing = '\u{1f601}';
        let text = format!("{first_missing}{second_missing}{character}");
        let font_face = TextMeasurementFontFace::new("illus5".to_owned(), None, None, &bytes);
        assert!(!face_supports_character(&font_face, first_missing));
        assert!(!face_supports_character(&font_face, second_missing));
        let shaped = shaped_run_width(&character.to_string(), &font_face, 20.0)
            .expect("fixture character shapes");
        let fonts = TextMeasurementFonts::new(vec![font_face]);

        let measured = measure_text(TextMeasurementInput {
            text: &text,
            style: TextMeasurementStyle {
                font_size: 20.0,
                font_family: Some("illus5".to_owned()),
                ..TextMeasurementStyle::default()
            },
            policy: TextMeasurementPolicy::FontAware,
            fonts: &fonts,
        });

        assert_width(
            measured.width,
            shaped
                + fixture_character_width(first_missing, 20.0)
                + fixture_character_width(second_missing, 20.0),
        );
    }

    fn read_epub_font(path: &str) -> Vec<u8> {
        let fixture = workspace_path("packages/rito/tests/fixtures/books/book-01.epub");
        let file = File::open(&fixture)
            .unwrap_or_else(|error| panic!("fixture epub opens at {}: {error}", fixture.display()));
        let mut archive = ZipArchive::new(file).expect("fixture epub is a zip archive");
        let mut font = archive.by_name(path).expect("fixture font exists");
        let mut bytes = Vec::new();
        font.read_to_end(&mut bytes).expect("fixture font reads");
        bytes
    }

    fn workspace_path(relative: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(relative)
    }

    fn font_metric_sample(bytes: &[u8], font_size: f64) -> (char, f64) {
        let face = Face::parse(bytes, 0).expect("fixture font parses");
        (0x20..=0x9fff)
            .filter_map(char::from_u32)
            .find_map(|character| {
                let glyph = face.glyph_index(character)?;
                let advance = face.glyph_hor_advance(glyph)?;
                let width = f64::from(advance) * font_size / f64::from(face.units_per_em());
                if (width - fixture_character_width(character, font_size)).abs() > 0.001 {
                    Some((character, width))
                } else {
                    None
                }
            })
            .expect("fixture font has a measurable non-fixture glyph")
    }

    fn supported_character_after(bytes: &[u8], after: char) -> Option<char> {
        let face = Face::parse(bytes, 0).expect("fixture font parses");
        ((after as u32 + 1)..=0x9fff)
            .filter_map(char::from_u32)
            .find(|character| face.glyph_index(*character).is_some())
    }

    fn character_supported_only_by(preferred: &[u8], fallback: &[u8]) -> char {
        let preferred = Face::parse(preferred, 0).expect("preferred fixture font parses");
        let fallback = Face::parse(fallback, 0).expect("fallback fixture font parses");
        (0x20..=0xffff)
            .filter_map(char::from_u32)
            .find(|character| {
                preferred.glyph_index(*character).is_none()
                    && fallback.glyph_index(*character).is_some()
            })
            .expect("fixture fonts have a fallback-only glyph")
    }
}
