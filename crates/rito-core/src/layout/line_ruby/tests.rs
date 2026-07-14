use std::{num::NonZeroUsize, sync::Arc};

use serde_json::{json, Value};

use super::{extract_ruby_annotations, PendingRubyExtraction};
use crate::layout::{
    line::{AtomRunBox, LineRun, RubyRunBox, TextRunBox},
    text_mapping::RunTextMapping,
    text_shape::{ExactRunShape, RunShape, RunShapeCluster, RunShapeDirection, RunShapeProvenance},
    text_work::{TextWorkBudget, TextWorkMeter, TextWorkYield},
};

#[test]
fn small_quanta_match_eager_extraction_without_incremental_output() {
    let runs = vec![
        text_run("A", Some("same"), 1.0, 0.0, 4.0, 16.0, json!({})),
        text_run("B", Some("same"), 5.0, 0.0, 5.0, 16.0, json!({})),
        LineRun::Atom(AtomRunBox {
            x: 10.0,
            y: 0.0,
            width: 2.0,
            height: 3.0,
            image_src: None,
            alt: None,
            href: None,
        }),
        text_run("C", Some("other"), 12.0, 0.0, 5.0, 16.0, json!({})),
        text_run("D", Some(""), 17.0, 0.0, 5.0, 16.0, json!({})),
        text_run("E", None, 22.0, 0.0, 5.0, 16.0, json!({})),
    ];
    let expected = extract_ruby_annotations(runs.clone(), 20.0);
    let total_work = runs.len() * 2;

    for quantum in [1, 2, 3, usize::MAX] {
        let (actual, yields) = resumable_extract(runs.clone(), 20.0, quantum);

        assert_eq!(actual, expected, "quantum={quantum}");
        assert_eq!(yields, (total_work - 1) / quantum, "quantum={quantum}");
    }
}

#[test]
fn plain_runs_reuse_the_input_vector_allocation_after_the_bounded_scan() {
    let runs = vec![
        text_run("A", None, 1.0, 0.0, 4.0, 16.0, json!({})),
        text_run("B", None, 5.0, 0.0, 5.0, 16.0, json!({})),
        text_run("C", None, 10.0, 0.0, 5.0, 16.0, json!({})),
    ];
    let input_pointer = runs.as_ptr();
    let input_capacity = runs.capacity();

    let (output, yields) = resumable_extract(runs, 20.0, 1);

    assert_eq!(yields, 2);
    assert_eq!(output.as_ptr(), input_pointer);
    assert_eq!(output.capacity(), input_capacity);
}

#[test]
fn contiguous_ruby_runs_preserve_base_runs_and_derive_annotation_paint() {
    let paint = json!({
        "color": "#123456",
        "font": {
            "family": "Ruby Base",
            "style": "italic",
            "weight": 650,
        },
        "background": "preserved-only-on-base",
    });
    let first = text_run("A", Some("ruby"), 4.0, 2.0, 8.0, 20.0, paint);
    let second = text_run("B", Some("ruby"), 12.0, 9.0, 10.0, 18.0, json!({}));
    let plain = text_run("C", None, 22.0, 4.0, 6.0, 16.0, json!({}));
    let expected_base = [first.clone(), second.clone(), plain.clone()];

    let output = extract_ruby_annotations(vec![first, second, plain], 30.0);

    assert_eq!(output.len(), 4);
    assert_eq!(output[0], expected_base[0]);
    assert_eq!(output[1], expected_base[1]);
    assert_eq!(output[3], expected_base[2]);
    assert_eq!(
        output[2],
        LineRun::Ruby(RubyRunBox {
            text: "ruby".to_owned(),
            x: 4.0,
            y: 21.0,
            width: 18.0,
            height: 10.0,
            paint: json!({
                "color": "#123456",
                "font": {
                    "family": "Ruby Base",
                    "sizePx": 10,
                    "style": "italic",
                    "weight": 650,
                },
            }),
        })
    );
}

#[test]
fn continuation_uses_the_last_run_end_instead_of_the_furthest_end() {
    let output = extract_ruby_annotations(
        vec![
            text_run("A", Some("ruby"), 10.0, 0.0, 10.0, 16.0, json!({})),
            text_run("B", Some("ruby"), 5.0, 0.0, 2.0, 16.0, json!({})),
        ],
        20.0,
    );

    assert!(matches!(
        &output[2],
        LineRun::Ruby(run) if run.x == 10.0 && run.width == -3.0
    ));
}

#[test]
fn non_text_run_splits_otherwise_matching_ruby_groups() {
    let first = text_run("A", Some("same"), 1.0, 0.0, 4.0, 16.0, json!({}));
    let atom = LineRun::Atom(AtomRunBox {
        x: 5.0,
        y: 0.0,
        width: 3.0,
        height: 3.0,
        image_src: None,
        alt: None,
        href: None,
    });
    let second = text_run("B", Some("same"), 8.0, 0.0, 5.0, 16.0, json!({}));

    let output = extract_ruby_annotations(vec![first, atom.clone(), second], 20.0);

    assert_eq!(output.len(), 5);
    assert!(matches!(&output[0], LineRun::Text(run) if run.text == "A"));
    assert!(matches!(&output[1], LineRun::Ruby(run) if run.x == 1.0 && run.width == 4.0));
    assert_eq!(output[2], atom);
    assert!(matches!(&output[3], LineRun::Text(run) if run.text == "B"));
    assert!(matches!(&output[4], LineRun::Ruby(run) if run.x == 8.0 && run.width == 5.0));
}

