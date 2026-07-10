mod fixture;

use fixture::{
    fixture_document, layout, minimal_png, multi_chapter_document, resource_payload, revision_id,
};
use rito_core::runtime::{
    decode_runtime_bundle, RuntimeResourceKind, RuntimeResourceTransferPayload,
};
use serde_json::Value;

use super::{WasmRuntimeDocument, WasmRuntimeErrorCode};

#[test]
fn links_against_core() {
    assert_eq!(super::BOUNDARY_NAME, "rito-wasm");
    assert_eq!(super::core_engine_name(), "rito-core");
}

#[test]
fn creates_revision_and_frame_json() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_json = document
        .create_full_revision_bundle_json(
            &serde_json::json!({
                "layoutConfig": layout(),
                "activeSpreadIndex": 0
            })
            .to_string(),
        )
        .expect("revision JSON is created");
    let revision: Value = serde_json::from_str(&revision_json).expect("revision JSON parses");
    let revision_id = revision["bundle"]["revision"]["revisionId"]
        .as_str()
        .expect("revision id is available");

    let frame_json = document
        .get_frame_json(revision_id, 0)
        .expect("frame JSON is created");
    let frame: Value = serde_json::from_str(&frame_json).expect("frame JSON parses");

    assert_eq!(revision_id, "rev-1");
    assert_eq!(frame["revisionId"], "rev-1");
    assert_eq!(frame["spreadIndex"], 0);
    assert!(frame["commands"]
        .as_array()
        .is_some_and(|commands| !commands.is_empty()));
    assert!(frame["commands"]
        .as_array()
        .expect("commands are available")
        .iter()
        .any(|command| command["kind"] == "paintText" && command["text"].as_str().is_some()));
    assert!(frame["commandHash"]
        .as_str()
        .is_some_and(|hash| !hash.is_empty()));
}

#[test]
fn creates_revision_from_structured_request_with_line_breaking() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let request = serde_json::json!({
        "layoutConfig": layout(),
        "lineBreaking": "optimal",
        "activeSpreadIndex": 0,
    });

    let revision_json = document
        .create_full_revision_bundle_json(&request.to_string())
        .expect("structured revision request is accepted");
    let revision: Value = serde_json::from_str(&revision_json).expect("revision JSON parses");

    assert_eq!(revision["bundle"]["revision"]["revisionId"], "rev-1");
    assert_eq!(revision["bundle"]["revision"]["pageCount"], 2);
}

#[test]
fn creates_initial_preview_revision_bundle_json() {
    let mut document = WasmRuntimeDocument::from_loaded_document(multi_chapter_document());
    let request = serde_json::json!({
        "layoutConfig": layout(),
        "lineBreaking": "greedy",
    });

    let bundle_json = document
        .create_initial_preview_revision_bundle_json(&request.to_string())
        .expect("initial preview bundle JSON is created");
    let response: Value = serde_json::from_str(&bundle_json).expect("bundle JSON parses");

    assert_eq!(response["bundle"]["revision"]["revisionId"], "rev-1");
    assert!(response["bundle"]["fontFamilies"]
        .as_array()
        .is_some_and(|families| !families.is_empty()));
    assert_eq!(
        response["bundle"]["tocTargets"]["targets"],
        Value::Array(Vec::new())
    );
    assert!(response.get("initialFrame").is_none());
    assert_eq!(response["frameSelection"]["spreadIndex"], 0);
    assert_eq!(response["frameSelection"]["displaySpreadIndex"], 0);
    assert_eq!(
        response["initialFrameWindow"]["plan"]["revisionId"],
        "rev-1"
    );
    assert_eq!(
        response["initialFrameWindow"]["plan"]["centerSpreadIndex"],
        0
    );
    assert_eq!(
        response["initialFrameWindow"]["plan"]["displaySpreadIndex"],
        0
    );
    assert!(response["initialFrameWindow"]["spreads"]
        .as_array()
        .is_some_and(|spreads| !spreads.is_empty()));
    assert!(response.get("displaySpreadIndex").is_none());
    assert_eq!(response["preview"], true);
    assert_eq!(response["releasedPreviousRevisionTransferCount"], 0);
}

