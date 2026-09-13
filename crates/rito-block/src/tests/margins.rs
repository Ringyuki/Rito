//! Vertical margin collapsing and the LayoutUnit truncation the used
//! box edges around it go through.

use super::*;

#[test]
fn horizontal_padding_truncates_onto_the_layout_unit_grid() {
    // b19 note paragraph: padding 1em/0.1em at 12.16px resolves to
    // 12.16/1.216 in CSS arithmetic, but the used box subtracts the
    // truncated 12.15625/1.203125 — content width 567.796875, not
    // 567.78025.
    let mut style = block_style(margin_px(0.0), margin_px(0.0));
    let pad = |px: f32| {
        NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(px).expect("padding length"),
        ))
    };
    style.padding.left = pad(12.16);
    style.padding.right = pad(1.216);
    let hbox = resolve_horizontal_box(&style, 581.15625).expect("box resolves");
    assert!(
        (hbox.padding_left - 12.15625).abs() < 1e-9,
        "left {}",
        hbox.padding_left
    );
    assert!(
        (hbox.content_width - 567.796875).abs() < 1e-9,
        "content {}",
        hbox.content_width
    );
}

#[test]
fn mixed_sign_margins_collapse_as_a_set_through_empty_blocks() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let mut inline = InlineStyleTable::new(1);
    let text_style = inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                    .expect("family list"),
                16.0,
                0.0,
            ),
        )
        .expect("style interns");
    // Every paragraph: +16 top (the UA <p> margin), −12.8 bottom (an
    // authored −0.8em). An EMPTY paragraph sits between two one-line
    // paragraphs, so the set between their line boxes is
    // {+16, −12.8, +16, −12.8} → 16 − 12.8 = 3.2 (CSS 8.3.1).
    // A pairwise fold gives 6.4 (3.2 → −9.6 → 6.4) — the Durarara
    // account.
    let layout = layout_table_with(4, |_| block_style(margin_px(16.0), margin_px(-12.8)));
    let paragraph = |count: usize| FormattingNodeContent::InlineFlow {
        items: (0..count)
            .map(|line| InlineItem::Text {
                text: format!("line {line}"),
                style: text_style,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            })
            .collect(),
    };
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: paragraph(1),
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: paragraph(0),
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 2),
            content: paragraph(1),
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 3),
            content: FormattingNodeContent::BlockContainer,
            children: vec![
                FormattingNodeId(0),
                FormattingNodeId(1),
                FormattingNodeId(2),
            ],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(3),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(100.0),
            None,
            &CancelFlag::new(),
        )
        .expect("lays out");
    let children = box_children(&outcome);
    let Fragment::Box(first) = &children[0] else {
        panic!("paragraph fragments are boxes");
    };
    let Fragment::Box(second) = &children[2] else {
        panic!("paragraph fragments are boxes");
    };
    // The root collapses its leading edge, so the first paragraph's
    // escaping top margin leaves it at the container top.
    let first_bottom = first.rect.y + first.rect.height;
    // 3.2 lands on the layout grid as 3.203125 — the exact gap the
    // truth probe measures between the Durarara section head and its
    // following empty paragraph.
    assert!(
        (second.rect.y - (first_bottom + 3.2)).abs() < 0.01,
        "set-wise collapse 16 − 12.8 = 3.2, got gap {}",
        second.rect.y - first_bottom
    );
}

