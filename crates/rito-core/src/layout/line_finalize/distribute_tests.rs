use std::num::NonZeroUsize;

use serde_json::{json, Value};

use super::PendingJustifyDistribution;
use crate::layout::{
    line::{AtomRunBox, LineRun, TextRunBox},
    line_align::{apply_justify_plan, JustifyPlan},
    text_mapping::RunTextMapping,
    text_shape::{
        fixture_run_shape, RunShape, RunShapeCluster, RunShapeDirection, RunShapeProvenance,
    },
    text_work::{TextWorkBudget, TextWorkMeter, TextWorkYield},
};

#[test]
fn word_distribution_updates_zero_space_text_and_matches_eager_oracle() {
    let runs = vec![
        exact_text_run("ab", 0.0, RunShapeDirection::LeftToRight),
        exact_text_run(" c", 10.0, RunShapeDirection::RightToLeft),
        exact_text_run("", 20.0, RunShapeDirection::LeftToRight),
    ];
    let plan = JustifyPlan::Word {
        per_run: vec![0, 1, 0],
        total_gaps: 1,
    };
    let expected = apply_justify_plan(runs.clone(), 7.25, plan.clone());
    let (actual, yields) = distribute_bounded(runs, 7.25, plan);

    assert!(yields > 8);
    assert_eq!(actual, expected);
    let LineRun::Text(first) = &actual[0] else {
        unreachable!()
    };
    assert_eq!(first.paint["wordSpacingPx"], json!(7.25));
    assert_eq!(first.shape.advance().to_bits(), first.width.to_bits());
    let LineRun::Text(empty) = &actual[2] else {
        unreachable!()
    };
    assert_eq!(empty.paint["wordSpacingPx"], json!(7.25));
    assert_eq!(empty.shape.advance().to_bits(), empty.width.to_bits());
}

#[test]
fn inter_character_boundary_precedes_run_shift_and_shape_spacing() {
    let runs = vec![
        exact_text_run("中A", 0.0, RunShapeDirection::LeftToRight),
        exact_text_run("文", 10.0, RunShapeDirection::LeftToRight),
    ];
    let plan = JustifyPlan::InterCharacter {
        per_run: vec![1, 0],
        boundary_before: vec![false, true],
        total_gaps: 2,
    };
    let expected = apply_justify_plan(runs.clone(), 12.0, plan.clone());
    let (actual, _) = distribute_bounded(runs, 12.0, plan);

    assert_eq!(actual, expected);
    let LineRun::Text(first) = &actual[0] else {
        unreachable!()
    };
    let LineRun::Text(second) = &actual[1] else {
        unreachable!()
    };
    assert_eq!((first.x, first.width), (0.0, 16.0));
    assert_eq!(second.x, 22.0);
    assert!(second.paint.get("letterSpacingPx").is_none());
}

#[test]
fn zero_gap_plans_fail_closed() {
    assert!(PendingJustifyDistribution::new(
        JustifyPlan::Word {
            per_run: vec![0],
            total_gaps: 0,
        },
        10.0,
    )
    .is_none());
    assert!(PendingJustifyDistribution::new(
        JustifyPlan::InterCharacter {
            per_run: vec![0],
            boundary_before: vec![false],
            total_gaps: 0,
        },
        10.0,
    )
    .is_none());
}

#[test]
fn rejects_non_finite_or_non_positive_extra_before_distribution() {
    let plan = JustifyPlan::Word {
        per_run: vec![1],
        total_gaps: 1,
    };
    for extra in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 0.0, -1.0] {
        assert!(PendingJustifyDistribution::new(plan.clone(), extra).is_none());
    }
}

#[test]
fn atoms_follow_accumulated_word_and_inter_character_offsets() {
    for (plan, runs) in [
        (
            JustifyPlan::Word {
                per_run: vec![1, 0, 0],
                total_gaps: 1,
            },
            vec![text_run("a ", 0.0), atom_run(10.0), text_run("b", 11.0)],
        ),
        (
            JustifyPlan::InterCharacter {
                per_run: vec![1, 0, 0],
                boundary_before: vec![false, false, true],
                total_gaps: 2,
            },
            vec![text_run("中A", 0.0), atom_run(10.0), text_run("文", 11.0)],
        ),
    ] {
        let expected = apply_justify_plan(runs.clone(), 8.0, plan.clone());
        let (actual, _) = distribute_bounded(runs, 8.0, plan);

        assert_eq!(actual, expected);
    }
}

fn distribute_bounded(
    mut runs: Vec<LineRun>,
    extra: f64,
    plan: JustifyPlan,
) -> (Vec<LineRun>, usize) {
    let mut pending = PendingJustifyDistribution::new(plan, extra).expect("non-empty plan");
    let mut yields = 0;
    loop {
        let mut work = meter(1);
        match pending.advance(&mut runs, &mut work) {
            Ok(()) => return (runs, yields),
            Err(TextWorkYield) => yields += 1,
        }
        assert!(yields < 100, "distribution must not livelock");
    }
}

fn exact_text_run(text: &str, x: f64, direction: RunShapeDirection) -> LineRun {
    let mut logical_offset = 0_u32;
    let logical_clusters = text
        .chars()
        .map(|character| {
            let start = logical_offset;
            logical_offset += character.len_utf16() as u32;
            RunShapeCluster {
                logical_start: start,
                logical_end: logical_offset,
                advance: 5.0,
            }
        })
        .collect::<Vec<_>>();
    let clusters = match direction {
        RunShapeDirection::LeftToRight => logical_clusters,
        RunShapeDirection::RightToLeft => logical_clusters.into_iter().rev().collect(),
    };
    text_run_with_shape(
        text,
        x,
        RunShape::exact(
            RunShapeProvenance::single([3; 8]),
            direction,
            10.0,
            clusters,
        ),
    )
}

fn text_run(text: &str, x: f64) -> LineRun {
    text_run_with_shape(text, x, fixture_run_shape(10.0))
}

fn text_run_with_shape(text: &str, x: f64, shape: RunShape) -> LineRun {
    LineRun::Text(TextRunBox {
        text: text.to_owned(),
        text_mapping: RunTextMapping::synthetic(),
        x,
        y: 0.0,
        width: 10.0,
        height: 10.0,
        font_size: 10.0,
        paint: Value::Object(Default::default()),
        line_height_px: None,
        href: None,
        source_path: None,
        source_text: None,
        source_text_offset: None,
        inline_margin_right: None,
        ruby_annotation: None,
        shape,
    })
}

fn atom_run(x: f64) -> LineRun {
    LineRun::Atom(AtomRunBox {
        x,
        y: 0.0,
        width: 1.0,
        height: 1.0,
        image_src: None,
        alt: None,
        href: None,
    })
}

fn meter(max_utf16_units: usize) -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(
        NonZeroUsize::new(max_utf16_units).expect("text limit is non-zero"),
        NonZeroUsize::new(1).expect("operation limit is non-zero"),
    ))
}
