use std::num::NonZeroUsize;

use serde_json::{json, Map, Value};

use super::RuntimeChapterLayoutSession;
use crate::{
    layout::{
        continuous_layout::summarize_pagination_flow_for_chapter,
        create_layout_config,
        image_size::ImageSizeIndex,
        line::{LineRun, TextRunBox},
        pagination_flow::PaginationFlowChapter,
        pagination_session::{LayoutAdvanceStatus, LayoutWorkBudget, LayoutWorkMeter},
        LayoutConfig, LayoutConfigInput, LayoutRuntimePage, LineBreaking, MarginInput, SpreadMode,
        TextMeasurementFonts,
    },
    style::{StyledNode, StyledNodeKind},
};

#[test]
fn budget_one_and_large_budget_exactly_match_eager_chapter_pages() {
    let layout = test_layout();
    let paint = Some(json!({ "backgroundColor": "#fafafa" }));
    let mut constrained = paragraph(&"widow orphan content ".repeat(42));
    constrained.style.extend([
        ("marginTop".to_owned(), json!(13)),
        ("orphans".to_owned(), json!(3)),
        ("widows".to_owned(), json!(3)),
    ]);
    let mut forced = paragraph("forced page starts here");
    forced
        .style
        .insert("pageBreakBefore".to_owned(), json!("always"));
    let nodes = vec![
        paragraph("first short paragraph"),
        constrained,
        forced,
        paragraph("final paragraph"),
    ];
    let expected = eager_chapter(&nodes, &layout, paint.clone());

    let (small_pages, small_blocks) = collect_pages(&nodes, &layout, paint.clone(), 1);
    let (large_pages, large_blocks) = collect_pages(&nodes, &layout, paint, 64);

    assert_eq!(small_pages, expected.pages);
    assert_eq!(large_pages, expected.pages);
    assert_eq!(small_blocks, expected.block_count);
    assert_eq!(large_blocks, expected.block_count);
}

#[test]
fn open_page_stays_private_until_chapter_completion() {
    let layout = test_layout();
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut session = RuntimeChapterLayoutSession::new(
        vec![paragraph("first"), paragraph("second")],
        images,
        &layout,
        LineBreaking::Greedy,
        None,
    );

    let first = session.advance(budget(1), &fonts);

    assert_eq!(first.status, LayoutAdvanceStatus::Partial);
    assert_eq!(first.processed_top_level_nodes, 1);
    assert_eq!(first.total_block_count, 1);
    assert!(first.newly_sealed_pages.is_empty());

    let second = session.advance(budget(1), &fonts);

    assert_eq!(second.status, LayoutAdvanceStatus::Complete);
    assert_eq!(second.processed_top_level_nodes, 1);
    assert_eq!(second.total_block_count, 2);
    assert_eq!(second.newly_sealed_pages.len(), 1);
    assert_eq!(page_text(&second.newly_sealed_pages[0]), "firstsecond");
}

#[test]
fn one_meter_shares_the_line_quantum_between_chapter_sessions() {
    let layout = test_layout();
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut first = RuntimeChapterLayoutSession::new(
        vec![paragraph("first chapter")],
        images.clone(),
        &layout,
        LineBreaking::Greedy,
        None,
    );
    let mut second = RuntimeChapterLayoutSession::new(
        vec![paragraph("second chapter")],
        images,
        &layout,
        LineBreaking::Greedy,
        None,
    );
    let mut work = LayoutWorkMeter::new(LayoutWorkBudget::with_max_line_boxes(
        NonZeroUsize::new(2).expect("test node budget is non-zero"),
        NonZeroUsize::new(1).expect("test line budget is non-zero"),
    ));

    let first_advance = first.advance_with_meter(&mut work, &fonts);
    let second_partial = second.advance_with_meter(&mut work, &fonts);

    assert_eq!(first_advance.status, LayoutAdvanceStatus::Complete);
    assert_eq!(first_advance.processed_top_level_nodes, 1);
    assert_eq!(second_partial.status, LayoutAdvanceStatus::Partial);
    assert_eq!(second_partial.processed_top_level_nodes, 1);
    assert_eq!(second_partial.total_block_count, 0);
    assert!(second_partial.newly_sealed_pages.is_empty());

    let second_complete = second.advance(budget_with_lines(1, 1), &fonts);
    assert_eq!(second_complete.status, LayoutAdvanceStatus::Complete);
    assert_eq!(second_complete.processed_top_level_nodes, 0);
    assert_eq!(second_complete.total_block_count, 1);
    assert_eq!(
        page_text(&second_complete.newly_sealed_pages[0]),
        "second chapter"
    );
}