#[test]
fn a_percentage_parent_margin_collapses_with_its_first_child_at_layout() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let mut inline = InlineStyleTable::new(1);
    let text_style = inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                    .expect("family list"),
                16.0,
                0.0,
            ),
        )
        .expect("style interns");
    // The b59 contents pattern: `div { margin-top: 2%; }` around a
    // heading with a larger length margin. The bridge cannot fold a
    // percentage (no basis before layout); CSS 2 §8.3.1 still
    // collapses the pair — at 400px the heading's 20px absorbs the
    // resolved 8px via the set max. Stacking them was the +13px
    // account.
    let percent_margin = LengthPercentageOrAuto::Value(LengthPercentage::Percentage(
        rito_style_contract::Percentage::from_percent(2.0).expect("finite percentage"),
    ));
    let layout = layout_table_with(3, |index| match index {
        0 => block_style(margin_px(20.0), margin_px(0.0)),
        1 => block_style(percent_margin, margin_px(0.0)),
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    let paragraph = |count: usize| FormattingNodeContent::InlineFlow {
        items: (0..count)
            .map(|line| InlineItem::Text {
                text: format!("line {line}"),
                style: text_style,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            })
            .collect(),
    };
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: paragraph(1),
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0)],
        },
        FormattingNode {
            style: node_style_id(&layout, 2),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(1)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(2),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(400.0),
            None,
            &CancelFlag::new(),
        )
        .expect("lays out");
    let children = box_children(&outcome);
    let Fragment::Box(wrapper) = &children[0] else {
        panic!("container fragments are boxes");
    };
    assert!(
        (wrapper.rect.y - 20.0).abs() < 1e-9,
        "collapsed set max(8, 20) positions the wrapper, got {}",
        wrapper.rect.y
    );
    let Fragment::Box(heading) = &wrapper.children[0] else {
        panic!("paragraph fragments are boxes");
    };
    assert!(
        heading.rect.y.abs() < 1e-9,
        "the consumed child margin starts flush inside, got {}",
        heading.rect.y
    );
}

#[test]
fn a_padded_percentage_parent_keeps_its_child_margin_inside() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let mut inline = InlineStyleTable::new(1);
    let text_style = inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                    .expect("family list"),
                16.0,
                0.0,
            ),
        )
        .expect("style interns");
    // Padding on the meeting edge blocks the through-collapse
    // (CSS 2 §8.3.1): the wrapper keeps only its own resolved 2%,
    // and the heading margin applies inside, below the padding.
    let percent_margin = LengthPercentageOrAuto::Value(LengthPercentage::Percentage(
        rito_style_contract::Percentage::from_percent(2.0).expect("finite percentage"),
    ));
    let mut padded = block_style(percent_margin, margin_px(0.0));
    padded.padding.top = NonNegativeLengthPercentage::new(LengthPercentage::Length(
        CssPx::new(1.0).expect("finite"),
    ));
    let layout = layout_table_with(3, |index| match index {
        0 => block_style(margin_px(20.0), margin_px(0.0)),
        1 => padded,
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    let paragraph = |count: usize| FormattingNodeContent::InlineFlow {
        items: (0..count)
            .map(|line| InlineItem::Text {
                text: format!("line {line}"),
                style: text_style,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            })
            .collect(),
    };
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: paragraph(1),
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0)],
        },
        FormattingNode {
            style: node_style_id(&layout, 2),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(1)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(2),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(400.0),
            None,
            &CancelFlag::new(),
        )
        .expect("lays out");
    let children = box_children(&outcome);
    let Fragment::Box(wrapper) = &children[0] else {
        panic!("container fragments are boxes");
    };
    // 2% rides an f32 ratio (0.0199999996…), so 400 × it lands just
    // under 8 and LayoutUnit truncation keeps 511/64 — the same
    // arithmetic Blink performs.
    assert!(
        (wrapper.rect.y - 7.984375).abs() < 1e-9,
        "the padded wrapper keeps only its own 2%, got {}",
        wrapper.rect.y
    );
    let Fragment::Box(heading) = &wrapper.children[0] else {
        panic!("paragraph fragments are boxes");
    };
    assert!(
        (heading.rect.y - 21.0).abs() < 1e-9,
        "padding 1 plus the heading's own 20 stay inside, got {}",
        heading.rect.y
    );
}

