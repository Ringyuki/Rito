//! Floats: where a float box lands against the floats still active at
//! its position, how content flows beside one and clears below it, and
//! how paired and nested float columns resume across pages.

use super::*;

/// Floats place individually per CSS 9.5.1 — each stacks
/// against the floats still ACTIVE at its own position, not into a
/// cumulative band chain. Replica of b60's title page (element-box
/// oracle, basis 627.219 = body content after 1% side padding; margin
/// boxes carry SIGNED widths — two negative margins in the set):
/// title2 belongs at title1's margin edge because title1-1 has
/// expired vertically, and title3 at title2's edge likewise. The old
/// band chain parked title2 at 439.3 (paint 508.4) where Blink puts
/// it at 405.78 (paint 474.89 exact).
#[test]
fn floats_stack_against_the_active_set_not_a_band_chain() {
    let cw = 627.219;
    let mut floats = FloatBands::new();
    let close = |value: f64, expect: f64| (value - expect).abs() < 1e-3;
    // title1: ml 62.719 + w 48; margin box spans mt 25.078 + h 205.875.
    let (x1, y1) = floats.place(Float::Right, 110.719, 230.953, 0.0, cw);
    assert!(close(x1, 516.5) && close(y1, 0.0), "title1 at ({x1}, {y1})");
    // title1-1: ml -81.531 + w 48 (negative outer width!), bottom 163.953.
    let (x2, y2) = floats.place(Float::Right, -33.531, 163.953, 0.0, cw);
    assert!(
        close(x2, 550.031) && close(y2, 0.0),
        "title1-1 at ({x2}, {y2})"
    );
    // title2: same outer shape as title1, bottom 246.844.
    let (x3, y3) = floats.place(Float::Right, 110.719, 246.844, 0.0, cw);
    assert!(
        close(x3, 405.781) && close(y3, 0.0),
        "title2 at ({x3}, {y3})"
    );
    // title3: w 160 + mr -188.156 (right-overhang), bottom 317.5.
    let (x4, y4) = floats.place(Float::Right, -28.156, 317.5, 0.0, cw);
    assert!(
        close(x4, 433.937) && close(y4, 0.0),
        "title3 at ({x4}, {y4})"
    );
}

/// A float too wide for the space beside active floats steps down to
/// the next band edge (the earliest active bottom), preserving the
/// old model's fits-below behavior.
#[test]
fn an_unfitting_float_steps_below_the_blocking_band() {
    let mut floats = FloatBands::new();
    let (x1, y1) = floats.place(Float::Left, 300.0, 100.0, 0.0, 400.0);
    assert!((x1, y1) == (0.0, 0.0));
    let (x2, y2) = floats.place(Float::Right, 200.0, 50.0, 0.0, 400.0);
    assert!(
        (x2 - 200.0).abs() < 1e-9 && (y2 - 100.0).abs() < 1e-9,
        "second float steps below the first, got ({x2}, {y2})"
    );
}

