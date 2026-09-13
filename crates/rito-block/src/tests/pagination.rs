//! Fragmentation: which content lands in which fragmentainer, how a
//! break resumes through nested containers, and what the block model
//! refuses outright.

use super::*;

/// Builds a tree whose container children are paragraphs with the given
/// line counts (each line 10 px through `FixedLineInline`).
fn paragraph_counts_tree(line_counts: &[usize]) -> FormattingTree {
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
    let layout = uniform_layout_table(line_counts.len() + 1);
    let mut nodes: Vec<FormattingNode> = line_counts
        .iter()
        .enumerate()
        .map(|(index, count)| FormattingNode {
            style: node_style_id(&layout, index),
            content: FormattingNodeContent::InlineFlow {
                items: (0..*count)
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
fn a_box_whose_trailing_padding_misses_moves_whole_when_it_can() {
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
    let mut padded = block_style(margin_px(0.0), margin_px(0.0));
    padded.padding.bottom = NonNegativeLengthPercentage::new(LengthPercentage::Length(
        CssPx::new(8.0).expect("finite"),
    ));
    let layout = layout_table_with(3, |index| match index {
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
            content: paragraph(1),
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
    // 10px line, then a box of one 10px line plus 8px trailing
    // padding, through 25px fragmentainers: the second box's line
    // fits (20 <= 25) but its padding does not (28 > 25) — the box
    // moves whole, not just its padding (measured on multi-page TOCs).
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 25.0));
    assert_eq!(pages.len(), 2);
    assert_eq!(box_children(&pages[0]).len(), 1);
    let Fragment::Box(moved) = &box_children(&pages[1])[0] else {
        panic!("paragraph fragments are boxes");
    };
    assert!(moved.rect.y.abs() < 1e-9);
    assert!(
        (moved.rect.height - 18.0).abs() < 1e-9,
        "line plus trailing padding travel together, got {}",
        moved.rect.height
    );
    assert_eq!(moved.children.len(), 1);
}

#[test]
fn trailing_padding_still_defers_when_the_box_opens_the_page() {
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
    let mut padded = block_style(margin_px(0.0), margin_px(0.0));
    padded.padding.bottom = NonNegativeLengthPercentage::new(LengthPercentage::Length(
        CssPx::new(8.0).expect("finite"),
    ));
    let layout = layout_table_with(2, |index| match index {
        0 => padded,
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::InlineFlow {
                items: (0..2)
                    .map(|line| InlineItem::Text {
                        text: format!("line {line}"),
                        style: text_style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    })
                    .collect(),
            },
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(1),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    // The padded box OPENS its page: moving it whole would recreate
    // the same state, so the padding-only closing fragment stands.
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 25.0));
    assert_eq!(pages.len(), 2);
    let Fragment::Box(head) = &box_children(&pages[0])[0] else {
        panic!("paragraph fragments are boxes");
    };
    assert_eq!(head.children.len(), 2);
    assert!((head.rect.height - 20.0).abs() < 1e-9);
    let Fragment::Box(tail) = &box_children(&pages[1])[0] else {
        panic!("paragraph fragments are boxes");
    };
    assert!(tail.children.is_empty());
    assert!((tail.rect.height - 8.0).abs() < 1e-9);
}

#[test]
fn page_tall_line_pairs_paginate_one_per_page() {
    let context = BlockFormattingContext::new(FixedLineInline);
    // Two 10px lines through a 15px fragmentainer: only one line fits
    // a fresh page, and orphans (2) would forbid placing it alone —
    // an empty page must make progress instead, one line per page
    // (the b110 hang: two page-tall plate lines looped forever).
    let tree = paragraph_counts_tree(&[2]);
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 15.0));
    assert_eq!(pages.len(), 2);
    for page in &pages {
        let children = box_children(page);
        let Fragment::Box(paragraph) = &children[0] else {
            panic!("paragraph fragments are boxes");
        };
        assert_eq!(paragraph.children.len(), 1);
    }
}

#[test]
fn paragraph_lines_paginate_without_gaps_or_repeats() {
    let context = BlockFormattingContext::new(FixedLineInline);
    // 7 lines of 10px through 25px fragmentainers: 2 + 2 + 2 + 1.
    let tree = paragraph_counts_tree(&[7]);
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 25.0));
    assert_eq!(pages.len(), 4);
    let line_counts: Vec<usize> = pages
        .iter()
        .map(|page| {
            let children = box_children(page);
            assert_eq!(children.len(), 1, "one paragraph fragment per page");
            let Fragment::Box(paragraph) = &children[0] else {
                panic!("paragraph fragments are boxes");
            };
            paragraph.children.len()
        })
        .collect();
    assert_eq!(line_counts, vec![2, 2, 2, 1]);
    for page in &pages {
        let children = box_children(page);
        let Fragment::Box(paragraph) = &children[0] else {
            panic!("paragraph fragments are boxes");
        };
        for (index, line) in paragraph.children.iter().enumerate() {
            assert!((line.rect().y - 10.0 * index as f64).abs() < 1e-9);
        }
    }
}