#[test]
fn unfinished_greedy_paragraph_withholds_its_block_and_pages_until_complete() {
    let layout = test_layout();
    let nodes = vec![paragraph(&"long resumable paragraph ".repeat(240))];
    let expected = eager_chapter(&nodes, &layout, None);
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut session =
        RuntimeChapterLayoutSession::new(nodes, images, &layout, LineBreaking::Greedy, None);
    let line_budget = budget_with_lines(1, 5);

    let first = session.advance(line_budget, &fonts);
    assert_eq!(first.status, LayoutAdvanceStatus::Partial);
    assert_eq!(first.processed_top_level_nodes, 1);
    assert_eq!(first.total_block_count, 0);
    assert!(first.newly_sealed_pages.is_empty());

    let final_advance = loop {
        let advance = session.advance(line_budget, &fonts);
        if advance.status == LayoutAdvanceStatus::Complete {
            break advance;
        }
        assert_eq!(advance.processed_top_level_nodes, 0);
        assert_eq!(advance.total_block_count, 0);
        assert!(advance.newly_sealed_pages.is_empty());
    };

    assert_eq!(final_advance.total_block_count, expected.block_count);
    assert_eq!(final_advance.newly_sealed_pages, expected.pages);
}

#[test]
fn transparent_container_yields_stable_pages_before_the_container_completes() {
    let layout = test_layout();
    let children = (0..96)
        .map(|index| paragraph(&format!("nested paragraph {index}")))
        .collect();
    let nodes = vec![container("section", children)];
    let expected = eager_chapter(&nodes, &layout, None);
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut session =
        RuntimeChapterLayoutSession::new(nodes, images, &layout, LineBreaking::Greedy, None);

    let first = session.advance(budget(1), &fonts);

    assert_eq!(first.status, LayoutAdvanceStatus::Partial);
    assert_eq!(first.processed_top_level_nodes, 1);
    assert!(first.total_block_count > 0);
    assert!(
        !first.newly_sealed_pages.is_empty(),
        "completed children should reach pagination before the section closes"
    );

    let mut pages = first.newly_sealed_pages;
    let final_block_count = loop {
        let advance = session.advance(budget(1), &fonts);
        assert_eq!(advance.processed_top_level_nodes, 0);
        pages.extend(advance.newly_sealed_pages);
        if advance.status == LayoutAdvanceStatus::Complete {
            break advance.total_block_count;
        }
    };

    assert_eq!(pages, expected.pages);
    assert_eq!(final_block_count, expected.block_count);
}

#[test]
fn each_advance_returns_only_pages_newly_sealed_by_that_advance() {
    let layout = test_layout();
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut first = paragraph("first page");
    first
        .style
        .insert("pageBreakAfter".to_owned(), json!("always"));
    let mut session = RuntimeChapterLayoutSession::new(
        vec![first, paragraph("second page")],
        images,
        &layout,
        LineBreaking::Greedy,
        None,
    );

    let first = session.advance(budget(1), &fonts);
    let second = session.advance(budget(1), &fonts);

    assert_eq!(first.status, LayoutAdvanceStatus::Partial);
    assert_eq!(first.newly_sealed_pages.len(), 1);
    assert_eq!(page_text(&first.newly_sealed_pages[0]), "first page");
    assert_eq!(second.status, LayoutAdvanceStatus::Complete);
    assert_eq!(second.newly_sealed_pages.len(), 1);
    assert_eq!(page_text(&second.newly_sealed_pages[0]), "second page");
}

