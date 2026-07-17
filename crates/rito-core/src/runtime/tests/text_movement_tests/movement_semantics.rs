use super::super::{
    pinned_font_policy_fixtures::{content_epub, face, font_aware_layout, policy, title_font},
    text_granularity_tests::cluster_center_with_page,
};
use super::{exact_caret, incomplete_chapter_fixture};
use crate::{
    interaction::{
        TextCaretAddress, TextInteractionUnavailableReason, TextSelectionBoundary,
        TextSelectionMovement,
    },
    runtime::{
        RuntimeDocument, RuntimePinnedFontGenericRole, RuntimeRevisionHandle,
        RuntimeTextSelectionMovementRequest, RuntimeTextSelectionMovementResolution,
    },
};

#[test]
fn line_end_at_a_retained_line_edge_is_not_pending() {
    let (document, handle, anchor) = incomplete_chapter_fixture();
    let first = document
        .resolve_text_selection_movement_at(
            &handle,
            RuntimeTextSelectionMovementRequest {
                anchor,
                focus: anchor,
                movement: TextSelectionMovement::LineEnd,
                preferred_inline_position: None,
            },
        )
        .expect("the retained line end resolves");
    let RuntimeTextSelectionMovementResolution::Resolved { focus_caret, .. } =
        first.value.resolution
    else {
        panic!("the initial focus is inside the retained line");
    };

    let response = document
        .resolve_text_selection_movement_at(
            &handle,
            RuntimeTextSelectionMovementRequest {
                anchor,
                focus: focus_caret.address,
                movement: TextSelectionMovement::LineEnd,
                preferred_inline_position: None,
            },
        )
        .expect("the known line boundary returns a typed result");

    assert_eq!(
        response.value.resolution,
        RuntimeTextSelectionMovementResolution::Boundary {
            boundary: TextSelectionBoundary::End,
        }
    );
}

#[test]
fn incomplete_chapter_end_rebinds_both_endpoints_before_pending() {
    let (document, handle, caret) = incomplete_chapter_fixture();
    let invalid = TextCaretAddress {
        char_index: usize::MAX,
        ..caret
    };

    for (anchor, focus) in [(invalid, caret), (caret, invalid)] {
        let response = document
            .resolve_text_selection_movement_at(
                &handle,
                RuntimeTextSelectionMovementRequest {
                    anchor,
                    focus,
                    movement: TextSelectionMovement::ChapterEnd,
                    preferred_inline_position: None,
                },
            )
            .expect("invalid retained caret returns a typed result");
        assert_eq!(
            response.value.resolution,
            RuntimeTextSelectionMovementResolution::Unavailable {
                reason: TextInteractionUnavailableReason::InvalidCaret,
            }
        );
    }
}

#[test]
fn word_movement_uses_the_package_language() {
    let bytes = content_epub(
        "fi",
        r#"<p style="font-family: serif">EU:ssa</p>"#,
        "",
        None,
    );
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &bytes,
        policy(vec![face(
            title_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("fi"),
        )]),
    )
    .expect("Finnish document opens");
    let revision = document
        .create_revision(&font_aware_layout())
        .expect("exact Finnish revision is created");
    let handle = RuntimeRevisionHandle::from(&revision);
    let (page_index, x, y) =
        cluster_center_with_page(&document, &revision.revision_id, "EU:ssa", 0);
    let caret = exact_caret(&document, &handle, page_index, x, y);
    assert_eq!(caret.char_index, 1);

    let response = document
        .resolve_text_selection_movement_at(
            &handle,
            RuntimeTextSelectionMovementRequest {
                anchor: caret,
                focus: caret,
                movement: TextSelectionMovement::WordRight,
                preferred_inline_position: None,
            },
        )
        .expect("Finnish word movement resolves");
    let RuntimeTextSelectionMovementResolution::Resolved {
        focus_caret, range, ..
    } = response.value.resolution
    else {
        panic!("Finnish tailoring keeps the colon inside the moved word");
    };

    assert_eq!(focus_caret.address.char_index, 6);
    assert_eq!(range.selected_text, "U:ssa");
}
