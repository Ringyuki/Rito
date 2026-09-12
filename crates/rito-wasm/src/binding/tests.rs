use rito_core::runtime::{RuntimeRevisionError, RuntimeRevisionErrorKind};

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
    let error = WasmRuntimeError::from_revision(RuntimeRevisionError {
        kind: RuntimeRevisionErrorKind::StaleRevisionVersion,
        message: "stale".to_owned(),
    });
    let value = error_json_string(error);

    assert_eq!(
        value,
        r#"{"code":"stale-revision-version","message":"stale"}"#
    );
}

#[test]
fn chapter_local_wasm_bindings_keep_the_raw_api_contract() {
    let source = include_str!("chapter_local.rs");
    for method in [
        "createBoundedChapterLocalRevisionJson",
        "getChapterLocalRevisionSummaryJson",
        "resolveChapterLocalSourceLocatorJson",
        "getChapterLocalFrameCommandBufferMetadataJson",
        "readChapterLocalFrameCommandBuffer",
        "getChapterLocalResourcePayloadJson",
        "prefetchChapterLocalFrameResourcesJson",
        "readChapterLocalResourceTransfer",
        "takeChapterLocalResourceTransfer",
        "releaseChapterLocalResourceTransfer",
        "releaseChapterLocalRevisionJson",
    ] {
        assert!(
            source.contains(&format!("js_name = {method}")),
            "missing {method}"
        );
    }
}