#[test]
fn forced_breaks_seal_the_fragmentainer_between_children() {
    let context = BlockFormattingContext::new(FixedLineInline);
    // Two 2-line paragraphs that would share one 100px fragmentainer;
    // a forced break between them puts each on its own page. A break
    // already satisfied at the top of a fresh fragmentainer never
    // produces an empty page.
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
    let mut layout = LayoutStyleTable::new(0);
    let plain = layout
        .intern(block_style(margin_px(0.0), margin_px(0.0)))
        .expect("style interns");
    let mut breaking = block_style(margin_px(0.0), margin_px(0.0));
    breaking.break_before = PageBreak::Always;
    let breaking = layout.intern(breaking).expect("style interns");
    let paragraph = |style: LayoutStyleId| FormattingNode {
        style,
        content: FormattingNodeContent::InlineFlow {
            items: (0..2)
                .map(|line| InlineItem::Text {
                    text: format!("line {line}"),
                    style: text_style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                })
                .collect(),
        },
        children: Vec::new(),
    };
    let nodes = vec![
        // First child itself asks for a break-before: satisfied at the
        // top, no empty page.
        paragraph(breaking),
        paragraph(breaking),
        FormattingNode {
            style: plain,
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
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 100.0));
    assert_eq!(pages.len(), 2, "forced break splits the two paragraphs");
    for page in &pages {
        assert_eq!(box_children(page).len(), 1, "one paragraph per page");
    }
}

#[test]
fn resumption_is_deterministic() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let tree = paragraph_counts_tree(&[5, 3]);
    let space = ConstraintSpace::fragmented(100.0, 30.0);
    let cancel = CancelFlag::new();
    let first = context
        .layout(&tree, tree.root(), &space, None, &cancel)
        .expect("first page");
    let token = first.continuation.clone().expect("break token");
    let resumed_a = context
        .layout(&tree, tree.root(), &space, Some(&token), &cancel)
        .expect("resume a");
    let resumed_b = context
        .layout(&tree, tree.root(), &space, Some(&token), &cancel)
        .expect("resume b");
    assert_eq!(resumed_a, resumed_b);
}

#[test]
fn mixed_leaves_and_paragraphs_share_fragmentainers() {
    let context = BlockFormattingContext::new(FixedLineInline);
    // leaf 12px + paragraph 3 lines (30px) through 30px fragmentainers:
    // page 1 = leaf + 1 line (12 + 10 <= 30, second line would overflow),
    // page 2 = remaining 2 lines.
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
    let layout = uniform_layout_table(3);
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::SizedLeaf {
                block_size: 12.0,
                breakable: false,
            },
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::InlineFlow {
                items: (0..3)
                    .map(|index| InlineItem::Text {
                        text: format!("line {index}"),
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
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 30.0));
    // Only one 10px line fits under the 12px leaf in a 30px
    // fragmentainer — fewer than `orphans` (2), so the break moves
    // before the paragraph and the whole 3-line block lands on page 2,
    // exactly as the browser breaks it.
    assert_eq!(pages.len(), 2);
    let first_children = box_children(&pages[0]);
    assert_eq!(
        first_children.len(),
        1,
        "the orphan rule leaves page 1 to the leaf"
    );
    let second_children = box_children(&pages[1]);
    assert_eq!(second_children.len(), 1);
    let Fragment::Box(rest) = &second_children[0] else {
        panic!("paragraph fragment is a box");
    };
    assert_eq!(rest.children.len(), 3);
    assert!((rest.rect.y).abs() < 1e-9);
}

#[test]
fn a_full_page_monolith_breaks_past_the_opener_padding() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let mut padded = block_style(margin_px(0.0), margin_px(0.0));
    padded.padding.top = NonNegativeLengthPercentage::new(LengthPercentage::Length(
        CssPx::new(10.0).expect("finite"),
    ));
    let layout = layout_table_with(2, |index| match index {
        1 => padded,
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::SizedLeaf {
                block_size: 100.0,
                breakable: false,
            },
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(1),
        FormattingTreeStyles {
            layout,
            inline: InlineStyleTable::new(1),
        },
    )
    .expect("tree builds");
    // A 100px monolith under 10px of opener padding in 100px pages:
    // Blink leaves the opener blank and places the plate on a fresh
    // page (the b117 gallery's leading blank), never force-placing it
    // 10px down.
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 100.0));
    assert_eq!(pages.len(), 2);
    assert!(box_children(&pages[0]).is_empty(), "the opener stays blank");
    let second = box_children(&pages[1]);
    assert_eq!(second.len(), 1);
    let Fragment::Box(leaf) = &second[0] else {
        panic!("leaf fragment is a box");
    };
    assert!(leaf.rect.y.abs() < 1e-9);
    assert!((leaf.rect.height - 100.0).abs() < 1e-9);
}

