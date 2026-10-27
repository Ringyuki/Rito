//! A continuous layout that knows its fragmentainer, as a scrolled chapter
//! is laid out: a box positioned in the tree's unpositioned root resolves
//! against the initial containing block, which for continuous media has
//! the viewport's size (CSS 2.1 §10.1), the flow's first fragmentainer-tall
//! stretch; and a forced break, which only fragmentation honours, is run
//! through.

use super::*;

/// A root holding a block `tall` px high and, positioned at the bottom of
/// the root, a box holding a block 50 px high.
fn tree_with_a_bottom_box(tall: f64) -> FormattingTree {
    let mut layout = LayoutStyleTable::new(0);
    let plain = layout
        .intern(block_style(margin_px(0.0), margin_px(0.0)))
        .expect("style interns");
    let mut bottom = block_style(margin_px(0.0), margin_px(0.0));
    bottom.position = Position::Absolute;
    bottom.inset.bottom = margin_px(0.0);
    let bottom = layout.intern(bottom).expect("style interns");
    let leaf = |style, block_size| FormattingNode {
        style,
        content: FormattingNodeContent::SizedLeaf {
            block_size,
            breakable: false,
        },
        children: Vec::new(),
    };
    let container = |style, children: Vec<u32>| FormattingNode {
        style,
        content: FormattingNodeContent::BlockContainer,
        children: children.into_iter().map(FormattingNodeId).collect(),
    };
    FormattingTree::with_styles(
        vec![
            leaf(plain, tall),
            leaf(plain, 50.0),
            container(bottom, vec![1]),
            container(plain, vec![0, 2]),
        ],
        FormattingNodeId(3),
        FormattingTreeStyles {
            layout,
            inline: InlineStyleTable::new(0),
        },
    )
    .expect("tree builds")
}

fn bottom_box_top(space: &ConstraintSpace) -> f64 {
    let context = BlockFormattingContext::new(FixedLineInline);
    let tree = tree_with_a_bottom_box(2000.0);
    let outcome = context
        .layout(&tree, tree.root(), space, None, &CancelFlag::new())
        .expect("tree lays out");
    box_children(&outcome)
        .last()
        .expect("the positioned box joins the root")
        .rect()
        .y
}

#[test]
fn a_box_positioned_in_the_root_of_a_continuous_layout_sits_in_its_first_viewport() {
    let viewport = ConstraintSpace {
        fragmentainer_size: Some(500.0),
        ..ConstraintSpace::continuous(300.0)
    };
    assert_eq!(bottom_box_top(&viewport), 450.0);
    // Not knowing the fragmentainer, the root's own box is the block.
    assert_eq!(bottom_box_top(&ConstraintSpace::continuous(300.0)), 1950.0);
}

#[test]
fn a_continuous_layout_runs_on_through_a_forced_break() {
    let mut layout = LayoutStyleTable::new(0);
    let plain = layout
        .intern(block_style(margin_px(0.0), margin_px(0.0)))
        .expect("style interns");
    let mut forced = block_style(margin_px(0.0), margin_px(0.0));
    forced.break_before = PageBreak::Always;
    let forced = layout.intern(forced).expect("style interns");
    let leaf = |style| FormattingNode {
        style,
        content: FormattingNodeContent::SizedLeaf {
            block_size: 100.0,
            breakable: false,
        },
        children: Vec::new(),
    };
    let tree = FormattingTree::with_styles(
        vec![
            leaf(plain),
            leaf(forced),
            FormattingNode {
                style: plain,
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(0), FormattingNodeId(1)],
            },
        ],
        FormattingNodeId(2),
        FormattingTreeStyles {
            layout,
            inline: InlineStyleTable::new(0),
        },
    )
    .expect("tree builds");
    let viewport = ConstraintSpace {
        fragmentainer_size: Some(500.0),
        ..ConstraintSpace::continuous(300.0)
    };
    let outcome = BlockFormattingContext::new(FixedLineInline)
        .layout(&tree, tree.root(), &viewport, None, &CancelFlag::new())
        .expect("tree lays out");
    assert!(
        outcome.continuation.is_none(),
        "a continuous layout never breaks"
    );
    let tops: Vec<f64> = box_children(&outcome)
        .iter()
        .map(|child| child.rect().y)
        .collect();
    assert_eq!(tops, [0.0, 100.0]);
}