/// Tree of paragraphs (2 fixed lines each = 20px) whose vertical
/// margins come from `margins[i] = (top, bottom)`.
fn margined_paragraphs_tree(
    margins: &[(LengthPercentageOrAuto, LengthPercentageOrAuto)],
) -> FormattingTree {
    let mut inline = InlineStyleTable::new(1);
    let style = inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                    .expect("family list"),
                16.0,
                0.0,
            ),
        )
        .expect("style interns");
    let layout = layout_table_with(margins.len() + 1, |index| {
        if index < margins.len() {
            let (top, bottom) = margins[index];
            block_style(top, bottom)
        } else {
            block_style(margin_px(0.0), margin_px(0.0))
        }
    });
    let mut nodes: Vec<FormattingNode> = margins
        .iter()
        .enumerate()
        .map(|(index, _)| FormattingNode {
            style: node_style_id(&layout, index),
            content: FormattingNodeContent::InlineFlow {
                items: (0..2)
                    .map(|line| InlineItem::Text {
                        text: format!("line {line}"),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    })
                    .collect(),
            },
            children: Vec::new(),
        })
        .collect();
    let count = nodes.len() as u32;
    nodes.push(FormattingNode {
        style: node_style_id(&layout, count as usize),
        content: FormattingNodeContent::BlockContainer,
        children: (0..count).map(FormattingNodeId).collect(),
    });
    FormattingTree::with_styles(
        nodes,
        FormattingNodeId(count),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds")
}

#[test]
fn an_empty_paragraph_self_collapses_its_margins() {
    // `<h4></h4>` before a paragraph: no inline content means no line
    // boxes (CSS 2.1 §9.4.2), the 30/25 margins collapse through the
    // empty box (§8.3.1), and the paragraph sits at max(30, 25) = 30
    // — not 55 (measured: Blink places the first line at 30).
    let context = BlockFormattingContext::new(FixedLineInline);
    let mut inline = InlineStyleTable::new(1);
    let style = inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                    .expect("family list"),
                16.0,
                0.0,
            ),
        )
        .expect("style interns");
    let layout = layout_table_with(3, |index| match index {
        0 => block_style(margin_px(30.0), margin_px(25.0)),
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::InlineFlow { items: Vec::new() },
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::InlineFlow {
                items: (0..2)
                    .map(|line| InlineItem::Text {
                        text: format!("line {line}"),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    })
                    .collect(),
            },
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 2),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0), FormattingNodeId(1)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(2),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    let space = ConstraintSpace::continuous(100.0);
    let cancel = CancelFlag::new();
    let outcome = context
        .layout(&tree, tree.root(), &space, None, &cancel)
        .expect("lays out");
    let children = box_children(&outcome);
    assert_eq!(children.len(), 2);
    let Fragment::Box(empty) = &children[0] else {
        panic!("empty paragraph fragment is a box");
    };
    assert!(
        (empty.rect.height).abs() < 1e-9,
        "empty block is zero-height"
    );
    let Fragment::Box(paragraph) = &children[1] else {
        panic!("paragraph fragment is a box");
    };
    assert!(
        (paragraph.rect.y - 30.0).abs() < 1e-9,
        "paragraph sits at the collapsed margin, got {}",
        paragraph.rect.y
    );
}

#[test]
fn a_childless_container_self_collapses_its_margins() {
    // The bridge lowers an empty `<h4></h4>` to a childless
    // BlockContainer; it must collapse exactly like the empty flow.
    let context = BlockFormattingContext::new(FixedLineInline);
    let mut inline = InlineStyleTable::new(1);
    let style = inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                    .expect("family list"),
                16.0,
                0.0,
            ),
        )
        .expect("style interns");
    let layout = layout_table_with(3, |index| match index {
        0 => block_style(margin_px(30.0), margin_px(25.0)),
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::BlockContainer,
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::InlineFlow {
                items: (0..2)
                    .map(|line| InlineItem::Text {
                        text: format!("line {line}"),
                        style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    })
                    .collect(),
            },
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 2),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0), FormattingNodeId(1)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(2),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    let space = ConstraintSpace::continuous(100.0);
    let cancel = CancelFlag::new();
    let outcome = context
        .layout(&tree, tree.root(), &space, None, &cancel)
        .expect("lays out");
    let children = box_children(&outcome);
    assert_eq!(children.len(), 2);
    let Fragment::Box(paragraph) = &children[1] else {
        panic!("paragraph fragment is a box");
    };
    assert!(
        (paragraph.rect.y - 30.0).abs() < 1e-9,
        "paragraph sits at the collapsed margin, got {}",
        paragraph.rect.y
    );
}

