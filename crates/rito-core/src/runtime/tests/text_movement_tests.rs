use serde_json::json;

use super::pinned_font_policy_fixtures::{content_epub, layout};
use super::revisions::revision_by_id;
use crate::{
    interaction::{
        TextCaretAddress, TextCaretAffinity, TextSelectionBoundary, TextSelectionMovement,
    },
    runtime::{
        RuntimeDocument, RuntimeTextSelectionMovementRequest,
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
            preferred_block_position: None,
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
fn movement_rejects_a_non_finite_preference() {
    let bytes = content_epub("en", "<p>Wi</p>", "", None);
    let mut document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let error = document
        .resolve_text_selection_movement_in(
            &revision.revision_id,
            revision_by_id(&document, &revision.revision_id),
            RuntimeTextSelectionMovementRequest {
                anchor: text_address(0),
                focus: text_address(0),
                movement: TextSelectionMovement::LineDown,
                preferred_inline_position: Some(f64::NAN),
                preferred_block_position: None,
            },
        )
        .expect_err("non-finite sticky position fails");
    assert_eq!(
        error.to_string(),
        "text selection preferred positions must be finite"
    );
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
