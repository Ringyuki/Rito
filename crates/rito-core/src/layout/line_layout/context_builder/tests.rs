use std::{num::NonZeroUsize, path::Path, sync::Arc};

use serde_json::{json, Map, Value};

use super::super::build_line_context;
use super::PendingLineContextBuilder;
use crate::layout::{
    inline_segment::{AtomSegment, InlineSegment, TextSegment},
    text_mapping::{fixture_logical_text_flow, RunTextMapping, TextFlowSlice, TextSegmentMapping},
    text_measure::{TextMeasurementFontFace, TextMeasurementFonts},
    text_work::{TextWorkBudget, TextWorkMeter},
};

#[test]
fn every_quantum_matches_the_independent_eager_context() {
    let segments = complex_segments();
    let fonts = TextMeasurementFonts::empty();
    let base_style = segments[0].style().clone();
    let expected = build_line_context(&segments, base_style, 321.5, &fonts);

    for quantum in [1, 2, 3, usize::MAX] {
        let (actual, yields) = finish_pending(segments.clone(), 321.5, &fonts, quantum);
        assert_eq!(actual, expected, "text quantum {quantum}");
        assert_shared_sources(&actual, &expected);
        if quantum == 1 {
            assert!(yields > 20, "mixed input must genuinely resume");
        }
    }
}

fn assert_shared_sources(actual: &super::super::LineContext, expected: &super::super::LineContext) {
    let RunTextMapping::Exact(actual_mapping) = &actual.ranges[0].text_mapping else {
        panic!("pending range must retain exact mapping");
    };
    let RunTextMapping::Exact(expected_mapping) = &expected.ranges[0].text_mapping else {
        panic!("eager range must retain exact mapping");
    };
    assert!(Arc::ptr_eq(&actual_mapping.flow, &expected_mapping.flow));
    assert!(Arc::ptr_eq(
        actual.ranges[0].source_text.as_ref().expect("source text"),
        expected.ranges[0]
            .source_text
            .as_ref()
            .expect("source text"),
    ));
}

#[test]
fn long_bmp_text_preserves_the_bounded_prefix_decision() {
    let style = base_style();
    let segments = vec![text_segment("AV中文".repeat(80), style)];
    let fonts = TextMeasurementFonts::empty();
    let expected = build_line_context(&segments, segments[0].style().clone(), 40.0, &fonts);

    let (actual, yields) = finish_pending(segments, 40.0, &fonts, 1);

    assert!(expected.monotonic_prefix_widths);
    assert!(actual.monotonic_prefix_widths);
    assert!(yields > 500);
    assert_eq!(actual, expected);
}

#[test]
fn bounded_prefix_threshold_matches_at_256_and_257_utf16_units() {
    let fonts = TextMeasurementFonts::empty();
    for (length, bounded) in [(256, false), (257, true)] {
        let segments = vec![text_segment("a".repeat(length), base_style())];
        let eager = build_line_context(&segments, segments[0].style().clone(), 40.0, &fonts);
        let (pending, _) = finish_pending(segments, 40.0, &fonts, 3);
        assert_eq!(eager.monotonic_prefix_widths, bounded, "length {length}");
        assert_eq!(pending, eager, "length {length}");
    }
}

#[test]
fn font_setup_is_skipped_at_256_and_resumed_at_257_utf16_units() {
    let fonts = TextMeasurementFonts::empty();
    let plain_style = base_style();
    let mut family_style = plain_style.clone();
    family_style.insert(
        "fontFamily".to_owned(),
        json!(format!("{}monospace", "Very Long Family, ".repeat(20))),
    );

    let (_, plain_256) = finish_pending(
        vec![text_segment("a".repeat(256), plain_style.clone())],
        40.0,
        &fonts,
        1,
    );
    let (_, family_256) = finish_pending(
        vec![text_segment("a".repeat(256), family_style.clone())],
        40.0,
        &fonts,
        1,
    );
    let (_, plain_257) = finish_pending(
        vec![text_segment("a".repeat(257), plain_style)],
        40.0,
        &fonts,
        1,
    );
    let (_, family_257) = finish_pending(
        vec![text_segment("a".repeat(257), family_style)],
        40.0,
        &fonts,
        1,
    );

    assert_eq!(family_256, plain_256);
    assert!(family_257 > plain_257 + 200);
}