/// Paired float columns like a character-introduction page: 49% left
/// and 49% right, different heights, followed by nothing.
/// #85 phantom-fy replica: two successive right floats, the second
/// with a margin-top and each holding a margined paragraph. Its
/// fragment y must be exactly its own margin-top (fy = flow position
/// 0): the b60 title probe showed the second/third float's y drifting
/// +13.4/+60.8 beyond that.
#[test]
fn a_later_float_keeps_its_flow_position_y() {
    use rito_style_contract::Float;
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
    let mut float_one = block_style(margin_px(0.0), margin_px(0.0));
    float_one.float = Float::Right;
    float_one.width = PreferredSize::Value(NonNegativeLengthPercentage::new(
        LengthPercentage::Length(CssPx::new(48.0).expect("finite")),
    ));
    let mut float_two = block_style(margin_px(100.0), margin_px(0.0));
    float_two.float = Float::Right;
    float_two.width = float_one.width;
    let layout = layout_table_with(5, |index| match index {
        0 => float_one,
        1 => float_two,
        2 | 3 => block_style(margin_px(20.0), margin_px(0.0)),
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    let paragraph = |node_index: usize| FormattingNode {
        style: node_style_id(&layout, node_index),
        content: FormattingNodeContent::InlineFlow {
            items: vec![InlineItem::Text {
                text: "line".to_owned(),
                style,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            }],
        },
        children: Vec::new(),
    };
    let nodes = vec![
        paragraph(2),
        paragraph(3),
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0)],
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(1)],
        },
        FormattingNode {
            style: node_style_id(&layout, 4),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(2), FormattingNodeId(3)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(4),
        rito_fragment::FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(600.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root box");
    };
    let float_ys: Vec<(u32, f64)> = root
        .children
        .iter()
        .filter_map(|child| match child {
            Fragment::Box(inner) => Some((inner.source.0, inner.rect.y)),
            _ => None,
        })
        .collect();
    let first = float_ys.iter().find(|(id, _)| *id == 2).expect("float one");
    let second = float_ys.iter().find(|(id, _)| *id == 3).expect("float two");
    assert!(
        first.1.abs() < 1e-6,
        "first float sits at its flow position 0, got {}",
        first.1
    );
    assert!(
        (second.1 - 100.0).abs() < 1e-6,
        "second float sits at flow 0 + its margin-top 100, got {}",
        second.1
    );
}

#[test]
fn paired_float_columns_split_and_resume_side_by_side_across_pages() {
    use rito_style_contract::{Float, NonNegativeLengthPercentage, Percentage};
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
    let half_width = PreferredSize::Value(NonNegativeLengthPercentage::new(
        LengthPercentage::Percentage(Percentage::from_percent(49.0).expect("finite")),
    ));
    let mut column = block_style(margin_px(0.0), margin_px(0.0));
    column.width = half_width;
    let mut left_column = column;
    left_column.float = Float::Left;
    let mut right_column = column;
    right_column.float = Float::Right;
    let layout = layout_table_with(5, |index| match index {
        0 => left_column,
        1 => right_column,
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
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
    // Each column is a block container of two paragraphs (30px each,
    // 60px total) in a 40px fragmentainer: both columns must split at
    // the page edge and resume side by side on page two.
    let nodes = vec![
        paragraph(2, 3),
        paragraph(3, 3),
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0), FormattingNodeId(1)],
        },
        paragraph(2, 3),
        paragraph(3, 3),
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(3), FormattingNodeId(4)],
        },
        FormattingNode {
            style: node_style_id(&layout, 4),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(2), FormattingNodeId(5)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(6),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(200.0, 40.0));
    assert_eq!(pages.len(), 2, "both columns span exactly two pages");

    let first = box_children(&pages[0]);
    assert_eq!(first.len(), 2, "page one holds both column heads");
    let left = first[0].rect();
    let right = first[1].rect();
    assert!((left.x - 0.0).abs() < 1e-6, "left head at the left edge");
    assert!(
        (right.x - (200.0 - 98.0)).abs() < 1e-3,
        "right head against the right edge, got {}",
        right.x
    );
    assert!((left.y - 0.0).abs() < 1e-6);
    assert!((right.y - 0.0).abs() < 1e-6, "heads share the page top");
    assert!(left.height <= 40.0 + 1e-6, "left head fits the page");
    assert!(right.height <= 40.0 + 1e-6, "right head fits the page");

    let second = box_children(&pages[1]);
    assert_eq!(second.len(), 2, "page two holds both column tails");
    let left_tail = second[0].rect();
    let right_tail = second[1].rect();
    assert!((left_tail.y - 0.0).abs() < 1e-6, "tails resume at the top");
    assert!(
        (right_tail.y - 0.0).abs() < 1e-6,
        "tails resume side by side, got y {}",
        right_tail.y
    );
    assert!((left_tail.x - 0.0).abs() < 1e-6);
    assert!(
        (right_tail.x - (200.0 - 98.0)).abs() < 1e-3,
        "right tail keeps its band, got {}",
        right_tail.x
    );
    // No fragment anywhere may carry negative coordinates.
    for (index, page) in pages.iter().enumerate() {
        for fragment in box_children(page) {
            assert!(
                fragment.rect().y >= -1e-6,
                "page {index} fragment starts above the page top",
            );
        }
    }
}

