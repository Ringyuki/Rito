use super::super::{
    measure_text, shape_text, TextMeasurementFontFace, TextMeasurementFonts, TextMeasurementInput,
    TextMeasurementPolicy, TextMeasurementStyle,
};
use super::read_demo_epub_font;
use crate::layout::text_work_trace::{
    capture_text_work_trace, AtomicTextOperationKind, MeasurementCacheOutcome,
    MeasurementCacheSource, TextWorkEvent,
};

#[test]
fn trace_distinguishes_requests_cache_outcomes_and_actual_rustybuzz_runs() {
    let bytes = read_demo_epub_font("OEBPS/Fonts/title.ttf");
    let fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
        "title".to_owned(),
        None,
        None,
        &bytes,
    )]);
    let style = TextMeasurementStyle {
        font_family: Some("title".to_owned()),
        ..TextMeasurementStyle::default()
    };

    let (_, trace) = capture_text_work_trace(|| {
        for _ in 0..2 {
            measure_text(TextMeasurementInput {
                text: "Wi",
                style: style.clone(),
                policy: TextMeasurementPolicy::FontAware,
                fonts: &fonts,
            });
        }
        shape_text(TextMeasurementInput {
            text: "Wi",
            style,
            policy: TextMeasurementPolicy::FontAware,
            fonts: &fonts,
        });
    });

    assert_eq!(trace.text_requests.len(), 3);
    assert_eq!(
        trace
            .text_requests
            .iter()
            .map(|request| (request.kind, request.utf16_units))
            .collect::<Vec<_>>(),
        vec![
            (AtomicTextOperationKind::MeasureRequest, 2),
            (AtomicTextOperationKind::MeasureRequest, 2),
            (AtomicTextOperationKind::ShapeRequest, 2),
        ]
    );
    assert_eq!(
        trace
            .measurement_cache
            .iter()
            .map(|lookup| (lookup.source, lookup.outcome, lookup.utf16_units))
            .collect::<Vec<_>>(),
        vec![
            (
                MeasurementCacheSource::MeasureWidth,
                MeasurementCacheOutcome::Miss,
                2,
            ),
            (
                MeasurementCacheSource::MeasureWidth,
                MeasurementCacheOutcome::Hit,
                2,
            ),
            (
                MeasurementCacheSource::ExactShapeAdvance,
                MeasurementCacheOutcome::Hit,
                2,
            ),
        ]
    );
    assert_eq!(
        trace
            .rustybuzz_shape_runs
            .iter()
            .map(|run| run.utf16_units)
            .collect::<Vec<_>>(),
        vec![2, 2]
    );
    assert_eq!(trace.max_rustybuzz_shape_run_utf16_units(), 2);
    assert!(matches!(
        trace.events.as_slice(),
        [
            TextWorkEvent::TextRequest(_),
            TextWorkEvent::MeasurementCache(_),
            TextWorkEvent::RustybuzzShapeRun(_),
            TextWorkEvent::TextRequest(_),
            TextWorkEvent::MeasurementCache(_),
            TextWorkEvent::TextRequest(_),
            TextWorkEvent::RustybuzzShapeRun(_),
            TextWorkEvent::MeasurementCache(_),
        ]
    ));
    let expected_hash = trace.text_requests[0].text_hash;
    assert!(trace
        .text_requests
        .iter()
        .all(|request| request.text_hash == expected_hash));
    assert!(trace
        .measurement_cache
        .iter()
        .all(|lookup| lookup.text_hash == expected_hash));
    assert!(trace
        .rustybuzz_shape_runs
        .iter()
        .all(|run| run.text_hash == expected_hash));
}

#[test]
fn fallback_shape_request_does_not_claim_rustybuzz_work() {
    let fonts = TextMeasurementFonts::font_aware_empty();
    let (_, trace) = capture_text_work_trace(|| {
        shape_text(TextMeasurementInput {
            text: "A😀B",
            style: TextMeasurementStyle::default(),
            policy: TextMeasurementPolicy::FontAware,
            fonts: &fonts,
        });
    });

    assert_eq!(trace.text_requests.len(), 1);
    assert_eq!(
        trace.text_requests[0].kind,
        AtomicTextOperationKind::ShapeRequest
    );
    assert_eq!(trace.text_requests[0].utf16_units, 4);
    assert!(trace.rustybuzz_shape_runs.is_empty());
}
