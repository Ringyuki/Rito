use serde_json::{json, Value};

use super::ContinuousPaginationSession;
use crate::layout::{
    content::{RuntimeBlock, RuntimeChild},
    create_layout_config,
    line::{LineBox, LineRun, TextRunBox},
    page::{RuntimePage, RuntimePageAccumulator},
    pagination_flow::{paginate_continuous_blocks, place_pagination_block},
    LayoutConfig, LayoutConfigInput, MarginInput, PaginationPolicy, SpreadMode,
};

type TestBlock = RuntimeBlock<LineBox>;
type TestPage = RuntimePage<TestBlock>;

#[test]
fn small_and_large_batches_exactly_match_the_eager_reference() {
    let layout = test_layout();
    let paint = Some(json!({ "backgroundColor": "#fafafa" }));
    let mut tall = block_with_lines(35.0, 8);
    tall.orphans = Some(3);
    tall.widows = Some(3);
    let mut final_block = block_with_line("final", 205.0, 20.0);
    final_block.page_break_after = true;
    let blocks = vec![block_with_line("first", 5.0, 20.0), tall, final_block];

    let expected = eager_reference(&blocks, &layout, paint.clone());
    let eager = paginate_continuous_blocks(blocks.clone(), &layout, paint.clone());
    let small = paginate_in_batches(&blocks, 1, &layout, paint.clone());
    let large = paginate_in_batches(&blocks, blocks.len(), &layout, paint);

    assert_eq!(eager, expected);
    assert_eq!(small, expected);
    assert_eq!(large, expected);
}

#[test]
fn partial_snapshot_excludes_the_open_page() {
    let layout = test_layout();
    let mut session = ContinuousPaginationSession::new(&layout, None);

    let pushed = session.push_blocks(vec![block_with_line("open", 0.0, 20.0)]);

    assert_eq!(pushed.processed_blocks, 1);
    assert_eq!(pushed.newly_sealed_pages, 0..0);
    assert!(pushed.snapshot.sealed_pages.is_empty());
    assert!(!pushed.snapshot.finished);
    assert!(session.snapshot().sealed_pages.is_empty());

    let finished = session.finish();
    assert_eq!(finished.newly_sealed_pages, 0..1);
    assert_eq!(finished.snapshot.sealed_pages.len(), 1);
}

#[test]
fn page_breaks_seal_pages_across_batches_and_finish_is_idempotent() {
    let layout = test_layout();
    let paint = Some(json!({ "backgroundColor": "#fff" }));
    let mut session = ContinuousPaginationSession::new(&layout, paint.clone());
    let first = block_with_line("first", 0.0, 20.0);
    let mut second = block_with_line("second", 30.0, 20.0);
    second.page_break_before = true;
    let mut third = block_with_line("third", 60.0, 20.0);
    third.page_break_after = true;

    let first_push = session.push_blocks(vec![first.clone()]);
    assert!(first_push.snapshot.sealed_pages.is_empty());
    let second_push = session.push_blocks(vec![second.clone()]);
    assert_eq!(second_push.newly_sealed_pages, 0..1);
    assert_eq!(page_text(&second_push.snapshot.sealed_pages[0]), "first");
    let third_push = session.push_blocks(vec![third.clone()]);
    assert_eq!(third_push.newly_sealed_pages, 1..2);
    assert_eq!(third_push.snapshot.sealed_pages.len(), 2);
    assert_eq!(third_push.snapshot.sealed_pages[1].content[0].y, 0.0);
    assert_eq!(third_push.snapshot.sealed_pages[1].content[1].y, 30.0);

    let first_result = session.finish();
    assert_eq!(first_result.newly_sealed_pages, 2..2);
    assert!(first_result.snapshot.finished);
    let first_finish = first_result.snapshot.sealed_pages.to_vec();
    let second_result = session.finish();
    assert_eq!(second_result.newly_sealed_pages, 2..2);
    assert!(second_result.snapshot.finished);
    let second_finish = second_result.snapshot.sealed_pages.to_vec();
    assert_eq!(first_finish, second_finish);
    assert_eq!(first_finish.len(), 2);
    assert!(first_finish.iter().all(|page| page.paint == paint));
    assert!(first_finish
        .iter()
        .all(|page| (page.width, page.height) == (layout.page_width, layout.page_height)));
    assert_eq!(
        first_finish,
        eager_reference(&[first, second, third], &layout, paint)
    );
}

