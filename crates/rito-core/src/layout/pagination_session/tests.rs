use std::num::NonZeroUsize;

use serde_json::{json, Map, Value};

use super::{ContinuousLayoutSession, LayoutAdvanceStatus, LayoutWorkBudget};
use crate::{
    layout::{
        content::{RuntimeBlock, RuntimeChild},
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
    assert_eq!(first.status, LayoutAdvanceStatus::Partial);
    assert_eq!(first.processed_top_level_nodes, 1);
    assert_eq!(first.output.len(), 1, "the float finishes first");
    let mut actual = first.output;
    let mut completed = false;
    for _ in 0..8 {
        let advance = session.advance(budget(1), &fonts);
        let complete = advance.status == LayoutAdvanceStatus::Complete;
        actual.extend(advance.output);
        if complete {
            completed = true;
            break;
        }
    }

    assert!(completed, "the bounded session must complete");
    assert_eq!(actual.len(), 3, "all three blocks must finish");
    assert!(actual[1].x > 0.0, "the active float offsets text");
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
fn text_work_budget_resumes_inside_a_nowrap_run_without_partial_output() {
    let mut long = paragraph(&"text-work-budget ".repeat(40), 0.0, 0.0);
    long.style.insert("whiteSpace".to_owned(), json!("nowrap"));
    let nodes = vec![long];
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut session = session(&nodes, &images);
    let work = budget_with_text_work(1, 16, 1);

    let first = session.advance(work, &fonts);
    assert_eq!(first.status, LayoutAdvanceStatus::Partial);
    assert_eq!(first.processed_top_level_nodes, 1);
    assert!(first.output.is_empty());

    let mut advance_count = 1;
    let final_output = loop {
        let advance = session.advance(work, &fonts);
        advance_count += 1;
        assert!(advance_count < 1_000, "text layout must not livelock");
        assert_eq!(advance.processed_top_level_nodes, 0);
        if advance.status == LayoutAdvanceStatus::Complete {
            break advance.output;
        }
        assert!(advance.output.is_empty());
    };

    assert!(advance_count > 10);
    assert_eq!(final_output, one_shot_blocks(&nodes));
}

#[test]
fn tiny_text_quantum_resumes_nested_mapping_context_and_lines_without_partial_output() {
    let leaf = paragraph(
        &"mapping assembly inside a transparent descendant 😀 ".repeat(3),
        0.0,
        0.0,
    );
    let nodes = vec![container("outer", vec![container("inner", vec![leaf])])];
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut layout = session(&nodes, &images);
    let work = budget_with_text_work(1, 1, 64);

    let first = layout.advance(work, &fonts);
    assert_eq!(first.status, LayoutAdvanceStatus::Partial);
    assert_eq!(first.processed_top_level_nodes, 1);
    assert!(first.output.is_empty());

    let mut advances = 1;
    let final_output = loop {
        let advance = layout.advance(work, &fonts);
        advances += 1;
        assert!(
            advances < 10_000,
            "mapping, line-context preparation and line layout must not livelock"
        );
        assert_eq!(advance.processed_top_level_nodes, 0);
        if advance.status == LayoutAdvanceStatus::Complete {
            break advance.output;
        }
        assert!(advance.output.is_empty());
    };

    assert!(advances > 10);
    assert!(final_output.iter().map(block_line_count).sum::<usize>() > 1);
    assert_eq!(final_output, one_shot_blocks(&nodes));
}

#[test]
#[should_panic(expected = "continuous leaf session must resume with the same font profile")]
fn mapping_continuation_rejects_a_different_font_profile() {
    let nodes = vec![paragraph(
        "mapping must retain the font profile before line context exists",
        0.0,
        0.0,
    )];
    let images = ImageSizeIndex::new(&[]);
    let mut layout = session(&nodes, &images);
    let work = budget_with_text_work(1, 1, 64);

    let first = layout.advance(work, &TextMeasurementFonts::empty());
    assert_eq!(first.status, LayoutAdvanceStatus::Partial);
    assert!(first.output.is_empty());

    let _ = layout.advance(work, &TextMeasurementFonts::font_aware_empty());
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
fn nested_greedy_paragraph_resumes_and_exactly_matches_one_shot() {
    let long = paragraph(&"resumable inside a container ".repeat(240), 0.0, 0.0);
    let mut container = styled_node(StyledNodeKind::Block, vec![long]);
    container.tag = Some("section".to_owned());
    container.style.insert("display".to_owned(), json!("block"));
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let nodes = vec![container];
    let mut nested = session(&nodes, &images);
    let work = budget_with_lines(1, 1);

    let first = nested.advance(work, &fonts);
    assert_eq!(first.status, LayoutAdvanceStatus::Partial);
    assert_eq!(first.processed_top_level_nodes, 1);
    assert!(first.output.is_empty());

    let mut advances = 1;
    let mut output = Vec::new();
    loop {
        let advance = nested.advance(work, &fonts);
        advances += 1;
        assert_eq!(advance.processed_top_level_nodes, 0);
        output.extend(advance.output);
        if advance.status == LayoutAdvanceStatus::Complete {
            break;
        }
    }
    assert!(advances > 2);
    assert_eq!(output, one_shot_blocks(&nodes));
}

#[test]
fn descendant_node_budget_is_shared_across_recursive_containers() {
    let leaf = paragraph("deep leaf", 0.0, 0.0);
    let nodes = vec![container(
        "outer",
        vec![container("middle", vec![container("inner", vec![leaf])])],
    )];
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut nested = session(&nodes, &images);
    let work = budget_with_work_limits(1, 1, 64);

    for expected_processed in [1, 0] {
        let advance = nested.advance(work, &fonts);
        assert_eq!(advance.status, LayoutAdvanceStatus::Partial);
        assert_eq!(advance.processed_top_level_nodes, expected_processed);
        assert!(advance.output.is_empty());
    }
    let final_advance = nested.advance(work, &fonts);
    assert_eq!(final_advance.status, LayoutAdvanceStatus::Complete);
    assert_eq!(final_advance.processed_top_level_nodes, 0);
    assert_eq!(final_advance.output, one_shot_blocks(&nodes));
}

#[test]
fn line_budget_is_shared_between_parent_and_nested_child_sessions() {
    let nested = container(
        "outer",
        vec![
            paragraph("first line", 0.0, 0.0),
            container("inner", vec![paragraph("second nested line", 0.0, 0.0)]),
        ],
    );
    let nodes = vec![nested];
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut layout = session(&nodes, &images);
    let work = budget_with_work_limits(1, 64, 1);

    let first = layout.advance(work, &fonts);
    assert_eq!(first.status, LayoutAdvanceStatus::Partial);
    assert_eq!(first.processed_top_level_nodes, 1);
    assert!(first.output.is_empty());

    let second = layout.advance(work, &fonts);
    assert_eq!(second.status, LayoutAdvanceStatus::Complete);
    assert_eq!(second.processed_top_level_nodes, 0);
    assert_eq!(second.output, one_shot_blocks(&nodes));
}

#[test]
fn flattened_container_streams_with_a_safe_tail_and_preserves_outer_semantics() {
    let first = paragraph("first child", 5.0, 7.0);
    let second = paragraph("second child", 11.0, 13.0);
    let mut ignored = paragraph("ignored absolute child", 0.0, 0.0);
    ignored
        .style
        .insert("position".to_owned(), json!("absolute"));
    let mut outer = container("section", vec![first, second, ignored]);
    outer.id = Some("outer-anchor".to_owned());
    outer.style.extend([
        ("marginTop".to_owned(), json!(17)),
        ("marginBottom".to_owned(), json!(19)),
        ("marginLeft".to_owned(), json!(9)),
        ("paddingLeft".to_owned(), json!(6)),
        ("paddingBottom".to_owned(), json!(4)),
        ("pageBreakBefore".to_owned(), json!("always")),
        ("pageBreakAfter".to_owned(), json!("always")),
    ]);
    let nodes = vec![outer, paragraph("following sibling", 3.0, 0.0)];
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut layout = session(&nodes, &images);
    let work = budget_with_work_limits(1, 1, 64);

    let first = layout.advance(work, &fonts);
    assert_eq!(first.processed_top_level_nodes, 1);
    assert!(first.output.is_empty(), "the first child remains the tail");

    let second = layout.advance(work, &fonts);
    assert_eq!(second.processed_top_level_nodes, 0);
    assert_eq!(second.output.len(), 1);
    assert_eq!(second.output[0].anchor_id.as_deref(), Some("outer-anchor"));
    assert!(second.output[0].page_break_before);
    assert!(!second.output[0].page_break_after);

    let third = layout.advance(work, &fonts);
    assert_eq!(third.status, LayoutAdvanceStatus::Complete);
    assert_eq!(third.processed_top_level_nodes, 1);
    assert_eq!(third.output.len(), 2);
    assert!(third.output[0].page_break_after);

    let mut actual = first.output;
    actual.extend(second.output);
    actual.extend(third.output);
    assert_eq!(actual, one_shot_blocks(&nodes));
}

#[test]
fn nested_transparent_container_borrows_and_restores_list_context() {
    let nested = container("div", vec![list_item("second")]);
    let mut list = container("ol", vec![list_item("first"), nested, list_item("third")]);
    list.style
        .insert("listStyleType".to_owned(), json!("decimal"));
    let nodes = vec![list];

    let actual = session_blocks_with_budget(&nodes, budget_with_work_limits(1, 1, 64));
    assert_eq!(actual, one_shot_blocks(&nodes));
}

#[test]
fn decorated_nested_and_optimal_paragraphs_remain_atomic_fallbacks() {
    let long = paragraph(
        &"still atomic inside a decorated container ".repeat(240),
        0.0,
        0.0,
    );
    let mut decorated = container("section", vec![long.clone()]);
    decorated
        .style
        .insert("backgroundColor".to_owned(), json!("#ffffff"));
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();

    let mut nested = session(&[decorated.clone()], &images);
    let nested_result = nested.advance(budget_with_lines(1, 1), &fonts);
    assert_eq!(nested_result.status, LayoutAdvanceStatus::Complete);
    assert_eq!(nested_result.output, one_shot_blocks(&[decorated]));

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
    session_blocks_with_budget(nodes, budget(max_nodes))
}

fn session_blocks_with_budget(nodes: &[StyledNode], work: LayoutWorkBudget) -> Vec<TestBlock> {
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut session = session(nodes, &images);
    let mut blocks = Vec::new();
    loop {
        let result = session.advance(work, &fonts);
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

fn block_line_count(block: &TestBlock) -> usize {
    block
        .children
        .iter()
        .map(|child| match child {
            RuntimeChild::Block(child) => block_line_count(child),
            RuntimeChild::Line(_) => 1,
            RuntimeChild::Image(_) | RuntimeChild::Hr(_) => 0,
        })
        .sum()
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

fn budget_with_work_limits(
    max_nodes: usize,
    max_descendant_nodes: usize,
    max_lines: usize,
) -> LayoutWorkBudget {
    LayoutWorkBudget::with_work_limits(
        NonZeroUsize::new(max_nodes).expect("test node budget is non-zero"),
        NonZeroUsize::new(max_descendant_nodes).expect("test descendant-node budget is non-zero"),
        NonZeroUsize::new(max_lines).expect("test line budget is non-zero"),
    )
}

fn budget_with_text_work(
    max_nodes: usize,
    max_utf16_units: usize,
    max_atomic_operations: usize,
) -> LayoutWorkBudget {
    LayoutWorkBudget::with_text_work_limits(
        NonZeroUsize::new(max_nodes).expect("test node budget is non-zero"),
        NonZeroUsize::new(max_utf16_units).expect("test text budget is non-zero"),
        NonZeroUsize::new(max_atomic_operations).expect("test operation budget is non-zero"),
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

fn container(tag: &str, children: Vec<StyledNode>) -> StyledNode {
    let mut node = styled_node(StyledNodeKind::Block, children);
    node.tag = Some(tag.to_owned());
    node.style.insert("display".to_owned(), json!("block"));
    node
}

fn list_item(content: &str) -> StyledNode {
    let mut node = paragraph(content, 0.0, 0.0);
    node.tag = Some("li".to_owned());
    node.style
        .insert("listStyleType".to_owned(), json!("decimal"));
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