/// The same paired columns, but inside a wrapper container — how real
/// books structure character pages (body > div.intro > two columns).
/// The wrapper's split floats must ride the resume path down and come
/// back side by side on the next page.
#[test]
fn nested_float_columns_resume_side_by_side_across_pages() {
    use rito_style_contract::{Float, NonNegativeLengthPercentage, Percentage};
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
    let half_width = PreferredSize::Value(NonNegativeLengthPercentage::new(
        LengthPercentage::Percentage(Percentage::from_percent(49.0).expect("finite")),
    ));
    let mut column = block_style(margin_px(0.0), margin_px(0.0));
    column.width = half_width;
    let mut left_column = column;
    left_column.float = Float::Left;
    let mut right_column = column;
    right_column.float = Float::Right;
    let layout = layout_table_with(5, |index| match index {
        0 => left_column,
        1 => right_column,
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
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
    // body(8) > wrapper(7) > [left column(2), right column(5)]; each
    // column holds two 30px paragraphs in a 40px fragmentainer, so
    // both columns split inside the wrapper and resume on page two.
    let nodes = vec![
        paragraph(2, 3),
        paragraph(3, 3),
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(0), FormattingNodeId(1)],
        },
        paragraph(2, 3),
        paragraph(3, 3),
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(3), FormattingNodeId(4)],
        },
        FormattingNode {
            style: node_style_id(&layout, 4),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(2), FormattingNodeId(5)],
        },
        FormattingNode {
            style: node_style_id(&layout, 4),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(6)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(7),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(200.0, 40.0));
    assert_eq!(pages.len(), 2, "the nested columns span exactly two pages");

    let columns_of = |page: &LayoutOutcome| -> Vec<FragmentRect> {
        let wrappers = box_children(page);
        assert_eq!(wrappers.len(), 1, "each page holds the wrapper box");
        let Fragment::Box(wrapper) = &wrappers[0] else {
            panic!("wrapper is a box");
        };
        wrapper.children.iter().map(|child| child.rect()).collect()
    };
    let first = columns_of(&pages[0]);
    assert_eq!(first.len(), 2, "page one holds both column heads");
    assert!((first[0].x - 0.0).abs() < 1e-6);
    assert!(
        (first[1].x - (200.0 - 98.0)).abs() < 1e-3,
        "right head against the right edge, got {}",
        first[1].x
    );
    assert!((first[0].y - 0.0).abs() < 1e-6);
    assert!((first[1].y - 0.0).abs() < 1e-6, "heads share the page top");

    let second = columns_of(&pages[1]);
    assert_eq!(second.len(), 2, "page two holds both column tails");
    assert!((second[0].y - 0.0).abs() < 1e-6, "tails resume at the top");
    assert!(
        (second[1].y - 0.0).abs() < 1e-6,
        "tails resume side by side, got y {}",
        second[1].y
    );
    assert!((second[0].x - 0.0).abs() < 1e-6);
    assert!(
        (second[1].x - (200.0 - 98.0)).abs() < 1e-3,
        "right tail keeps its band, got {}",
        second[1].x
    );
    for (index, page) in pages.iter().enumerate() {
        for fragment in box_children(page) {
            assert!(
                fragment.rect().y >= -1e-6,
                "page {index} fragment starts above the page top",
            );
        }
    }
}

