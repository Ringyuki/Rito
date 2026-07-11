use std::num::NonZeroUsize;

use serde_json::{json, Map, Value};

use super::{ContinuousLayoutSession, LayoutAdvanceStatus, LayoutWorkBudget};
use crate::{
    layout::{
        content::RuntimeBlock,
        continuous_layout::{layout_continuous_nodes_at, ContinuousTextLayout},
        image_size::ImageSizeIndex,
        line::LineBox,
        LineBreaking, TextMeasurementFonts,
    },
    style::{StyledNode, StyledNodeKind},
};

type TestBlock = RuntimeBlock<LineBox>;

#[test]
fn small_and_large_budgets_exactly_match_one_shot_layout() {
    let nodes = vec![
        paragraph("First paragraph wraps over more than one line.", 3.0, 17.0),
        paragraph("Second paragraph keeps collapsed margin state.", 11.0, 4.0),
        paragraph("Third paragraph completes the chapter.", 2.0, 0.0),
    ];
    let expected = one_shot_blocks(&nodes);

    let small = session_blocks(&nodes, 1);
    let large = session_blocks(&nodes, 64);

    assert_eq!(small, expected);
    assert_eq!(large, expected);
    assert_eq!(small, large);
}

#[test]
fn partial_continuations_are_deterministic() {
    let nodes = vec![
        paragraph("one", 0.0, 0.0),
        paragraph("two", 0.0, 0.0),
        paragraph("three", 0.0, 0.0),
    ];
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut first = session(&nodes, &images);
    let mut matching = session(&nodes, &images);

    let first_advance = first.advance(budget(1), &fonts);
    let matching_advance = matching.advance(budget(1), &fonts);

    assert_eq!(first_advance, matching_advance);
    assert_eq!(first_advance.status, LayoutAdvanceStatus::Partial);
    assert_eq!(first_advance.processed_top_level_nodes, 1);
    let continuation = first_advance
        .continuation
        .expect("two top-level nodes remain");
    assert_eq!(continuation.completed_top_level_nodes, 1);
    assert_eq!(continuation.total_top_level_nodes, 3);

    let next = first.advance(budget(1), &fonts);
    assert_eq!(next.status, LayoutAdvanceStatus::Partial);
    assert_ne!(next.continuation, Some(continuation));
}

#[test]
fn floats_and_margins_survive_an_advance_boundary() {
    let mut floated = paragraph("floated", 0.0, 0.0);
    floated.style.extend([
        ("float".to_owned(), json!("left")),
        ("width".to_owned(), json!(64)),
    ]);
    let nodes = vec![
        floated,
        paragraph(
            "Follower text must flow beside the float instead of restarting layout state.",
            0.0,
            13.0,
        ),
        paragraph("Collapsed margin follows in another batch.", 9.0, 0.0),
    ];
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut session = session(&nodes, &images);

    let first = session.advance(budget(1), &fonts);
    let second = session.advance(budget(1), &fonts);
    let third = session.advance(budget(1), &fonts);

    assert_eq!(first.status, LayoutAdvanceStatus::Partial);
    assert_eq!(second.status, LayoutAdvanceStatus::Partial);
    assert_eq!(third.status, LayoutAdvanceStatus::Complete);
    assert!(second.output[0].x > 0.0, "the active float offsets text");
    let mut actual = first.output;
    actual.extend(second.output);
    actual.extend(third.output);
    assert_eq!(actual, one_shot_blocks(&nodes));
}

#[test]
fn anonymous_inline_runs_resume_without_changing_grouping() {
    let nodes = vec![
        text("anonymous "),
        inline("inline run"),
        paragraph("following block", 0.0, 0.0),
    ];
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut session = session(&nodes, &images);

    let first = session.advance(budget(1), &fonts);
    let second = session.advance(budget(1), &fonts);
    let third = session.advance(budget(1), &fonts);

    assert!(
        first.output.is_empty(),
        "the inline boundary is not known yet"
    );
    assert_eq!(first.processed_top_level_nodes, 1);
    assert_eq!(
        second.output.len(),
        1,
        "the anonymous block is now complete"
    );
    assert_eq!(second.processed_top_level_nodes, 1);
    assert_eq!(third.status, LayoutAdvanceStatus::Complete);
    let mut actual = first.output;
    actual.extend(second.output);
    actual.extend(third.output);
    assert_eq!(actual, one_shot_blocks(&nodes));
}