#[test]
fn creates_full_revision_bundle_json_with_planned_initial_window() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let request = serde_json::json!({
        "layoutConfig": layout(),
        "lineBreaking": "greedy",
        "activeSpreadIndex": 99,
    });

    let bundle_json = document
        .create_full_revision_bundle_json(&request.to_string())
        .expect("full revision bundle JSON is created");
    let response: Value = serde_json::from_str(&bundle_json).expect("bundle JSON parses");

    assert_eq!(response["bundle"]["revision"]["revisionId"], "rev-1");
    assert_eq!(response["preview"], false);
    assert!(response.get("initialFrame").is_none());
    assert_eq!(
        response["initialFrameWindow"]["plan"]["revisionId"],
        "rev-1"
    );
    assert_eq!(
        response["initialFrameWindow"]["plan"]["centerSpreadIndex"].as_u64(),
        Some(
            response["bundle"]["revision"]["spreadCount"]
                .as_u64()
                .unwrap()
                - 1
        )
    );
    assert_eq!(
        response["initialFrameWindow"]["plan"]["displaySpreadIndex"].as_u64(),
        response["initialFrameWindow"]["plan"]["centerSpreadIndex"].as_u64()
    );
    assert_eq!(
        response["frameSelection"]["spreadIndex"].as_u64(),
        response["initialFrameWindow"]["plan"]["centerSpreadIndex"].as_u64()
    );
    assert_eq!(
        response["frameSelection"]["displaySpreadIndex"].as_u64(),
        response["initialFrameWindow"]["plan"]["displaySpreadIndex"].as_u64()
    );
    assert!(response.get("displaySpreadIndex").is_none());
}

#[test]
fn returns_packed_frame_command_buffer_metadata_and_bytes() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_id = revision_id(&mut document);

    let frame = document
        .get_frame_json(&revision_id, 0)
        .expect("frame JSON is returned");
    let frame: Value = serde_json::from_str(&frame).expect("frame JSON parses");
    let metadata_json = document
        .get_frame_command_buffer_metadata_json(&revision_id, 0)
        .expect("command buffer metadata JSON is returned");
    let metadata: Value =
        serde_json::from_str(&metadata_json).expect("command buffer metadata parses");
    let bytes = document
        .read_frame_command_buffer(&revision_id, 0)
        .expect("command buffer bytes are returned");

    assert_eq!(metadata["revisionId"], revision_id);
    assert_eq!(metadata["spreadIndex"], 0);
    assert_eq!(metadata["commandCount"], frame["commandCount"]);
    assert_eq!(metadata["commandHash"], frame["commandHash"]);
    assert_eq!(metadata["fontFamilies"], frame["fontFamilies"]);
    assert_eq!(metadata["byteLength"], bytes.len());
    assert_eq!(&bytes[0..8], b"RITOFCB2");
    assert!(metadata["payloadTable"]
        .as_array()
        .is_some_and(|payloads| !payloads.is_empty()));
}

#[test]
fn creates_active_chapter_preview_revision_bundle_json() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture::multi_chapter_document());
    let full_json = document
        .create_full_revision_bundle_json(
            &serde_json::json!({
                "layoutConfig": layout(),
                "activeSpreadIndex": 1
            })
            .to_string(),
        )
        .expect("full revision bundle is returned");
    let full: Value = serde_json::from_str(&full_json).expect("full bundle JSON parses");
    let full_revision_id = full["bundle"]["revision"]["revisionId"]
        .as_str()
        .expect("full revision id is present");

    let preview_json = document
        .create_active_chapter_preview_revision_bundle_json(
            &serde_json::json!({
                "layoutConfig": layout(),
                "previousRevisionId": full_revision_id,
                "activeSpreadIndex": 1
            })
            .to_string(),
        )
        .expect("active preview bundle is returned");
    let preview: Value = serde_json::from_str(&preview_json).expect("preview JSON parses");

    assert_eq!(preview["preview"], true);
    assert_eq!(
        preview["bundle"]["tocTargets"]["targets"],
        serde_json::json!([])
    );
    assert_eq!(
        preview["bundle"]["chapterTextIndices"]["entries"]
            .as_object()
            .map(|entries| entries.keys().cloned().collect::<Vec<_>>()),
        Some(vec!["chapter-2".to_owned()])
    );
    assert!(preview.get("initialFrame").is_none());
    assert_eq!(preview["frameSelection"]["spreadIndex"], 0);
    assert_eq!(preview["frameSelection"]["displaySpreadIndex"], 1);
    assert_eq!(
        preview["initialFrameWindow"]["plan"]["displaySpreadIndex"],
        1
    );
    assert!(preview.get("displaySpreadIndex").is_none());
}