#[test]
fn a_snug_last_paragraph_keeps_its_full_margin() {
    // The p169 tail state: a page whose last one-line paragraph fits
    // with a fraction of a pixel to spare must sit at the full
    // collapsed margin below its predecessor — not creep upward.
    struct FractionalLineInline;
    impl FormattingContext for FractionalLineInline {
        fn layout(
            &self,
            tree: &FormattingTree,
            node: FormattingNodeId,
            space: &ConstraintSpace,
            _token: Option<&BreakToken>,
            _cancel: &CancelFlag,
        ) -> Result<LayoutOutcome, LayoutError> {
            let FormattingNodeContent::InlineFlow { items } = &tree.node(node).content else {
                return Err(LayoutError::Invalid("not an inline flow".to_owned()));
            };
            const LINE: f64 = 19.203125;
            let lines = (0..items.len())
                .map(|index| {
                    Fragment::Line(LineFragment {
                        source: node,
                        marker: None,
                        rect: FragmentRect {
                            x: 0.0,
                            y: LINE * index as f64,
                            width: space.inline_size,
                            height: LINE,
                        },
                        baseline: 16.0,
                        trailing_whitespace: 0.0,
                        ruby_growth: 0.0,
                        children: Vec::new(),
                    })
                })
                .collect();
            Ok(LayoutOutcome {
                fragments: FragmentTree {
                    root: Fragment::Box(BoxFragment {
                        source: node,
                        rect: FragmentRect {
                            x: 0.0,
                            y: 0.0,
                            width: space.inline_size,
                            height: LINE * items.len() as f64,
                        },
                        children: lines,
                    }),
                },
                continuation: None,
                escaped_floats: Vec::new(),
            })
        }
        fn intrinsic_inline_sizes(
            &self,
            _tree: &FormattingTree,
            _node: FormattingNodeId,
        ) -> Result<IntrinsicInlineSizes, LayoutError> {
            Ok(IntrinsicInlineSizes {
                min_content: 10.0,
                max_content: 100.0,
            })
        }
    }
    let context = BlockFormattingContext::new(FractionalLineInline);
    let mut inline = InlineStyleTable::new(1);
    let style = inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                    .expect("family list"),
                16.0,
                0.0,
            ),
        )
        .expect("style interns");
    let layout = layout_table_with(4, |_| block_style(margin_px(0.0), margin_px(8.0)));
    let paragraph = |node_index: usize, line_count: usize| FormattingNode {
        style: node_style_id(&layout, node_index),
        content: FormattingNodeContent::InlineFlow {
            items: (0..line_count)
                .map(|line| InlineItem::Text {
                    text: format!("line {line}"),
                    style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                })
                .collect(),
        },
        children: Vec::new(),
    };
    let nodes = vec![
        paragraph(0, 40), // 768.125
        paragraph(1, 2),  // top 776.125+8? -> gap 8 => 776.125; bottom 814.53
        paragraph(2, 1),  // top 822.53; bottom 841.73
        FormattingNode {
            style: node_style_id(&layout, 3),
            content: FormattingNodeContent::BlockContainer,
            children: vec![
                FormattingNodeId(0),
                FormattingNodeId(1),
                FormattingNodeId(2),
            ],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(3),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    // Fragmentainer sized so the final paragraph fits by ~0.3px.
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 842.0));
    assert_eq!(pages.len(), 1, "everything fits on one page");
    let children = box_children(&pages[0]);
    assert_eq!(children.len(), 3);
    let Fragment::Box(second) = &children[1] else {
        panic!("second paragraph is a box");
    };
    let Fragment::Box(last) = &children[2] else {
        panic!("last paragraph is a box");
    };
    let gap = last.rect.y - (second.rect.y + second.rect.height);
    assert!(
        (gap - 8.0).abs() < 1e-9,
        "snug last paragraph keeps margin 8, got gap {gap} (last at {})",
        last.rect.y
    );
}

