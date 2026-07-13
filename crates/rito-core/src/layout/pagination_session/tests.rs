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
    assert_eq!(continuation.accepted_top_level_nodes, 1);
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
fn one_large_greedy_paragraph_resumes_by_line_without_publishing_a_partial_block() {
    let content = "A large paragraph now resumes between completed line boxes. ".repeat(400);
    let nodes = vec![paragraph(&content, 0.0, 0.0)];
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut session = session(&nodes, &images);
    let line_budget = budget_with_lines(1, 7);

    let first = session.advance(line_budget, &fonts);

    assert_eq!(first.status, LayoutAdvanceStatus::Partial);
    assert_eq!(first.processed_top_level_nodes, 1);
    assert!(first.output.is_empty());
    assert!(first.continuation.is_some());

    let mut advance_count = 1;
    let mut saw_zero_node_resume = false;
    let final_output = loop {
        let advance = session.advance(line_budget, &fonts);
        advance_count += 1;
        saw_zero_node_resume |= advance.processed_top_level_nodes == 0;
        if advance.status == LayoutAdvanceStatus::Complete {
            break advance.output;
        }
        assert!(advance.output.is_empty());
    };

    assert!(advance_count > 2);
    assert!(saw_zero_node_resume);
    assert_eq!(final_output, one_shot_blocks(&nodes));
}

#[test]
fn accepted_nodes_wait_in_source_order_behind_a_resumable_paragraph() {
    let nodes = vec![
        paragraph(&"queued long paragraph ".repeat(240), 0.0, 0.0),
        paragraph("second", 0.0, 0.0),
        paragraph("third", 0.0, 0.0),
    ];
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut session = session(&nodes, &images);
    let line_budget = budget_with_lines(3, 5);

    let first = session.advance(line_budget, &fonts);
    assert_eq!(first.status, LayoutAdvanceStatus::Partial);
    assert_eq!(first.processed_top_level_nodes, 3);
    assert!(first.output.is_empty());

    let mut actual = Vec::new();
    loop {
        let advance = session.advance(line_budget, &fonts);
        assert_eq!(advance.processed_top_level_nodes, 0);
        actual.extend(advance.output);
        if advance.status == LayoutAdvanceStatus::Complete {
            break;
        }
    }
    assert_eq!(actual, one_shot_blocks(&nodes));
}

#[test]
fn nested_and_optimal_paragraphs_remain_explicit_atomic_fallbacks() {
    let long = paragraph(&"still atomic inside a container ".repeat(240), 0.0, 0.0);
    let mut container = styled_node(StyledNodeKind::Block, vec![long.clone()]);
    container.tag = Some("section".to_owned());
    container.style.insert("display".to_owned(), json!("block"));
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();

    let mut nested = session(&[container.clone()], &images);
    let nested_result = nested.advance(budget_with_lines(1, 1), &fonts);
    assert_eq!(nested_result.status, LayoutAdvanceStatus::Complete);
    assert_eq!(nested_result.output, one_shot_blocks(&[container]));

    let mut optimal = ContinuousLayoutSession::new(
        vec![long.clone()],
        180.0,
        600.0,
        images,
        LineBreaking::Optimal,
    );
    let optimal_result = optimal.advance(budget_with_lines(1, 1), &fonts);
    assert_eq!(optimal_result.status, LayoutAdvanceStatus::Complete);
    assert_eq!(optimal_result.processed_top_level_nodes, 1);
    assert!(!optimal_result.output.is_empty());
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

fn budget_with_lines(max_nodes: usize, max_lines: usize) -> LayoutWorkBudget {
    LayoutWorkBudget::with_max_line_boxes(
        NonZeroUsize::new(max_nodes).expect("test node budget is non-zero"),
        NonZeroUsize::new(max_lines).expect("test line budget is non-zero"),
    )
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
