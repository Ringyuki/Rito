use super::super::{
    resolve_text_range_from_points, LayoutTextRangeFromPointsResolution,
    LayoutTextSelectionGranularity, TextInteractionUnavailableReason,
};
use super::helpers::*;
use crate::layout::{
    LineBox, RunShape, RunShapeUnavailableReason, RunTextMapping, RuntimeBlock, RuntimeChild,
};
use serde_json::json;

#[test]
fn paragraph_granularity_selects_retained_flows_in_both_directions() {
    let first = exact_flow("first paragraph");
    let second = exact_flow("second paragraph");
    let third = exact_flow("third paragraph");
    let page = flow_page(&[
        (&first, "first paragraph"),
        (&second, "second paragraph"),
        (&third, "third paragraph"),
    ]);
    let single = resolved(
        std::slice::from_ref(&page),
        point(0, 45.0, 30.0),
        point(0, 45.0, 30.0),
        LayoutTextSelectionGranularity::Paragraph,
    );
    assert_eq!(single.range.selected_text, "first paragraph\n\n");
    assert_eq!(single.range.rects.len(), 1);
    assert_eq!(single.focus_caret.address.block_index, 0);

    let forward = resolved(
        std::slice::from_ref(&page),
        point(0, 45.0, 30.0),
        point(0, 45.0, 70.0),
        LayoutTextSelectionGranularity::Paragraph,
    );
    assert_eq!(
        forward.range.selected_text,
        "first paragraph\n\nsecond paragraph\n\n"
    );
    assert_eq!(forward.range.rects.len(), 2);
    assert_eq!(forward.anchor_caret.source_point.text_offset, 0);
    assert_eq!(forward.focus_caret.source_point.text_offset, 16);

    let reverse = resolved(
        std::slice::from_ref(&page),
        point(0, 45.0, 70.0),
        point(0, 45.0, 30.0),
        LayoutTextSelectionGranularity::Paragraph,
    );
    assert_eq!(
        reverse.range.selected_text,
        "first paragraph\n\nsecond paragraph\n\n"
    );
    assert_eq!(reverse.range.anchor, reverse.anchor_caret.address);
    assert_eq!(reverse.range.focus, reverse.focus_caret.address);
    assert!(reverse.range.anchor.block_index > reverse.range.focus.block_index);

    let last = resolved(
        &[page],
        point(0, 45.0, 110.0),
        point(0, 45.0, 110.0),
        LayoutTextSelectionGranularity::Paragraph,
    );
    assert_eq!(last.range.selected_text, "third paragraph");
    assert_eq!(last.range.rects.len(), 1);
}

#[test]
fn decorated_container_keeps_nested_paragraphs_distinct() {
    let first = exact_flow("first");
    let second = exact_flow("second");
    let page = page_from_blocks(
        0,
        vec![decorated_container(vec![
            block(20.0, "first", exact_slice(&first, 0, 5), uniform_shape(5)),
            block(60.0, "second", exact_slice(&second, 0, 6), uniform_shape(6)),
        ])],
    );
    let first = resolved(
        std::slice::from_ref(&page),
        point(0, 25.0, 30.0),
        point(0, 25.0, 30.0),
        LayoutTextSelectionGranularity::Paragraph,
    );
    assert_eq!(first.range.selected_text, "first\n\n");
    assert_eq!(first.range.rects.len(), 1);
    assert_eq!(first.anchor_caret.address.block_index, 0);
    assert_eq!(first.focus_caret.address.block_index, 0);

    let cross_paragraph = resolved(
        &[page],
        point(0, 25.0, 30.0),
        point(0, 25.0, 70.0),
        LayoutTextSelectionGranularity::Paragraph,
    );
    assert_eq!(cross_paragraph.range.selected_text, "first\n\nsecond");
    assert_eq!(cross_paragraph.range.rects.len(), 2);
    assert_eq!(cross_paragraph.anchor_caret.address.block_index, 0);
    assert_eq!(cross_paragraph.focus_caret.address.block_index, 0);
}

#[test]
fn decorated_container_keeps_nested_same_block_fail_closed() {
    let current = exact_flow("alpha");
    let next = exact_flow("next");
    let page = page_from_blocks(
        0,
        vec![decorated_container(vec![
            block_with_runs(
                20.0,
                vec![
                    text_run("alpha", exact_slice(&current, 0, 5), 0.0, uniform_shape(5)),
                    text_run("tail", RunTextMapping::synthetic(), 50.0, uniform_shape(4)),
                ],
            ),
            block(60.0, "next", exact_slice(&next, 0, 4), uniform_shape(4)),
        ])],
    );
    assert_eq!(
        resolve_text_range_from_points(
            &[page],
            point(0, 25.0, 30.0),
            point(0, 25.0, 30.0),
            LayoutTextSelectionGranularity::Paragraph,
            None,
            page_range(0, 0),
        ),
        LayoutTextRangeFromPointsResolution::Unavailable(
            TextInteractionUnavailableReason::SourceUnavailable
        )
    );
}

