use ttf_parser::Face as TtfFace;

use super::{mac_roman, TextMeasurementFonts};

#[derive(Clone)]
pub(crate) struct TextMeasurementFontFace<'a> {
    pub(crate) family: String,
    pub(crate) style: Option<String>,
    pub(crate) weight: Option<u16>,
    pub(crate) bytes: &'a [u8],
    pub(super) ttf_face: Option<TtfFace<'a>>,
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
}

pub(in super::super) enum FontMeasurementRun<'a> {
    Shaped {
        text: &'a str,
        face: &'a TextMeasurementFontFace<'a>,
    },
    Fallback(char),
}

pub(in super::super) fn font_runs<'a>(
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

pub(in super::super) fn face_supports_character(
    face: &TextMeasurementFontFace<'_>,
    character: char,
) -> bool {
    supported_glyph_index(face, character).is_some()
}

pub(super) fn glyph_run_width(
    text: &str,
    faces: &[&TextMeasurementFontFace<'_>],
    font_size: f64,
    fonts: &TextMeasurementFonts<'_>,
    monospace: bool,
    fallback_family: Option<&str>,
) -> f64 {
    text.chars()
        .map(|character| {
            glyph_width(character, faces, font_size).unwrap_or_else(|| {
                fonts.fallback_character_width(character, font_size, monospace, fallback_family)
            })
        })
        .sum()
}

fn glyph_width(
    character: char,
    faces: &[&TextMeasurementFontFace<'_>],
    font_size: f64,
) -> Option<f64> {
    faces.iter().find_map(|face| {
        let parsed = face.ttf_face.as_ref()?;
        let glyph = supported_glyph_index(face, character)?;
        let advance = parsed.glyph_hor_advance(glyph)?;
        Some(f64::from(advance) * font_size / f64::from(parsed.units_per_em()))
    })
}

fn supported_glyph_index(
    measurement_face: &TextMeasurementFontFace<'_>,
    character: char,
) -> Option<ttf_parser::GlyphId> {
    let face = measurement_face.ttf_face.as_ref()?;
    let subtable = face
        .tables()
        .cmap?
        .subtables
        .get(measurement_face.shape_cmap_subtable?)?;
    let codepoint = mac_roman::cmap_codepoint(subtable.platform_id, character as u32);
    let glyph = subtable.glyph_index(codepoint).or_else(|| {
        (subtable.platform_id == ttf_parser::PlatformId::Windows
            && subtable.encoding_id == WINDOWS_SYMBOL_ENCODING
            && codepoint <= 0xff)
            .then(|| subtable.glyph_index(0xf000 + codepoint))
            .flatten()
    })?;
    (glyph.0 != 0).then_some(glyph)
}

const WINDOWS_SYMBOL_ENCODING: u16 = 0;

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

pub(in super::super) fn shaped_run_width(
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
