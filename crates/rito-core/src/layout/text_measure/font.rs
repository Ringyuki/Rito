use ttf_parser::Face as TtfFace;

use super::{
    fixture_character_width, TextMeasurement, TextMeasurementCache, TextMeasurementCacheKey,
    TextMeasurementInput, TextMeasurementStyle,
};

mod matching;

pub(super) use matching::parse_font_family_list;

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

    pub(super) fn matching_faces<'b>(
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
}

pub(super) fn font_aware_measurement(input: &TextMeasurementInput<'_>) -> Option<TextMeasurement> {
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

pub(super) enum FontMeasurementRun<'a> {
    Shaped {
        text: &'a str,
        face: &'a TextMeasurementFontFace<'a>,
    },
    Fallback(char),
}

pub(super) fn font_runs<'a>(
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

pub(super) fn face_supports_character(face: &TextMeasurementFontFace<'_>, character: char) -> bool {
    face.ttf_face
        .as_ref()
        .and_then(|parsed| parsed.glyph_index(character))
        .is_some()
}

pub(super) fn shaped_run_width(
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
