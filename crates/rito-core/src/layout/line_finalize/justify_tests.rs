use std::num::NonZeroUsize;

use serde_json::json;

use super::{JustifyMode, PendingJustifyAnalysis};
use crate::layout::{
    line::{AtomRunBox, LineRun, RubyRunBox, TextRunBox},
    line_align::JustifyPlan,
    text_mapping::RunTextMapping,
    text_shape::fixture_run_shape,
    text_work::{TextWorkBudget, TextWorkMeter, TextWorkYield},
};

#[test]
fn one_unit_quanta_resume_inside_an_astral_cjk_scalar() {
    let runs = vec![text_run("𠀀中")];
    let mut analysis = PendingJustifyAnalysis::new(JustifyMode::InterCharacter, runs.len());
    let mut yields = 0;

    let plan = loop {
        let mut work = meter(1);
        match analysis.advance(&runs, &mut work) {
            Ok(plan) => break plan,
            Err(TextWorkYield) => yields += 1,
        }
        assert!(yields < 10, "astral analysis must not livelock");
    };

    assert_eq!(yields, 3);
    assert_eq!(analysis.per_run_ascii_spaces, [0]);
    assert_eq!(
        plan,
        JustifyPlan::InterCharacter {
            per_run: vec![1],
            boundary_before: vec![false],
            total_gaps: 1,
        }
    );
}

#[test]
fn atom_disables_inter_character_but_does_not_disable_word_gaps() {
    let runs = vec![text_run("中 "), atom_run(), text_run(" 文")];

    assert_eq!(
        analyze(&runs, JustifyMode::InterCharacter),
        JustifyPlan::None
    );
    assert_eq!(
        analyze(&runs, JustifyMode::Auto),
        JustifyPlan::Word {
            per_run: vec![1, 0, 1],
            total_gaps: 2,
        }
    );
}

#[test]
fn ruby_resets_the_boundary_between_cjk_text_runs() {
    let runs = vec![text_run("中"), ruby_run(), text_run("文")];

    assert_eq!(
        analyze(&runs, JustifyMode::InterCharacter),
        JustifyPlan::None
    );

    let adjacent = vec![text_run("中"), text_run("文")];
    assert_eq!(
        analyze(&adjacent, JustifyMode::InterCharacter),
        JustifyPlan::InterCharacter {
            per_run: vec![0, 0],
            boundary_before: vec![false, true],
            total_gaps: 1,
        }
    );
}

#[test]
fn inter_word_without_ascii_spaces_is_a_no_op() {
    assert_eq!(
        analyze(&[text_run("中文")], JustifyMode::InterWord),
        JustifyPlan::None
    );
}

fn analyze(runs: &[LineRun], mode: JustifyMode) -> JustifyPlan {
    let mut analysis = PendingJustifyAnalysis::new(mode, runs.len());
    let mut work = meter(usize::MAX);
    analysis
        .advance(runs, &mut work)
        .expect("unbounded analysis completes")
}

fn text_run(text: &str) -> LineRun {
    LineRun::Text(TextRunBox {
        text: text.to_owned(),
        text_mapping: RunTextMapping::synthetic(),
        x: 0.0,
        y: 0.0,
        width: 10.0,
        height: 10.0,
        font_size: 10.0,
        paint: json!({}),
        line_height_px: None,
        href: None,
        source_path: None,
        source_text: None,
        source_text_offset: None,
        inline_margin_right: None,
        ruby_annotation: None,
        shape: fixture_run_shape(10.0),
    })
}

fn atom_run() -> LineRun {
    LineRun::Atom(AtomRunBox {
        x: 0.0,
        y: 0.0,
        width: 1.0,
        height: 1.0,
        image_src: None,
        alt: None,
        href: None,
    })
}

fn ruby_run() -> LineRun {
    LineRun::Ruby(RubyRunBox {
        text: "注".to_owned(),
        x: 0.0,
        y: 0.0,
        width: 1.0,
        height: 1.0,
        paint: json!({}),
    })
}

fn meter(max_utf16_units: usize) -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(
        NonZeroUsize::new(max_utf16_units).expect("text limit is non-zero"),
        NonZeroUsize::new(1).expect("operation limit is non-zero"),
    ))
}
