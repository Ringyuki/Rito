use serde_json::{Map, Value};

use super::{
    style_values::{number_style, string_style},
    text_measure::{
        measure_text, TextMeasurementFonts, TextMeasurementInput, TextMeasurementPolicy,
        TextMeasurementStyle,
    },
};

pub(crate) fn measure_text_slice_with_fonts(
    text: &str,
    style: &Map<String, Value>,
    fonts: &TextMeasurementFonts<'_>,
) -> f64 {
    measure_text(TextMeasurementInput {
        text,
        style: TextMeasurementStyle::from_style(style),
        policy: TextMeasurementPolicy::FontAware,
        fonts,
    })
    .width
}

pub(crate) fn line_height_px(style: &Map<String, Value>) -> f64 {
    number_style(style, "lineHeightPx").unwrap_or_else(|| {
        number_style(style, "fontSize").unwrap_or(16.0)
            * number_style(style, "lineHeight").unwrap_or(1.2)
    })
}

pub(crate) fn vertical_align_offset(
    style: &Map<String, Value>,
    line_height: f64,
    base_font_size: f64,
) -> f64 {
    let font_size = number_style(style, "fontSize").unwrap_or(16.0);
    match string_style(style, "verticalAlign").as_deref() {
        Some("baseline") => 0.8 * (base_font_size - font_size),
        Some("top" | "text-top") => 0.0,
        Some("super") => 0.8 * (base_font_size - font_size) - base_font_size * 0.4,
        Some("sub") => 0.8 * (base_font_size - font_size) + base_font_size * 0.2,
        Some("middle") => (line_height - font_size) / 2.0,
        Some("bottom" | "text-bottom") => line_height - font_size,
        _ => 0.0,
    }
}