#[test]
fn a_monolith_taller_than_any_page_still_force_places() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let mut padded = block_style(margin_px(0.0), margin_px(0.0));
    padded.padding.top = NonNegativeLengthPercentage::new(LengthPercentage::Length(
        CssPx::new(10.0).expect("finite"),
    ));
    let layout = layout_table_with(2, |index| match index {
        1 => padded,
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::SizedLeaf {
                block_size: 120.0,
                breakable: false,
            },
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(1),
        FormattingTreeStyles {
            layout,
            inline: InlineStyleTable::new(1),
        },
    )
    .expect("tree builds");
    // Taller than ANY page: a break buys nothing, so it places whole
    // on the opener exactly as before — progress over blank churn.
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 100.0));
    assert_eq!(pages.len(), 1);
    assert_eq!(box_children(&pages[0]).len(), 1);
}

#[test]
fn a_page_tall_line_breaks_past_a_padding_shortened_opener() {
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
    let mut padded = block_style(margin_px(0.0), margin_px(0.0));
    padded.padding.top = NonNegativeLengthPercentage::new(LengthPercentage::Length(
        CssPx::new(2.0).expect("finite"),
    ));
    let layout = layout_table_with(2, |index| match index {
        1 => padded,
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "plate".to_owned(),
                    style: text_style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(1),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    // A 10px line through 8px fragmentainers with a 2px padded opener:
    // the line is taller than ANY page, but the opener is also
    // shortened — Blink breaks past it (blank opener) and lets the
    // line overflow the FRESH page invisibly, never the padded one
    // (the b117 gallery's leading blank).
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 8.0));
    assert_eq!(pages.len(), 2);
    assert!(
        box_children(&pages[0]).is_empty(),
        "the shortened opener stays blank"
    );
    let second = box_children(&pages[1]);
    assert_eq!(second.len(), 1);
    let Fragment::Box(paragraph) = &second[0] else {
        panic!("paragraph fragment is a box");
    };
    assert!(paragraph.rect.y.abs() < 1e-9);
    assert_eq!(paragraph.children.len(), 1, "the line overflows in place");
}

#[test]
fn line_taller_than_a_fresh_fragmentainer_still_progresses() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let tree = paragraph_counts_tree(&[2]);
    // 10px lines through 6px fragmentainers: each page takes one forced
    // line rather than looping forever.
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 6.0));
    assert_eq!(pages.len(), 2);
}

#[test]
fn continuous_space_never_breaks() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let tree = paragraph_counts_tree(&[5, 3]);
    let pages = paginate(&context, &tree, ConstraintSpace::continuous(100.0));
    assert_eq!(pages.len(), 1);
    let children = box_children(&pages[0]);
    assert_eq!(children.len(), 2);
    assert!((pages[0].fragments.root.rect().height - 80.0).abs() < 1e-9);
}

