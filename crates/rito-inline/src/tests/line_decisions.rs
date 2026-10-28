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
            unhung_starts: &[],
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

/// A spread ruby's carrier is priced by the plan, with its start overhang
/// or without (a ruby opening a line drops it), exactly as a build under
/// the same unhung rubies pushes it.
#[test]
fn the_spacing_plan_prices_an_unhung_ruby_as_a_build_pushes() {
    let context = source_han_context();
    let mut inline = InlineStyleTable::new(1);
    let style = inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
                    .expect("family list"),
                18.0,
                0.0,
            ),
        )
        .expect("style interns");
    let text_item = |text: &str, annotation: Option<&str>| InlineItem::Text {
        text: text.to_owned(),
        style,
        baseline_shift_px: 0.0,
        ruby_annotation: annotation.map(|annotation| rito_fragment::RubyAnnotation {
            text: annotation.to_owned(),
            size_ratio: 0.8,
            align: rito_style_contract::RubyAlign::SpaceAround,
        }),
    };
    let items = vec![
        text_item("永永", None),
        text_item("碎片", Some("Fragment")),
        text_item("永", None),
        text_item("剑", Some("Historia")),
        text_item("永永", None),
        text_item("人族", Some("Emnetwiht")),
        text_item("永", None),
    ];
    let text: String = items
        .iter()
        .map(|item| match item {
            InlineItem::Text { text, .. } => text.as_str(),
            _ => "",
        })
        .collect();
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow { items },
            children: Vec::new(),
        }],
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles {
            layout: LayoutStyleTable::new(0),
            inline,
        },
    )
    .expect("inline tree builds");
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
    let rubies = [1_usize, 3, 5];
    assert!(
        rubies.iter().all(|item| plan
            .ruby_carrier(*item)
            .is_some_and(|c| c.start_overhang > 0.0)),
        "every ruby spreads and overhangs"
    );
    for mask in 0..8_usize {
        let unhung: Vec<usize> = rubies
            .iter()
            .enumerate()
            .filter(|(bit, _)| mask & (1 << bit) != 0)
            .map(|(_, item)| *item)
            .collect();
        let edits = ParagraphEdits {
            unhung_starts: &unhung,
            ..ParagraphEdits::default()
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
        for (byte, _) in text.char_indices() {
            let pushed = built
                .spacing_edits
                .letter
                .iter()
                .rev()
                .find(|(range, _)| range.contains(&byte))
                .map_or(0.0, |(_, spacing)| *spacing);
            assert_eq!(
                plan.letter_spacing_at(&text, byte, edits).to_bits(),
                pushed.to_bits(),
                "byte {byte} with rubies {unhung:?} unhung"
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

/// The lines (ranges and break reasons) and the letter-spacing pushes the
/// line loop decides for the paragraph at `root` in `space`.
type DriverResult = (
    Vec<(std::ops::Range<usize>, String)>,
    Vec<(std::ops::Range<usize>, f32)>,
);

fn decided_lines(
    context: &ParleyInlineContext,
    tree: &FormattingTree,
    space: &ConstraintSpace,
) -> (DriverResult, usize) {
    let FormattingNodeContent::InlineFlow { items } = &tree.node(FormattingNodeId(0)).content
    else {
        panic!("an inline flow");
    };
    let mut cursor = 0;
    let item_text_ranges: Vec<std::ops::Range<usize>> = items
        .iter()
        .map(|item| match item {
            InlineItem::Text { text, .. } => {
                cursor += text.len();
                cursor - text.len()..cursor
            }
            _ => cursor..cursor,
        })
        .collect();
    let cancel = CancelFlag::new();
    let inputs = LineEdgeInputs {
        tree,
        root: FormattingNodeId(0),
        space,
        band: space.float_band,
        item_text_ranges: &item_text_ranges,
        cancel: &cancel,
    };
    let result = |decided: &DecidedParagraph| -> DriverResult {
        (
            decided
                .layout
                .lines()
                .map(|line| (line.text_range(), format!("{:?}", line.break_reason())))
                .collect(),
            decided.spacing_edits.letter.clone(),
        )
    };
    let base_pushes = context
        .shaped_paragraph(
            tree,
            FormattingNodeId(0),
            space,
            ParagraphEdits::default(),
            &cancel,
        )
        .expect("base builds")
        .spacing_edits
        .letter
        .len();
    let decided = context
        .decide_line_edges(&inputs, &mut WidthBounds::new(space.inline_size))
        .expect("line edges decide");
    (result(&decided), base_pushes)
}

/// The paragraph `items` (one text item each, all in the serif) laid out
/// at `width`.
fn lay_text_items(
    context: &ParleyInlineContext,
    items: &[&str],
    padding_right: &[f32],
    width: f64,
) -> LayoutOutcome {
    let mut inline = InlineStyleTable::new(items.len());
    let inline_items: Vec<InlineItem> = items
        .iter()
        .enumerate()
        .map(|(index, text)| {
            let mut style = plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Generic(GenericFontFamily::Serif)])
                    .expect("family list"),
                16.0,
                0.0,
            );
            let padding = padding_right.get(index).copied().unwrap_or(0.0);
            style.fragment.padding.right = rito_style_contract::NonNegativeLengthPercentage::new(
                LengthPercentage::Length(rito_style_contract::CssPx::new(padding).expect("finite")),
            );
            let style = inline.intern_for_node(index, style).expect("style interns");
            let text = InlineItem::Text {
                text: (*text).to_owned(),
                style,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            };
            if padding == 0.0 {
                vec![text]
            } else {
                vec![text, InlineItem::CloseTag { style }]
            }
        })
        .collect::<Vec<_>>()
        .concat();
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: inline_items,
            },
            children: Vec::new(),
        }],
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles {
            layout: LayoutStyleTable::new(0),
            inline,
        },
    )
    .expect("inline tree builds");
    lay(context, &tree, width)
}

