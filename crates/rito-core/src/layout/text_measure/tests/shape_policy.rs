use serde_json::{json, Map, Value};

use super::super::{
    measure_text, shape_run, shape_text, TextMeasurementFontFace, TextMeasurementFonts,
    TextMeasurementInput, TextMeasurementPolicy, TextMeasurementStyle,
};
use super::{assert_width, read_demo_epub_font};
use crate::layout::{
    inline_segment::{InlineSegment, TextSegment},
    line::LineRun,
    line_align::apply_line_align,
    line_layout::layout_greedy_lines_with_fonts,
    line_optimal::layout_optimal_lines_with_fonts,
    text_shape::{RunShape, RunShapeDirection, RunShapeProvenance, RunShapeUnavailableReason},
};

#[test]
fn retained_shape_uses_real_variable_width_cluster_boundaries() {
    let bytes = read_demo_epub_font("OEBPS/Fonts/title.ttf");
    let face = TextMeasurementFontFace::new("title".to_owned(), None, None, &bytes);
    let fonts = TextMeasurementFonts::new(vec![face]);
    let style = TextMeasurementStyle {
        font_size: 20.0,
        font_family: Some("title".to_owned()),
        ..TextMeasurementStyle::default()
    };
    let shape = shape_text(TextMeasurementInput {
        text: "Wi",
        style: style.clone(),
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    });
    let measured = measure_text(TextMeasurementInput {
        text: "Wi",
        style,
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    });
    let RunShape::Exact(shape) = shape else {
        panic!("font-backed text retains exact shaping");
    };
    let stops = shape.caret_stops();

    assert_eq!(shape.direction, RunShapeDirection::LeftToRight);
    assert_eq!(shape.clusters.len(), 2);
    assert_eq!(stops.len(), 3);
    assert_eq!(stops[1].logical_offset, 1);
    assert_ne!(stops[1].visual_offset, (shape.advance / 2.0) as f32);
    assert_width(shape.advance, measured.width);
    assert!(matches!(
        shape.provenance,
        RunShapeProvenance::Single { .. }
    ));
}

#[test]
fn retained_shape_applies_word_and_letter_spacing_at_cluster_edges() {
    let title = read_demo_epub_font("OEBPS/Fonts/title.ttf");
    let title_fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
        "title".to_owned(),
        None,
        None,
        &title,
    )]);
    let RunShape::Exact(letter_shape) = shape_text(TextMeasurementInput {
        text: "Wi",
        style: TextMeasurementStyle {
            font_size: 20.0,
            letter_spacing: 3.0,
            font_family: Some("title".to_owned()),
            ..TextMeasurementStyle::default()
        },
        policy: TextMeasurementPolicy::FontAware,
        fonts: &title_fonts,
    }) else {
        panic!("simple letter spacing stays exact");
    };

    let illus = read_demo_epub_font("OEBPS/Fonts/illus1.ttf");
    let illus_fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
        "illus1".to_owned(),
        None,
        None,
        &illus,
    )]);
    let RunShape::Exact(word_shape) = shape_text(TextMeasurementInput {
        text: "A V",
        style: TextMeasurementStyle {
            font_size: 20.0,
            word_spacing: 4.0,
            font_family: Some("illus1".to_owned()),
            ..TextMeasurementStyle::default()
        },
        policy: TextMeasurementPolicy::FontAware,
        fonts: &illus_fonts,
    }) else {
        panic!("font-backed spaces keep exact word spacing");
    };

    assert_eq!(letter_shape.clusters.len(), 2);
    assert_eq!(word_shape.clusters.len(), 3);
    assert!(letter_shape.caret_stops()[1].visual_offset > 0.0);
    assert!(word_shape.caret_stops()[2].visual_offset > 0.0);
}

#[test]
fn rustybuzz_cluster_extraction_keeps_combining_text_atomic() {
    let bytes = read_demo_epub_font("OEBPS/Fonts/title.ttf");
    let face = TextMeasurementFontFace::new("title".to_owned(), None, None, &bytes);
    let shaped = shape_run("e\u{301}", &face, 20.0).expect("font shapes composed text");

    assert_eq!(shaped.clusters.len(), 1);
    assert_eq!(shaped.clusters[0].logical_start, 0);
    assert_eq!(shaped.clusters[0].logical_end, 2);
}

#[test]
fn rustybuzz_cluster_extraction_preserves_right_to_left_edges() {
    let bytes = read_demo_epub_font("OEBPS/Fonts/title.ttf");
    let face = TextMeasurementFontFace::new("title".to_owned(), None, None, &bytes);
    let shaped = shape_run("العربية", &face, 20.0).expect("font shaper accepts RTL text");

    assert_eq!(shaped.direction, RunShapeDirection::RightToLeft);
    assert_eq!(
        shaped.clusters.first().map(|cluster| cluster.logical_start),
        Some(6)
    );
    assert_eq!(
        shaped.clusters.last().map(|cluster| cluster.logical_start),
        Some(0)
    );
}