#[test]
fn leaf_roots_fail_closed_and_empty_nested_containers_are_zero_height() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let layout = uniform_layout_table(2);
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::BlockContainer,
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(1),
        FormattingTreeStyles {
            layout,
            inline: InlineStyleTable::new(0),
        },
    )
    .expect("tree builds");
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 50.0));
    assert_eq!(pages.len(), 1);
    assert!((pages[0].fragments.root.rect().height - 0.0).abs() < 1e-9);

    let leaf_layout = uniform_layout_table(1);
    let leaf_tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: node_style_id(&leaf_layout, 0),
            content: FormattingNodeContent::SizedLeaf {
                block_size: 10.0,
                breakable: true,
            },
            children: Vec::new(),
        }],
        FormattingNodeId(0),
        FormattingTreeStyles {
            layout: leaf_layout,
            inline: InlineStyleTable::new(0),
        },
    )
    .expect("leaf tree builds");
    assert!(matches!(
        context.layout(
            &leaf_tree,
            leaf_tree.root(),
            &ConstraintSpace::continuous(100.0),
            None,
            &CancelFlag::new()
        ),
        Err(LayoutError::Invalid(_))
    ));
}

/// Outer container: [paragraph A, inner [paragraph B, paragraph C],
/// paragraph D], every paragraph two 10px fixed lines.
fn nested_tree() -> FormattingTree {
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
    let layout = uniform_layout_table(6);
    let paragraph = |node_index: usize| FormattingNode {
        style: node_style_id(&layout, node_index),
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
    };
    let nodes = vec![
        paragraph(0), // A
        paragraph(1), // B
        paragraph(2), // C
        FormattingNode {
            style: node_style_id(&layout, 3), // inner
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(1), FormattingNodeId(2)],
        },
        paragraph(4), // D
        FormattingNode {
            style: node_style_id(&layout, 5), // outer
            content: FormattingNodeContent::BlockContainer,
            children: vec![
                FormattingNodeId(0),
                FormattingNodeId(3),
                FormattingNodeId(4),
            ],
        },
    ];
    FormattingTree::with_styles(
        nodes,
        FormattingNodeId(5),
        FormattingTreeStyles { layout, inline },
    )
    .expect("nested tree builds")
}

#[test]
fn nested_containers_stack_in_continuous_space() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let tree = nested_tree();
    let pages = paginate(&context, &tree, ConstraintSpace::continuous(100.0));
    assert_eq!(pages.len(), 1);
    let children = box_children(&pages[0]);
    assert_eq!(children.len(), 3, "A, inner, D");
    // A 0..20, inner 20..60 (B + C), D 60..80.
    assert!((children[1].rect().y - 20.0).abs() < 1e-9);
    assert!((children[1].rect().height - 40.0).abs() < 1e-9);
    assert!((children[2].rect().y - 60.0).abs() < 1e-9);
    assert!((pages[0].fragments.root.rect().height - 80.0).abs() < 1e-9);
}

#[test]
fn breaks_inside_nested_containers_resume_through_the_ancestor_path() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let tree = nested_tree();
    // 30px pages over 80px of lines: the first break lands inside the
    // inner container (paragraph B's second line would overflow page 1).
    let space = ConstraintSpace::fragmented(100.0, 30.0);
    let cancel = CancelFlag::new();
    let first = context
        .layout(&tree, tree.root(), &space, None, &cancel)
        .expect("first page");
    let token = first.continuation.clone().expect("break token");
    assert_eq!(
        token.resume_path,
        vec![FormattingNodeId(3), FormattingNodeId(1)],
        "the resume path names the inner container, then paragraph B"
    );

    let resumed_a = context
        .layout(&tree, tree.root(), &space, Some(&token), &cancel)
        .expect("resume a");
    let resumed_b = context
        .layout(&tree, tree.root(), &space, Some(&token), &cancel)
        .expect("resume b");
    assert_eq!(resumed_a, resumed_b, "deep resumption is deterministic");

    // Full pagination loses no lines anywhere in the tree.
    let pages = paginate(&context, &tree, space);
    let mut total_lines = 0usize;
    fn count_lines(fragment: &Fragment, total: &mut usize) {
        match fragment {
            Fragment::Line(_) => *total += 1,
            Fragment::Box(inner) => {
                for child in &inner.children {
                    count_lines(child, total);
                }
            }
            Fragment::Text(_) | Fragment::Image(_) => {}
        }
    }
    for page in &pages {
        count_lines(&page.fragments.root, &mut total_lines);
    }
    assert_eq!(total_lines, 8, "A, B, C, D contribute two lines each");
}

