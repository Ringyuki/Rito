use std::{cell::RefCell, collections::HashMap, rc::Rc};

use serde_json::{Map, Value};

use super::{
    line_break::utf16_len,
    style_values::{number_style, string_style},
    text_shape::{RunShape, RunShapeUnavailableReason},
};

mod font;
mod generic_serif;

#[cfg(test)]
mod tests;

pub(crate) use font::{parse_font_family_list, TextMeasurementFontFace, TextMeasurementFonts};

#[cfg(test)]
use font::{
    face_supports_character, font_runs, reset_shape_run_call_count, shape_run,
    shape_run_call_count, shaped_run_width, FontMeasurementRun,
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

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct TextMeasurementCacheKey {
    text: String,
    font_size: u64,
    word_spacing: u64,
    letter_spacing: u64,
    font_family: Option<String>,
    font_style: Option<String>,
    font_weight: Option<u16>,
    layout_profile_id: u64,
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
            layout_profile_id: input.fonts.layout_profile_id(),
        }
    }
}

pub(crate) fn measure_text(input: TextMeasurementInput<'_>) -> TextMeasurement {
    #[cfg(test)]
    super::text_work_trace::record_text_request(
        super::text_work_trace::AtomicTextOperationKind::MeasureRequest,
        input.text,
    );
    match input.policy {
        TextMeasurementPolicy::FixtureCompatible => fixture_compatible_measurement(&input),
        TextMeasurementPolicy::FontAware => font::font_aware_measurement(&input),
    }
}

pub(crate) fn shape_text(input: TextMeasurementInput<'_>) -> RunShape {
    #[cfg(test)]
    super::text_work_trace::record_text_request(
        super::text_work_trace::AtomicTextOperationKind::ShapeRequest,
        input.text,
    );
    match input.policy {
        TextMeasurementPolicy::FixtureCompatible => RunShape::unavailable(
            RunShapeUnavailableReason::FixtureCompatibleMeasurement,
            fixture_compatible_measurement(&input).width,
        ),
        TextMeasurementPolicy::FontAware => font::font_aware_shape(&input),
    }
}

pub(crate) fn shape_text_with_style(
    text: &str,
    style: &Map<String, Value>,
    fonts: &TextMeasurementFonts<'_>,
) -> RunShape {
    shape_text(TextMeasurementInput {
        text,
        style: TextMeasurementStyle::from_style(style),
        policy: TextMeasurementPolicy::FontAware,
        fonts,
    })
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

fn fixture_character_width(character: char, font_size: f64) -> f64 {
    character.len_utf16() as f64 * font_size * 0.6
}

// Platform-neutral approximation for generic/system fonts unavailable to Rust.
// Exact parity still requires shaping and painting with the same fallback font bytes.
fn font_aware_fallback_character_width(character: char, font_size: f64, monospace: bool) -> f64 {
    if is_zero_advance_character(character) {
        0.0
    } else if is_east_asian_wide_character(character) {
        font_size
    } else if monospace && character.is_ascii() {
        fixture_character_width(character, font_size)
    } else if let Some(width) = generic_serif::ascii_advance(character, font_size) {
        width
    } else if !monospace {
        generic_serif::unicode_advance(character, font_size)
            .unwrap_or_else(|| fallback_non_ascii_character_width(character, font_size))
    } else {
        fallback_non_ascii_character_width(character, font_size)
    }
}

fn fallback_non_ascii_character_width(character: char, font_size: f64) -> f64 {
    if matches!(character, ' ' | '\u{00a0}') {
        font_size * 0.25
    } else if character.is_ascii() {
        font_size * 0.5
    } else {
        fixture_character_width(character, font_size)
    }
}

fn font_aware_fallback_pair_adjustment(
    left: char,
    right: char,
    font_size: f64,
    monospace: bool,
) -> f64 {
    if monospace {
        0.0
    } else {
        generic_serif::ascii_pair_adjustment(left, right, font_size)
    }
}

fn is_zero_advance_character(character: char) -> bool {
    matches!(
        character as u32,
        0x0300..=0x036f
            | 0x1ab0..=0x1aff
            | 0x1dc0..=0x1dff
            | 0x200c..=0x200d
            | 0x20d0..=0x20ff
            | 0x3099..=0x309a
            | 0xfe00..=0xfe0f
            | 0xfe20..=0xfe2f
            | 0x1f3fb..=0x1f3ff
            | 0xe0100..=0xe01ef
    )
}

fn is_east_asian_wide_character(character: char) -> bool {
    matches!(
        character as u32,
        0x1100..=0x11ff
            | 0x2e80..=0xa4cf
            | 0xa960..=0xa97f
            | 0xac00..=0xd7ff
            | 0xf900..=0xfaff
            | 0xfe10..=0xfe19
            | 0xfe30..=0xfe6f
            | 0xff01..=0xff60
            | 0xffe0..=0xffe6
            | 0x16fe0..=0x18dff
            | 0x1aff0..=0x1afff
            | 0x1b000..=0x1b2ff
            | 0x20000..=0x323af
    )
}
