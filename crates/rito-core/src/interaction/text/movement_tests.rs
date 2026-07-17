use super::tests::{address, exact_flow, exact_shape, page, run, slice, uniform_shape};
use super::{
    resolve_text_selection_movement, LayoutTextPageRange, LayoutTextPageTarget,
    LayoutTextSelectionMovement, LayoutTextSelectionMovementInput,
    LayoutTextSelectionMovementResolution, LayoutTextSelectionMovementTarget, TextCaretAddress,
    TextCaretAffinity, TextInteractionUnavailableReason, TextSelectionBoundary,
    TextSelectionMovement,
};
use crate::layout::RunShapeDirection;

mod fail_closed;

#[test]
fn character_movement_uses_cluster_edges_and_can_cross_the_fixed_anchor() {
    let flow = exact_flow("e\u{301}x");
    let pages = vec![page(
        0,
        vec![vec![run(
            "e\u{301}x",
            slice(&flow, 0, 0, 3),
            0.0,
            30.0,
            exact_shape(
                &[(0, 2, 20.0), (2, 3, 10.0)],
                RunShapeDirection::LeftToRight,
            ),
        )]],
        None,
    )];
    let anchor = address(0, 0, 0, 0, 2, TextCaretAffinity::Upstream);

    let selection = resolved(move_selection(
        &pages,
        scope(0, 0),
        anchor,
        anchor,
        TextSelectionMovement::CharacterLeft,
        None,
    ));

    assert_eq!(selection.anchor_caret.address, anchor);
    assert_eq!(selection.focus_caret.address.char_index, 0);
    assert_eq!(selection.range.selected_text, "e\u{301}");
    assert_eq!(selection.range.start, selection.focus_caret.address);
    assert_eq!(selection.range.end, anchor);
}

#[test]
fn character_movement_follows_physical_left_and_right_in_rtl() {
    let flow = exact_flow("ab");
    let pages = vec![page(
        0,
        vec![vec![run(
            "ab",
            slice(&flow, 0, 0, 2),
            0.0,
            30.0,
            exact_shape(
                &[(1, 2, 10.0), (0, 1, 20.0)],
                RunShapeDirection::RightToLeft,
            ),
        )]],
        None,
    )];
    let caret = address(0, 0, 0, 0, 1, TextCaretAffinity::Downstream);

    let left = resolved(move_selection(
        &pages,
        scope(0, 0),
        caret,
        caret,
        TextSelectionMovement::CharacterLeft,
        None,
    ));

    assert_eq!(left.focus_caret.address.char_index, 2);
    assert_eq!(left.focus_caret.geometry.x, 10.0);
    assert!(left.focus_caret.geometry.x < 20.0);
    assert_eq!(left.range.selected_text, "b");

    let right = resolved(move_selection(
        &pages,
        scope(0, 0),
        caret,
        caret,
        TextSelectionMovement::CharacterRight,
        None,
    ));
    assert_eq!(right.focus_caret.address.char_index, 0);
    assert_eq!(right.focus_caret.geometry.x, 40.0);
    assert!(right.focus_caret.geometry.x > 20.0);
    assert_eq!(right.range.selected_text, "a");

    let word_left = resolved(move_selection(
        &pages,
        scope(0, 0),
        caret,
        caret,
        TextSelectionMovement::WordLeft,
        None,
    ));
    let word_right = resolved(move_selection(
        &pages,
        scope(0, 0),
        caret,
        caret,
        TextSelectionMovement::WordRight,
        None,
    ));
    assert_eq!(word_left.focus_caret.address.char_index, 2);
    assert_eq!(word_right.focus_caret.address.char_index, 0);
}