/// A floated badge with a large negative top margin hoists above its
/// flow position — how title pages pull a volume number back to the
/// page top — and occupies no float band doing it.
#[test]
fn negative_top_margins_hoist_floats_above_their_flow_position() {
    use rito_style_contract::Float;
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
    let mut badge = block_style(margin_px(-100.0), margin_px(0.0));
    badge.float = Float::Right;
    let layout = layout_table_with(3, |index| match index {
        0 => badge,
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
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
    // Flow: a 120px paragraph, then the floated one-line badge with
    // margin-top -100 — its box must land 100px above the flow tail.
    let nodes = vec![
        paragraph(1, 12),
        paragraph(0, 1),
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
    let pages = paginate(&context, &tree, ConstraintSpace::continuous(300.0));
    let children = box_children(&pages[0]);
    assert_eq!(children.len(), 2);
    let badge_rect = children[1].rect();
    // Flow tail is y=120; the badge box hoists to 120 - 100 = 20.
    assert!(
        (badge_rect.y - 20.0).abs() < 1e-6,
        "the badge hoists above the flow, got y {}",
        badge_rect.y
    );
    // The container's height is the flow's, not stretched by the badge.
    assert!(
        (pages[0].fragments.root.rect().height - 120.0).abs() < 1e-6,
        "the hoisted badge occupies no band, got {}",
        pages[0].fragments.root.rect().height
    );
}

#[test]
fn auto_width_floats_shrink_to_their_content() {
    use rito_style_contract::Float;
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
    let mut side_note = block_style(margin_px(0.0), margin_px(0.0));
    side_note.float = Float::Right;
    let layout = layout_table_with(2, |index| match index {
        0 => side_note,
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "note".to_owned(),
                    style,
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
    // The fixture provider reports max-content 100; in a 300px
    // containing block the float takes its preferred 100, not the
    // full width, and floats right against the edge.
    let pages = paginate(&context, &tree, ConstraintSpace::continuous(300.0));
    let children = box_children(&pages[0]);
    assert_eq!(children.len(), 1);
    let rect = children[0].rect();
    assert!(
        (rect.width - 100.0).abs() < 1e-6,
        "fit width, got {}",
        rect.width
    );
    assert!((rect.x - 200.0).abs() < 1e-6, "flush right, got {}", rect.x);

    // In a 60px containing block the preferred width no longer fits;
    // the float shrinks to the available space, floored by
    // min-content (10).
    let narrow = paginate(&context, &tree, ConstraintSpace::continuous(60.0));
    let children = box_children(&narrow[0]);
    let rect = children[0].rect();
    assert!(
        (rect.width - 60.0).abs() < 1e-6,
        "clamped to available, got {}",
        rect.width
    );
}

#[test]
fn paired_float_columns_sit_side_by_side() {
    use rito_style_contract::{Float, NonNegativeLengthPercentage, Percentage};
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
    let half_width = PreferredSize::Value(NonNegativeLengthPercentage::new(
        LengthPercentage::Percentage(Percentage::from_percent(49.0).expect("finite")),
    ));
    let mut column = block_style(margin_px(0.0), margin_px(0.0));
    column.width = half_width;
    let mut left_column = column;
    left_column.float = Float::Left;
    let mut right_column = column;
    right_column.float = Float::Right;
    let layout = layout_table_with(3, |index| match index {
        0 => left_column,
        1 => right_column,
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
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
        paragraph(0, 3), // left column: 30px
        paragraph(1, 5), // right column: 50px
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
    let pages = paginate(&context, &tree, ConstraintSpace::continuous(200.0));
    assert_eq!(pages.len(), 1);
    let children = box_children(&pages[0]);
    assert_eq!(children.len(), 2);
    let left = children[0].rect();
    let right = children[1].rect();
    assert!((left.x - 0.0).abs() < 1e-6, "left column at the left edge");
    assert!((left.width - 98.0).abs() < 1e-3);
    assert!(
        (right.x - (200.0 - 98.0)).abs() < 1e-3,
        "right column against the right edge, got {}",
        right.x
    );
    assert!((left.y - 0.0).abs() < 1e-6);
    assert!((right.y - 0.0).abs() < 1e-6, "columns share the band top");
    // The container contains its floats: height = the taller column.
    assert!((pages[0].fragments.root.rect().height - 50.0).abs() < 1e-6);
}

#[test]
fn content_beside_floats_clears_below_them() {
    use rito_style_contract::{Clear, Float, NonNegativeLengthPercentage, Percentage};
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
    let half_width = PreferredSize::Value(NonNegativeLengthPercentage::new(
        LengthPercentage::Percentage(Percentage::from_percent(40.0).expect("finite")),
    ));
    let mut float_style = block_style(margin_px(0.0), margin_px(0.0));
    float_style.width = half_width;
    float_style.float = Float::Left;
    let mut cleared = block_style(margin_px(0.0), margin_px(0.0));
    cleared.clear = Clear::Both;
    let build = |following: LayoutFormattingStyle| {
        let layout = layout_table_with(3, move |index| match index {
            0 => float_style,
            1 => following,
            _ => block_style(margin_px(0.0), margin_px(0.0)),
        });
        let mut inline_table = InlineStyleTable::new(1);
        let style_id = inline_table
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
        let paragraph = |node_index: usize, line_count: usize| FormattingNode {
            style: node_style_id(&layout, node_index),
            content: FormattingNodeContent::InlineFlow {
                items: (0..line_count)
                    .map(|line| InlineItem::Text {
                        text: format!("line {line}"),
                        style: style_id,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    })
                    .collect(),
            },
            children: Vec::new(),
        };
        let nodes = vec![
            paragraph(0, 4),
            paragraph(1, 2),
            FormattingNode {
                style: node_style_id(&layout, 2),
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(0), FormattingNodeId(1)],
            },
        ];
        FormattingTree::with_styles(
            nodes,
            FormattingNodeId(2),
            FormattingTreeStyles {
                layout,
                inline: inline_table,
            },
        )
        .expect("tree builds")
    };
    let _ = style;

    let cleared_tree = build(cleared);
    let pages = paginate(&context, &cleared_tree, ConstraintSpace::continuous(200.0));
    let children = box_children(&pages[0]);
    assert_eq!(children.len(), 2);
    assert!(
        (children[1].rect().y - 40.0).abs() < 1e-6,
        "cleared content starts below the 40px float, got {}",
        children[1].rect().y
    );

    // Un-cleared content sits beside the float: CSS shortens the line
    // boxes inside the float's band rather than moving the block box,
    // so the block itself still starts at the float's top.
    let beside_tree = build(block_style(margin_px(0.0), margin_px(0.0)));
    let pages = paginate(&context, &beside_tree, ConstraintSpace::continuous(200.0));
    let children = box_children(&pages[0]);
    assert_eq!(children.len(), 2);
    assert!(
        children[1].rect().y.abs() < 1e-6,
        "un-cleared content stays beside the float, got {}",
        children[1].rect().y
    );
}

/// A floated inline flow with its own padding: `space.inline_size` is
/// the border-box width by contract, so the inline provider must be
/// handed the CONTENT width (CSS 2.1 §9.4.2 — line boxes fill the
/// containing block's content area) and its lines must sit inside the
/// padding. Measured on the speech-bubble idiom (float + width% +
/// asymmetric padding + text-align:right) the engine's aligned lines
/// overshot Chromium's by exactly the horizontal padding sum.
#[test]
fn padded_float_inline_flow_lays_lines_in_the_content_box() {
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
    let pad = |px: f32| {
        NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(px).expect("padding length"),
        ))
    };
    let mut float_style = block_style(margin_px(0.0), margin_px(0.0));
    float_style.float = Float::Left;
    float_style.width =
        PreferredSize::Value(rito_style_contract::NonNegativeLengthPercentage::new(
            LengthPercentage::Length(CssPx::new(400.0).expect("width length")),
        ));
    float_style.padding = PhysicalSides {
        top: pad(3.0),
        right: pad(16.0),
        bottom: pad(9.0),
        left: pad(5.0),
    };
    let layout = layout_table_with(2, |index| {
        if index == 0 {
            float_style
        } else {
            block_style(margin_px(0.0), margin_px(0.0))
        }
    });
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "bubble".to_owned(),
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
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(500.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let Fragment::Box(float_box) = &root.children[0] else {
        panic!("float child is a box");
    };
    assert!(
        (float_box.rect.width - 421.0).abs() < 0.01,
        "float border box is content 400 + padding 21: {}",
        float_box.rect.width
    );
    let Fragment::Line(line) = &float_box.children[0] else {
        panic!("float content is lines, got {:?}", float_box.children[0]);
    };
    assert!(
        (line.rect.width - 400.0).abs() < 0.01,
        "the inline provider is handed the content width: {}",
        line.rect.width
    );
    assert!(
        (line.rect.x - 5.0).abs() < 0.01,
        "lines start after padding-left: {}",
        line.rect.x
    );
    assert!(
        (line.rect.y - 3.0).abs() < 0.01,
        "the first line sits below padding-top: {}",
        line.rect.y
    );
    assert!(
        (float_box.rect.height - 22.0).abs() < 0.01,
        "the float closes with its vertical padding (3 + 10 + 9): {}",
        float_box.rect.height
    );
}

/// Shrink-to-fit sizes a float's own content box (CSS 2.1 §10.3.5);
/// the margin-box contribution intrinsics answer what the box hands
/// its PARENT (css-sizing-3 §5.2). Leaking the float's own margins
/// into its border width is how a 72px icon float measured 104px wide
/// with `margin: -6em 2em 0 0` in a real TOC page.
#[test]
fn float_shrink_to_fit_excludes_the_floats_own_margins() {
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
    let mut float_style = block_style(margin_px(0.0), margin_px(0.0));
    float_style.float = Float::Right;
    float_style.margin.right = margin_px(32.0);
    let layout = layout_table_with(2, |index| {
        if index == 0 {
            float_style
        } else {
            block_style(margin_px(0.0), margin_px(0.0))
        }
    });
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "icon".to_owned(),
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
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(500.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let Fragment::Box(float_box) = &root.children[0] else {
        panic!("float child is a box");
    };
    // FixedLineInline reports max-content 100; the float's own 32px
    // margin must not widen its border box past that.
    assert!(
        (float_box.rect.width - 100.0).abs() < 0.01,
        "shrink-to-fit border width is the content fit, not fit + own margins: {}",
        float_box.rect.width
    );
    // The margin still positions the box: right margin insets it from
    // the right content edge.
    assert!(
        (float_box.rect.x - (500.0 - 100.0 - 32.0)).abs() < 0.01,
        "the right margin insets the float from the right edge: {}",
        float_box.rect.x
    );
}

/// A float that is itself a BLOCK CONTAINER shrinks to its content
/// fit too: the container intrinsics hand the parent a margin-box
/// contribution, and the float's own margins must come back out of
/// the fit (measured: a title page's float:right columns each with
/// `margin-left: 0.2em` doubled every inter-column gap).
#[test]
fn container_float_shrink_to_fit_excludes_its_own_margins() {
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
    let mut float_style = block_style(margin_px(0.0), margin_px(0.0));
    float_style.float = Float::Right;
    float_style.margin.left = margin_px(7.0);
    let layout = layout_table_with(3, |index| {
        if index == 1 {
            float_style
        } else {
            block_style(margin_px(0.0), margin_px(0.0))
        }
    });
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "icon".to_owned(),
                    style: text_style,
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        },
        // The float is a block CONTAINER (paragraph inside), so the
        // shrink-to-fit path queries container intrinsics.
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
            &ConstraintSpace::continuous(500.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let Fragment::Box(float_box) = &root.children[0] else {
        panic!("float child is a box");
    };
    // FixedLineInline reports max-content 100; the container float's
    // own 7px margin-left must not widen its border box.
    assert!(
        (float_box.rect.width - 100.0).abs() < 0.01,
        "container shrink-to-fit strips the float's own margins: {}",
        float_box.rect.width
    );
    assert!(
        (float_box.rect.x - (500.0 - 100.0)).abs() < 0.01,
        "a float:right box hugs the right edge; its margin-left stays outside: {}",
        float_box.rect.x
    );
}

/// The b51 title idiom: a float whose inner paragraphs carry their
/// own margins, an empty clearing spacer, then a margined block. The
/// cleared spacer's top is the float's margin-box bottom, and the
/// following block keeps its whole margin below that line.
#[test]
fn a_margined_block_after_a_cleared_spacer_keeps_its_full_margin() {
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
    let mut float_style = block_style(margin_px(0.0), margin_px(0.0));
    float_style.float = Float::Left;
    let mut spacer_style = block_style(margin_px(0.0), margin_px(0.0));
    spacer_style.clear = Clear::Both;
    let layout = layout_table_with(8, |index| match index {
        0 => block_style(margin_px(0.0), margin_px(0.0)),
        1 => block_style(margin_px(-4.0), margin_px(0.0)),
        2 => block_style(margin_px(6.0), margin_px(0.0)),
        3 => float_style,
        4 => spacer_style,
        5 => {
            let mut badge = block_style(margin_px(16.0), margin_px(16.0));
            badge.margin.left = LengthPercentageOrAuto::Auto;
            badge.margin.right = LengthPercentageOrAuto::Auto;
            badge.width = PreferredSize::Value(NonNegativeLengthPercentage::new(
                LengthPercentage::Length(CssPx::new(67.2).expect("finite")),
            ));
            badge.height = PreferredSize::Value(NonNegativeLengthPercentage::new(
                LengthPercentage::Length(CssPx::new(67.2).expect("finite")),
            ));
            badge.overflow = Overflow::Hidden;
            badge
        }
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    let paragraph = |node_index: usize| FormattingNode {
        style: node_style_id(&layout, node_index),
        content: FormattingNodeContent::InlineFlow {
            items: vec![InlineItem::Text {
                text: "line".to_owned(),
                style: text_style,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            }],
        },
        children: Vec::new(),
    };
    let nodes = vec![
        paragraph(0),
        paragraph(1),
        paragraph(2),
        FormattingNode {
            style: node_style_id(&layout, 3),
            content: FormattingNodeContent::BlockContainer,
            children: vec![
                FormattingNodeId(0),
                FormattingNodeId(1),
                FormattingNodeId(2),
            ],
        },
        FormattingNode {
            style: node_style_id(&layout, 4),
            content: FormattingNodeContent::InlineFlow { items: Vec::new() },
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 5),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(6)],
        },
        paragraph(6),
        FormattingNode {
            style: node_style_id(&layout, 7),
            content: FormattingNodeContent::BlockContainer,
            children: vec![
                FormattingNodeId(3),
                FormattingNodeId(4),
                FormattingNodeId(5),
            ],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(7),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(500.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root fragment is a box");
    };
    // Float content: 10 + (-4 + 10) + (6 + 10) = 32.
    let float_bottom = 32.0;
    let block = root
        .children
        .iter()
        .filter_map(|fragment| match fragment {
            Fragment::Box(node) => Some(node),
            _ => None,
        })
        .find(|node| node.source == FormattingNodeId(5))
        .map(|node| node.rect.y);
    let line = root
        .children
        .iter()
        .filter_map(|fragment| match fragment {
            Fragment::Line(fragment) => Some(fragment),
            _ => None,
        })
        .find(|fragment| fragment.source == FormattingNodeId(5))
        .map(|fragment| fragment.rect.y);
    let top = block.or(line).expect("the margined block laid out");
    assert!(
        (top - (float_bottom + 16.0)).abs() < 0.01,
        "the block after the cleared spacer keeps its full margin: {top} vs {}",
        float_bottom + 16.0
    );
}

/// A float's hypothetical flow position sits below the margin chain
/// of everything before it — including the margins of a `clear:both`
/// paragraph that had nothing to clear (the title-page idiom: content,
/// a clearing spacer, then a hoisted float whose big negative
/// margin-top anchors off that flow position).
#[test]
fn float_flow_position_includes_a_clear_paragraphs_margins() {
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
    let mut clear_style = block_style(margin_px(6.4), margin_px(6.4));
    clear_style.clear = Clear::Both;
    let mut hoisted = block_style(margin_px(-100.0), margin_px(0.0));
    hoisted.float = Float::Left;
    let layout = layout_table_with(4, |index| match index {
        1 => clear_style,
        2 => hoisted,
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    let paragraph = |node_index: usize| FormattingNode {
        style: node_style_id(&layout, node_index),
        content: FormattingNodeContent::InlineFlow {
            items: vec![InlineItem::Text {
                text: "line".to_owned(),
                style: text_style,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            }],
        },
        children: Vec::new(),
    };
    let nodes = vec![
        paragraph(0),
        paragraph(1),
        paragraph(2),
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
            &ConstraintSpace::continuous(500.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let Fragment::Box(float_box) = &root.children[2] else {
        panic!("third child is the float box");
    };
    // p0: 0..10. clear p: top margin 6.4 → 16.4..26.4, bottom margin
    // 6.4 pending. The float's hypothetical flow position is
    // 26.4 + 6.4 = 32.8; its -100 margin-top hoists the border box
    // to 32.8 - 100 = -67.2.
    assert!(
        (float_box.rect.y - (-67.2)).abs() < 0.05,
        "the float anchors below the clear paragraph's margin chain: {}",
        float_box.rect.y
    );
}

/// Clearance places the cleared content below the float's bottom
/// MARGIN edge (CSS 2.1 §9.5.2: "below the bottom outer edge"), not
/// its border bottom. Measured on the speech-bubble idiom: content
/// after `clear:both` sat exactly one `margin-bottom` too high.
#[test]
fn clearance_clears_the_floats_margin_edge() {
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
    let mut float_style = block_style(margin_px(0.0), margin_px(8.0));
    float_style.float = Float::Left;
    let mut clear_style = block_style(margin_px(0.0), margin_px(0.0));
    clear_style.clear = Clear::Both;
    let layout = layout_table_with(4, |index| match index {
        0 => float_style,
        1 => clear_style,
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    let flow = |style_index: usize| FormattingNode {
        style: node_style_id(&layout, style_index),
        content: FormattingNodeContent::InlineFlow {
            items: vec![InlineItem::Text {
                text: "line".to_owned(),
                style: text_style,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            }],
        },
        children: Vec::new(),
    };
    let nodes = vec![
        flow(0), // float, one 10px line, margin-bottom 8
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::BlockContainer,
            children: Vec::new(),
        }, // <div clear:both></div>
        flow(2), // following paragraph
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
            &ConstraintSpace::continuous(500.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let following = root
        .children
        .iter()
        .find_map(|fragment| match fragment {
            Fragment::Box(inner) if inner.source == FormattingNodeId(2) => Some(inner),
            _ => None,
        })
        .expect("following paragraph fragment");
    assert!(
        (following.rect.y - 18.0).abs() < 0.01,
        "cleared content starts below the float's margin edge (10 + 8): {}",
        following.rect.y
    );
}

/// A float's top sits at its hypothetical in-flow position (CSS 2.1
/// §9.5.1 rule 4), which lies below the preceding sibling's bottom
/// margin — float margins never collapse with siblings (§8.3.1).
/// Measured on the speech-bubble idiom: every float following a
/// margined paragraph sat exactly that margin too high.
#[test]
fn a_float_respects_the_preceding_siblings_bottom_margin() {
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
    let mut float_style = block_style(margin_px(0.0), margin_px(0.0));
    float_style.float = Float::Left;
    let layout = layout_table_with(3, |index| match index {
        0 => block_style(margin_px(0.0), margin_px(8.0)),
        1 => float_style,
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    let flow = |style_index: usize| FormattingNode {
        style: node_style_id(&layout, style_index),
        content: FormattingNodeContent::InlineFlow {
            items: vec![InlineItem::Text {
                text: "line".to_owned(),
                style: text_style,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            }],
        },
        children: Vec::new(),
    };
    let nodes = vec![
        flow(0), // one 10px line, margin-bottom 8
        flow(1), // float:left
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
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(500.0),
            None,
            &CancelFlag::new(),
        )
        .expect("layout succeeds");
    let Fragment::Box(root) = &outcome.fragments.root else {
        panic!("root is a box");
    };
    let float_box = root
        .children
        .iter()
        .find_map(|fragment| match fragment {
            Fragment::Box(inner) if inner.source == FormattingNodeId(1) => Some(inner),
            _ => None,
        })
        .expect("float fragment");
    assert!(
        (float_box.rect.y - 18.0).abs() < 0.01,
        "the float starts below the sibling's margin edge (10 + 8): {}",
        float_box.rect.y
    );
}
