use super::super::{
    reset_shape_run_call_count, shape_run_call_count, shape_text, TextMeasurementFontFace,
    TextMeasurementFonts, TextMeasurementInput, TextMeasurementPolicy, TextMeasurementStyle,
};
use super::{character_supported_only_by, font_metric_sample, read_epub_font};
use crate::layout::text_shape::{RunShape, RunShapeProvenance};

#[test]
fn exact_shape_maps_each_logical_font_run_to_its_resolved_face() {
    let preferred_bytes = read_epub_font("OEBPS/Fonts/illus1.ttf");
    let fallback_bytes = read_epub_font("OEBPS/Fonts/illus5.ttf");
    let preferred_character = font_metric_sample(&preferred_bytes, 20.0).0;
    let fallback_character = character_supported_only_by(&preferred_bytes, &fallback_bytes);
    let text = format!("{preferred_character}{fallback_character}{preferred_character}");
    let first_end = preferred_character.len_utf16() as u32;
    let second_end = first_end + fallback_character.len_utf16() as u32;
    let logical_end = second_end + preferred_character.len_utf16() as u32;
    let fonts = TextMeasurementFonts::new(vec![
        TextMeasurementFontFace::new("Preferred".to_owned(), None, None, &preferred_bytes),
        TextMeasurementFontFace::new("Fallback".to_owned(), None, None, &fallback_bytes),
    ]);

    let shape = shape_text(TextMeasurementInput {
        text: &text,
        style: TextMeasurementStyle {
            font_size: 20.0,
            font_family: Some("Preferred, Fallback".to_owned()),
            ..TextMeasurementStyle::default()
        },
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    });
    let RunShape::Exact(shape) = shape else {
        panic!("two resolved real faces remain authoritative");
    };

    let RunShapeProvenance::Mixed(provenance) = shape.provenance else {
        panic!("multiple resolved faces retain sparse logical spans");
    };
    assert_eq!(provenance.font_fingerprints.len(), 2);
    assert_eq!(provenance.face_spans.len(), 3);
    assert_eq!(
        provenance
            .face_spans
            .iter()
            .map(|span| (span.logical_start, span.logical_end, span.font_index))
            .collect::<Vec<_>>(),
        [
            (0, first_end, 0),
            (first_end, second_end, 1),
            (second_end, logical_end, 0),
        ]
    );
    assert_eq!(
        provenance.face_spans.last().map(|span| span.logical_end),
        Some(logical_end)
    );
}

#[test]
fn uncached_exact_shape_runs_rustybuzz_once() {
    let bytes = super::read_demo_epub_font("OEBPS/Fonts/title.ttf");
    let fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
        "title".to_owned(),
        None,
        None,
        &bytes,
    )]);
    reset_shape_run_call_count();

    let shape = shape_text(TextMeasurementInput {
        text: "Wi",
        style: TextMeasurementStyle {
            font_size: 20.0,
            font_family: Some("title".to_owned()),
            ..TextMeasurementStyle::default()
        },
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    });

    assert!(matches!(shape, RunShape::Exact(_)));
    assert_eq!(shape_run_call_count(), 1);
}

#[test]
fn precomputed_document_fingerprint_is_reused_by_font_faces() {
    let bytes = super::read_demo_epub_font("OEBPS/Fonts/title.ttf");
    let fingerprint = [7_u8; 8];

    let face = TextMeasurementFontFace::new_with_fingerprint(
        "title".to_owned(),
        None,
        None,
        &bytes,
        fingerprint,
    );

    assert_eq!(face.fingerprint(), fingerprint);
}