#[test]
fn three_levels_of_nesting_paginate_losslessly() {
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
    let layout = uniform_layout_table(4);
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::InlineFlow {
                items: (0..5)
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
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0)],
        },
        FormattingNode {
            style: node_style_id(&layout, 2),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(1)],
        },
        FormattingNode {
            style: node_style_id(&layout, 3),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(2)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(3),
        FormattingTreeStyles { layout, inline },
    )
    .expect("deep tree builds");
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 20.0));
    assert_eq!(pages.len(), 3, "five 10px lines through 20px pages");
    let deep_token_page = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::fragmented(100.0, 20.0),
            None,
            &CancelFlag::new(),
        )
        .expect("first page");
    let token = deep_token_page.continuation.expect("token");
    assert_eq!(
        token.resume_path,
        vec![
            FormattingNodeId(2),
            FormattingNodeId(1),
            FormattingNodeId(0)
        ],
        "the path walks every nesting level down to the paragraph"
    );
}

#[test]
fn cancellation_propagates() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let tree = paragraph_counts_tree(&[3]);
    let cancel = CancelFlag::new();
    cancel.cancel();
    assert_eq!(
        context.layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(100.0),
            None,
            &cancel
        ),
        Err(LayoutError::Cancelled)
    );
}

#[test]
fn missing_layout_styles_fail_closed() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let nodes = vec![
        FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::SizedLeaf {
                block_size: 10.0,
                breakable: true,
            },
            children: Vec::new(),
        },
        FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0)],
        },
    ];
    let tree = FormattingTree::new(nodes, FormattingNodeId(1)).expect("tree builds");
    assert!(matches!(
        context.layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(100.0),
            None,
            &CancelFlag::new()
        ),
        Err(LayoutError::Invalid(_))
    ));
}

fn tinos_bytes() -> Vec<u8> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"
    );
    std::fs::read(path).expect("pinned Tinos test font reads")
}

#[test]
fn real_paragraphs_paginate_losslessly_through_parley() {
    let inline = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context builds");
    let context = BlockFormattingContext::new(inline);

    let first_text = "The quick brown fox jumps over the lazy dog and keeps running \
through the quiet forest until the morning light returns.";
    let second_text = "A second paragraph follows the first one and must keep every \
single line across page boundaries.";
    let mut inline_table = InlineStyleTable::new(2);
    let families = FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Tinos"))])
        .expect("family list");
    let first_style = inline_table
        .intern_for_node(0, plain_paragraph_style(families.clone(), 16.0, 32.0))
        .expect("first style interns");
    let second_style = inline_table
        .intern_for_node(1, plain_paragraph_style(families, 16.0, 32.0))
        .expect("second style interns");
    let layout = uniform_layout_table(3);
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: first_text.to_owned(),
                    style: first_style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: second_text.to_owned(),
                    style: second_style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
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
        FormattingTreeStyles {
            layout,
            inline: inline_table,
        },
    )
    .expect("tree builds");

    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(160.0, 60.0));
    assert!(pages.len() > 2, "narrow pages force pagination");

    // Reassemble every page's text fragments; nothing may be lost or
    // duplicated across fragmentainer boundaries.
    let mut reassembled: Vec<String> = vec![String::new(), String::new()];
    for page in &pages {
        for paragraph in box_children(page) {
            let Fragment::Box(paragraph) = paragraph else {
                panic!("paragraph fragments are boxes");
            };
            let text = match paragraph.source {
                FormattingNodeId(0) => first_text,
                FormattingNodeId(1) => second_text,
                other => panic!("unexpected source {other:?}"),
            };
            let slot = &mut reassembled[paragraph.source.0 as usize];
            for line in &paragraph.children {
                let Fragment::Line(line) = line else {
                    panic!("paragraph children are lines");
                };
                let mut start = u32::MAX;
                let mut end = 0_u32;
                for run in &line.children {
                    let Fragment::Text(run) = run else {
                        panic!("line children are text runs");
                    };
                    start = start.min(run.text_start);
                    end = end.max(run.text_end);
                }
                slot.push_str(&text[start as usize..end as usize]);
            }
        }
    }
    assert_eq!(reassembled[0], first_text);
    assert_eq!(reassembled[1], second_text);

    // The cache makes the second pagination replay-fast and identical.
    let repeat = paginate(&context, &tree, ConstraintSpace::fragmented(160.0, 60.0));
    assert_eq!(pages, repeat);
}

