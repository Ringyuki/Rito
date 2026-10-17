//! Zero-height boxes take no block space: a fragmentainer holding only
//! them is still at its start, so they never cost a page. A forced break
//! is the exception, since any earlier sibling satisfies it. Each case
//! is pinned to the column count Chromium multicol lays out for the same
//! markup.

use super::*;

/// What a test tree is built from, in node order; the last entry is the
/// root container.
enum Node {
    /// A container with no children: a zero-height box like
    /// `<div><a id="tp"></a></div>`.
    Empty,
    /// A paragraph of one 10px line.
    Line,
    /// An unbreakable block of the given height.
    Monolith(f64),
    /// A container of the given nodes.
    Container(Vec<u32>),
}

fn tree(nodes: Vec<(Node, LayoutFormattingStyle)>) -> FormattingTree {
    let mut inline = InlineStyleTable::new(nodes.len());
    let text_style = inline
        .intern(plain_paragraph_style(
            FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                .expect("family list"),
            16.0,
            0.0,
        ))
        .expect("style interns");
    let mut layout = LayoutStyleTable::new(0);
    let root = nodes.len() as u32 - 1;
    let nodes = nodes
        .into_iter()
        .map(|(node, style)| {
            let style = layout.intern(style).expect("style interns");
            let (content, children) = match node {
                Node::Empty => (FormattingNodeContent::BlockContainer, Vec::new()),
                Node::Line => (
                    FormattingNodeContent::InlineFlow {
                        items: vec![InlineItem::Text {
                            text: "plate".to_owned(),
                            style: text_style,
                            baseline_shift_px: 0.0,
                            ruby_annotation: None,
                        }],
                    },
                    Vec::new(),
                ),
                Node::Monolith(block_size) => (
                    FormattingNodeContent::SizedLeaf {
                        block_size,
                        breakable: false,
                    },
                    Vec::new(),
                ),
                Node::Container(children) => (
                    FormattingNodeContent::BlockContainer,
                    children.into_iter().map(FormattingNodeId).collect(),
                ),
            };
            FormattingNode {
                style,
                content,
                children,
            }
        })
        .collect();
    FormattingTree::with_styles(
        nodes,
        FormattingNodeId(root),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds")
}

fn plain() -> LayoutFormattingStyle {
    block_style(margin_px(0.0), margin_px(0.0))
}

fn heights(page: &LayoutOutcome) -> Vec<f64> {
    box_children(page)
        .iter()
        .map(|child| child.rect().height)
        .collect()
}

#[test]
fn empty_boxes_ahead_of_a_page_tall_line_cost_no_page() {
    // An empty anchor `<div>` (or two) before a plate whose line box,
    // image plus strut descent, overflows the page: Chromium lays it all
    // in ONE column, the line overflowing in place. Counting the empty
    // box as content broke before the line and left a blank page.
    let context = BlockFormattingContext::new(FixedLineInline);
    for empties in 1..=2 {
        let mut nodes: Vec<(Node, LayoutFormattingStyle)> =
            (0..empties).map(|_| (Node::Empty, plain())).collect();
        nodes.push((Node::Line, plain()));
        nodes.push((Node::Container((0..=empties).collect()), plain()));
        let pages = paginate(
            &context,
            &tree(nodes),
            ConstraintSpace::fragmented(100.0, 8.0),
        );
        assert_eq!(pages.len(), 1, "{empties} empty box(es): one page");
        let children = box_children(&pages[0]);
        assert_eq!(children.len(), empties as usize + 1);
        let Fragment::Box(paragraph) = &children[empties as usize] else {
            panic!("paragraph fragment is a box");
        };
        assert_eq!(paragraph.children.len(), 1, "the line overflows in place");
    }
}

#[test]
fn an_empty_box_ahead_of_a_page_tall_monolith_costs_no_page() {
    // Chromium: an empty `<div>` then a 900px block in 850px columns is
    // one column, the block overflowing.
    let context = BlockFormattingContext::new(FixedLineInline);
    let nodes = vec![
        (Node::Empty, plain()),
        (Node::Monolith(120.0), plain()),
        (Node::Container(vec![0, 1]), plain()),
    ];
    let pages = paginate(
        &context,
        &tree(nodes),
        ConstraintSpace::fragmented(100.0, 100.0),
    );
    assert_eq!(pages.len(), 1);
    assert_eq!(heights(&pages[0]), vec![0.0, 120.0]);
}

#[test]
fn an_empty_box_keeps_a_padded_wrappers_head_on_the_first_page() {
    // Chromium: an empty `<div>` then a plate inside a 2px-padded wrapper
    // is two columns, the 2px padding alone in the first and the plate
    // opening the second. Moving the whole wrapper past the empty box
    // added a blank page ahead of the padding-only one.
    let context = BlockFormattingContext::new(FixedLineInline);
    let mut padded = plain();
    padded.padding.top = NonNegativeLengthPercentage::new(LengthPercentage::Length(
        CssPx::new(2.0).expect("finite"),
    ));
    let nodes = vec![
        (Node::Empty, plain()),
        (Node::Line, plain()),
        (Node::Container(vec![1]), padded),
        (Node::Container(vec![0, 2]), plain()),
    ];
    let pages = paginate(
        &context,
        &tree(nodes),
        ConstraintSpace::fragmented(100.0, 8.0),
    );
    assert_eq!(pages.len(), 2);
    assert_eq!(
        heights(&pages[0]),
        vec![0.0, 2.0],
        "empty box, padding-only head"
    );
    let second = box_children(&pages[1]);
    assert_eq!(second.len(), 1);
    let Fragment::Box(wrapper) = &second[0] else {
        panic!("wrapper fragment is a box");
    };
    assert_eq!(wrapper.children.len(), 1, "the plate opens the second page");
}

#[test]
fn an_empty_boxs_margin_still_takes_space() {
    // Chromium: an empty `<div>` with a 20px bottom margin then a plate is
    // two columns. The margin is space, so the plate breaks to a fresh
    // page instead of overflowing below it.
    let context = BlockFormattingContext::new(FixedLineInline);
    let nodes = vec![
        (Node::Empty, block_style(margin_px(0.0), margin_px(2.0))),
        (Node::Line, plain()),
        (Node::Container(vec![0, 1]), plain()),
    ];
    let pages = paginate(
        &context,
        &tree(nodes),
        ConstraintSpace::fragmented(100.0, 8.0),
    );
    assert_eq!(pages.len(), 2);
    assert_eq!(heights(&pages[0]), vec![0.0]);
    assert_eq!(heights(&pages[1]), vec![10.0]);
}

#[test]
fn a_forced_break_after_an_empty_box_still_breaks() {
    // Chromium: an empty `<div>` then `break-before: column` is two
    // columns, the first holding only the empty box.
    let context = BlockFormattingContext::new(FixedLineInline);
    let mut breaking = plain();
    breaking.break_before = PageBreak::Always;
    let nodes = vec![
        (Node::Empty, plain()),
        (Node::Line, breaking),
        (Node::Container(vec![0, 1]), plain()),
    ];
    let pages = paginate(
        &context,
        &tree(nodes),
        ConstraintSpace::fragmented(100.0, 100.0),
    );
    assert_eq!(pages.len(), 2);
    assert_eq!(heights(&pages[0]), vec![0.0]);
    assert_eq!(heights(&pages[1]), vec![10.0]);
}
