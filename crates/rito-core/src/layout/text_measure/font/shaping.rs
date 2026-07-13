use super::{cluster_safety::constrain_clusters_to_graphemes, mac_roman, TextMeasurementFonts};
use crate::layout::text_shape::{RunShapeCluster, RunShapeDirection};
use sha2::{Digest, Sha256};
use ttf_parser::Face as TtfFace;

mod cluster_ranges;

use cluster_ranges::logical_cluster_ranges;

#[cfg(test)]
thread_local! {
    static SHAPE_RUN_CALL_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
pub(in super::super) fn reset_shape_run_call_count() {
    SHAPE_RUN_CALL_COUNT.with(|count| count.set(0));
}

#[cfg(test)]
pub(in super::super) fn shape_run_call_count() -> usize {
    SHAPE_RUN_CALL_COUNT.with(std::cell::Cell::get)
}

#[derive(Clone)]
pub(crate) struct TextMeasurementFontFace<'a> {
    pub(crate) family: String,
    pub(crate) style: Option<String>,
    pub(crate) weight: Option<u16>,
    pub(crate) bytes: &'a [u8],
    fingerprint: [u8; 8],
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
        Self::new_with_fingerprint(family, style, weight, bytes, font_fingerprint(bytes))
    }

    pub(crate) fn new_with_fingerprint(
        family: String,
        style: Option<String>,
        weight: Option<u16>,
        bytes: &'a [u8],
        fingerprint: [u8; 8],
    ) -> Self {
        let ttf_face = TtfFace::parse(bytes, 0).ok();
        let shape_cmap_subtable = ttf_face.as_ref().and_then(preferred_shape_cmap_subtable);
        Self {
            family,
            style,
            weight,
            bytes,
            fingerprint,
            ttf_face,
            shape_face: rustybuzz::Face::from_slice(bytes, 0),
            shape_cmap_subtable,
        }
    }

    pub(in super::super) fn fingerprint(&self) -> [u8; 8] {
        self.fingerprint
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
}

fn font_fingerprint(bytes: &[u8]) -> [u8; 8] {
    let digest = Sha256::digest(bytes);
    let mut fingerprint = [0_u8; 8];
    fingerprint.copy_from_slice(&digest[..8]);
    fingerprint
}

pub(in super::super) struct ShapedFontRun {
    pub(in super::super) direction: RunShapeDirection,
    pub(in super::super) clusters: Vec<RunShapeCluster>,
    pub(in super::super) advance: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum ShapeRunFailure {
    RustybuzzUnavailable,
    NonGraphemeSafeClusters { advance: f64 },
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
    measurement_advance(shape_run_checked(text, measurement_face, font_size))
}

#[cfg(test)]
pub(in super::super) fn shape_run(
    text: &str,
    measurement_face: &TextMeasurementFontFace<'_>,
    font_size: f64,
) -> Option<ShapedFontRun> {
    shape_run_checked(text, measurement_face, font_size).ok()
}

pub(super) fn shape_run_checked(
    text: &str,
    measurement_face: &TextMeasurementFontFace<'_>,
    font_size: f64,
) -> Result<ShapedFontRun, ShapeRunFailure> {
    #[cfg(test)]
    SHAPE_RUN_CALL_COUNT.with(|count| count.set(count.get() + 1));
    let face = measurement_face
        .shape_face
        .as_ref()
        .ok_or(ShapeRunFailure::RustybuzzUnavailable)?;
    let mut buffer = rustybuzz::UnicodeBuffer::new();
    buffer.push_str(text);
    buffer.guess_segment_properties();
    let direction = match buffer.direction() {
        rustybuzz::Direction::LeftToRight => RunShapeDirection::LeftToRight,
        rustybuzz::Direction::RightToLeft => RunShapeDirection::RightToLeft,
        _ => return Err(ShapeRunFailure::RustybuzzUnavailable),
    };
    #[cfg(test)]
    crate::layout::text_work_trace::record_rustybuzz_shape_run(text);
    let glyphs = rustybuzz::shape(face, &[], buffer);
    let units_per_em = f64::from(face.units_per_em());
    if units_per_em <= 0.0 {
        return Err(ShapeRunFailure::RustybuzzUnavailable);
    }
    let infos = glyphs.glyph_infos();
    let positions = glyphs.glyph_positions();
    let cluster_ranges =
        logical_cluster_ranges(text, infos).ok_or(ShapeRunFailure::RustybuzzUnavailable)?;
    let mut clusters = Vec::new();
    let mut glyph_start = 0usize;
    let mut visual_cursor = 0.0;
    while glyph_start < infos.len() {
        let cluster = infos[glyph_start].cluster;
        let mut glyph_end = glyph_start + 1;
        while glyph_end < infos.len() && infos[glyph_end].cluster == cluster {
            glyph_end += 1;
        }
        let advance = positions[glyph_start..glyph_end]
            .iter()
            .map(|position| f64::from(position.x_advance) * font_size / units_per_em)
            .sum::<f64>();
        let logical_range = cluster_ranges
            .get(&cluster)
            .ok_or(ShapeRunFailure::RustybuzzUnavailable)?;
        clusters.push(RunShapeCluster {
            logical_start: logical_range.start,
            logical_end: logical_range.end,
            advance: advance as f32,
        });
        visual_cursor += advance;
        glyph_start = glyph_end;
    }
    let clusters = constrain_clusters_to_graphemes(text, clusters, direction).ok_or(
        ShapeRunFailure::NonGraphemeSafeClusters {
            advance: visual_cursor,
        },
    )?;
    Ok(ShapedFontRun {
        direction,
        clusters,
        advance: visual_cursor,
    })
}

fn measurement_advance(result: Result<ShapedFontRun, ShapeRunFailure>) -> Option<f64> {
    match result {
        Ok(shape) => Some(shape.advance),
        Err(ShapeRunFailure::NonGraphemeSafeClusters { advance }) => Some(advance),
        Err(ShapeRunFailure::RustybuzzUnavailable) => None,
    }
}

#[cfg(test)]
mod tests;
