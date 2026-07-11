use super::super::{
    face_supports_character, fixture_character_width, measure_text, shaped_run_width,
    TextMeasurementFontFace, TextMeasurementFonts, TextMeasurementInput, TextMeasurementPolicy,
    TextMeasurementStyle,
};
use super::{assert_width, font_metric_sample, read_epub_font, supported_character_after};

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
