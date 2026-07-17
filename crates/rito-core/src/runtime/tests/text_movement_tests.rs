use serde_json::json;

use super::{
    fixture::multi_chapter_fixture_epub,
    pinned_font_policy_fixtures::{
        content_epub, face, font_aware_layout, policy, serif_text_font, title_font,
    },
    text_granularity_tests::cluster_center_with_page,
};
use crate::{
    interaction::{
        TextCaretAddress, TextCaretAffinity, TextInteractionUnavailableReason,
        TextSelectionBoundary, TextSelectionMovement,
    },
    layout::LineBreaking,
    runtime::{
        RuntimeBoundedRevisionRequest, RuntimeDocument, RuntimePinnedFontGenericRole,
        RuntimeRevisionAccessErrorKind, RuntimeRevisionHandle, RuntimeRevisionWorkBudget,
        RuntimeTextCaretResolution, RuntimeTextPointRequest, RuntimeTextSelectionMovementRequest,
        RuntimeTextSelectionMovementResolution, RuntimeTextSelectionMovementResponse,
    },
};

mod movement_semantics;

#[test]
fn movement_contract_uses_optional_camel_case_positions_and_typed_pending() {
    let address = text_address(2);
    assert_eq!(
        serde_json::to_value(RuntimeTextSelectionMovementRequest {
            anchor: address,
            focus: address,
            movement: TextSelectionMovement::WordStartRight,
            preferred_inline_position: None,
        })
        .expect("movement request serializes"),
        json!({
            "anchor": serde_json::to_value(address).expect("anchor serializes"),
            "focus": serde_json::to_value(address).expect("focus serializes"),
            "movement": "wordStartRight",
        })
    );
    assert_eq!(
        serde_json::to_value(TextSelectionMovement::ParagraphPreviousStart)
            .expect("previous paragraph start movement serializes"),
        json!("paragraphPreviousStart")
    );
    assert_eq!(
        serde_json::to_value(TextSelectionMovement::ParagraphNextStart)
            .expect("next paragraph start movement serializes"),
        json!("paragraphNextStart")
    );
    assert_eq!(
        serde_json::to_value(RuntimeTextSelectionMovementResponse {
            revision_id: "rev-4".to_owned(),
            resolution: RuntimeTextSelectionMovementResolution::Pending {
                boundary: TextSelectionBoundary::End,
            },
        })
        .expect("movement response serializes"),
        json!({
            "revisionId": "rev-4",
            "resolution": { "status": "pending", "boundary": "end" },
        })
    );
}

#[test]
fn paragraph_next_start_maps_an_incomplete_retained_tail_to_pending() {
    let (document, handle, caret) = incomplete_chapter_fixture();
    let first = document
        .resolve_text_selection_movement_at(
            &handle,
            RuntimeTextSelectionMovementRequest {
                anchor: caret,
                focus: caret,
                movement: TextSelectionMovement::ParagraphNextStart,
                preferred_inline_position: None,
            },
        )
        .expect("next retained paragraph start resolves");
    let RuntimeTextSelectionMovementResolution::Resolved { focus_caret, .. } =
        first.value.resolution
    else {
        panic!("second retained paragraph start resolves");
    };
    let response = document
        .resolve_text_selection_movement_at(
            &handle,
            RuntimeTextSelectionMovementRequest {
                anchor: caret,
                focus: focus_caret.address,
                movement: TextSelectionMovement::ParagraphNextStart,
                preferred_inline_position: None,
            },
        )
        .expect("unretained next paragraph returns a typed retained-tail result");

    assert_eq!(
        response.value.resolution,
        RuntimeTextSelectionMovementResolution::Pending {
            boundary: TextSelectionBoundary::End,
        }
    );
}

#[test]
fn chapter_end_waits_for_the_retained_chapter_to_complete() {
    let (document, handle, caret) = incomplete_chapter_fixture();
    let response = document
        .resolve_text_selection_movement_at(
            &handle,
            RuntimeTextSelectionMovementRequest {
                anchor: caret,
                focus: caret,
                movement: TextSelectionMovement::ChapterEnd,
                preferred_inline_position: None,
            },
        )
        .expect("chapter end returns a typed retained-tail result");

    assert_eq!(response.revision, handle);
    assert_eq!(
        response.value.resolution,
        RuntimeTextSelectionMovementResolution::Pending {
            boundary: TextSelectionBoundary::End,
        }
    );
}

#[test]
fn character_right_maps_an_incomplete_retained_tail_to_pending() {
    let (document, handle, anchor) = incomplete_chapter_fixture();
    let mut focus = anchor;
    for _ in 0..64 {
        let response = document
            .resolve_text_selection_movement_at(
                &handle,
                RuntimeTextSelectionMovementRequest {
                    anchor,
                    focus,
                    movement: TextSelectionMovement::CharacterRight,
                    preferred_inline_position: None,
                },
            )
            .expect("character movement returns a typed result");
        match response.value.resolution {
            RuntimeTextSelectionMovementResolution::Resolved { focus_caret, .. } => {
                focus = focus_caret.address;
            }
            RuntimeTextSelectionMovementResolution::Pending {
                boundary: TextSelectionBoundary::End,
            } => return,
            resolution => panic!("retained tail must become pending, got {resolution:?}"),
        }
    }
    panic!("retained tail is reached within the fixture's bounded text");
}

