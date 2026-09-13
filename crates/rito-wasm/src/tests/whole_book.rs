use rito_core::runtime::RuntimeRevisionHandle;

use super::fixture::{layout, pinned_multi_chapter_wasm_document};
use crate::{WasmRuntimeError, WasmRuntimeErrorCode};

#[test]
fn revision_json_validates_its_layout_config() {
    let mut document = pinned_multi_chapter_wasm_document();
    let malformed = document
        .create_revision_json(r#"{}"#)
        .expect_err("malformed layout config fails");

    assert_eq!(malformed.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(malformed.message().contains("invalid layout config JSON"));
}

#[test]
fn failed_create_transport_releases_the_revision() {
    let mut document = pinned_multi_chapter_wasm_document();
    let summary = document
        .document
        .create_revision(&layout())
        .expect("candidate revision is created");
    let revision = RuntimeRevisionHandle::from(&summary);
    let error = WasmRuntimeError::internal_error("injected encoder failure");

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