#[test]
fn an_empty_text_segment_still_participates_in_monotonic_checks() {
    let mut invalid_style = base_style();
    invalid_style.insert("fontSize".to_owned(), json!(-1));
    let segments = vec![
        text_segment("a".repeat(300), base_style()),
        text_segment(String::new(), invalid_style),
    ];
    let fonts = TextMeasurementFonts::empty();
    let expected = build_line_context(&segments, segments[0].style().clone(), 40.0, &fonts);

    let (actual, _) = finish_pending(segments, 40.0, &fonts, 2);

    assert!(!expected.monotonic_prefix_widths);
    assert_eq!(actual, expected);
}

#[test]
fn an_empty_text_segment_still_runs_resumable_font_setup() {
    let bytes = std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"),
    )
    .expect("fixture font reads");
    let fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
        "Empty Face".to_owned(),
        None,
        None,
        &bytes,
    )]);
    let mut matching_style = base_style();
    matching_style.insert("fontFamily".to_owned(), json!("Empty Face"));
    let segments = vec![
        text_segment("a".repeat(300), base_style()),
        text_segment(String::new(), matching_style),
    ];
    let expected = build_line_context(&segments, segments[0].style().clone(), 40.0, &fonts);

    let (actual, yields) = finish_pending(segments, 40.0, &fonts, 1);

    assert!(!expected.monotonic_prefix_widths);
    assert_eq!(actual, expected);
    assert!(yields > 600);
}

#[test]
fn initial_completion_matches_trim_newline_and_atom_semantics() {
    let fonts = TextMeasurementFonts::empty();
    let cases = [
        ("", true),
        (" \t\u{00a0}", true),
        ("\n", false),
        ("\u{200b}", false),
        ("\u{fffc}", false),
    ];
    for (text, complete) in cases {
        let segments = vec![text_segment(text.to_owned(), base_style())];
        let eager = build_line_context(&segments, segments[0].style().clone(), 80.0, &fonts);
        let (pending, _) = finish_pending(segments, 80.0, &fonts, 1);
        assert_eq!(eager.initially_complete, complete, "eager {text:?}");
        assert_eq!(pending, eager, "pending {text:?}");
    }

    let atom = vec![atom_segment(base_style())];
    let eager = build_line_context(&atom, atom[0].style().clone(), 80.0, &fonts);
    let (pending, _) = finish_pending(atom, 80.0, &fonts, 1);
    assert!(!eager.initially_complete);
    assert_eq!(pending, eager);
}

#[test]
fn empty_input_preserves_the_eager_empty_session_branch() {
    let fonts = TextMeasurementFonts::empty();

    assert!(PendingLineContextBuilder::new(Vec::new(), 80.0, &fonts).is_none());
}

#[test]
#[should_panic(expected = "must resume with the same font profile")]
fn pending_builder_rejects_a_changed_font_profile() {
    let construction_fonts = TextMeasurementFonts::empty();
    let mut builder = PendingLineContextBuilder::new(
        vec![text_segment("abc".to_owned(), base_style())],
        80.0,
        &construction_fonts,
    )
    .expect("non-empty input");
    let mut first = meter(1);
    assert!(builder.advance(&mut first, &construction_fonts).is_err());

    let mut second = meter(1);
    let _ = builder.advance(&mut second, &TextMeasurementFonts::font_aware_empty());
}

