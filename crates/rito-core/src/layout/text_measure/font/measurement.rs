use super::super::{
    fixture_compatible_measurement, TextMeasurement, TextMeasurementCacheKey, TextMeasurementInput,
    TextMeasurementStyle,
};
use super::{
    parse_font_family_list,
    shaping::{font_runs, glyph_run_width, shaped_run_width, FontMeasurementRun},
    TextMeasurementFontFace, TextMeasurementFonts,
};

pub(in super::super) fn font_aware_measurement(
    input: &TextMeasurementInput<'_>,
) -> TextMeasurement {
    if input.text.is_empty() {
        return TextMeasurement { width: 0.0 };
    }
    let cache_key = TextMeasurementCacheKey::new(input);
    if let Some(width) = input.fonts.cached_width(&cache_key) {
        return TextMeasurement { width };
    }
    let faces = input.fonts.matching_faces(&input.style);
    if faces.is_empty() && input.fonts.uses_fixture_compatible_fallback() {
        // Frozen fixture layouts depend on the exact arithmetic order of the
        // original 0.6em formula, not a per-character sum of the same widths.
        return fixture_compatible_measurement(input);
    }
    let monospace = uses_generic_monospace(&input.style);
    let width = if faces.is_empty() {
        fallback_text_width(input.text, input.style.font_size, input.fonts, monospace)
    } else {
        let fallback_family = faces.first().map(|face| face.family.as_str());
        font_run_width(
            input.text,
            &faces,
            input.style.font_size,
            input.fonts,
            monospace,
            fallback_family,
        )
    };
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
    TextMeasurement { width }
}

fn uses_generic_monospace(style: &TextMeasurementStyle) -> bool {
    style
        .font_family
        .as_deref()
        .map(parse_font_family_list)
        .unwrap_or_default()
        .iter()
        .any(|family| family.eq_ignore_ascii_case("monospace"))
}

fn fallback_text_width(
    text: &str,
    font_size: f64,
    fonts: &TextMeasurementFonts<'_>,
    monospace: bool,
) -> f64 {
    let mut previous = None;
    text.chars()
        .map(|character| {
            let adjustment = previous
                .map(|left| {
                    fonts.fallback_pair_adjustment(left, character, font_size, monospace, None)
                })
                .unwrap_or(0.0);
            previous = Some(character);
            fonts.fallback_character_width(character, font_size, monospace, None) + adjustment
        })
        .sum()
}

fn font_run_width(
    text: &str,
    faces: &[&TextMeasurementFontFace<'_>],
    font_size: f64,
    fonts: &TextMeasurementFonts<'_>,
    monospace: bool,
    fallback_family: Option<&str>,
) -> f64 {
    let mut previous_fallback = None;
    font_runs(text, faces)
        .into_iter()
        .map(|run| match run {
            FontMeasurementRun::Shaped { text, face } => {
                previous_fallback = None;
                shaped_run_width(text, face, font_size).unwrap_or_else(|| {
                    glyph_run_width(text, &[face], font_size, fonts, monospace, fallback_family)
                })
            }
            FontMeasurementRun::Fallback(character) => {
                let adjustment = previous_fallback
                    .map(|left| {
                        fonts.fallback_pair_adjustment(
                            left,
                            character,
                            font_size,
                            monospace,
                            fallback_family,
                        )
                    })
                    .unwrap_or(0.0);
                previous_fallback = Some(character);
                fonts.fallback_character_width(character, font_size, monospace, fallback_family)
                    + adjustment
            }
        })
        .sum()
}