#[test]
fn one_large_paragraph_is_deliberately_atomic() {
    let content = "A large paragraph remains one atomic top-level node. ".repeat(400);
    let nodes = vec![paragraph(&content, 0.0, 0.0)];
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut session = session(&nodes, &images);

    let result = session.advance(budget(1), &fonts);

    assert_eq!(result.status, LayoutAdvanceStatus::Complete);
    assert_eq!(result.processed_top_level_nodes, 1);
    assert!(result.continuation.is_none());
    assert_eq!(result.output, one_shot_blocks(&nodes));
}

#[test]
fn empty_session_completes_without_work() {
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut session = session(&[], &images);

    let result = session.advance(budget(1), &fonts);

    assert_eq!(result.status, LayoutAdvanceStatus::Complete);
    assert_eq!(result.processed_top_level_nodes, 0);
    assert!(result.continuation.is_none());
    assert!(result.output.is_empty());
}

fn session(nodes: &[StyledNode], images: &ImageSizeIndex) -> ContinuousLayoutSession {
    ContinuousLayoutSession::new(
        nodes.to_vec(),
        180.0,
        600.0,
        images.clone(),
        LineBreaking::Greedy,
    )
}

fn session_blocks(nodes: &[StyledNode], max_nodes: usize) -> Vec<TestBlock> {
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut session = session(nodes, &images);
    let mut blocks = Vec::new();
    loop {
        let result = session.advance(budget(max_nodes), &fonts);
        assert!(result.processed_top_level_nodes <= max_nodes);
        blocks.extend(result.output);
        if result.status == LayoutAdvanceStatus::Complete {
            return blocks;
        }
    }
}

fn one_shot_blocks(nodes: &[StyledNode]) -> Vec<TestBlock> {
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut list_ctx = None;
    layout_continuous_nodes_at(
        nodes,
        180.0,
        600.0,
        0.0,
        &images,
        ContinuousTextLayout {
            line_breaking: LineBreaking::Greedy,
            fonts: &fonts,
        },
        &mut list_ctx,
    )
}

fn budget(max_nodes: usize) -> LayoutWorkBudget {
    LayoutWorkBudget::new(NonZeroUsize::new(max_nodes).expect("test budget is non-zero"))
}

fn paragraph(content: &str, margin_top: f64, margin_bottom: f64) -> StyledNode {
    let mut node = styled_node(StyledNodeKind::Block, vec![text(content)]);
    node.tag = Some("p".to_owned());
    node.style.extend([
        ("display".to_owned(), json!("block")),
        ("marginTop".to_owned(), json!(margin_top)),
        ("marginBottom".to_owned(), json!(margin_bottom)),
    ]);
    node
}

fn inline(content: &str) -> StyledNode {
    let mut node = styled_node(StyledNodeKind::Inline, vec![text(content)]);
    node.tag = Some("span".to_owned());
    node
}

fn text(content: &str) -> StyledNode {
    let mut node = styled_node(StyledNodeKind::Text, Vec::new());
    node.content = Some(content.to_owned());
    node
}

fn styled_node(node_type: StyledNodeKind, children: Vec<StyledNode>) -> StyledNode {
    StyledNode {
        node_type,
        tag: None,
        content: None,
        source_text: None,
        src: None,
        alt: None,
        id: None,
        href: None,
        colspan: None,
        rowspan: None,
        style: base_style(),
        children,
        source_ref: None,
    }
}

fn base_style() -> Map<String, Value> {
    Map::from_iter([
        ("fontSize".to_owned(), json!(16)),
        ("lineHeight".to_owned(), json!(1.25)),
        ("lineHeightPx".to_owned(), json!(20)),
        ("marginTop".to_owned(), json!(0)),
        ("marginBottom".to_owned(), json!(0)),
    ])
}
