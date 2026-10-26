//! Line edges decided one line at a time: a paragraph is built (shaped)
//! at most twice however many of its lines take a line-end trim, a pair
//! trim a break separates or a ruby spread, and the lines are pinned
//! against pinned Chromium (Source Han Serif at 16px).

use super::*;

fn source_han_context() -> ParleyInlineContext {
    let source_han = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
    ))
    .expect("pinned serif reads");
    ParleyInlineContext::new(vec![source_han]).expect("context builds")
}

fn serif_paragraph(text: &str) -> FormattingTree {
    let mut inline = InlineStyleTable::new(1);
    let style = inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
                    .expect("family list"),
                16.0,
                0.0,
            ),
        )
        .expect("style interns");
    FormattingTree::with_styles(
        vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: text.to_owned(),
                    style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        }],
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles {
            layout: LayoutStyleTable::new(0),
            inline,
        },
    )
    .expect("inline tree builds")
}

fn lay(context: &ParleyInlineContext, tree: &FormattingTree, width: f64) -> LayoutOutcome {
    context
        .layout(
            tree,
            FormattingNodeId(0),
            &ConstraintSpace::continuous(width),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds")
}

#[test]
fn every_line_taking_a_line_end_trim_builds_the_paragraph_at_most_twice() {
    let context = source_han_context();
    let segment = format!("{}」", "永".repeat(10));
    let text = segment.repeat(40);
    let outcome = lay(&context, &serif_paragraph(&text), 170.0);
    // Chromium: forty lines, each ten ideographs and the closer at half
    // width (168px).
    let lines = line_texts(&outcome, &text);
    assert_eq!(lines.len(), 40, "{lines:?}");
    assert!(lines.iter().all(|line| *line == segment), "{lines:?}");
    assert!(
        context.counts.builds.get() <= 2,
        "built {} times",
        context.counts.builds.get()
    );
}

#[test]
fn trims_and_separated_pairs_interleaved_lay_out_as_chromium_does_in_two_builds() {
    let context = source_han_context();
    let ten = "永".repeat(10);
    let text = format!(
        "{}{}」{}{}{}」",
        "永".repeat(9),
        format!("」「{}", "永".repeat(8)).repeat(6),
        format!("{ten}」").repeat(3),
        "永".repeat(9),
        format!("」「{}", "永".repeat(8)).repeat(3),
    );
    let outcome = lay(&context, &serif_paragraph(&text), 160.0);
    let lines = line_texts(&outcome, &text);
    let opened = format!("「{}」", "永".repeat(8));
    let mut expected = vec![format!("{}」", "永".repeat(9))];
    expected.extend(std::iter::repeat_n(opened, 6));
    expected.push("永".repeat(9));
    expected.push(format!("永」{}", "永".repeat(8)));
    expected.push(format!("永永」{}", "永".repeat(7)));
    expected.push(format!("永永永」{}", "永".repeat(6)));
    expected.extend(std::iter::repeat_n(
        format!("永永永」「{}", "永".repeat(5)),
        3,
    ));
    expected.push("永永永」".to_owned());
    assert_eq!(lines, expected);
    assert!(
        context.counts.builds.get() <= 2,
        "built {} times",
        context.counts.builds.get()
    );
}

/// What the spacing plan says a byte carries under some edits is what a
/// build under them pushes there last: the line loop reads the plan
/// instead of building the paragraph again.
#[test]
fn the_spacing_plan_answers_as_a_build_pushes() {
    let context = source_han_context();
    let text = "「永」、「永永」。『永』（永）永」永。」』永」「永」永";
    let tree = serif_paragraph(text);
    let base = context
        .shaped_paragraph(
            &tree,
            FormattingNodeId(0),
            &ConstraintSpace::continuous(500.0),
            ParagraphEdits::default(),
            &CancelFlag::new(),
        )
        .expect("base builds");
    let plan = std::rc::Rc::clone(&base.spacing_plan);
    let pairs: Vec<usize> = plan
        .applied_pair_trims(ParagraphEdits::default())
        .map(|trim| trim.left_byte)
        .collect();
    let closers: Vec<usize> = text
        .char_indices()
        .filter(|(_, character)| crate::line_end_trim_eligible(*character))
        .map(|(byte, _)| byte)
        .collect();
    assert!(
        pairs.len() >= 6 && closers.len() >= 6,
        "{pairs:?} {closers:?}"
    );
    let chars: Vec<usize> = text.char_indices().map(|(byte, _)| byte).collect();
    let mut seed = 0x2545_f491_u32;
    let mut next = |bound: usize| {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed as usize % bound.max(1)
    };
    for _ in 0..64 {
        let end_trims: Vec<usize> = closers.iter().copied().filter(|_| next(3) == 0).collect();
        let suppressed: Vec<usize> = pairs.iter().copied().filter(|_| next(3) == 0).collect();
        let spreads: Vec<(std::ops::Range<usize>, f32)> = (0..next(3))
            .map(|_| {
                let start = next(chars.len() - 1);
                let end = (start + 1 + next(3)).min(chars.len() - 1);
                (chars[start]..chars[end], next(7) as f32 - 3.0)
            })
            .collect();
        let edits = ParagraphEdits {
            end_trims: &end_trims,
            suppressed_pair_trims: &suppressed,
            split_spreads: &spreads,
        };
        let built = context
            .build_layout(
                &tree,
                FormattingNodeId(0),
                &BuildSpace::new(Some(500.0), None, None),
                PercentageImageSizing::Intrinsic,
                edits,
                &CancelFlag::new(),
            )
            .expect("edited build");
        for &byte in &chars {
            let pushed = built
                .spacing_edits
                .letter
                .iter()
                .rev()
                .find(|(range, _)| range.contains(&byte))
                .map_or(0.0, |(_, spacing)| *spacing);
            assert_eq!(
                plan.letter_spacing_at(text, byte, edits).to_bits(),
                pushed.to_bits(),
                "byte {byte} under trims {end_trims:?}, suppressed {suppressed:?}, spreads {spreads:?}"
            );
        }
    }
}

/// A paragraph laid out again in a space it was decided in replays what
/// it decided: nothing is built, broken or decided again, and the lines
/// are the same.
#[test]
fn a_paragraph_laid_out_again_at_its_width_decides_nothing_again() {
    let context = source_han_context();
    let segment = format!("{}」", "永".repeat(10));
    let text = segment.repeat(12);
    let tree = serif_paragraph(&text);
    let first = line_texts(&lay(&context, &tree, 170.0), &text);
    let counts = |context: &ParleyInlineContext| {
        (
            context.counts.builds.get(),
            context.counts.breaks.get(),
            context.counts.passes.get(),
        )
    };
    let after_first = counts(&context);
    assert_eq!(after_first.2, 1, "one pass decided the lines");
    let again = line_texts(&lay(&context, &tree, 170.0), &text);
    assert_eq!(again, first);
    assert_eq!(
        counts(&context),
        after_first,
        "the second layout replayed the first"
    );
}
