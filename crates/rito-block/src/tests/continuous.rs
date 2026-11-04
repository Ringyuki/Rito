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

/// Lays lines out as [`FixedLineInline`] does, noting the line text each
/// flow is asked for.
struct NotingInline(std::rc::Rc<std::cell::RefCell<Vec<(FormattingNodeId, LineText)>>>);

impl FormattingContext for NotingInline {
    fn layout(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
        space: &ConstraintSpace,
        token: Option<&BreakToken>,
        cancel: &CancelFlag,
    ) -> Result<LayoutOutcome, LayoutError> {
        self.0.borrow_mut().push((node, space.line_text));
        FixedLineInline.layout(tree, node, space, token, cancel)
    }

    fn intrinsic_inline_sizes(
        &self,
        tree: &FormattingTree,
        node: FormattingNodeId,
    ) -> Result<IntrinsicInlineSizes, LayoutError> {
        FixedLineInline.intrinsic_inline_sizes(tree, node)
    }
}

fn padded_top(px: f32) -> LayoutFormattingStyle {
    let mut style = block_style(margin_px(0.0), margin_px(0.0));
    style.padding.top =
        NonNegativeLengthPercentage::new(LengthPercentage::Length(CssPx::new(px).expect("finite")));
    style
}

/// The line text each flow of `tree` is asked for, laid out continuously
/// under `line_text`.
fn line_text_asked(
    tree: &FormattingTree,
    line_text: LineText,
) -> Vec<(FormattingNodeId, LineText)> {
    let asked = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let context = BlockFormattingContext::new(NotingInline(std::rc::Rc::clone(&asked)));
    let space = ConstraintSpace {
        line_text,
        ..ConstraintSpace::continuous(300.0)
    };
    context
        .layout(tree, tree.root(), &space, None, &CancelFlag::new())
        .expect("tree lays out");
    asked.take()
}

fn text_items(inline: &mut InlineStyleTable, count: usize) -> FormattingNodeContent {
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
    FormattingNodeContent::InlineFlow {
        items: (0..count)
            .map(|line| InlineItem::Text {
                text: format!("line {line}"),
                style,
                baseline_shift_px: 0.0,
                ruby_annotation: None,
            })
            .collect(),
    }
}

#[test]
fn a_range_of_lines_reaches_a_nested_flow_in_its_own_coordinates() {
    // A 100 px block, then a box with 20 px of top padding holding a 30 px
    // block and a paragraph: the paragraph's lines start 150 px down.
    let mut layout = LayoutStyleTable::new(0);
    let plain = layout
        .intern(block_style(margin_px(0.0), margin_px(0.0)))
        .expect("style interns");
    let padded = layout.intern(padded_top(20.0)).expect("style interns");
    let mut inline = InlineStyleTable::new(1);
    let leaf = |block_size| FormattingNode {
        style: plain,
        content: FormattingNodeContent::SizedLeaf {
            block_size,
            breakable: false,
        },
        children: Vec::new(),
    };
    let tree = FormattingTree::with_styles(
        vec![
            leaf(100.0),
            leaf(30.0),
            FormattingNode {
                style: plain,
                content: text_items(&mut inline, 3),
                children: Vec::new(),
            },
            FormattingNode {
                style: padded,
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(1), FormattingNodeId(2)],
            },
            FormattingNode {
                style: plain,
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(0), FormattingNodeId(3)],
            },
        ],
        FormattingNodeId(4),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    assert_eq!(
        line_text_asked(
            &tree,
            LineText::Within {
                top: 160.0,
                bottom: 170.0
            }
        ),
        [(
            FormattingNodeId(2),
            LineText::Within {
                top: 10.0,
                bottom: 20.0
            }
        )]
    );
    assert_eq!(
        line_text_asked(&tree, LineText::All),
        [(FormattingNodeId(2), LineText::All)]
    );
}

#[test]
fn a_range_of_lines_reaches_a_padded_paragraph_below_its_padding() {
    let mut layout = LayoutStyleTable::new(0);
    let padded = layout.intern(padded_top(12.0)).expect("style interns");
    let mut inline = InlineStyleTable::new(1);
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: padded,
            content: text_items(&mut inline, 2),
            children: Vec::new(),
        }],
        FormattingNodeId(0),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    assert_eq!(
        line_text_asked(
            &tree,
            LineText::Within {
                top: 20.0,
                bottom: 30.0
            }
        ),
        [(
            FormattingNodeId(0),
            LineText::Within {
                top: 8.0,
                bottom: 18.0
            }
        )]
    );
}

#[test]
fn a_flex_paragraph_that_centres_its_lines_holds_all_their_text() {
    // Its lines move once they are laid out, so no range can say which of
    // them a window reaches.
    let mut layout = LayoutStyleTable::new(0);
    let plain = layout
        .intern(block_style(margin_px(0.0), margin_px(0.0)))
        .expect("style interns");
    let mut centring = block_style(margin_px(0.0), margin_px(0.0));
    centring.display.inside = LayoutDisplayInside::Flex;
    centring.align_items = AlignItems::Center;
    let centring = layout.intern(centring).expect("style interns");
    let mut inline = InlineStyleTable::new(1);
    let tree = FormattingTree::with_styles(
        vec![
            FormattingNode {
                style: centring,
                content: text_items(&mut inline, 2),
                children: Vec::new(),
            },
            FormattingNode {
                style: plain,
                content: FormattingNodeContent::BlockContainer,
                children: vec![FormattingNodeId(0)],
            },
        ],
        FormattingNodeId(1),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    assert_eq!(
        line_text_asked(
            &tree,
            LineText::Within {
                top: 0.0,
                bottom: 5.0
            }
        ),
        [(FormattingNodeId(0), LineText::All)]
    );
}