#[test]
fn creates_unified_preview_revision_bundle_json() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture::multi_chapter_document());
    let initial_json = document
        .create_preview_revision_bundle_json(
            &serde_json::json!({
                "layoutConfig": layout(),
                "lineBreaking": "greedy"
            })
            .to_string(),
        )
        .expect("initial preview bundle is returned");
    let initial: Value = serde_json::from_str(&initial_json).expect("initial JSON parses");
    let initial_revision_id = initial["bundle"]["revision"]["revisionId"]
        .as_str()
        .expect("initial revision id is present");
    let active_json = document
        .create_preview_revision_bundle_json(
            &serde_json::json!({
                "layoutConfig": layout(),
                "previousRevisionId": initial_revision_id,
                "activeSpreadIndex": 1
            })
            .to_string(),
        )
        .expect("active preview bundle is returned");
    let active: Value = serde_json::from_str(&active_json).expect("active JSON parses");

    assert_eq!(initial["preview"], true);
    assert_eq!(initial["frameSelection"]["spreadIndex"], 0);
    assert_eq!(active["preview"], true);
    assert_eq!(active["frameSelection"]["displaySpreadIndex"], 1);
    assert_eq!(active["releasedPreviousRevisionTransferCount"], 0);
}

#[test]
fn create_view_revision_json_declares_display_policy() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture::multi_chapter_document());
    let initial_json = document
        .create_view_revision_bundle_json(
            &serde_json::json!({
                "layoutConfig": layout(),
                "lineBreaking": "greedy",
                "activeSpreadIndex": 0,
                "mode": "preview"
            })
            .to_string(),
        )
        .expect("initial view JSON is returned");
    let initial: Value = serde_json::from_str(&initial_json).expect("initial JSON parses");
    let initial_revision_id = initial["result"]["bundle"]["revision"]["revisionId"]
        .as_str()
        .expect("initial revision id is present");
    let active_json = document
        .create_view_revision_bundle_json(
            &serde_json::json!({
                "layoutConfig": layout(),
                "lineBreaking": "greedy",
                "activeSpreadIndex": 1,
                "previousRevisionId": initial_revision_id,
                "mode": "preview"
            })
            .to_string(),
        )
        .expect("active view JSON is returned");
    let active: Value = serde_json::from_str(&active_json).expect("active JSON parses");

    assert_eq!(initial["display"], "revision");
    assert_eq!(active["display"], "visualPreview");
    assert_eq!(active["kind"], "preview");
    assert_eq!(
        initial["followUp"]["previousRevisionId"],
        initial["result"]["bundle"]["revision"]["revisionId"]
    );
    assert_eq!(
        active["followUp"]["previousRevisionId"],
        initial["result"]["bundle"]["revision"]["revisionId"]
    );
    assert_eq!(active["followUp"]["mode"], "full");
}