#[test]
fn retained_shape_never_promotes_fixture_or_host_fallback_to_exact() {
    let fixture = shape_text(TextMeasurementInput {
        text: "fallback",
        style: TextMeasurementStyle::default(),
        policy: TextMeasurementPolicy::FixtureCompatible,
        fonts: &TextMeasurementFonts::empty(),
    });
    let host = shape_text(TextMeasurementInput {
        text: "fallback",
        style: TextMeasurementStyle::default(),
        policy: TextMeasurementPolicy::FontAware,
        fonts: &TextMeasurementFonts::font_aware_empty(),
    });

    assert!(matches!(
        fixture,
        RunShape::Unavailable(unavailable)
            if unavailable.reason == RunShapeUnavailableReason::FixtureCompatibleMeasurement
    ));
    assert!(matches!(
        host,
        RunShape::Unavailable(unavailable)
            if unavailable.reason == RunShapeUnavailableReason::HostMetricsFallback
    ));
}

#[test]
fn greedy_and_optimal_final_runs_retain_the_same_exact_shape_contract() {
    let bytes = read_demo_epub_font("OEBPS/Fonts/title.ttf");
    let fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
        "title".to_owned(),
        None,
        None,
        &bytes,
    )]);
    let segment = text_segment("Wi", "title");

    let greedy = layout_greedy_lines_with_fonts(std::slice::from_ref(&segment), 1_000.0, &fonts);
    let optimal = layout_optimal_lines_with_fonts(std::slice::from_ref(&segment), 1_000.0, &fonts);

    for run in [first_text_run(&greedy), first_text_run(&optimal)] {
        let RunShape::Exact(shape) = &run.shape else {
            panic!("final font-backed run keeps exact shape");
        };
        assert_width(shape.advance, run.width);
        assert_eq!(shape.caret_stops().len(), 3);
    }
}

#[test]
fn discretionary_hyphens_do_not_invent_source_caret_clusters() {
    let bytes = read_demo_epub_font("OEBPS/Fonts/title.ttf");
    let fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
        "title".to_owned(),
        None,
        None,
        &bytes,
    )]);
    let style = TextMeasurementStyle {
        font_size: 20.0,
        font_family: Some("title".to_owned()),
        ..TextMeasurementStyle::default()
    };
    let max_width = measure_text(TextMeasurementInput {
        text: "Nokyoushit-",
        style,
        policy: TextMeasurementPolicy::FontAware,
        fonts: &fonts,
    })
    .width;
    let segment = text_segment("Nokyoushitsue", "title");
    let greedy = layout_greedy_lines_with_fonts(std::slice::from_ref(&segment), max_width, &fonts);
    let optimal =
        layout_optimal_lines_with_fonts(std::slice::from_ref(&segment), max_width, &fonts);

    for run in [first_text_run(&greedy), first_text_run(&optimal)] {
        assert!(run.text.ends_with('-'));
        assert!(matches!(
            run.shape,
            RunShape::Unavailable(unavailable)
                if unavailable.reason == RunShapeUnavailableReason::SyntheticLayoutText
                    && unavailable.advance == run.width
        ));
    }
}

#[test]
fn justification_updates_retained_cluster_advances_with_run_width() {
    let bytes = read_demo_epub_font("OEBPS/Fonts/illus1.ttf");
    let fonts = TextMeasurementFonts::new(vec![TextMeasurementFontFace::new(
        "illus1".to_owned(),
        None,
        None,
        &bytes,
    )]);
    let mut lines =
        layout_greedy_lines_with_fonts(&[text_segment("A V", "illus1")], 1_000.0, &fonts);
    let line = lines.remove(0);
    let original_width = line
        .runs
        .iter()
        .map(LineRun::advance_right)
        .fold(0.0, f64::max);
    let justified = apply_line_align(
        line.runs,
        original_width,
        0.0,
        line.height,
        original_width + 12.0,
        &Map::from_iter([
            ("textAlign".to_owned(), Value::String("justify".to_owned())),
            (
                "textJustify".to_owned(),
                Value::String("inter-word".to_owned()),
            ),
        ]),
        false,
    );
    let LineRun::Text(run) = &justified.runs[0] else {
        panic!("expected text run");
    };
    let RunShape::Exact(shape) = &run.shape else {
        panic!("cluster-safe word justification remains exact");
    };

    assert_width(run.width, original_width + 12.0);
    assert_width(shape.advance, run.width);
    assert_eq!(
        shape.caret_stops().last().map(|stop| stop.visual_offset),
        Some(run.width as f32)
    );
}

fn text_segment(text: &str, family: &str) -> InlineSegment {
    InlineSegment::Text(TextSegment {
        text: text.to_owned(),
        style: Map::from_iter([
            ("fontSize".to_owned(), json!(20)),
            ("lineHeight".to_owned(), json!(1.2)),
            ("fontFamily".to_owned(), Value::String(family.to_owned())),
        ]),
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

fn first_text_run(lines: &[crate::layout::line::LineBox]) -> &crate::layout::line::TextRunBox {
    lines
        .iter()
        .flat_map(|line| &line.runs)
        .find_map(|run| match run {
            LineRun::Text(run) => Some(run),
            LineRun::Atom(_) | LineRun::Ruby(_) => None,
        })
        .expect("line has text")
}
