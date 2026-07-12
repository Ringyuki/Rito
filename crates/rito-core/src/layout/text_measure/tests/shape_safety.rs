use super::super::{
    face_supports_character, font_runs, shape_run, shape_text, FontMeasurementRun,
    TextMeasurementFontFace, TextMeasurementFonts, TextMeasurementInput, TextMeasurementPolicy,
    TextMeasurementStyle,
};
use super::{font_metric_sample, read_demo_epub_font, read_epub_font};
use crate::layout::text_shape::{
    RunShape, RunShapeDirection, RunShapeProvenance, RunShapeUnavailableReason,
};

#[test]
fn mixed_bidi_text_is_not_claimed_as_an_authoritative_exact_run() {
    let bytes = read_demo_epub_font("OEBPS/Fonts/title.ttf");
    let fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
        "title".to_owned(),
        None,
        None,
        &bytes,
    )]);

    for text in ["abc العربية 123", "العربية 123"] {
        let shape = shape_text(TextMeasurementInput {
            text,
            style: TextMeasurementStyle {
                font_size: 20.0,
                font_family: Some("title".to_owned()),
                ..TextMeasurementStyle::default()
            },
            policy: TextMeasurementPolicy::FontAware,
            fonts: &fonts,
        });

        assert!(matches!(
            shape,
            RunShape::Unavailable(unavailable)
                if unavailable.reason == RunShapeUnavailableReason::MixedDirection
        ));
    }
}

#[test]
fn rustybuzz_keeps_non_bmp_zwj_cluster_on_utf16_edges() {
    let bytes = read_demo_epub_font("OEBPS/Fonts/title.ttf");
    let face = TextMeasurementFontFace::new("title".to_owned(), None, None, &bytes);
    let shaped = shape_run("👩\u{200d}💻", &face, 20.0).expect("font shaper accepts ZWJ text");

    assert_eq!(shaped.clusters.len(), 1);
    assert_eq!(shaped.clusters[0].logical_start, 0);
    assert_eq!(shaped.clusters[0].logical_end, 5);
}

#[test]
fn rustybuzz_merges_ltr_and_rtl_prepend_sequences_to_egc_boundaries() {
    let bytes = read_demo_epub_font("OEBPS/Fonts/title.ttf");
    let face = TextMeasurementFontFace::new("title".to_owned(), None, None, &bytes);

    for (text, direction, logical_end) in [
        ("𑂽𑂃", RunShapeDirection::LeftToRight, 4),
        ("؀ا", RunShapeDirection::RightToLeft, 2),
    ] {
        let shaped = shape_run(text, &face, 20.0).expect("font shaper accepts prepend text");
        assert_eq!(shaped.direction, direction);
        assert_eq!(shaped.clusters.len(), 1);
        assert_eq!(shaped.clusters[0].logical_start, 0);
        assert_eq!(shaped.clusters[0].logical_end, logical_end);

        let RunShape::Exact(shape) = RunShape::exact(
            RunShapeProvenance::single([1; 8]),
            shaped.direction,
            shaped.advance,
            shaped.clusters,
        ) else {
            unreachable!();
        };
        assert_eq!(
            shape
                .caret_stops()
                .iter()
                .map(|stop| stop.logical_offset)
                .collect::<Vec<_>>(),
            [0, logical_end]
        );
    }
}

#[test]
fn devanagari_zwnj_clusters_do_not_expose_internal_grapheme_carets() {
    let bytes = read_demo_epub_font("OEBPS/Fonts/title.ttf");
    let face = TextMeasurementFontFace::new("title".to_owned(), None, None, &bytes);
    let shaped = shape_run("क्‌ष", &face, 20.0).expect("font shaper accepts Devanagari text");
    assert_eq!(
        shaped
            .clusters
            .iter()
            .map(|cluster| (cluster.logical_start, cluster.logical_end))
            .collect::<Vec<_>>(),
        [(0, 3), (3, 4)]
    );

    let RunShape::Exact(shape) = RunShape::exact(
        RunShapeProvenance::single([1; 8]),
        shaped.direction,
        shaped.advance,
        shaped.clusters,
    ) else {
        unreachable!();
    };
    let offsets = shape
        .caret_stops()
        .iter()
        .map(|stop| stop.logical_offset)
        .collect::<Vec<_>>();
    assert!(!offsets.contains(&1));
    assert!(!offsets.contains(&2));
    assert_eq!(offsets, [0, 3, 4]);
}

#[test]
fn font_fallback_never_splits_a_combining_grapheme() {
    let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let face = TextMeasurementFontFace::new("illus5".to_owned(), None, None, &bytes);
    assert!(face_supports_character(&face, 'e'));
    assert!(!face_supports_character(&face, '\u{301}'));
    let faces = [&face];

    let runs = font_runs("e\u{301}", &faces);

    assert_eq!(runs.len(), 1);
    assert!(matches!(
        runs[0],
        FontMeasurementRun::Fallback(text) if text == "e\u{301}"
    ));
}

#[test]
fn variation_selector_stays_with_its_supported_base_face() {
    let bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let base = font_metric_sample(&bytes, 20.0).0;
    let face = TextMeasurementFontFace::new("illus5".to_owned(), None, None, &bytes);
    let text = format!("{base}\u{fe0f}");
    let faces = [&face];

    let runs = font_runs(&text, &faces);

    assert_eq!(runs.len(), 1);
    assert!(matches!(
        runs[0],
        FontMeasurementRun::Shaped { text: run_text, .. } if run_text == text
    ));
}
