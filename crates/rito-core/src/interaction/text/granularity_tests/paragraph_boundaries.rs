use super::super::{
    resolve_text_range_from_points, LayoutTextRangeFromPointsResolution,
    LayoutTextSelectionGranularity, TextInteractionUnavailableReason,
};
use super::helpers::*;
use crate::layout::{fixture_logical_text_flow, RunShape, RunShapeUnavailableReason};

#[test]
fn paragraph_does_not_skip_outer_unavailable_source_or_visible_shape() {
    let unavailable_source =
        fixture_logical_text_flow(" alpha", vec![(0, 1, None), (1, 6, Some((vec![1, 2], 1)))]);
    let source_page = page_from_blocks(
        0,
        vec![block(
            20.0,
            "alpha",
            mapped_slice(&unavailable_source, 1, 1, 6),
            uniform_shape(5),
        )],
    );
    assert_eq!(
        resolve_text_range_from_points(
            &[source_page],
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

    let unavailable_shape = exact_flow("alpha beta");
    let shape_page = page_from_blocks(
        0,
        vec![
            block(
                20.0,
                "alpha",
                exact_slice(&unavailable_shape, 0, 5),
                RunShape::unavailable(RunShapeUnavailableReason::HostMetricsFallback, 50.0),
            ),
            block(
                60.0,
                "beta",
                exact_slice(&unavailable_shape, 6, 10),
                uniform_shape(4),
            ),
        ],
    );
    assert_eq!(
        resolve_text_range_from_points(
            &[shape_page],
            point(0, 25.0, 70.0),
            point(0, 25.0, 70.0),
            LayoutTextSelectionGranularity::Paragraph,
            None,
            page_range(0, 0),
        ),
        LayoutTextRangeFromPointsResolution::Unavailable(
            TextInteractionUnavailableReason::ShapeUnavailable
        )
    );
}

#[test]
fn all_whitespace_paragraph_has_no_interactive_seed() {
    let page = page_from_blocks(0, Vec::new());
    assert_eq!(
        resolve_text_range_from_points(
            &[page],
            point(0, 15.0, 30.0),
            point(0, 15.0, 30.0),
            LayoutTextSelectionGranularity::Paragraph,
            None,
            page_range(0, 0),
        ),
        LayoutTextRangeFromPointsResolution::Miss
    );
}

#[test]
fn unit_endpoints_can_cross_pages_for_paragraphs_and_split_words() {
    let paragraph_flow = exact_flow("  alpha beta  ");
    let paragraph_pages = vec![
        page_from_blocks(
            0,
            vec![block(
                20.0,
                "alpha",
                exact_slice(&paragraph_flow, 2, 7),
                uniform_shape(5),
            )],
        ),
        page_from_blocks(
            1,
            vec![block(
                20.0,
                "beta",
                exact_slice(&paragraph_flow, 8, 12),
                uniform_shape(4),
            )],
        ),
    ];
    let paragraph = resolved(
        &paragraph_pages,
        point(1, 25.0, 30.0),
        point(1, 25.0, 30.0),
        LayoutTextSelectionGranularity::Paragraph,
    );
    assert_eq!(paragraph.range.selected_text, "alpha beta");
    assert_eq!(paragraph.anchor_caret.address.page_index, 0);
    assert_eq!(paragraph.focus_caret.address.page_index, 1);
    assert_eq!(paragraph.range.source_start.text_offset, 2);
    assert_eq!(paragraph.range.source_end.text_offset, 12);

    let word_flow = exact_flow("alphabet");
    let word_pages = split_flow_pages(&word_flow, "alphabet", 5);
    let word = resolved(
        &word_pages,
        point(1, 15.0, 30.0),
        point(1, 15.0, 30.0),
        LayoutTextSelectionGranularity::Word,
    );
    assert_eq!(word.range.selected_text, "alphabet");
    assert_eq!(word.anchor_caret.address.page_index, 0);
    assert_eq!(word.focus_caret.address.page_index, 1);
}

#[test]
fn paragraph_separator_crosses_pages_but_never_crosses_page_scope() {
    let first = exact_flow("first");
    let next = exact_flow("next");
    let pages = vec![
        one_flow_page(0, &first, "first", uniform_shape(5)),
        one_flow_page(1, &next, "next", uniform_shape(4)),
    ];
    let same_chapter = resolved_with_page_range(
        &pages,
        point(0, 25.0, 30.0),
        point(0, 25.0, 30.0),
        LayoutTextSelectionGranularity::Paragraph,
        page_range(0, 1),
    );
    assert_eq!(same_chapter.range.selected_text, "first\n\n");
    assert_eq!(same_chapter.focus_caret.address.page_index, 0);

    let chapter_end = resolved_with_page_range(
        &pages,
        point(0, 25.0, 30.0),
        point(0, 25.0, 30.0),
        LayoutTextSelectionGranularity::Paragraph,
        page_range(0, 0),
    );
    assert_eq!(chapter_end.range.selected_text, "first");
    assert_eq!(chapter_end.focus_caret.address.page_index, 0);
}