#[test]
fn rtl_left_crosses_a_soft_wrap_in_document_reading_order() {
    let flow = exact_flow("abcd");
    let rtl_shape = || {
        exact_shape(
            &[(1, 2, 10.0), (0, 1, 10.0)],
            RunShapeDirection::RightToLeft,
        )
    };
    let pages = vec![page(
        0,
        vec![
            vec![run("ab", slice(&flow, 0, 0, 2), 0.0, 20.0, rtl_shape())],
            vec![run("cd", slice(&flow, 0, 2, 4), 0.0, 20.0, rtl_shape())],
        ],
        None,
    )];
    let wrap_end = address(0, 0, 0, 0, 2, TextCaretAffinity::Upstream);

    let selection = resolved(move_selection(
        &pages,
        scope(0, 0),
        wrap_end,
        wrap_end,
        TextSelectionMovement::CharacterLeft,
        None,
    ));

    assert_eq!(selection.focus_caret.address.line_index, 1);
    assert_eq!(selection.focus_caret.address.char_index, 0);
    assert_eq!(selection.focus_caret.geometry.x, 30.0);
    assert!(selection.range.selected_text.is_empty());
}

#[test]
fn horizontal_movement_fails_closed_for_a_mixed_direction_line() {
    let flow = exact_flow("ab");
    let pages = vec![page(
        0,
        vec![vec![
            run("a", slice(&flow, 0, 0, 1), 0.0, 10.0, uniform_shape(1)),
            run(
                "b",
                slice(&flow, 0, 1, 2),
                10.0,
                10.0,
                exact_shape(&[(0, 1, 10.0)], RunShapeDirection::RightToLeft),
            ),
        ]],
        None,
    )];
    let focus = address(0, 0, 0, 0, 1, TextCaretAffinity::Upstream);

    assert_eq!(
        move_selection(
            &pages,
            scope(0, 0),
            focus,
            focus,
            TextSelectionMovement::CharacterRight,
            None,
        ),
        LayoutTextSelectionMovementResolution::Unavailable(
            TextInteractionUnavailableReason::ShapeUnavailable
        )
    );
}

#[test]
fn vertical_line_movement_keeps_the_original_inline_position() {
    let flow = exact_flow("abcde");
    let pages = vec![page(
        0,
        vec![
            vec![run(
                "ab",
                slice(&flow, 0, 0, 2),
                0.0,
                20.0,
                uniform_shape(2),
            )],
            vec![run(
                "c",
                slice(&flow, 0, 2, 3),
                0.0,
                4.0,
                exact_shape(&[(0, 1, 4.0)], RunShapeDirection::LeftToRight),
            )],
            vec![run(
                "de",
                slice(&flow, 0, 3, 5),
                0.0,
                30.0,
                exact_shape(
                    &[(0, 1, 10.0), (1, 2, 20.0)],
                    RunShapeDirection::LeftToRight,
                ),
            )],
        ],
        None,
    )];
    let anchor = address(0, 0, 0, 0, 2, TextCaretAffinity::Upstream);
    let first = resolved(move_selection(
        &pages,
        scope(0, 0),
        anchor,
        anchor,
        TextSelectionMovement::LineDown,
        None,
    ));
    assert_eq!(first.focus_caret.address.line_index, 1);
    assert_eq!(first.focus_caret.geometry.x, 14.0);
    assert_eq!(first.preferred_inline_position, Some(30.0));

    let second = resolved(move_selection(
        &pages,
        scope(0, 0),
        first.anchor_caret.address,
        first.focus_caret.address,
        TextSelectionMovement::LineDown,
        first.preferred_inline_position,
    ));
    assert_eq!(second.focus_caret.address.line_index, 2);
    assert_eq!(second.focus_caret.geometry.x, 20.0);
    assert_eq!(second.preferred_inline_position, Some(30.0));
}