#[test]
fn anonymous_inline_input_crosses_budget_boundaries_without_early_pages() {
    let layout = test_layout();
    let nodes = vec![
        text("anonymous "),
        inline("inline run"),
        paragraph("following block"),
    ];
    let expected = eager_chapter(&nodes, &layout, None);
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut session =
        RuntimeChapterLayoutSession::new(nodes, images, &layout, LineBreaking::Greedy, None);

    let first = session.advance(budget(1), &fonts);
    let second = session.advance(budget(1), &fonts);
    let third = session.advance(budget(1), &fonts);

    assert_eq!(first.total_block_count, 0);
    assert!(first.newly_sealed_pages.is_empty());
    assert_eq!(second.total_block_count, 1);
    assert!(second.newly_sealed_pages.is_empty());
    assert_eq!(third.status, LayoutAdvanceStatus::Complete);
    assert_eq!(third.total_block_count, expected.block_count);
    assert_eq!(third.newly_sealed_pages, expected.pages);
}

#[test]
fn widow_orphan_and_page_break_state_matches_eager_across_advances() {
    let layout = test_layout();
    let mut constrained = paragraph(&"long constrained paragraph ".repeat(36));
    constrained.style.extend([
        ("orphans".to_owned(), json!(3)),
        ("widows".to_owned(), json!(4)),
    ]);
    let mut next_page = paragraph("forced next page");
    next_page
        .style
        .insert("pageBreakBefore".to_owned(), json!("always"));
    let nodes = vec![paragraph("prefix"), constrained, next_page];
    let expected = eager_chapter(&nodes, &layout, None);

    let (actual, block_count) = collect_pages(&nodes, &layout, None, 1);

    assert_eq!(actual, expected.pages);
    assert_eq!(block_count, expected.block_count);
    assert!(actual.len() >= 3, "the constrained paragraph should split");
}

fn collect_pages(
    nodes: &[StyledNode],
    layout: &LayoutConfig,
    paint: Option<Value>,
    max_nodes: usize,
) -> (Vec<LayoutRuntimePage>, usize) {
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut session = RuntimeChapterLayoutSession::new(
        nodes.to_vec(),
        images,
        layout,
        LineBreaking::Greedy,
        paint,
    );
    let mut pages = Vec::new();
    let mut previous_block_count = 0;
    loop {
        let advance = session.advance(budget(max_nodes), &fonts);
        assert!(advance.processed_top_level_nodes <= max_nodes);
        assert!(advance.total_block_count >= previous_block_count);
        previous_block_count = advance.total_block_count;
        pages.extend(advance.newly_sealed_pages);
        if advance.status == LayoutAdvanceStatus::Complete {
            return (pages, advance.total_block_count);
        }
    }
}

fn eager_chapter(
    nodes: &[StyledNode],
    layout: &LayoutConfig,
    paint: Option<Value>,
) -> PaginationFlowChapter {
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    summarize_pagination_flow_for_chapter(
        "chapter",
        nodes,
        paint,
        &images,
        layout,
        LineBreaking::Greedy,
        &fonts,
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

fn test_layout() -> LayoutConfig {
    create_layout_config(LayoutConfigInput {
        width: 220.0,
        height: 120.0,
        margin: MarginInput::All(10.0),
        spread: SpreadMode::Single,
        first_page_alone: false,
        spread_gap: 20.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        pagination_policy: None,
        text_measurement: None,
    })
}

fn paragraph(content: &str) -> StyledNode {
    let mut node = styled_node(StyledNodeKind::Block, vec![text(content)]);
    node.tag = Some("p".to_owned());
    node.style.insert("display".to_owned(), json!("block"));
    node
}

fn container(tag: &str, children: Vec<StyledNode>) -> StyledNode {
    let mut node = styled_node(StyledNodeKind::Block, children);
    node.tag = Some(tag.to_owned());
    node.style.insert("display".to_owned(), json!("block"));
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

fn page_text(page: &LayoutRuntimePage) -> String {
    page.content
        .iter()
        .flat_map(|block| &block.children)
        .filter_map(|child| match child {
            crate::layout::content::RuntimeChild::Line(line) => Some(
                line.runs
                    .iter()
                    .filter_map(|run| match run {
                        LineRun::Text(TextRunBox { text, .. }) => Some(text.as_str()),
                        _ => None,
                    })
                    .collect::<String>(),
            ),
            _ => None,
        })
        .collect()
}