/// A fresh fragmentainer narrowed by the box's own leading padding
/// breaks AFTER the padding when the first line would fit a full
/// page: the page keeps a padding-only fragment and the line opens
/// the next fragmentainer (measured: Blink's 2px-only blank column
/// before a full-height illustration).
#[test]
fn leading_padding_breaks_alone_when_it_squeezes_a_full_page_line() {
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
    let mut padded = block_style(margin_px(0.0), margin_px(0.0));
    padded.padding.top = NonNegativeLengthPercentage::new(LengthPercentage::Length(
        CssPx::new(2.0).expect("finite"),
    ));
    let layout = layout_table_with(2, |index| {
        if index == 0 {
            padded
        } else {
            block_style(margin_px(0.0), margin_px(0.0))
        }
    });
    // FixedLineInline lines are 10px tall; a 10px fragmentainer with
    // a 2px-padded paragraph reproduces the 850-into-852 squeeze.
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "image line".to_owned(),
                    style: text_style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(1),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    let space = ConstraintSpace {
        inline_size: 100.0,
        fragmentainer_remaining: Some(10.0),
        fragmentainer_size: Some(10.0),
        float_band: None,
        containing_block_size: None,
    };
    let first = context
        .layout(&tree, tree.root(), &space, None, &CancelFlag::new())
        .expect("first page lays out");
    let Fragment::Box(root) = &first.fragments.root else {
        panic!("root is a box");
    };
    let Some(Fragment::Box(paragraph)) = root.children.first() else {
        panic!("padding-only paragraph fragment exists");
    };
    assert!(
        paragraph.children.is_empty() && (paragraph.rect.height - 2.0).abs() < 0.01,
        "first fragment holds only the 2px leading padding: h={} lines={}",
        paragraph.rect.height,
        paragraph.children.len()
    );
    let token = first.continuation.clone().expect("line resumes next page");
    let second = context
        .layout(&tree, tree.root(), &space, Some(&token), &CancelFlag::new())
        .expect("second page lays out");
    let Fragment::Box(root2) = &second.fragments.root else {
        panic!("root is a box");
    };
    let Some(Fragment::Box(paragraph2)) = root2.children.first() else {
        panic!("resumed paragraph exists");
    };
    assert!(
        (paragraph2.rect.height - 10.0).abs() < 0.01 && !paragraph2.children.is_empty(),
        "the resumed fragment holds the full 10px line with no re-applied padding: h={}",
        paragraph2.rect.height
    );
    assert!(second.continuation.is_none(), "the paragraph finishes");
}

/// The padding break holds even when the line will not fit a whole
/// fragmentainer either: the padding edge is a break opportunity, so
/// the squeezed page keeps a padding-only fragment and the
/// monolithic line overflows the NEXT page from its very top
/// (measured: Blink's 854px image line box — 850px image plus strut
/// descent — behind a 2px-only blank column).
#[test]
fn leading_padding_breaks_even_when_the_line_overflows_a_whole_page() {
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
    let mut padded = block_style(margin_px(0.0), margin_px(0.0));
    padded.padding.top = NonNegativeLengthPercentage::new(LengthPercentage::Length(
        CssPx::new(2.0).expect("finite"),
    ));
    let layout = layout_table_with(2, |index| {
        if index == 0 {
            padded
        } else {
            block_style(margin_px(0.0), margin_px(0.0))
        }
    });
    // FixedLineInline lines are 10px tall; an 8px fragmentainer makes
    // the line overflow even a whole fresh page (the 854-into-850
    // shape), yet the padding must still break alone.
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "image line".to_owned(),
                    style: text_style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(1),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    let space = ConstraintSpace {
        inline_size: 100.0,
        fragmentainer_remaining: Some(8.0),
        fragmentainer_size: Some(8.0),
        float_band: None,
        containing_block_size: None,
    };
    let first = context
        .layout(&tree, tree.root(), &space, None, &CancelFlag::new())
        .expect("first page lays out");
    let Fragment::Box(root) = &first.fragments.root else {
        panic!("root is a box");
    };
    let Some(Fragment::Box(paragraph)) = root.children.first() else {
        panic!("padding-only paragraph fragment exists");
    };
    assert!(
        paragraph.children.is_empty() && (paragraph.rect.height - 2.0).abs() < 0.01,
        "first fragment holds only the 2px leading padding: h={} lines={}",
        paragraph.rect.height,
        paragraph.children.len()
    );
    let token = first.continuation.clone().expect("line resumes next page");
    let second = context
        .layout(&tree, tree.root(), &space, Some(&token), &CancelFlag::new())
        .expect("second page lays out");
    let Fragment::Box(root2) = &second.fragments.root else {
        panic!("root is a box");
    };
    let Some(Fragment::Box(paragraph2)) = root2.children.first() else {
        panic!("resumed paragraph exists");
    };
    assert!(
        (paragraph2.rect.height - 10.0).abs() < 0.01 && !paragraph2.children.is_empty(),
        "the resumed fragment force-fits the 10px line from the page top: h={}",
        paragraph2.rect.height
    );
    assert!(second.continuation.is_none(), "the paragraph finishes");
}