#[test]
fn word_and_line_boundaries_move_to_exact_shaped_carets() {
    let flow = exact_flow("alpha beta");
    let pages = vec![page(
        0,
        vec![vec![run(
            "alpha beta",
            slice(&flow, 0, 0, 10),
            0.0,
            100.0,
            uniform_shape(10),
        )]],
        None,
    )];
    let inside = address(0, 0, 0, 0, 2, TextCaretAffinity::Upstream);
    let word = resolved(move_selection(
        &pages,
        scope(0, 0),
        inside,
        inside,
        TextSelectionMovement::WordRight,
        Some(999.0),
    ));
    assert_eq!(word.focus_caret.address.char_index, 5);
    assert_eq!(word.range.selected_text, "pha");
    assert_eq!(word.preferred_inline_position, None);

    let next_word = resolved(move_selection(
        &pages,
        scope(0, 0),
        word.anchor_caret.address,
        word.focus_caret.address,
        TextSelectionMovement::WordRight,
        None,
    ));
    assert_eq!(next_word.focus_caret.address.char_index, 10);
    assert_eq!(next_word.range.selected_text, "pha beta");

    let inside_beta = address(0, 0, 0, 0, 8, TextCaretAffinity::Upstream);
    let word_left = resolved(move_selection(
        &pages,
        scope(0, 0),
        inside_beta,
        inside_beta,
        TextSelectionMovement::WordLeft,
        None,
    ));
    assert_eq!(word_left.focus_caret.address.char_index, 6);
    let previous_word = resolved(move_selection(
        &pages,
        scope(0, 0),
        word_left.anchor_caret.address,
        word_left.focus_caret.address,
        TextSelectionMovement::WordLeft,
        None,
    ));
    assert_eq!(previous_word.focus_caret.address.char_index, 0);

    let windows_right = resolved(move_selection(
        &pages,
        scope(0, 0),
        inside,
        inside,
        TextSelectionMovement::WordStartRight,
        None,
    ));
    assert_eq!(windows_right.focus_caret.address.char_index, 6);

    let line_end = resolved(move_selection(
        &pages,
        scope(0, 0),
        inside,
        inside,
        TextSelectionMovement::LineEnd,
        None,
    ));
    assert_eq!(line_end.focus_caret.address.char_index, 10);
    assert_eq!(line_end.range.selected_text, "pha beta");
}

#[test]
fn paragraph_movement_advances_within_then_across_paragraphs() {
    let first_flow = exact_flow("one");
    let second_flow = exact_flow("two");
    let pages = vec![
        page(
            0,
            vec![vec![run(
                "one",
                slice(&first_flow, 0, 0, 3),
                0.0,
                30.0,
                uniform_shape(3),
            )]],
            None,
        ),
        page(
            1,
            vec![vec![run(
                "two",
                slice(&second_flow, 0, 0, 3),
                0.0,
                30.0,
                uniform_shape(3),
            )]],
            None,
        ),
    ];
    let anchor = address(0, 0, 0, 0, 1, TextCaretAffinity::Upstream);
    let first = resolved(move_selection(
        &pages,
        scope(0, 1),
        anchor,
        anchor,
        TextSelectionMovement::ParagraphForward,
        None,
    ));
    assert_eq!(first.focus_caret.address.page_index, 0);
    assert_eq!(first.focus_caret.address.char_index, 3);

    let second = resolved(move_selection(
        &pages,
        scope(0, 1),
        first.anchor_caret.address,
        first.focus_caret.address,
        TextSelectionMovement::ParagraphForward,
        None,
    ));
    assert_eq!(second.focus_caret.address.page_index, 1);
    assert_eq!(second.focus_caret.address.char_index, 3);
    assert_eq!(second.range.selected_text, "ne\n\ntwo");
}

#[test]
fn adjacent_paragraph_start_movement_skips_the_current_paragraph_edge() {
    let first_flow = exact_flow("one");
    let second_flow = exact_flow("two");
    let pages = vec![
        one_line_page(0, &first_flow, "one"),
        one_line_page(1, &second_flow, "two"),
    ];
    let first_middle = address(0, 0, 0, 0, 1, TextCaretAffinity::Upstream);
    let second_middle = address(1, 0, 0, 0, 1, TextCaretAffinity::Upstream);

    let next = resolved(move_selection(
        &pages,
        scope(0, 1),
        first_middle,
        first_middle,
        TextSelectionMovement::ParagraphNextStart,
        None,
    ));
    assert_eq!(next.focus_caret.address.page_index, 1);
    assert_eq!(next.focus_caret.address.char_index, 0);

    let previous = resolved(move_selection(
        &pages,
        scope(0, 1),
        second_middle,
        second_middle,
        TextSelectionMovement::ParagraphPreviousStart,
        None,
    ));
    assert_eq!(previous.focus_caret.address.page_index, 0);
    assert_eq!(previous.focus_caret.address.char_index, 0);

    assert_eq!(
        move_selection(
            &pages,
            scope(0, 1),
            first_middle,
            first_middle,
            TextSelectionMovement::ParagraphPreviousStart,
            None,
        ),
        LayoutTextSelectionMovementResolution::Boundary(TextSelectionBoundary::Start)
    );
    assert_eq!(
        move_selection(
            &pages,
            scope(0, 1),
            second_middle,
            second_middle,
            TextSelectionMovement::ParagraphNextStart,
            None,
        ),
        LayoutTextSelectionMovementResolution::Boundary(TextSelectionBoundary::End)
    );
}

