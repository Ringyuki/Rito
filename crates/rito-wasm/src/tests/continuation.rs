use rito_core::{
    layout::LineBreaking,
    runtime::{RuntimeBoundedRevisionRequest, RuntimeRevisionHandle, RuntimeRevisionWorkBudget},
};
use serde_json::{json, Value};

use super::fixture::{layout, multi_chapter_document};
use crate::{WasmRuntimeDocument, WasmRuntimeError, WasmRuntimeErrorCode};

fn start_bounded(document: &mut WasmRuntimeDocument) -> Value {
    let response = document
        .create_bounded_revision_json(
            &json!({
                "layoutConfig": layout(),
                "lineBreaking": "greedy",
                "budget": { "maxTopLevelNodes": 1 }
            })
            .to_string(),
        )
        .expect("bounded revision starts");
    serde_json::from_str(&response).expect("bounded response parses")
}

fn continue_request(advance: &Value) -> String {
    json!({
        "revisionId": advance["continuation"]["revisionId"],
        "revisionVersion": advance["continuation"]["revisionVersion"],
        "cursor": advance["continuation"]["cursor"],
        "budget": { "maxTopLevelNodes": 1 }
    })
    .to_string()
}

#[test]
fn bounded_revision_json_advances_from_partial_to_complete() {
    let mut document = WasmRuntimeDocument::from_loaded_document(multi_chapter_document());
    let initial = start_bounded(&mut document);

    assert_eq!(initial["revision"]["revisionId"], "rev-1");
    assert_eq!(initial["revision"]["revisionVersion"], 0);
    assert_ne!(initial["revision"]["status"], "complete");
    assert_eq!(
        initial["previousKnownExtent"],
        json!({
            "pageCount": 0,
            "spreadCount": 0
        })
    );
    assert_eq!(initial["processedTopLevelNodes"], 1);
    assert_eq!(
        initial["revision"]["pageCount"],
        initial["revision"]["knownExtent"]["pageCount"]
    );
    assert_eq!(
        initial["revision"]["spreadCount"],
        initial["revision"]["knownExtent"]["spreadCount"]
    );
    assert!(initial["revision"].get("finalExtent").is_none());
    assert_eq!(
        initial["newlyKnownPages"]["startPage"],
        initial["previousKnownExtent"]["pageCount"]
    );
    assert_eq!(
        initial["newlyKnownPages"]["endPageExclusive"],
        initial["revision"]["knownExtent"]["pageCount"]
    );
    assert_eq!(initial["continuation"]["revisionId"], "rev-1");
    assert_eq!(initial["continuation"]["revisionVersion"], 0);
    assert!(initial["continuation"]["cursor"].as_str().is_some());

    let completed_json = document
        .continue_revision_json(&continue_request(&initial))
        .expect("bounded revision completes");
    let completed: Value = serde_json::from_str(&completed_json).expect("completion parses");

    assert_eq!(completed["revision"]["revisionVersion"], 1);
    assert_eq!(completed["revision"]["status"], "complete");
    assert_eq!(
        completed["revision"]["finalExtent"],
        completed["revision"]["knownExtent"]
    );
    assert_eq!(
        completed["previousKnownExtent"],
        initial["revision"]["knownExtent"]
    );
    assert_eq!(completed["processedTopLevelNodes"], 1);
    assert!(completed.get("continuation").is_none());

    let summary_json = document
        .get_revision_summary_json("rev-1")
        .expect("summary is available");
    let summary: Value = serde_json::from_str(&summary_json).expect("summary parses");
    assert_eq!(summary, completed["revision"]);
}