#[test]
fn create_view_revision_ritorb1_matches_json_across_revision_modes() {
    let mut json_document =
        WasmRuntimeDocument::from_loaded_document(fixture::multi_chapter_document());
    let mut binary_document =
        WasmRuntimeDocument::from_loaded_document(fixture::multi_chapter_document());

    let initial = assert_view_revision_wire_agreement(
        &mut json_document,
        &mut binary_document,
        serde_json::json!({
            "layoutConfig": layout(),
            "lineBreaking": "greedy",
            "activeSpreadIndex": 0,
            "mode": "preview"
        }),
    );
    let initial_revision_id = initial["result"]["bundle"]["revision"]["revisionId"]
        .as_str()
        .expect("initial revision id is present");
    assert_eq!(initial["kind"], "preview");
    assert_eq!(initial["display"], "revision");
    assert_eq!(initial["followUp"]["mode"], "full");

    let active = assert_view_revision_wire_agreement(
        &mut json_document,
        &mut binary_document,
        serde_json::json!({
            "layoutConfig": layout(),
            "lineBreaking": "greedy",
            "activeSpreadIndex": 1,
            "previousRevisionId": initial_revision_id,
            "mode": "preview"
        }),
    );
    let active_revision_id = active["result"]["bundle"]["revision"]["revisionId"]
        .as_str()
        .expect("active revision id is present");
    assert_eq!(active["kind"], "preview");
    assert_eq!(active["display"], "visualPreview");
    assert_eq!(
        active["followUp"]["previousRevisionId"],
        initial_revision_id
    );

    let full = assert_view_revision_wire_agreement(
        &mut json_document,
        &mut binary_document,
        serde_json::json!({
            "layoutConfig": layout(),
            "lineBreaking": "greedy",
            "activeSpreadIndex": 1,
            "previousRevisionId": active_revision_id,
            "mode": "full"
        }),
    );
    assert_eq!(full["kind"], "full");
    assert_eq!(full["display"], "revision");
    assert!(full["followUp"].is_null());
}

#[test]
fn create_view_revision_ritorb1_matches_json_with_resource_metadata() {
    let mut json_document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let mut binary_document = WasmRuntimeDocument::from_loaded_document(fixture_document());

    let full = assert_view_revision_wire_agreement(
        &mut json_document,
        &mut binary_document,
        serde_json::json!({
            "layoutConfig": layout(),
            "lineBreaking": "greedy",
            "activeSpreadIndex": 0,
            "mode": "full"
        }),
    );

    let initial_window = &full["result"]["initialFrameWindow"];
    assert!(initial_window["spreads"]
        .as_array()
        .is_some_and(|spreads| !spreads.is_empty()));
    assert!(initial_window["spreads"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|spread| spread["payloads"].as_array().into_iter().flatten())
        .any(|payload| payload["href"] == "Images/cover.png"));
}

#[test]
fn measures_json_view_revision_wire_once() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let request = full_view_revision_request();

    document.measure_next_view_revision_wire();
    let payload = document
        .create_view_revision_bundle_json(&request)
        .expect("JSON view bundle is returned");
    document
        .create_view_revision_bundle_bytes(&request)
        .expect("unarmed RITORB1 view bundle is returned");

    assert_view_revision_wire_metrics(&mut document, "json", payload.len());
    assert_eq!(take_view_revision_wire_metrics(&mut document), Value::Null);
}

#[test]
fn measures_ritorb1_view_revision_wire_bytes() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());

    document.measure_next_view_revision_wire();
    let payload = document
        .create_view_revision_bundle_bytes(&full_view_revision_request())
        .expect("RITORB1 view bundle is returned");

    assert_view_revision_wire_metrics(&mut document, "ritorb1", payload.len());
}

#[test]
fn leaves_view_revision_wire_metrics_empty_when_unarmed() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());

    document
        .create_view_revision_bundle_json(&full_view_revision_request())
        .expect("JSON view bundle is returned");

    assert_eq!(take_view_revision_wire_metrics(&mut document), Value::Null);
}

#[test]
fn clears_view_revision_wire_metrics_when_an_armed_request_fails() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    document.measure_next_view_revision_wire();
    document
        .create_view_revision_bundle_json(&full_view_revision_request())
        .expect("JSON view bundle is returned");

    document.measure_next_view_revision_wire();
    assert!(document
        .create_view_revision_bundle_json("not JSON")
        .is_err());

    assert_eq!(take_view_revision_wire_metrics(&mut document), Value::Null);
}

fn full_view_revision_request() -> String {
    serde_json::json!({
        "layoutConfig": layout(),
        "lineBreaking": "greedy",
        "activeSpreadIndex": 0,
        "mode": "full"
    })
    .to_string()
}