/// Trailing padding that no longer fits after an overflowing
/// monolithic line continues on the next page as a padding-only
/// closing fragment, and the NEXT sibling's top margin stacks after
/// it instead of truncating at the page top (measured: Blink opens
/// the post-illustration column with 2px of `.kuan` bottom padding
/// followed by the spacer paragraph's full 7.59px margin).
#[test]
fn deferred_trailing_padding_opens_the_next_page_and_preserves_the_sibling_margin() {
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
    let mut padded = block_style(margin_px(0.0), margin_px(0.0));
    padded.padding.bottom = NonNegativeLengthPercentage::new(LengthPercentage::Length(
        CssPx::new(2.0).expect("finite"),
    ));
    let layout = layout_table_with(3, |index| match index {
        0 => padded,
        1 => block_style(margin_px(4.0), margin_px(0.0)),
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    // FixedLineInline lines are 10px tall; a 9px fragmentainer makes
    // the paragraph's line overflow the whole page (force-fit), so
    // its 2px bottom padding must continue on page 2, followed by
    // the 3px leaf at its full 4px margin (2 + 4 = 6, 6 + 3 = 9).
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "image line".to_owned(),
                    style: text_style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::SizedLeaf {
                block_size: 3.0,
                breakable: false,
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
    let space = ConstraintSpace {
        inline_size: 100.0,
        fragmentainer_remaining: Some(9.0),
        fragmentainer_size: Some(9.0),
        float_band: None,
        containing_block_size: None,
    };
    let first = context
        .layout(&tree, tree.root(), &space, None, &CancelFlag::new())
        .expect("first page lays out");
    let Fragment::Box(root) = &first.fragments.root else {
        panic!("root is a box");
    };
    let Some(Fragment::Box(paragraph)) = root.children.first() else {
        panic!("force-fit paragraph fragment exists");
    };
    assert!(
        (paragraph.rect.height - 10.0).abs() < 0.01,
        "page 1 holds the overflowing line WITHOUT its bottom padding: h={}",
        paragraph.rect.height
    );
    let token = first.continuation.clone().expect("padding continues");
    let second = context
        .layout(&tree, tree.root(), &space, Some(&token), &CancelFlag::new())
        .expect("second page lays out");
    let Fragment::Box(root2) = &second.fragments.root else {
        panic!("root is a box");
    };
    let Some(Fragment::Box(padding_tail)) = root2.children.first() else {
        panic!("padding-only closing fragment exists");
    };
    assert!(
        padding_tail.children.is_empty() && (padding_tail.rect.height - 2.0).abs() < 0.01,
        "page 2 opens with the 2px padding-only fragment: h={}",
        padding_tail.rect.height
    );
    let Some(Fragment::Box(next)) = root2.children.get(1) else {
        panic!("the sized leaf follows on page 2");
    };
    assert!(
        (next.rect.y - 6.0).abs() < 0.01,
        "the sibling's 4px margin stacks after the 2px padding: y={}",
        next.rect.y
    );
    assert!(second.continuation.is_none(), "the chapter finishes");
}
