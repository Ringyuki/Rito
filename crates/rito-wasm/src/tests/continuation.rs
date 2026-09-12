use rito_core::{
    layout::LineBreaking,
    runtime::{RuntimeBoundedRevisionRequest, RuntimeRevisionHandle, RuntimeRevisionWorkBudget},
};
use serde_json::json;

use super::fixture::{layout, pinned_multi_chapter_wasm_document};
use crate::{WasmRuntimeError, WasmRuntimeErrorCode};

#[test]
fn bounded_revision_json_validates_requests_and_budget() {
    let mut document = pinned_multi_chapter_wasm_document();
    let malformed = document
        .create_bounded_revision_json(r#"{"layoutConfig":{}}"#)
        .expect_err("malformed request fails");
    let zero_budget = document
        .create_bounded_revision_json(
            &json!({
                "layoutConfig": layout(),
                "budget": { "maxTopLevelNodes": 0 }
            })
            .to_string(),
        )
        .expect_err("zero budget fails");

    assert_eq!(malformed.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(malformed
        .message()
        .contains("invalid bounded revision request JSON"));
    assert_eq!(zero_budget.code(), WasmRuntimeErrorCode::BadRequest);
    assert_eq!(
        zero_budget.message(),
        "maxTopLevelNodes must be greater than zero"
    );
}

#[test]
fn failed_bounded_create_transport_releases_the_revision_and_cursor() {
    let mut document = pinned_multi_chapter_wasm_document();
    let advance = document
        .document
        .create_bounded_revision(RuntimeBoundedRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Greedy,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .expect("bounded candidate is created");
    assert!(
        advance.continuation.is_none(),
        "the whole book paginates in one step"
    );
    let revision = RuntimeRevisionHandle::from(&advance.revision);
    let error = WasmRuntimeError::internal_error("injected bounded encoder failure");

    let result = document.finish_created_revision_transport(revision.clone(), None, |_, _, _| {
        Err::<String, _>(error.clone())
    });

    assert_eq!(result, Err(error));
    assert_eq!(document.document.revision_count(), 0);
    assert!(!document.document.has_revision(&revision.revision_id));
    let summary_error = document
        .get_revision_summary_json(&revision.revision_id)
        .expect_err("rolled-back candidate is unknown");
    assert_eq!(summary_error.code(), WasmRuntimeErrorCode::UnknownRevision);
    assert_eq!(summary_error.message(), "unknown revision: rev-1");
}