#[test]
fn taking_sealed_pages_preserves_page_history_and_open_page_state() {
    let layout = test_layout();
    let mut first = block_with_line("first", 0.0, 20.0);
    first.page_break_after = true;
    let second = block_with_line("second", 60.0, 20.0);
    let expected = eager_reference(&[first.clone(), second.clone()], &layout, None);
    let mut session = ContinuousPaginationSession::new(&layout, None);

    {
        let pushed = session.push_blocks(vec![first]);
        assert_eq!(pushed.newly_sealed_pages, 0..1);
        assert_eq!(pushed.snapshot.sealed_pages.len(), 1);
    }
    let mut actual = session.take_sealed_pages();
    assert_eq!(actual.len(), 1);
    assert_eq!(actual[0].index, 0);
    assert!(session.take_sealed_pages().is_empty());

    {
        let pushed = session.push_blocks(vec![second]);
        assert_eq!(pushed.newly_sealed_pages, 0..0);
        assert!(pushed.snapshot.sealed_pages.is_empty());
    }
    {
        let finished = session.finish();
        assert_eq!(finished.newly_sealed_pages, 0..1);
        assert_eq!(finished.snapshot.sealed_pages.len(), 1);
    }
    let second = session.take_sealed_pages();
    assert_eq!(second.len(), 1);
    assert_eq!(second[0].index, 1);
    assert_eq!(second[0].content[0].y, 0.0);
    actual.extend(second);

    assert_eq!(actual, expected);
    assert!(session.take_sealed_pages().is_empty());
    let finished_again = session.finish();
    assert_eq!(finished_again.newly_sealed_pages, 0..0);
    assert!(finished_again.snapshot.sealed_pages.is_empty());
}

#[test]
fn oversized_paragraph_seals_only_complete_fragments_before_finish() {
    let layout = test_layout();
    let mut block = block_with_lines(0.0, 8);
    block.widows = Some(4);
    let mut session = ContinuousPaginationSession::new(&layout, None);

    let pushed = session.push_blocks(vec![block.clone()]);

    assert_eq!(pushed.snapshot.sealed_pages.len(), 1);
    assert_eq!(pushed.snapshot.sealed_pages[0].content[0].children.len(), 4);
    let finish_result = session.finish();
    assert_eq!(finish_result.newly_sealed_pages, 1..2);
    let finished = finish_result.snapshot.sealed_pages.to_vec();
    assert_eq!(finished.len(), 2);
    assert_eq!(finished[1].content[0].children.len(), 4);
    assert_eq!(finished, eager_reference(&[block], &layout, None));
}

#[test]
fn spacing_and_widow_orphan_state_cross_a_batch_boundary() {
    let layout = test_layout();
    let first = block_with_line("first", 0.0, 20.0);
    let mut second = block_with_lines(40.0, 8);
    second.orphans = Some(3);
    second.widows = Some(3);
    let mut session = ContinuousPaginationSession::new(&layout, None);

    let _ = session.push_blocks(vec![first.clone()]);
    let pushed = session.push_blocks(vec![second.clone()]);

    assert_eq!(pushed.snapshot.sealed_pages.len(), 1);
    let first_page = &pushed.snapshot.sealed_pages[0];
    assert_eq!(first_page.content.len(), 2);
    assert_eq!(first_page.content[1].y, 40.0);
    assert_eq!(first_page.content[1].children.len(), 3);
    let finish_result = session.finish();
    assert_eq!(finish_result.newly_sealed_pages, 1..2);
    let pages = finish_result.snapshot.sealed_pages.to_vec();
    assert_eq!(pages[1].content[0].children.len(), 5);
    assert_eq!(pages, eager_reference(&[first, second], &layout, None));
}

#[test]
fn session_snapshots_pagination_policy_at_construction() {
    let mut layout = test_layout();
    layout.pagination_policy = Some(PaginationPolicy {
        enabled: None,
        default_orphans: Some(2),
        default_widows: Some(4),
    });
    let nested = block_with_lines(0.0, 8);
    let mut block = block_with_line("outer", 0.0, nested.height);
    block.children = vec![RuntimeChild::Block(Box::new(nested))];
    let expected = eager_reference(&[block.clone()], &layout, None);
    let RuntimeChild::Block(expected_nested) = &expected[0].content[0].children[0] else {
        panic!("nested policy fragment expected");
    };
    assert_eq!(expected_nested.children.len(), 4);
    let mut session = ContinuousPaginationSession::new(&layout, None);

    layout.pagination_policy = Some(PaginationPolicy {
        enabled: Some(false),
        default_orphans: None,
        default_widows: None,
    });
    let _ = session.push_blocks(vec![block]);

    assert_eq!(session.into_pages(), expected);
}