fn assert_view_revision_wire_metrics(
    document: &mut WasmRuntimeDocument,
    expected_wire: &str,
    expected_bytes: usize,
) {
    let metrics = take_view_revision_wire_metrics(document);
    assert_eq!(metrics["wire"], expected_wire);
    assert_eq!(metrics["rawWireBytes"], expected_bytes);
    let rust_encode_ms = metrics["rustEncodeMs"]
        .as_f64()
        .expect("Rust encode duration is a number");
    assert!(rust_encode_ms.is_finite());
    assert!(rust_encode_ms >= 0.0);
}

fn take_view_revision_wire_metrics(document: &mut WasmRuntimeDocument) -> Value {
    let json = document
        .take_view_revision_wire_metrics_json()
        .expect("wire metrics JSON is returned");
    serde_json::from_str(&json).expect("wire metrics JSON parses")
}

fn assert_view_revision_wire_agreement(
    json_document: &mut WasmRuntimeDocument,
    binary_document: &mut WasmRuntimeDocument,
    request: Value,
) -> Value {
    let request = request.to_string();
    let json_payload = json_document
        .create_view_revision_bundle_json(&request)
        .expect("JSON view bundle is returned");
    let json_value: Value = serde_json::from_str(&json_payload).expect("JSON view parses");
    let binary_payload = binary_document
        .create_view_revision_bundle_bytes(&request)
        .expect("RITORB1 view bundle is returned");
    let decoded = decode_runtime_bundle(&binary_payload).expect("RITORB1 view decodes");

    assert_eq!(&binary_payload[0..7], b"RITORB1");
    assert_eq!(decoded.payload, json_value);
    json_value
}

#[test]
fn returns_publication_json_before_revision_creation() {
    let document = WasmRuntimeDocument::from_loaded_document(fixture_document());

    let publication_json = document
        .publication_json()
        .expect("publication JSON is returned");
    let publication: Value =
        serde_json::from_str(&publication_json).expect("publication JSON parses");

    assert_eq!(publication["package"]["metadata"]["title"], "WASM fixture");
    assert_eq!(publication["chapters"][0]["href"], "chapter.xhtml");
    assert_eq!(
        publication["resources"]["stylesheets"][0]["href"],
        "style.css"
    );
    assert_eq!(
        publication["resources"]["fonts"][0]["href"],
        "Fonts/book.otf"
    );
    assert_eq!(
        publication["resources"]["images"][0]["href"],
        "Images/cover.png"
    );
}

#[test]
fn separates_resource_payload_json_from_bytes() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_id = revision_id(&mut document);

    let payload_json = document
        .get_resource_payload_json(&revision_id, RuntimeResourceKind::Image, "Images/cover.png")
        .expect("resource payload serializes");
    let payload: RuntimeResourceTransferPayload =
        serde_json::from_str(&payload_json).expect("payload parses");
    let payload_value: Value = serde_json::from_str(&payload_json).expect("payload JSON parses");
    let bytes = document
        .read_resource_transfer(&payload.transfer_id)
        .expect("resource bytes are available");

    assert_eq!(payload.revision_id, revision_id);
    assert!(payload.transfer_id.starts_with("transfer-"));
    assert_eq!(payload.kind, RuntimeResourceKind::Image);
    assert_eq!(payload.href, "Images/cover.png");
    assert_eq!(payload.media_type, "image/png");
    assert_eq!(payload.byte_length, minimal_png().len());
    assert_eq!(payload.width, Some(2));
    assert_eq!(payload.height, Some(3));
    assert!(payload_value.get("bytes").is_none());
    assert!(payload_value.get("data").is_none());
    assert_eq!(bytes, minimal_png());
    assert!(document.release_resource_transfer(&payload.transfer_id));
    assert!(document
        .read_resource_transfer(&payload.transfer_id)
        .is_err());
}

#[test]
fn gives_reused_resources_independent_transfer_leases() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_id = revision_id(&mut document);

    let first = resource_payload(&mut document, &revision_id);
    let second = resource_payload(&mut document, &revision_id);

    assert_ne!(first.transfer_id, second.transfer_id);
    assert_eq!(document.pending_resource_transfer_count(), 2);
    assert!(document.release_resource_transfer(&first.transfer_id));
    assert!(document.read_resource_transfer(&first.transfer_id).is_err());
    assert_eq!(
        document
            .read_resource_transfer(&second.transfer_id)
            .expect("second transfer remains"),
        minimal_png()
    );
    assert_eq!(document.release_revision_transfers(&revision_id), 1);
    assert_eq!(document.pending_resource_transfer_count(), 0);
}

