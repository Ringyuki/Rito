use serde_json::json;

use super::super::tests::{address, exact_flow, exact_shape, page, run, slice, uniform_shape};
use super::super::{
    LayoutTextSelectionMovementResolution, TextCaretAffinity, TextInteractionUnavailableReason,
    TextSelectionMovement,
};
use super::{move_selection, scope};
use crate::layout::{RunShape, RunShapeDirection, RunShapeUnavailableReason};

#[test]
fn unavailable_shape_tail_cannot_become_a_boundary() {
    let flow = exact_flow("ab");
    let pages = vec![
        exact_head(&flow),
        page(
            1,
            vec![vec![run(
                "b",
                slice(&flow, 0, 1, 2),
                0.0,
                10.0,
                RunShape::unavailable(RunShapeUnavailableReason::HostMetricsFallback, 10.0),
            )]],
            None,
        ),
    ];
    let focus = head_end();

    for movement in [
        TextSelectionMovement::CharacterRight,
        TextSelectionMovement::LineDown,
        TextSelectionMovement::ChapterEnd,
    ] {
        assert_eq!(
            move_selection(&pages, scope(0, 1), focus, focus, movement, None),
            unavailable(TextInteractionUnavailableReason::ShapeUnavailable),
            "{movement:?} must not skip the unavailable retained tail",
        );
    }
}

#[test]
fn unavailable_remote_tail_does_not_poison_a_local_character_step() {
    let flow = exact_flow("ab");
    let pages = vec![
        exact_head(&flow),
        page(
            1,
            vec![vec![run(
                "b",
                slice(&flow, 0, 1, 2),
                0.0,
                10.0,
                RunShape::unavailable(RunShapeUnavailableReason::HostMetricsFallback, 10.0),
            )]],
            None,
        ),
    ];
    let start = address(0, 0, 0, 0, 0, TextCaretAffinity::Downstream);

    let selection = super::resolved(move_selection(
        &pages,
        scope(0, 1),
        start,
        start,
        TextSelectionMovement::CharacterRight,
        None,
    ));

    assert_eq!(selection.focus_caret.address, head_end());
    assert_eq!(selection.range.selected_text, "a");
}

#[test]
fn transformed_tail_cannot_become_a_boundary() {
    let flow = exact_flow("ab");
    let pages = vec![
        exact_head(&flow),
        page(
            1,
            vec![vec![run(
                "b",
                slice(&flow, 0, 1, 2),
                0.0,
                10.0,
                uniform_shape(1),
            )]],
            Some(json!({ "transform": [{ "kind": "rotate", "rad": 0.5 }] })),
        ),
    ];

    assert_eq!(
        move_selection(
            &pages,
            scope(0, 1),
            head_end(),
            head_end(),
            TextSelectionMovement::CharacterRight,
            None,
        ),
        unavailable(TextInteractionUnavailableReason::UnsupportedTransform),
    );
}

#[test]
fn clipped_geometry_tail_cannot_become_a_boundary() {
    let flow = exact_flow("ab");
    let mut tail = page(
        1,
        vec![vec![run(
            "b",
            slice(&flow, 0, 1, 2),
            -5.0,
            20.0,
            exact_shape(&[(0, 1, 20.0)], RunShapeDirection::LeftToRight),
        )]],
        Some(json!({ "clipToBounds": true })),
    );
    tail.content[0].width = 5.0;
    let pages = vec![exact_head(&flow), tail];

    assert_eq!(
        move_selection(
            &pages,
            scope(0, 1),
            head_end(),
            head_end(),
            TextSelectionMovement::CharacterRight,
            None,
        ),
        unavailable(TextInteractionUnavailableReason::VisualGeometryUnavailable),
    );
}

fn exact_head(
    flow: &std::sync::Arc<crate::layout::LogicalTextFlow>,
) -> crate::layout::LayoutRuntimePage {
    page(
        0,
        vec![vec![run(
            "a",
            slice(flow, 0, 0, 1),
            0.0,
            10.0,
            uniform_shape(1),
        )]],
        None,
    )
}

fn head_end() -> super::super::TextCaretAddress {
    address(0, 0, 0, 0, 1, TextCaretAffinity::Upstream)
}

fn unavailable(reason: TextInteractionUnavailableReason) -> LayoutTextSelectionMovementResolution {
    LayoutTextSelectionMovementResolution::Unavailable(reason)
}