#[test]
fn bounded_revision_json_rejects_stale_and_replayed_cursors() {
    let mut document = WasmRuntimeDocument::from_loaded_document(multi_chapter_document());
    let initial = start_bounded(&mut document);
    let valid_request = continue_request(&initial);
    let stale_request = json!({
        "revisionId": "rev-1",
        "revisionVersion": 1,
        "cursor": initial["continuation"]["cursor"],
        "budget": { "maxTopLevelNodes": 1 }
    });

    let stale = document
        .continue_revision_json(&stale_request.to_string())
        .expect_err("stale version fails");
    assert_eq!(stale.code(), WasmRuntimeErrorCode::StaleRevisionVersion);
    assert!(stale.message().contains("revision version"));

    let missing_cursor = document
        .continue_revision_json(
            &json!({
                "revisionId": "rev-1",
                "revisionVersion": 0,
                "cursor": "cursor-missing",
                "budget": { "maxTopLevelNodes": 1 }
            })
            .to_string(),
        )
        .expect_err("unknown cursor fails");
    assert_eq!(missing_cursor.code(), WasmRuntimeErrorCode::EngineError);
    assert_eq!(
        missing_cursor.message(),
        "unknown or consumed continuation cursor: cursor-missing"
    );

    document
        .continue_revision_json(&valid_request)
        .expect("failed precondition did not consume the cursor");
    let replay = document
        .continue_revision_json(&valid_request)
        .expect_err("consumed cursor cannot replay");
    assert_eq!(replay.code(), WasmRuntimeErrorCode::StaleRevisionVersion);
    assert!(replay.message().contains("revision version"));
}

#[test]
fn bounded_revision_json_cancels_by_version() {
    let mut document = WasmRuntimeDocument::from_loaded_document(multi_chapter_document());
    let initial = start_bounded(&mut document);
    let cancel_request = json!({
        "revisionId": initial["revision"]["revisionId"],
        "revisionVersion": initial["revision"]["revisionVersion"]
    });

    let cancelled_json = document
        .cancel_revision_json(&cancel_request.to_string())
        .expect("revision cancels");
    let cancelled: Value = serde_json::from_str(&cancelled_json).expect("cancellation parses");

    assert_eq!(cancelled["revisionId"], "rev-1");
    assert_eq!(cancelled["revisionVersion"], 1);
    assert_eq!(cancelled["status"], "cancelled");
    assert!(cancelled.get("finalExtent").is_none());
    let summary: Value = serde_json::from_str(
        &document
            .get_revision_summary_json("rev-1")
            .expect("cancelled summary is available"),
    )
    .expect("summary parses");
    assert_eq!(summary, cancelled);

    let after_cancel = document
        .continue_revision_json(
            &json!({
                "revisionId": "rev-1",
                "revisionVersion": 1,
                "cursor": initial["continuation"]["cursor"],
                "budget": { "maxTopLevelNodes": 1 }
            })
            .to_string(),
        )
        .expect_err("cancelled revision cannot continue");
    assert_eq!(after_cancel.code(), WasmRuntimeErrorCode::EngineError);
    assert_eq!(
        after_cancel.message(),
        "revision is not continuable: Cancelled"
    );
}

#[test]
fn bounded_revision_json_validates_requests_and_budget() {
    let mut document = WasmRuntimeDocument::from_loaded_document(multi_chapter_document());
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
    let mut document = WasmRuntimeDocument::from_loaded_document(multi_chapter_document());
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
    let continuation = advance
        .continuation
        .clone()
        .expect("partial candidate owns a continuation");
    let revision = RuntimeRevisionHandle::from(&advance.revision);
    let error = WasmRuntimeError::internal_error("injected bounded encoder failure");

    let result = document.finish_created_revision_transport(revision.clone(), None, |_, _, _| {
        Err::<String, _>(error.clone())
    });

    assert_eq!(result, Err(error));
    assert_eq!(document.document.revision_count(), 0);
    assert!(!document.document.has_revision(&revision.revision_id));
    let continue_error = document
        .continue_revision_json(
            &json!({
                "revisionId": continuation.revision_id,
                "revisionVersion": continuation.revision_version,
                "cursor": continuation.cursor,
                "budget": { "maxTopLevelNodes": 1 }
            })
            .to_string(),
        )
        .expect_err("rolled-back candidate cannot continue");
    assert_eq!(continue_error.code(), WasmRuntimeErrorCode::UnknownRevision);
    assert_eq!(continue_error.message(), "unknown revision: rev-1");
}