/// A closer the line overflows by half a glyph extends the line inside
/// whichever text item it is in, wherever the line crosses an element
/// boundary and whether or not it ends its item (Chromium 156 at 172px:
/// each of these is one line ending in a half-width `）` but the third,
/// which sends only what follows the closer down).
#[test]
fn a_closer_extends_its_line_across_element_boundaries() {
    let context = source_han_context();
    let nine = "永".repeat(9);
    let body = format!("{nine}）");
    let seven = "永".repeat(7);
    let cases: [(Vec<String>, Vec<String>); 5] = [
        (vec!["①".into(), body.clone()], vec![format!("①{body}")]),
        (vec![format!("①{body}")], vec![format!("①{body}")]),
        (
            vec!["①".into(), format!("{body}永永")],
            vec![format!("①{body}"), "永永".into()],
        ),
        (
            vec!["永永".into(), "永".into(), format!("{seven}）永永")],
            vec![format!("永永永{seven}）"), "永永".into()],
        ),
        (
            vec!["永永".into(), "永".into(), format!("{seven}）")],
            vec![format!("永永永{seven}）")],
        ),
    ];
    for (items, expected) in cases {
        let items: Vec<&str> = items.iter().map(String::as_str).collect();
        let outcome = lay_text_items(&context, &items, &[], 172.0);
        assert_eq!(line_texts(&outcome, &items.concat()), expected, "{items:?}");
    }
}

/// The line-end extension fits a line within one LayoutUnit of its width,
/// as its other lines fit: Chromium 156 trims the closer at 1/64px over
/// and not at 2/64px.
#[test]
fn a_line_end_trim_fits_within_one_layout_unit() {
    let context = source_han_context();
    let text = format!("{}」永永", "永".repeat(10));
    let lines = |overflow: f64| {
        line_texts(
            &lay(&context, &serif_paragraph(&text), 168.0 - overflow / 64.0),
            &text,
        )
    };
    assert_eq!(
        lines(1.0),
        [format!("{}」", "永".repeat(10)), "永永".into()]
    );
    assert_eq!(
        lines(2.0),
        ["永".repeat(9), "永」永永".into()],
        "two LayoutUnits over is not a fit"
    );
}

/// A closer ending a box with end padding extends the line only when the
/// padding fits after its trimmed glyph, and keeps the padding beside it:
/// Chromium 156 sends the closer down at 170px (160 + 8 + 4 > 170) and
/// keeps it at 173px, its glyph box ending at 168px.
#[test]
fn a_trimmed_closer_keeps_the_padding_of_the_box_it_ends() {
    let context = source_han_context();
    let ten = "永".repeat(10);
    let items = [format!("{ten}」"), "永永".to_owned()];
    let items: Vec<&str> = items.iter().map(String::as_str).collect();
    let text = items.concat();
    let narrow = lay_text_items(&context, &items, &[4.0], 170.0);
    assert_eq!(
        line_texts(&narrow, &text),
        ["永".repeat(9), "永」永永".into()]
    );
    let wide = lay_text_items(&context, &items, &[4.0], 173.0);
    assert_eq!(
        line_texts(&wide, &text),
        [format!("{ten}」"), "永永".into()]
    );
    let Fragment::Box(root) = &wide.fragments.root else {
        panic!("inline outcome root is a box fragment");
    };
    let Fragment::Line(first) = &root.children[0] else {
        panic!("inline children are line fragments");
    };
    let closer_right = first
        .children
        .iter()
        .filter_map(|run| match run {
            Fragment::Text(run) => Some(run.rect.x + run.rect.width),
            _ => None,
        })
        .fold(0.0_f64, f64::max);
    assert_eq!(closer_right, 168.0, "the trimmed closer's glyph box");
}

