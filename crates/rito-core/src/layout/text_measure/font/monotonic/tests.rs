use std::{collections::BTreeMap, num::NonZeroUsize, path::Path};

use super::PendingMonotonicPrefixWidthCheck;
use crate::layout::{
    text_measure::{
        TextMeasurementCache, TextMeasurementFontFace, TextMeasurementFonts, TextMeasurementStyle,
    },
    text_work::{TextWorkBudget, TextWorkMeter},
};

#[test]
fn parser_and_face_scan_match_the_eager_oracle_for_every_quantum() {
    let bytes = fixture_font();
    let cases = [
        ("\"Fixture, Serif\", serif", "Fixture, Serif", true),
        ("Wrong, Target", "Target", true),
        ("Display\\'Name", "Display'Name", true),
        ("Fixture\\, Serif", "Fixture, Serif", true),
        ("Trailing\\", "Trailing\\", true),
        ("\u{2003}Unicode Trim\u{2003}", "Unicode Trim", true),
        (" , \u{2003}, ", "Target", false),
        ("éclair", "Éclair", false),
        ("Éclair", "Éclair", true),
    ];

    for (declaration, face_family, matches) in cases {
        let fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
            face_family.to_owned(),
            None,
            None,
            &bytes,
        )]);
        let style = family_style(declaration);
        let eager = fonts.has_monotonic_prefix_widths("AV", &style);
        assert_eq!(eager, !matches, "eager declaration {declaration:?}");
        for quantum in [1, 2, 3, usize::MAX] {
            let (pending, _) = pending_result("AV", style.clone(), &fonts, quantum);
            assert_eq!(pending, eager, "declaration {declaration:?}, q={quantum}");
        }
    }
}

#[test]
fn long_face_name_comparison_and_face_list_scan_genuinely_resume() {
    let bytes = fixture_font();
    let long_family = format!("{}Target", "LongFamily".repeat(40));
    let fonts = TextMeasurementFonts::new(vec![
        TextMeasurementFontFace::new("DifferentLength".to_owned(), None, None, &bytes),
        TextMeasurementFontFace::new(long_family.clone(), None, None, b"not a font"),
        TextMeasurementFontFace::new(long_family.clone(), None, None, &bytes),
    ]);
    let style = family_style(&long_family);

    let (actual, yields) = pending_result("AV", style.clone(), &fonts, 1);

    assert_eq!(actual, fonts.has_monotonic_prefix_widths("AV", &style));
    assert!(!actual);
    assert!(yields > long_family.len() * 2);
}

#[test]
fn non_bmp_family_scalar_and_utf8_face_comparison_resume_at_quantum_one() {
    let bytes = fixture_font();
    let family = "Astral 😀 Family";
    let fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
        family.to_owned(),
        None,
        None,
        &bytes,
    )]);
    let style = family_style(family);

    let (actual, yields) = pending_result("AV", style.clone(), &fonts, 1);

    assert!(!actual);
    assert_eq!(actual, fonts.has_monotonic_prefix_widths("AV", &style));
    assert!(yields > family.len());
}

#[test]
fn invalid_ttf_faces_do_not_count_as_family_matches() {
    let fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
        "Target".to_owned(),
        None,
        None,
        b"not a font",
    )]);
    let style = family_style("Target");

    for quantum in [1, 2, 3, usize::MAX] {
        let (actual, _) = pending_result("AV", style.clone(), &fonts, quantum);
        assert!(actual);
        assert_eq!(actual, fonts.has_monotonic_prefix_widths("AV", &style));
    }
}

#[test]
fn monospace_detection_preserves_quotes_escapes_commas_and_unicode_trim() {
    let fonts = fallback_with_negative_a();
    let declarations = [
        "monospace",
        "MONOSPACE",
        "\u{2003}'monospace'\u{2003}",
        "serif, mono\\space, monospace",
    ];
    for declaration in declarations {
        let style = family_style(declaration);
        assert!(fonts.has_monotonic_prefix_widths("AV", &style));
        for quantum in [1, 2, 3, usize::MAX] {
            let (actual, _) = pending_result("AV", style.clone(), &fonts, quantum);
            assert!(actual, "declaration {declaration:?}, q={quantum}");
        }
    }

    for declaration in ["serif", "mono space", "'monospace x'"] {
        let style = family_style(declaration);
        assert!(!fonts.has_monotonic_prefix_widths("AV", &style));
        let (actual, _) = pending_result("AV", style, &fonts, 1);
        assert!(!actual, "declaration {declaration:?}");
    }
}

#[test]
#[should_panic(expected = "must resume with the same font profile")]
fn setup_rejects_a_changed_font_profile() {
    let construction_fonts = TextMeasurementFonts::empty();
    let mut pending = PendingMonotonicPrefixWidthCheck::new(
        &construction_fonts,
        family_style(&"Long Family ".repeat(20)),
    );
    let mut first = meter(1);
    assert!(pending
        .advance_setup(&construction_fonts, &mut first)
        .is_err());

    let mut second = meter(1);
    let _ = pending.advance_setup(&TextMeasurementFonts::font_aware_empty(), &mut second);
}

#[test]
fn setup_accepts_a_distinct_font_object_with_the_same_profile() {
    let construction_fonts = TextMeasurementFonts::empty();
    let resume_fonts = TextMeasurementFonts::empty();
    let style = family_style(&format!("{}monospace", "Family, ".repeat(20)));
    let expected = construction_fonts.has_monotonic_prefix_widths("AV", &style);
    let mut pending = PendingMonotonicPrefixWidthCheck::new(&construction_fonts, style);
    loop {
        let mut work = meter(1);
        if pending.advance_setup(&resume_fonts, &mut work).is_ok() {
            break;
        }
    }
    for character in "AV".chars() {
        pending.push(&resume_fonts, character);
    }
    assert_eq!(pending.is_monotonic(), expected);
}

fn pending_result(
    text: &str,
    style: TextMeasurementStyle,
    fonts: &TextMeasurementFonts<'_>,
    quantum: usize,
) -> (bool, usize) {
    let mut pending = PendingMonotonicPrefixWidthCheck::new(fonts, style);
    let mut yields: usize = 0;
    loop {
        let mut work = meter(quantum);
        if pending.advance_setup(fonts, &mut work).is_ok() {
            break;
        }
        yields = yields
            .checked_add(1)
            .expect("yield count must fit in usize");
        assert!(yields < 10_000, "font setup must not livelock");
    }
    for character in text.chars() {
        pending.push(fonts, character);
    }
    (pending.is_monotonic(), yields)
}

fn meter(quantum: usize) -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(
        NonZeroUsize::new(quantum).expect("non-zero text quantum"),
        NonZeroUsize::MAX,
    ))
}

fn family_style(font_family: &str) -> TextMeasurementStyle {
    TextMeasurementStyle {
        font_family: Some(font_family.to_owned()),
        ..TextMeasurementStyle::default()
    }
}

fn fixture_font() -> Vec<u8> {
    std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"),
    )
    .expect("fixture font reads")
}

fn fallback_with_negative_a() -> TextMeasurementFonts<'static> {
    TextMeasurementFonts::new_with_cache(
        Vec::new(),
        TextMeasurementCache::default(),
        BTreeMap::from([('A', -1.0)]),
        BTreeMap::new(),
        BTreeMap::new(),
        BTreeMap::new(),
    )
}