#[test]
fn existing_ruby_and_distinct_or_empty_tags_keep_separate_groups() {
    let existing = LineRun::Ruby(RubyRunBox {
        text: "existing".to_owned(),
        x: 5.0,
        y: -4.0,
        width: 3.0,
        height: 4.0,
        paint: json!({ "color": "#abcdef" }),
    });
    let output = extract_ruby_annotations(
        vec![
            text_run("A", Some("same"), 1.0, 0.0, 4.0, 16.0, json!({})),
            existing.clone(),
            text_run("B", Some("same"), 8.0, 0.0, 5.0, 16.0, json!({})),
            text_run("C", Some("other"), 13.0, 0.0, 5.0, 16.0, json!({})),
            text_run("D", Some(""), 18.0, 0.0, 5.0, 16.0, json!({})),
        ],
        20.0,
    );

    assert_eq!(output.len(), 9);
    assert_eq!(output[2], existing);
    let ruby_texts = output
        .iter()
        .filter_map(|run| match run {
            LineRun::Ruby(run) => Some(run.text.as_str()),
            LineRun::Text(_) | LineRun::Atom(_) => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(ruby_texts, ["same", "existing", "same", "other", ""]);
}

#[test]
fn extraction_moves_base_run_allocations_into_output() {
    let first = text_run(
        "first-allocation",
        Some("ruby"),
        0.0,
        0.0,
        12.0,
        16.0,
        json!({ "color": "first-paint-allocation" }),
    );
    let second = text_run(
        "second-allocation",
        Some("ruby"),
        12.0,
        0.0,
        13.0,
        16.0,
        json!({ "color": "second-paint-allocation" }),
    );
    let first_pointers = allocation_pointers(&first);
    let second_pointers = allocation_pointers(&second);

    let output = extract_ruby_annotations(vec![first, second], 20.0);

    assert_eq!(allocation_pointers(&output[0]), first_pointers);
    assert_eq!(allocation_pointers(&output[1]), second_pointers);
    assert!(matches!(&output[2], LineRun::Ruby(run) if run.text == "ruby"));
}

#[test]
fn bounded_extraction_moves_base_run_allocations_into_output() {
    let first = text_run(
        "first-allocation",
        Some("ruby"),
        0.0,
        0.0,
        12.0,
        16.0,
        json!({ "color": "first-paint-allocation" }),
    );
    let second = text_run(
        "second-allocation",
        Some("ruby"),
        12.0,
        0.0,
        13.0,
        16.0,
        json!({ "color": "second-paint-allocation" }),
    );
    let first_pointers = allocation_pointers(&first);
    let second_pointers = allocation_pointers(&second);

    let (output, yields) = resumable_extract(vec![first, second], 20.0, 1);

    assert_eq!(yields, 3);
    assert_eq!(allocation_pointers(&output[0]), first_pointers);
    assert_eq!(allocation_pointers(&output[1]), second_pointers);
    assert!(matches!(&output[2], LineRun::Ruby(run) if run.text == "ruby"));
}

fn resumable_extract(runs: Vec<LineRun>, line_y: f64, quantum: usize) -> (Vec<LineRun>, usize) {
    let mut pending = PendingRubyExtraction::new(runs, line_y);
    let mut yields = 0;
    loop {
        let mut work = meter(quantum);
        match pending.advance(&mut work) {
            Ok(output) => return (output, yields),
            Err(TextWorkYield) => yields += 1,
        }
    }
}

fn meter(max_utf16_units: usize) -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(
        NonZeroUsize::new(max_utf16_units).expect("text limit is non-zero"),
        NonZeroUsize::MAX,
    ))
}

fn text_run(
    text: &str,
    ruby_annotation: Option<&str>,
    x: f64,
    y: f64,
    width: f64,
    font_size: f64,
    paint: Value,
) -> LineRun {
    LineRun::Text(TextRunBox {
        text: text.to_owned(),
        text_mapping: RunTextMapping::synthetic(),
        x,
        y,
        width,
        height: font_size,
        font_size,
        paint,
        line_height_px: None,
        href: Some(format!("#{text}")),
        source_path: Some(vec![1, text.len()]),
        source_text: Some(Arc::from(format!("source-{text}"))),
        source_text_offset: Some(0),
        inline_margin_right: None,
        ruby_annotation: ruby_annotation.map(str::to_owned),
        shape: RunShape::exact(
            RunShapeProvenance::single([7; 8]),
            RunShapeDirection::LeftToRight,
            width,
            vec![RunShapeCluster {
                logical_start: 0,
                logical_end: u32::try_from(text.len()).expect("fixture text length fits u32"),
                advance: width as f32,
            }],
        ),
    })
}

#[derive(Debug, PartialEq, Eq)]
struct AllocationPointers {
    text: *const u8,
    source_text: *const u8,
    source_path: *const usize,
    paint_color: *const u8,
    shape: *const ExactRunShape,
    shape_clusters: *const RunShapeCluster,
}

fn allocation_pointers(run: &LineRun) -> AllocationPointers {
    let LineRun::Text(run) = run else {
        panic!("fixture must be a text run");
    };
    let RunShape::Exact(shape) = &run.shape else {
        panic!("fixture must retain exact shape data");
    };
    AllocationPointers {
        text: run.text.as_ptr(),
        source_text: run
            .source_text
            .as_deref()
            .expect("fixture source text")
            .as_ptr(),
        source_path: run
            .source_path
            .as_deref()
            .expect("fixture source path")
            .as_ptr(),
        paint_color: run.paint["color"]
            .as_str()
            .expect("fixture paint color")
            .as_ptr(),
        shape: &**shape,
        shape_clusters: shape.clusters.as_ptr(),
    }
}
