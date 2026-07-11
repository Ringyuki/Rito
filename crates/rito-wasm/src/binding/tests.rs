use rito_core::runtime::{
    RuntimeContinuationError, RuntimeContinuationErrorKind, RuntimeRevisionExtent,
    RuntimeRevisionStatus, RuntimeRevisionSummary,
};

use super::{error_json_string, parse_resource_kind};
use crate::{WasmRuntimeError, WasmRuntimeErrorCode};

#[test]
fn parses_wire_resource_kinds() {
    assert!(parse_resource_kind("image").is_ok());
    assert!(parse_resource_kind("font").is_ok());
    assert!(parse_resource_kind("stylesheet").is_ok());

    let error = parse_resource_kind("audio").expect_err("unsupported kind fails");

    assert_eq!(error.code(), WasmRuntimeErrorCode::BadRequest);
    assert_eq!(error.message(), "unsupported resource kind: audio");
}

#[test]
fn serializes_structured_errors_to_json_strings() {
    let value = error_json_string(WasmRuntimeError::bad_request("bad input"));

    assert_eq!(value, r#"{"code":"bad-request","message":"bad input"}"#);
}

#[test]
fn serializes_stale_revision_as_a_stable_wire_code() {
    let error = WasmRuntimeError::from_continuation(RuntimeContinuationError {
        kind: RuntimeContinuationErrorKind::StaleRevisionVersion,
        message: "stale".to_owned(),
        revision: None,
    });
    let value = error_json_string(error);

    assert_eq!(
        value,
        r#"{"code":"stale-revision-version","message":"stale"}"#
    );
}

#[test]
fn serializes_failed_revision_state_with_continuation_errors() {
    let error = WasmRuntimeError::from_continuation(RuntimeContinuationError {
        kind: RuntimeContinuationErrorKind::EngineFailure,
        message: "layout failed".to_owned(),
        revision: Some(Box::new(RuntimeRevisionSummary {
            revision_id: "rev-7".to_owned(),
            revision_version: 4,
            layout_key: "layout".to_owned(),
            status: RuntimeRevisionStatus::Failed,
            known_extent: RuntimeRevisionExtent {
                page_count: 2,
                spread_count: 2,
            },
            final_extent: None,
            page_count: 2,
            spread_count: 2,
        })),
    });
    let value: serde_json::Value =
        serde_json::from_str(&error_json_string(error)).expect("structured error JSON parses");

    assert_eq!(value["code"], "engine-error");
    assert_eq!(value["revision"]["revisionId"], "rev-7");
    assert_eq!(value["revision"]["revisionVersion"], 4);
    assert_eq!(value["revision"]["status"], "failed");
}