#[test]
fn chapter_movement_obeys_the_absolute_page_scope_and_reports_boundaries() {
    let outside = exact_flow("x");
    let first = exact_flow("ab");
    let last = exact_flow("c");
    let pages = vec![
        one_line_page(0, &outside, "x"),
        one_line_page(1, &first, "ab"),
        one_line_page(2, &last, "c"),
    ];
    let focus = address(1, 0, 0, 0, 1, TextCaretAffinity::Upstream);
    let start = resolved(move_selection(
        &pages,
        scope(1, 2),
        focus,
        focus,
        TextSelectionMovement::ChapterStart,
        None,
    ));
    assert_eq!(start.focus_caret.address.page_index, 1);
    assert_eq!(start.focus_caret.address.char_index, 0);

    let end = resolved(move_selection(
        &pages,
        scope(1, 2),
        focus,
        focus,
        TextSelectionMovement::ChapterEnd,
        None,
    ));
    assert_eq!(end.focus_caret.address.page_index, 2);
    assert_eq!(end.focus_caret.address.char_index, 1);
    assert_eq!(
        move_selection(
            &pages,
            scope(1, 2),
            end.anchor_caret.address,
            end.focus_caret.address,
            TextSelectionMovement::ChapterEnd,
            None,
        ),
        LayoutTextSelectionMovementResolution::Boundary(TextSelectionBoundary::End)
    );
}

#[test]
fn document_movement_uses_the_retained_publication_edges() {
    let first = exact_flow("ab");
    let middle = exact_flow("cd");
    let last = exact_flow("ef");
    let pages = vec![
        one_line_page(0, &first, "ab"),
        one_line_page(1, &middle, "cd"),
        one_line_page(2, &last, "ef"),
    ];
    let focus = address(1, 0, 0, 0, 1, TextCaretAffinity::Upstream);

    let start = resolved(move_selection(
        &pages,
        scope(0, 2),
        focus,
        focus,
        TextSelectionMovement::DocumentStart,
        None,
    ));
    assert_eq!(start.focus_caret.address.page_index, 0);
    assert_eq!(start.focus_caret.address.char_index, 0);

    let end = resolved(move_selection(
        &pages,
        scope(0, 2),
        focus,
        focus,
        TextSelectionMovement::DocumentEnd,
        None,
    ));
    assert_eq!(end.focus_caret.address.page_index, 2);
    assert_eq!(end.focus_caret.address.char_index, 2);
}

#[test]
fn chapter_target_can_keep_an_anchor_in_another_chapter() {
    let anchor_flow = exact_flow("a");
    let focus_flow = exact_flow("bc");
    let pages = vec![
        one_line_page(0, &anchor_flow, "a"),
        one_line_page(1, &focus_flow, "bc"),
    ];
    let anchor = address(0, 0, 0, 0, 1, TextCaretAffinity::Upstream);
    let focus = address(1, 0, 0, 0, 0, TextCaretAffinity::Downstream);
    let selection = resolved(move_selection_to_target(
        &pages,
        LayoutTextSelectionMovementInput {
            scope: scope(0, 1),
            anchor_address: anchor,
            focus_address: focus,
            movement: TextSelectionMovement::ChapterEnd,
            language: None,
            preferred_inline_position: None,
            preferred_block_position: None,
            target: LayoutTextSelectionMovementTarget::Scope(scope(1, 1)),
        },
    ));

    assert_eq!(selection.anchor_caret.address, anchor);
    assert_eq!(selection.focus_caret.address.page_index, 1);
    assert_eq!(selection.focus_caret.address.char_index, 2);
}

