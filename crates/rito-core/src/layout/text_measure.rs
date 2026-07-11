use std::{cell::RefCell, collections::HashMap, rc::Rc};

use serde_json::{Map, Value};

use super::{
    line_break::utf16_len,
    style_values::{number_style, string_style},
};

mod font;

#[cfg(test)]
mod tests;

pub(crate) use font::{TextMeasurementFontFace, TextMeasurementFonts};

#[cfg(test)]
use font::{
    face_supports_character, font_runs, parse_font_family_list, shaped_run_width,
    FontMeasurementRun,
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

pub(crate) fn measure_text(input: TextMeasurementInput<'_>) -> TextMeasurement {
    match input.policy {
        TextMeasurementPolicy::FixtureCompatible => fixture_compatible_measurement(&input),
        TextMeasurementPolicy::FontAware => font::font_aware_measurement(&input)
            .unwrap_or_else(|| fixture_compatible_measurement(&input)),
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

fn fixture_character_width(character: char, font_size: f64) -> f64 {
    character.len_utf16() as f64 * font_size * 0.6
}
