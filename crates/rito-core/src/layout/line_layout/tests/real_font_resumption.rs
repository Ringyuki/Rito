use std::path::Path;

use serde_json::{json, Map, Value};

use super::{layout_with_text_quanta, text_segment};
use crate::layout::{
    line_layout::layout_greedy_lines_with_fonts,
    text_measure::{TextMeasurementFontFace, TextMeasurementFonts},
    text_work_trace::capture_text_work_trace,
};

#[test]
fn tiny_text_quanta_preserve_real_font_lines_and_ordered_work_trace() {
    let font_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/reader/src/assets/fonts/Tinos-Regular.ttf");
    let bytes = std::fs::read(font_path).expect("read the pinned test font");
    let make_fonts = || {
        TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
            "Tinos".to_owned(),
            None,
            None,
            &bytes,
        )])
    };
    let style = Map::from_iter([
        ("fontSize".to_owned(), json!(14)),
        ("lineHeight".to_owned(), json!(1.4)),
        ("fontFamily".to_owned(), Value::String("Tinos".to_owned())),
    ]);
    let segments = vec![text_segment(
        "office affinity AVATAR cafe\u{301} ffi ".repeat(12),
        style,
    )];
    let expected_fonts = make_fonts();
    let (expected, expected_trace) = capture_text_work_trace(|| {
        layout_greedy_lines_with_fonts(&segments, 150.0, &expected_fonts)
    });
    let actual_fonts = make_fonts();
    let ((actual, quantum_count), actual_trace) =
        capture_text_work_trace(|| layout_with_text_quanta(&segments, 150.0, &actual_fonts, 24, 2));

    assert!(quantum_count > expected.len());
    assert!(!expected_trace.rustybuzz_shape_runs.is_empty());
    assert_eq!(actual, expected);
    assert_eq!(actual_trace.events, expected_trace.events);
}