#[test]
fn adjacent_margins_collapse_to_the_larger_one() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let tree = margined_paragraphs_tree(&[
        (margin_px(0.0), margin_px(12.0)),
        (margin_px(8.0), margin_px(6.0)),
    ]);
    let pages = paginate(&context, &tree, ConstraintSpace::continuous(100.0));
    assert_eq!(pages.len(), 1);
    let children = box_children(&pages[0]);
    assert_eq!(children.len(), 2);
    // Paragraph 1 at 0..20; collapsed gap max(12, 8) = 12; paragraph 2
    // at 32..52. The trailing bottom margin escapes the collapsing root
    // edge, so the container height ends at the content edge.
    assert!((children[0].rect().y - 0.0).abs() < 1e-9);
    assert!((children[1].rect().y - 32.0).abs() < 1e-9);
    assert!((pages[0].fragments.root.rect().height - 52.0).abs() < 1e-9);
}

#[test]
fn negative_margins_collapse_by_positive_max_plus_negative_min() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let tree = margined_paragraphs_tree(&[
        (margin_px(0.0), margin_px(10.0)),
        (margin_px(-4.0), margin_px(0.0)),
    ]);
    let pages = paginate(&context, &tree, ConstraintSpace::continuous(100.0));
    let children = box_children(&pages[0]);
    // Gap = max(10, -4).max(0) + min(10, -4).min(0) = 10 - 4 = 6.
    assert!((children[1].rect().y - 26.0).abs() < 1e-9);
}

#[test]
fn percentage_margins_resolve_against_the_inline_size() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let ten_percent = LengthPercentageOrAuto::Value(LengthPercentage::Percentage(
        Percentage::from_percent(10.0).expect("finite percentage"),
    ));
    let tree = margined_paragraphs_tree(&[
        (margin_px(0.0), ten_percent),
        (margin_px(0.0), margin_px(0.0)),
    ]);
    let pages = paginate(&context, &tree, ConstraintSpace::continuous(200.0));
    let children = box_children(&pages[0]);
    // 10% of the 200px inline size = 20px gap (f32 ratio widened to f64,
    // so compare at single precision).
    assert!((children[1].rect().y - 40.0).abs() < 1e-4);
}

#[test]
fn auto_vertical_margins_resolve_to_zero() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let tree = margined_paragraphs_tree(&[
        (LengthPercentageOrAuto::Auto, LengthPercentageOrAuto::Auto),
        (LengthPercentageOrAuto::Auto, LengthPercentageOrAuto::Auto),
    ]);
    let pages = paginate(&context, &tree, ConstraintSpace::continuous(100.0));
    let children = box_children(&pages[0]);
    assert!((children[1].rect().y - 20.0).abs() < 1e-9);
    assert!((pages[0].fragments.root.rect().height - 40.0).abs() < 1e-9);
}

#[test]
fn a_margin_meeting_an_unforced_break_is_truncated() {
    let context = BlockFormattingContext::new(FixedLineInline);
    // Page height 25: paragraph 1 (20px) fits; the 12px gap leaves no
    // room for any line of paragraph 2, so the break truncates the
    // margin and page 2 starts flush at the top.
    let tree = margined_paragraphs_tree(&[
        (margin_px(0.0), margin_px(12.0)),
        (margin_px(0.0), margin_px(0.0)),
    ]);
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 25.0));
    assert_eq!(pages.len(), 2);
    let first_children = box_children(&pages[0]);
    assert_eq!(first_children.len(), 1);
    // Page 1 seals at the content edge, without the truncated margin.
    assert!((pages[0].fragments.root.rect().height - 20.0).abs() < 1e-9);
    let second_children = box_children(&pages[1]);
    assert_eq!(second_children.len(), 1);
    assert!((second_children[0].rect().y - 0.0).abs() < 1e-9);
}