#[test]
fn non_positive_content_height_never_exposes_a_page() {
    let mut layout = test_layout();
    layout.margin_top = layout.page_height / 2.0;
    layout.margin_bottom = layout.page_height / 2.0;
    let block = block_with_line("hidden", 0.0, 20.0);
    let mut session = ContinuousPaginationSession::new(&layout, None);

    let pushed = session.push_blocks(vec![block.clone()]);

    assert_eq!(pushed.processed_blocks, 1);
    assert!(pushed.snapshot.sealed_pages.is_empty());
    let finished = session.finish();
    assert_eq!(finished.newly_sealed_pages, 0..0);
    assert!(finished.snapshot.sealed_pages.is_empty());
    assert!(paginate_continuous_blocks(vec![block], &layout, None).is_empty());
}

fn paginate_in_batches(
    blocks: &[TestBlock],
    batch_size: usize,
    layout: &LayoutConfig,
    paint: Option<Value>,
) -> Vec<TestPage> {
    let mut session = ContinuousPaginationSession::new(layout, paint);
    for batch in blocks.chunks(batch_size) {
        let pushed = session.push_blocks(batch.to_vec());
        assert_eq!(pushed.processed_blocks, batch.len());
    }
    session.into_pages()
}

fn eager_reference(
    blocks: &[TestBlock],
    layout: &LayoutConfig,
    paint: Option<Value>,
) -> Vec<TestPage> {
    let content_height = layout.content_height();
    if content_height <= 0.0 {
        return Vec::new();
    }
    let mut state = RuntimePageAccumulator::new(layout.page_width, layout.page_height, paint);
    for (index, block) in blocks.iter().enumerate() {
        let spacing = if index == 0 {
            block.y
        } else {
            block.y - (blocks[index - 1].y + blocks[index - 1].height)
        };
        place_pagination_block(
            block.clone(),
            spacing,
            content_height,
            &mut state,
            layout.pagination_policy.as_ref(),
        );
    }
    if !state.page_blocks.is_empty() {
        state.emit_page();
    }
    state.pages
}

fn test_layout() -> LayoutConfig {
    create_layout_config(LayoutConfigInput {
        width: 320.0,
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

fn block_with_lines(y: f64, line_count: usize) -> TestBlock {
    let mut block = block_with_line("0", y, line_count as f64 * 20.0);
    block.children = (0..line_count)
        .map(|index| RuntimeChild::Line(line_box(&index.to_string(), index as f64 * 20.0)))
        .collect();
    block
}

fn block_with_line(text: &str, y: f64, height: f64) -> TestBlock {
    RuntimeBlock {
        x: 0.0,
        y,
        width: 240.0,
        height,
        semantic_tag: None,
        anchor_id: None,
        paint: None,
        border_box: None,
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children: vec![RuntimeChild::Line(line_box(text, 0.0))],
    }
}

fn line_box(text: &str, y: f64) -> LineBox {
    LineBox {
        x: 0.0,
        y,
        width: 240.0,
        height: 20.0,
        runs: vec![LineRun::Text(TextRunBox {
            text: text.to_owned(),
            text_mapping: crate::layout::text_mapping::RunTextMapping::synthetic(),
            x: 0.0,
            y: 0.0,
            width: 40.0,
            height: 12.0,
            font_size: 12.0,
            paint: json!({}),
            line_height_px: None,
            href: None,
            source_path: None,
            source_text: None,
            source_text_offset: None,
            inline_margin_right: None,
            ruby_annotation: None,
            shape: crate::layout::text_shape::fixture_run_shape(40.0),
        })],
    }
}

fn page_text(page: &TestPage) -> String {
    page.content
        .iter()
        .flat_map(|block| &block.children)
        .filter_map(|child| match child {
            RuntimeChild::Line(line) => Some(line.text()),
            _ => None,
        })
        .collect()
}