#[test]
fn page_movement_keeps_block_position_and_uses_the_sticky_inline_position() {
    let flow = exact_flow("abcde");
    let pages = vec![
        page(
            0,
            vec![
                vec![run("a", slice(&flow, 0, 0, 1), 0.0, 10.0, uniform_shape(1))],
                vec![run("b", slice(&flow, 0, 1, 2), 0.0, 10.0, uniform_shape(1))],
            ],
            None,
        ),
        page(
            1,
            vec![
                vec![run("c", slice(&flow, 0, 2, 3), 0.0, 10.0, uniform_shape(1))],
                vec![run(
                    "d",
                    slice(&flow, 0, 3, 4),
                    20.0,
                    10.0,
                    uniform_shape(1),
                )],
                vec![run("e", slice(&flow, 0, 4, 5), 0.0, 10.0, uniform_shape(1))],
            ],
            None,
        ),
    ];
    let focus = address(0, 0, 1, 0, 1, TextCaretAffinity::Upstream);
    let selection = resolved(move_selection_to_target(
        &pages,
        LayoutTextSelectionMovementInput {
            scope: scope(0, 1),
            anchor_address: focus,
            focus_address: focus,
            movement: TextSelectionMovement::PageDown,
            language: None,
            preferred_inline_position: Some(37.0),
            preferred_block_position: Some(50.0),
            target: LayoutTextSelectionMovementTarget::Page(LayoutTextPageTarget { page_index: 1 }),
        },
    ));

    assert_eq!(selection.focus_caret.address.page_index, 1);
    assert_eq!(selection.focus_caret.address.line_index, 1);
    assert_eq!(selection.focus_caret.geometry.y, 50.0);
    assert_eq!(selection.focus_caret.geometry.x, 40.0);
    assert_eq!(selection.preferred_inline_position, Some(37.0));
    assert_eq!(selection.preferred_block_position, Some(50.0));
}

#[test]
fn movement_rebinds_both_endpoints_before_attempting_navigation() {
    let flow = exact_flow("a");
    let pages = vec![one_line_page(0, &flow, "a")];
    let valid = address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream);
    let invalid = TextCaretAddress {
        char_index: 7,
        ..valid
    };

    assert_eq!(
        move_selection(
            &pages,
            scope(0, 0),
            valid,
            invalid,
            TextSelectionMovement::CharacterRight,
            None,
        ),
        LayoutTextSelectionMovementResolution::Unavailable(
            TextInteractionUnavailableReason::InvalidCaret
        )
    );
}

fn move_selection(
    pages: &[crate::layout::LayoutRuntimePage],
    scope: LayoutTextPageRange,
    anchor: TextCaretAddress,
    focus: TextCaretAddress,
    movement: TextSelectionMovement,
    preferred_inline_position: Option<f64>,
) -> LayoutTextSelectionMovementResolution {
    move_selection_to_target(
        pages,
        LayoutTextSelectionMovementInput {
            scope,
            anchor_address: anchor,
            focus_address: focus,
            movement,
            language: None,
            preferred_inline_position,
            preferred_block_position: None,
            target: LayoutTextSelectionMovementTarget::Scope(scope),
        },
    )
}

fn move_selection_to_target(
    pages: &[crate::layout::LayoutRuntimePage],
    input: LayoutTextSelectionMovementInput<'_>,
) -> LayoutTextSelectionMovementResolution {
    resolve_text_selection_movement(pages, input)
}

fn resolved(resolution: LayoutTextSelectionMovementResolution) -> Box<LayoutTextSelectionMovement> {
    let LayoutTextSelectionMovementResolution::Resolved(selection) = resolution else {
        panic!("movement should resolve, got {resolution:?}");
    };
    selection
}

fn one_line_page(
    index: usize,
    flow: &std::sync::Arc<crate::layout::LogicalTextFlow>,
    text: &str,
) -> crate::layout::LayoutRuntimePage {
    let length = text.encode_utf16().count() as u32;
    page(
        index,
        vec![vec![run(
            text,
            slice(flow, 0, 0, length),
            0.0,
            f64::from(length) * 10.0,
            uniform_shape(length),
        )]],
        None,
    )
}

fn scope(first_page: usize, last_page: usize) -> LayoutTextPageRange {
    LayoutTextPageRange {
        first_page,
        last_page,
    }
}