#[test]
fn movement_rejects_cross_chapter_endpoints_atomically() {
    let bytes = multi_chapter_fixture_epub();
    let mut document = pinned_document(&bytes, serif_text_font());
    let mut config = font_aware_layout();
    config.font_family_override = Some("serif".to_owned());
    config.font_family_force = Some(true);
    let revision = document
        .create_revision(&config)
        .expect("multi-chapter revision is created");
    let handle = RuntimeRevisionHandle::from(&revision);
    let anchor = caret_for_text(&document, &handle, "chapter one");
    let focus = caret_for_text(&document, &handle, "chapter two active window");
    let response = document
        .resolve_text_selection_movement_at(
            &handle,
            RuntimeTextSelectionMovementRequest {
                anchor,
                focus,
                movement: TextSelectionMovement::CharacterRight,
                preferred_inline_position: None,
            },
        )
        .expect("cross-chapter movement returns a typed result");

    assert_eq!(
        response.value.resolution,
        RuntimeTextSelectionMovementResolution::Unavailable {
            reason: TextInteractionUnavailableReason::DifferentChapter,
        }
    );
}

#[test]
fn movement_rejects_stale_versions_and_non_finite_preferences() {
    let bytes = content_epub("en", "<p>Wi</p>", "", None);
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let revision = document
        .create_revision(&font_aware_layout())
        .expect("revision is created");
    let request = RuntimeTextSelectionMovementRequest {
        anchor: text_address(0),
        focus: text_address(0),
        movement: TextSelectionMovement::LineDown,
        preferred_inline_position: Some(f64::NAN),
    };
    let stale = RuntimeRevisionHandle::new(
        &revision.revision_id,
        revision.revision_version.saturating_add(1),
    );
    let error = document
        .resolve_text_selection_movement_at(&stale, request)
        .expect_err("stale version fails before request evaluation");
    assert_eq!(
        error.kind,
        RuntimeRevisionAccessErrorKind::StaleRevisionVersion
    );
    let error = document
        .resolve_text_selection_movement_at(&RuntimeRevisionHandle::from(&revision), request)
        .expect_err("non-finite sticky position fails");
    assert_eq!(error.kind, RuntimeRevisionAccessErrorKind::OperationFailed);
}

fn pinned_document(bytes: &[u8], font: Vec<u8>) -> RuntimeDocument {
    RuntimeDocument::open_with_pinned_font_policy(
        bytes,
        policy(vec![face(
            font,
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("pinned document opens")
}

fn incomplete_chapter_fixture() -> (RuntimeDocument, RuntimeRevisionHandle, TextCaretAddress) {
    let bytes = content_epub(
        "en",
        r#"<p style="font-family: serif; page-break-after: always">first</p><p style="font-family: serif; page-break-after: always">second</p><p style="font-family: serif">third</p>"#,
        "",
        None,
    );
    let mut document = pinned_document(&bytes, title_font());
    let revision = document
        .create_bounded_revision(RuntimeBoundedRevisionRequest {
            layout_config: font_aware_layout(),
            line_breaking: LineBreaking::Greedy,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 2,
            },
        })
        .expect("first paragraph is retained");
    assert!(revision.continuation.is_some());
    let handle = RuntimeRevisionHandle::from(&revision.revision);
    let (page_index, x, y) =
        cluster_center_with_page(&document, &revision.revision.revision_id, "first", 2);
    let caret = exact_caret(&document, &handle, page_index, x, y);
    (document, handle, caret)
}

fn caret_for_text(
    document: &RuntimeDocument,
    handle: &RuntimeRevisionHandle,
    text: &str,
) -> TextCaretAddress {
    let (page_index, x, y) = cluster_center_with_page(document, &handle.revision_id, text, 2);
    exact_caret(document, handle, page_index, x, y)
}

fn exact_caret(
    document: &RuntimeDocument,
    handle: &RuntimeRevisionHandle,
    page_index: usize,
    x: f64,
    y: f64,
) -> TextCaretAddress {
    let response = document
        .resolve_text_caret_at(handle, RuntimeTextPointRequest { page_index, x, y })
        .expect("caret request succeeds");
    let RuntimeTextCaretResolution::Resolved { caret } = response.value.resolution else {
        panic!("caret is exact");
    };
    caret.address
}

fn text_address(page_index: usize) -> TextCaretAddress {
    TextCaretAddress {
        page_index,
        block_index: 0,
        line_index: 0,
        run_index: 0,
        char_index: 0,
        affinity: TextCaretAffinity::Downstream,
    }
}