#[test]
fn releases_revision_state_and_its_pending_transfers() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_id = revision_id(&mut document);
    let payload = resource_payload(&mut document, &revision_id);

    assert!(document.document.has_revision(&revision_id));
    assert_eq!(document.pending_resource_transfer_count(), 1);
    assert!(document.release_revision(&revision_id));
    assert!(!document.document.has_revision(&revision_id));
    assert_eq!(document.pending_resource_transfer_count(), 0);
    assert!(document
        .read_resource_transfer(&payload.transfer_id)
        .is_err());
    assert!(!document.release_revision(&revision_id));
}

#[test]
fn prefetches_resource_transfer_payloads() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_id = revision_id(&mut document);

    let prefetch_json = document
            .prefetch_resources_json(
                &revision_id,
                r#"{"resources":[{"kind":"image","href":"Images/cover.png"},{"kind":"font","href":"Fonts/missing.otf"}]}"#,
            )
            .expect("resource prefetch JSON is returned");
    let prefetch: Value = serde_json::from_str(&prefetch_json).expect("resource prefetch parses");
    let transfer_id = prefetch["payloads"][0]["transferId"]
        .as_str()
        .expect("transfer id is present");

    assert_eq!(prefetch["revisionId"], revision_id);
    assert_eq!(prefetch["payloads"].as_array().expect("payloads").len(), 1);
    assert_eq!(
        prefetch["missingResources"]
            .as_array()
            .expect("missing")
            .len(),
        1
    );
    assert_eq!(prefetch["pendingTransferCount"], 1);
    assert_eq!(
        document
            .read_resource_transfer(transfer_id)
            .expect("prefetched bytes are readable"),
        minimal_png()
    );
}

#[test]
fn prefetches_planned_frame_resource_transfers() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_id = revision_id(&mut document);

    let prefetch_json = document
        .prefetch_planned_frame_resources_json(&revision_id, 0)
        .expect("planned frame resources prefetch JSON is returned");
    let prefetch: Value =
        serde_json::from_str(&prefetch_json).expect("planned frame prefetch parses");
    let transfer_id = prefetch["spreads"][0]["payloads"][0]["transferId"]
        .as_str()
        .expect("transfer id is present");

    assert_eq!(prefetch["plan"]["revisionId"], revision_id);
    assert_eq!(prefetch["plan"]["centerSpreadIndex"], 0);
    assert_eq!(prefetch["plan"]["displaySpreadIndex"], 0);
    assert_eq!(prefetch["spreads"][0]["revisionId"], revision_id);
    assert_eq!(prefetch["spreads"][0]["spreadIndex"], 0);
    assert_eq!(prefetch["spreads"][0]["payloads"][0]["kind"], "image");
    assert_eq!(
        prefetch["spreads"][0]["payloads"][0]["href"],
        "Images/cover.png"
    );
    assert_eq!(prefetch["pendingTransferCount"], 2);
    assert_eq!(
        document
            .read_resource_transfer(transfer_id)
            .expect("planned frame resource is readable"),
        minimal_png()
    );
}