/// A ruby base split across lines spreads each segment to its allocated
/// annotation words decided line by line, as the whole-paragraph fixpoint
/// the line loop replaced decided them (its lines and pushes at every
/// width, pinned when it was retired).
#[test]
fn split_ruby_segments_spread_as_pinned() {
    let context = source_han_context();
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
    let text_item = |text: &str, annotation: Option<&str>| InlineItem::Text {
        text: text.to_owned(),
        style,
        baseline_shift_px: 0.0,
        ruby_annotation: annotation.map(|annotation| rito_fragment::RubyAnnotation {
            text: annotation.to_owned(),
            size_ratio: 0.5,
            align: rito_style_contract::RubyAlign::SpaceAround,
        }),
    };
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: rito_style_contract::LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![
                    text_item("永永永永永", None),
                    text_item("黄金妖精", Some("Leprechaun Leprechaun Lep")),
                    text_item("永永永永永永永永", None),
                ],
            },
            children: Vec::new(),
        }],
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles {
            layout: LayoutStyleTable::new(0),
            inline,
        },
    )
    .expect("inline tree builds");
    let mut spread = 0;
    let pinned = include_str!("fixtures/ruby_split_spreads.txt").lines();
    for (width, pinned) in (96..160).zip(pinned) {
        let (decided, base_pushes) = decided_lines(
            &context,
            &tree,
            &ConstraintSpace::continuous(f64::from(width)),
        );
        assert_eq!(snapshot_line(width, &decided), pinned);
        if decided.1.len() > base_pushes {
            spread += 1;
        }
    }
    assert!(spread > 0, "some width splits the base and spreads it");
}

/// Lines beside a float band break at its narrower width with their trims
/// and pairs decided against it, as the whole-paragraph fixpoint the line
/// loop replaced decided them (pinned when it was retired).
#[test]
fn line_edges_beside_a_float_band_are_decided_as_pinned() {
    let context = source_han_context();
    let text = format!(
        "{}{}」{}",
        "永".repeat(9),
        format!("」「{}", "永".repeat(8)).repeat(4),
        format!("{}」", "永".repeat(10)).repeat(4),
    );
    let tree = serif_paragraph(&text);
    let mut decided = 0;
    let mut pinned = include_str!("fixtures/float_band_line_edges.txt").lines();
    for width in 150..200 {
        let space = ConstraintSpace {
            float_band: Some(rito_fragment::FloatBand {
                left_inset: 24.0,
                right_inset: 0.0,
                bottom: 70.0,
            }),
            ..ConstraintSpace::continuous(f64::from(width))
        };
        let (lines, base_pushes) = decided_lines(&context, &tree, &space);
        assert_eq!(Some(snapshot_line(width, &lines).as_str()), pinned.next());
        if lines.1.len() != base_pushes {
            decided += 1;
        }
    }
    assert!(decided > 0, "some width decides a line edge");
}

/// A cancelled layout stops while it decides its line edges.
#[test]
fn a_cancelled_layout_stops_deciding() {
    let context = source_han_context();
    let text = format!("{}」", "永".repeat(10)).repeat(8);
    let cancel = CancelFlag::new();
    cancel.cancel();
    let outcome = context.layout(
        &serif_paragraph(&text),
        FormattingNodeId(0),
        &ConstraintSpace::continuous(170.0),
        None,
        &cancel,
    );
    assert!(matches!(outcome, Err(LayoutError::Cancelled)));
}

/// The inline sizes a layout without its text reports it holds for lay the
/// paragraph out exactly alike, decisions and all.
#[test]
fn the_sizes_a_decided_paragraph_holds_for_lay_it_out_alike() {
    let text = format!(
        "{}{}",
        format!("{}」", "永".repeat(10)).repeat(6),
        format!("」「{}", "永".repeat(8)).repeat(4),
    );
    let tree = serif_paragraph(&text);
    let omitted = |width: f64| ConstraintSpace {
        line_text: LineText::Omitted,
        ..ConstraintSpace::continuous(width)
    };
    let laid = |width: f64| {
        source_han_context()
            .layout(
                &tree,
                FormattingNodeId(0),
                &omitted(width),
                None,
                &CancelFlag::new(),
            )
            .expect("layout succeeds")
    };
    // The lines; the root box spans whatever width it is laid out at.
    let lines = |outcome: &LayoutOutcome| match &outcome.fragments.root {
        Fragment::Box(root) => root.children.clone(),
        _ => panic!("the root is a box"),
    };
    let at = laid(170.0);
    let (lo, hi) = at
        .inline_size_range
        .expect("the decided layout knows its range");
    assert!(lo <= 170.0 && 170.0 < hi, "{lo}..{hi}");
    for width in [lo, (lo + 170.0) / 2.0, (170.0 + hi) / 2.0, hi - 1e-6] {
        assert_eq!(
            lines(&laid(width)),
            lines(&at),
            "at {width}px in {lo}..{hi}"
        );
    }
}

/// One width's lines and letter-spacing pushes as one fixture line.
fn snapshot_line(width: i32, (lines, pushes): &DriverResult) -> String {
    let lines: Vec<String> = lines
        .iter()
        .map(|(range, reason)| format!("{}..{} {reason}", range.start, range.end))
        .collect();
    let pushes: Vec<String> = pushes
        .iter()
        .map(|(range, spacing)| format!("{}..{} {spacing:?}", range.start, range.end))
        .collect();
    format!("{width} | {} | {}", lines.join(", "), pushes.join(", "))
}