#[test]
fn paragraph_excludes_only_exact_outer_trim_whitespace_and_keeps_internal_gaps() {
    let flow = exact_flow("  alpha\nbeta  ");
    let page = page_from_blocks(
        0,
        vec![
            block(20.0, "alpha", exact_slice(&flow, 2, 7), uniform_shape(5)),
            block(60.0, "beta", exact_slice(&flow, 8, 12), uniform_shape(4)),
        ],
    );
    let paragraph = resolved(
        &[page],
        point(0, 25.0, 30.0),
        point(0, 25.0, 30.0),
        LayoutTextSelectionGranularity::Paragraph,
    );

    assert_eq!(paragraph.range.selected_text, "alpha\nbeta");
    assert_eq!(paragraph.range.source_start.text_offset, 2);
    assert_eq!(paragraph.range.source_end.text_offset, 12);
    assert_eq!(paragraph.range.rects.len(), 2);
}

#[test]
fn paragraph_trailing_separator_ignores_next_flow_trim_and_keeps_own_endpoint() {
    let first = exact_flow("  alpha  ");
    let next = exact_flow("  next");
    let page = page_from_blocks(
        0,
        vec![
            block(20.0, "alpha", exact_slice(&first, 2, 7), uniform_shape(5)),
            block(60.0, "next", exact_slice(&next, 2, 6), uniform_shape(4)),
        ],
    );
    let selected = resolved(
        &[page],
        point(0, 25.0, 30.0),
        point(0, 25.0, 30.0),
        LayoutTextSelectionGranularity::Paragraph,
    );

    assert_eq!(selected.range.selected_text, "alpha\n\n");
    assert_eq!(selected.range.rects.len(), 1);
    assert_eq!(selected.focus_caret.address.block_index, 0);
    assert_eq!(selected.focus_caret.source_point.text_offset, 7);
    assert_eq!(selected.range.source_end.text_offset, 7);
}

#[test]
fn next_block_unavailability_does_not_poison_exact_paragraph_selection() {
    for next in [
        block(
            60.0,
            "broken",
            RunTextMapping::synthetic(),
            uniform_shape(6),
        ),
        block(
            60.0,
            "broken",
            exact_slice(&exact_flow("broken"), 0, 6),
            RunShape::unavailable(RunShapeUnavailableReason::HostMetricsFallback, 60.0),
        ),
    ] {
        let current = exact_flow("alpha");
        let page = page_from_blocks(
            0,
            vec![
                block(20.0, "alpha", exact_slice(&current, 0, 5), uniform_shape(5)),
                next,
            ],
        );
        let selected = resolved(
            &[page],
            point(0, 25.0, 30.0),
            point(0, 25.0, 30.0),
            LayoutTextSelectionGranularity::Paragraph,
        );
        assert_eq!(selected.range.selected_text, "alpha\n\n");
        assert_eq!(selected.range.rects.len(), 1);
    }
}

#[test]
fn same_block_unavailable_text_remains_fail_closed() {
    let flow = exact_flow("alpha");
    let page = page_from_blocks(
        0,
        vec![block_with_runs(
            20.0,
            vec![
                text_run("alpha", exact_slice(&flow, 0, 5), 0.0, uniform_shape(5)),
                text_run("tail", RunTextMapping::synthetic(), 50.0, uniform_shape(4)),
            ],
        )],
    );
    assert_eq!(
        resolve_text_range_from_points(
            &[page],
            point(0, 25.0, 30.0),
            point(0, 25.0, 30.0),
            LayoutTextSelectionGranularity::Paragraph,
            None,
            page_range(0, 0),
        ),
        LayoutTextRangeFromPointsResolution::Unavailable(
            TextInteractionUnavailableReason::SourceUnavailable
        )
    );
}

fn decorated_container(children: Vec<RuntimeBlock<LineBox>>) -> RuntimeBlock<LineBox> {
    RuntimeBlock {
        x: 0.0,
        y: 0.0,
        width: 200.0,
        height: 100.0,
        semantic_tag: Some("div".to_owned()),
        anchor_id: None,
        paint: Some(json!({ "backgroundColor": "#eee" })),
        border_box: None,
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children: children
            .into_iter()
            .map(|child| RuntimeChild::Block(Box::new(child)))
            .collect(),
    }
}