#[test]
fn resource_prefetch_is_revision_gated_and_validated() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_id = revision_id(&mut document);

    let bad_request = document
        .prefetch_resources_json(&revision_id, r#"{"resources":"image"}"#)
        .expect_err("bad resource prefetch request fails");
    let unknown_revision = document
        .prefetch_resources_json(
            "rev-missing",
            r#"{"resources":[{"kind":"image","href":"Images/cover.png"}]}"#,
        )
        .expect_err("unknown revision fails");

    assert_eq!(bad_request.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(bad_request
        .message()
        .contains("invalid resource prefetch request JSON"));
    assert_eq!(unknown_revision.code(), WasmRuntimeErrorCode::EngineError);
    assert_eq!(unknown_revision.message(), "unknown revision: rev-missing");
}

#[test]
fn searches_revision_text_as_json() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_id = revision_id(&mut document);

    let search_json = document
        .search_json(
            &revision_id,
            r#"{"query":"wasm","caseSensitive":false,"wholeWord":false,"limit":2}"#,
        )
        .expect("search JSON is returned");
    let search: Value = serde_json::from_str(&search_json).expect("search JSON parses");
    let bad_request = document
        .search_json(&revision_id, r#"{"query":1}"#)
        .expect_err("bad search request fails");

    assert_eq!(search["revisionId"], revision_id);
    assert_eq!(search["query"], "wasm");
    assert_eq!(search["resultCount"], 1);
    assert_eq!(search["results"][0]["pageIndex"], 0);
    assert_eq!(search["results"][0]["spreadIndex"], 0);
    assert_eq!(bad_request.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(bad_request
        .message()
        .contains("invalid search request JSON"));
}

#[test]
fn resolves_locator_json() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_id = revision_id(&mut document);

    let locator_json = document
        .resolve_locator_json(&revision_id, r#"{"href":"chapter.xhtml#intro"}"#)
        .expect("locator JSON is returned");
    let locator: Value = serde_json::from_str(&locator_json).expect("locator JSON parses");
    let missing = document
        .resolve_locator_json(&revision_id, r#"{"href":"chapter.xhtml#missing"}"#)
        .expect_err("missing locator fails");

    assert_eq!(locator["revisionId"], revision_id);
    assert_eq!(locator["href"], "chapter.xhtml#intro");
    assert_eq!(locator["spineIdref"], "chapter");
    assert_eq!(locator["pageIndex"], 0);
    assert_eq!(locator["spreadIndex"], 0);
    assert_eq!(locator["fragment"], "intro");
    assert_eq!(missing.code(), WasmRuntimeErrorCode::EngineError);
    assert_eq!(
        missing.message(),
        "locator not found: chapter.xhtml#missing"
    );
}

#[test]
fn rejects_malformed_locator_json() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_id = revision_id(&mut document);

    let error = document
        .resolve_locator_json(&revision_id, r#"{"href":1}"#)
        .expect_err("bad locator request fails");

    assert_eq!(error.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(error.message().contains("invalid locator request JSON"));
}

#[test]
fn returns_page_targets_json() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_id = revision_id(&mut document);

    let targets_json = document
        .get_page_targets_json(&revision_id, 0)
        .expect("target JSON is returned");
    let targets: Value = serde_json::from_str(&targets_json).expect("target JSON parses");

    assert_eq!(targets["revisionId"], revision_id);
    assert_eq!(targets["pageIndex"], 0);
    assert_eq!(targets["spreadIndex"], 0);
    assert!(targets["entryCount"]
        .as_u64()
        .is_some_and(|count| count >= 1));
    assert!(targets["entries"]
        .as_array()
        .is_some_and(|entries| entries.iter().any(|entry| entry
            .get("text")
            .and_then(|text| text.get("length"))
            .and_then(Value::as_u64)
            .is_some_and(|length| length > 0))));
}

#[test]
fn returns_page_text_positions_json() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_id = revision_id(&mut document);

    let positions_json = document
        .get_page_text_positions_json(&revision_id, 0)
        .expect("text positions JSON is returned");
    let positions: Value =
        serde_json::from_str(&positions_json).expect("text positions JSON parses");
    let missing = document
        .get_page_text_positions_json(&revision_id, 99)
        .expect_err("missing page fails");

    assert_eq!(positions["revisionId"], revision_id);
    assert_eq!(positions["pageIndex"], 0);
    assert!(positions["text"]
        .as_str()
        .is_some_and(|text| text.contains("Hello WASM")));
    assert!(positions["offsets"]
        .as_array()
        .is_some_and(|offsets| !offsets.is_empty()));
    assert_eq!(missing.code(), WasmRuntimeErrorCode::EngineError);
    assert_eq!(missing.message(), "unknown page index: 99");
}

#[test]
fn returns_text_range_geometry_json() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_id = revision_id(&mut document);
    let search_json = document
        .search_json(
            &revision_id,
            r#"{"query":"WASM","caseSensitive":true,"wholeWord":false,"limit":1}"#,
        )
        .expect("search JSON is returned");
    let search: Value = serde_json::from_str(&search_json).expect("search JSON parses");
    let range = search["results"][0]["matchRange"].clone();
    let request = serde_json::json!({
        "pageIndex": search["results"][0]["pageIndex"],
        "start": range["start"],
        "end": range["end"],
    });

    let geometry_json = document
        .get_text_range_geometry_json(&revision_id, &request.to_string())
        .expect("text range geometry JSON is returned");
    let geometry: Value = serde_json::from_str(&geometry_json).expect("text geometry JSON parses");
    let bad_request = document
        .get_text_range_geometry_json(&revision_id, r#"{"pageIndex":0}"#)
        .expect_err("bad geometry request fails");

    assert_eq!(geometry["revisionId"], revision_id);
    assert_eq!(geometry["pageIndex"], 0);
    assert!(geometry["rectCount"]
        .as_u64()
        .is_some_and(|count| count >= 1));
    assert!(geometry["rects"][0]["width"]
        .as_f64()
        .is_some_and(|width| width > 0.0));
    assert_eq!(bad_request.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(bad_request
        .message()
        .contains("invalid text range geometry request JSON"));
}

#[test]
fn returns_footnote_json() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_id = revision_id(&mut document);

    let footnote_json = document
        .get_footnote_json(&revision_id, "chapter.xhtml#fn1")
        .expect("footnote JSON is returned");
    let footnotes_json = document
        .get_footnotes_json(&revision_id)
        .expect("footnote map JSON is returned");
    let chapter_text_indices_json = document
        .get_chapter_text_indices_json(&revision_id)
        .expect("chapter text indices JSON is returned");
    let footnote: Value = serde_json::from_str(&footnote_json).expect("footnote JSON parses");
    let footnotes: Value = serde_json::from_str(&footnotes_json).expect("footnote map JSON parses");
    let chapter_text_indices: Value =
        serde_json::from_str(&chapter_text_indices_json).expect("chapter text JSON parses");
    let missing = document
        .get_footnote_json(&revision_id, "chapter.xhtml#missing")
        .expect_err("missing footnote fails");

    assert_eq!(footnote["revisionId"], revision_id);
    assert_eq!(footnote["key"], "chapter.xhtml#fn1");
    assert_eq!(footnote["kind"], "footnote");
    assert_eq!(footnote["text"], "WASM note");
    assert_eq!(footnote["html"], "<p>WASM note</p>");
    assert_eq!(footnotes["revisionId"], revision_id);
    assert_eq!(
        footnotes["entries"]["chapter.xhtml#fn1"]["text"],
        "WASM note"
    );
    assert_eq!(chapter_text_indices["revisionId"], revision_id);
    assert_eq!(
        chapter_text_indices["entries"]["chapter"]["normalizedText"],
        "Hello WASM1"
    );
    assert_eq!(missing.code(), WasmRuntimeErrorCode::EngineError);
    assert_eq!(missing.message(), "unknown footnote: chapter.xhtml#missing");
}

#[test]
fn reports_bad_request_for_invalid_layout_json() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());

    let error = document
        .create_full_revision_bundle_json(
            r#"{"layoutConfig":{"viewportWidth":400},"activeSpreadIndex":0}"#,
        )
        .expect_err("invalid layout JSON fails");

    assert_eq!(error.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(error
        .message()
        .contains("invalid full revision bundle request JSON"));
}

#[test]
fn rejects_unknown_revision_line_breaking_mode() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let request = serde_json::json!({
        "layoutConfig": layout(),
        "lineBreaking": "balanced",
        "activeSpreadIndex": 0,
    });

    let error = document
        .create_full_revision_bundle_json(&request.to_string())
        .expect_err("unknown line breaking mode fails");

    assert_eq!(error.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(error
        .message()
        .contains("invalid full revision bundle request JSON"));
}

#[test]
fn reports_engine_errors_for_unknown_revision() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let _ = revision_id(&mut document);

    let error = document
        .get_frame_json("rev-missing", 0)
        .expect_err("unknown revision fails");

    assert_eq!(error.code(), WasmRuntimeErrorCode::EngineError);
    assert_eq!(error.message(), "unknown revision: rev-missing");
}