#[test]
fn pending_builder_accepts_a_distinct_font_object_with_the_same_profile() {
    let construction_fonts = TextMeasurementFonts::empty();
    let resume_fonts = TextMeasurementFonts::empty();
    let segments = vec![text_segment("abc😀def".repeat(20), base_style())];
    let expected = build_line_context(
        &segments,
        segments[0].style().clone(),
        80.0,
        &construction_fonts,
    );
    let mut builder =
        PendingLineContextBuilder::new(segments, 80.0, &construction_fonts).expect("input");
    let mut yields: usize = 0;
    loop {
        let mut work = meter(1);
        match builder.advance(&mut work, &resume_fonts) {
            Ok(actual) => {
                assert_eq!(actual, expected);
                break;
            }
            Err(_) => {
                yields = yields
                    .checked_add(1)
                    .expect("yield count must fit in usize");
            }
        }
    }
    assert!(yields > 100);
}

fn finish_pending(
    segments: Vec<InlineSegment>,
    width: f64,
    fonts: &TextMeasurementFonts<'_>,
    quantum: usize,
) -> (super::super::LineContext, usize) {
    let mut builder = PendingLineContextBuilder::new(segments, width, fonts).expect("input");
    let mut yields: usize = 0;
    loop {
        let mut work = meter(quantum);
        match builder.advance(&mut work, fonts) {
            Ok(context) => return (context, yields),
            Err(_) => {
                yields = yields
                    .checked_add(1)
                    .expect("yield count must fit in usize");
                assert!(yields < 10_000, "context builder must not livelock");
            }
        }
    }
}

fn meter(quantum: usize) -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(
        NonZeroUsize::new(quantum).expect("non-zero text quantum"),
        NonZeroUsize::MAX,
    ))
}

fn complex_segments() -> Vec<InlineSegment> {
    let exact_text = "A😀B";
    let flow = fixture_logical_text_flow(exact_text, vec![(0, 4, Some((vec![7, 8], 11)))]);
    let mapping = TextSegmentMapping::Resolved(RunTextMapping::Exact(TextFlowSlice {
        flow,
        span_index: 0,
        logical_start: 0,
        logical_end: 4,
    }));
    let mut first = text_segment(exact_text.to_owned(), base_style());
    if let InlineSegment::Text(text) = &mut first {
        text.mapping = mapping;
        text.href = Some("#note".to_owned());
        text.source_path = Some(vec![1, 2, 3]);
        text.source_text = Some(Arc::<str>::from("source 😀 text"));
        text.source_text_offset = Some(9);
        text.ruby_annotation = Some("注".to_owned());
        text.inline_margin_left = Some(2.0);
        text.inline_margin_right = Some(3.0);
        text.border_start = true;
        text.border_end = true;
    }
    vec![
        first,
        text_segment(String::new(), negative_style()),
        atom_segment(base_style()),
        text_segment(
            format!("literal \u{fffc} and {}", "long text ".repeat(35)),
            base_style(),
        ),
    ]
}

fn text_segment(text: String, style: Map<String, Value>) -> InlineSegment {
    InlineSegment::Text(TextSegment {
        text,
        mapping: TextSegmentMapping::synthetic(),
        style,
        href: None,
        source_path: None,
        source_text: None,
        source_text_offset: None,
        ruby_annotation: None,
        inline_margin_left: None,
        inline_margin_right: None,
        border_start: false,
        border_end: false,
    })
}

fn atom_segment(style: Map<String, Value>) -> InlineSegment {
    InlineSegment::Atom(AtomSegment {
        width: 17.25,
        height: 9.5,
        style,
        image_src: Some("image.png".to_owned()),
        alt: Some("cover".to_owned()),
        href: Some("chapter.xhtml".to_owned()),
        source_path: Some(vec![4, 5]),
    })
}

fn base_style() -> Map<String, Value> {
    Map::from_iter([
        ("fontSize".to_owned(), json!(14)),
        ("lineHeight".to_owned(), json!(1.4)),
        ("whiteSpace".to_owned(), json!("pre-wrap")),
        ("lineBreak".to_owned(), json!("strict")),
        ("wordBreak".to_owned(), json!("keep-all")),
        ("language".to_owned(), json!("ZH-CN")),
    ])
}

fn negative_style() -> Map<String, Value> {
    let mut style = base_style();
    style.insert("fontSize".to_owned(), json!(-1));
    style
}
