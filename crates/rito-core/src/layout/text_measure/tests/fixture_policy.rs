use serde_json::{json, Map, Value};

use super::super::{
    measure_text, measure_text_with_style, parse_font_family_list, TextMeasurementFonts,
    TextMeasurementInput, TextMeasurementPolicy, TextMeasurementStyle,
};
use super::assert_width;

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
