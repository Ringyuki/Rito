use super::super::{
    fixture::multi_chapter_fixture_epub,
    pinned_font_policy_fixtures::{content_epub, font_aware_layout, serif_text_font},
};
use super::{caret_for_text, incomplete_chapter_fixture, pinned_document};
use crate::{
    interaction::{TextCaretAddress, TextSelectionBoundary, TextSelectionMovement},
    layout::SpreadMode,
    runtime::{
        RuntimeDocument, RuntimeRevisionHandle, RuntimeTextSelectionMovementRequest,
        RuntimeTextSelectionMovementResolution,
    },
};

#[test]
fn document_edges_cross_chapters_and_report_final_boundaries() {
    let bytes = multi_chapter_fixture_epub();
    let mut document = pinned_document(&bytes, serif_text_font());
    let mut config = font_aware_layout();
    config.font_family_override = Some("serif".to_owned());
    config.font_family_force = Some(true);
    let revision = document
        .create_revision(&config)
        .expect("multi-chapter revision is created");
    let handle = RuntimeRevisionHandle::from(&revision);
    let middle = caret_for_text(&document, &handle, "chapter two active window");

    let start = resolved(movement(
        &document,
        &handle,
        middle,
        middle,
        TextSelectionMovement::DocumentStart,
        None,
        None,
    ));
    assert!(start.address.page_index < middle.page_index);
    let start_boundary = movement(
        &document,
        &handle,
        middle,
        start.address,
        TextSelectionMovement::DocumentStart,
        None,
        None,
    );
    assert_eq!(
        start_boundary,
        RuntimeTextSelectionMovementResolution::Boundary {
            boundary: TextSelectionBoundary::Start,
        }
    );

    let end = resolved(movement(
        &document,
        &handle,
        middle,
        middle,
        TextSelectionMovement::DocumentEnd,
        None,
        None,
    ));
    assert!(end.address.page_index > middle.page_index);
    let end_boundary = movement(
        &document,
        &handle,
        middle,
        end.address,
        TextSelectionMovement::DocumentEnd,
        None,
        None,
    );
    assert_eq!(
        end_boundary,
        RuntimeTextSelectionMovementResolution::Boundary {
            boundary: TextSelectionBoundary::End,
        }
    );
}

#[test]
fn document_end_and_page_down_wait_at_an_incomplete_retained_tail() {
    let (document, handle, anchor) = incomplete_chapter_fixture();
    assert_eq!(
        movement(
            &document,
            &handle,
            anchor,
            anchor,
            TextSelectionMovement::DocumentEnd,
            None,
            None,
        ),
        RuntimeTextSelectionMovementResolution::Pending {
            boundary: TextSelectionBoundary::End,
        }
    );

    let first_page_down = resolved(movement(
        &document,
        &handle,
        anchor,
        anchor,
        TextSelectionMovement::PageDown,
        None,
        None,
    ));
    assert!(first_page_down.address.page_index > anchor.page_index);
    let pending = movement(
        &document,
        &handle,
        anchor,
        first_page_down.address,
        TextSelectionMovement::PageDown,
        None,
        None,
    );
    assert_eq!(
        pending,
        RuntimeTextSelectionMovementResolution::Pending {
            boundary: TextSelectionBoundary::End,
        }
    );
}

#[test]
fn single_spread_page_movement_uses_adjacent_pages_and_sticky_geometry() {
    let (document, handle) = forced_page_document(3, SpreadMode::Single, true);
    let first = caret_for_text(&document, &handle, "page marker 0");
    let second = caret_for_text(&document, &handle, "page marker 1");
    let response = movement(
        &document,
        &handle,
        first,
        first,
        TextSelectionMovement::PageDown,
        Some(123.0),
        Some(77.0),
    );
    let RuntimeTextSelectionMovementResolution::Resolved {
        focus_caret,
        preferred_inline_position,
        preferred_block_position,
        ..
    } = response
    else {
        panic!("single-spread page down resolves");
    };
    assert_eq!(focus_caret.address.page_index, second.page_index);
    assert_eq!(preferred_inline_position, Some(123.0));
    assert_eq!(preferred_block_position, Some(77.0));

    let up = resolved(movement(
        &document,
        &handle,
        first,
        focus_caret.address,
        TextSelectionMovement::PageUp,
        preferred_inline_position,
        preferred_block_position,
    ));
    assert_eq!(up.address.page_index, first.page_index);
}

#[test]
fn double_spread_page_movement_keeps_side_and_falls_back_to_left_slot() {
    let (document, handle) = forced_page_document(5, SpreadMode::Double, false);
    let second = caret_for_text(&document, &handle, "page marker 1");
    let fourth = caret_for_text(&document, &handle, "page marker 3");
    let fifth = caret_for_text(&document, &handle, "page marker 4");

    let same_side = resolved(movement(
        &document,
        &handle,
        second,
        second,
        TextSelectionMovement::PageDown,
        None,
        None,
    ));
    assert_eq!(same_side.address.page_index, fourth.page_index);

    let fallback = resolved(movement(
        &document,
        &handle,
        second,
        same_side.address,
        TextSelectionMovement::PageDown,
        None,
        None,
    ));
    assert_eq!(fallback.address.page_index, fifth.page_index);
}

fn forced_page_document(
    page_count: usize,
    spread_mode: SpreadMode,
    first_page_alone: bool,
) -> (RuntimeDocument, RuntimeRevisionHandle) {
    let body = (0..page_count)
        .map(|index| {
            let page_break = (index + 1 < page_count).then_some("break-after: column;");
            format!(
                r#"<p style="font-family: serif; {}">page marker {index}</p>"#,
                page_break.unwrap_or_default()
            )
        })
        .collect::<String>();
    let bytes = content_epub("en", &body, "", None);
    let mut document = pinned_document(&bytes, serif_text_font());
    let mut config = font_aware_layout();
    config.spread_mode = spread_mode;
    config.first_page_alone = first_page_alone;
    let revision = document
        .create_revision(&config)
        .expect("forced-page revision is created");
    assert_eq!(revision.page_count, page_count);
    (document, RuntimeRevisionHandle::from(&revision))
}

fn movement(
    document: &RuntimeDocument,
    handle: &RuntimeRevisionHandle,
    anchor: TextCaretAddress,
    focus: TextCaretAddress,
    movement: TextSelectionMovement,
    preferred_inline_position: Option<f64>,
    preferred_block_position: Option<f64>,
) -> RuntimeTextSelectionMovementResolution {
    document
        .resolve_text_selection_movement_at(
            handle,
            RuntimeTextSelectionMovementRequest {
                anchor,
                focus,
                movement,
                preferred_inline_position,
                preferred_block_position,
            },
        )
        .expect("movement request resolves")
        .value
        .resolution
}

fn resolved(
    resolution: RuntimeTextSelectionMovementResolution,
) -> Box<crate::runtime::RuntimeTextCaret> {
    let RuntimeTextSelectionMovementResolution::Resolved { focus_caret, .. } = resolution else {
        panic!("movement should resolve, got {resolution:?}");
    };
    focus_caret
}
