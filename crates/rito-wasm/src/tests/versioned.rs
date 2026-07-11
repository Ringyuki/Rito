use rito_core::runtime::RuntimeResourceKind;
use serde_json::{json, Value};

use super::fixture::{fixture_document, layout, revision_id};
use crate::{WasmRuntimeDocument, WasmRuntimeErrorCode};

fn parse(response: String) -> Value {
    serde_json::from_str(&response).expect("versioned response parses")
}

fn assert_revision(response: &Value, revision_id: &str, revision_version: u32) {
    assert_eq!(response["revision"]["revisionId"], revision_id);
    assert_eq!(response["revision"]["revisionVersion"], revision_version);
}

#[test]
fn versioned_raw_reads_return_stamped_envelopes() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let revision_id = revision_id(&mut document);

    let frame = parse(
        document
            .get_frame_at_revision_json(&revision_id, 0, 0)
            .expect("frame is returned"),
    );
    assert_revision(&frame, &revision_id, 0);
    assert_eq!(frame["value"]["spreadIndex"], 0);

    let metadata = parse(
        document
            .get_frame_command_buffer_metadata_at_revision_json(&revision_id, 0, 0)
            .expect("command metadata is returned"),
    );
    assert_revision(&metadata, &revision_id, 0);
    assert!(metadata["value"]["byteLength"].as_u64().is_some());
    assert!(!document
        .read_frame_command_buffer_at_revision(&revision_id, 0, 0)
        .expect("command bytes are returned")
        .is_empty());

    let search = parse(
        document
            .search_at_revision_json(
                &revision_id,
                0,
                r#"{"query":"WASM","caseSensitive":true,"wholeWord":false,"limit":1}"#,
            )
            .expect("search is returned"),
    );
    assert_revision(&search, &revision_id, 0);
    let result = &search["value"]["results"][0];
    let geometry_request = json!({
        "pageIndex": result["pageIndex"],
        "start": result["matchRange"]["start"],
        "end": result["matchRange"]["end"],
    });

    let href = parse(
        document
            .resolve_locator_at_revision_json(&revision_id, 0, r#"{"href":"chapter.xhtml#intro"}"#)
            .expect("href locator is returned"),
    );
    assert_eq!(href["value"]["fragment"], "intro");
    let source = parse(
        document
            .resolve_source_locator_at_revision_json(
                &revision_id,
                0,
                r#"{"href":"chapter.xhtml","anchorId":"intro"}"#,
            )
            .expect("source locator is returned"),
    );
    assert_revision(&source, &revision_id, 0);
    assert_eq!(source["value"]["status"], "resolved");
    assert_eq!(source["value"]["matchedBy"], "anchor");

    for response in [
        document
            .get_page_targets_at_revision_json(&revision_id, 0, 0)
            .expect("targets"),
        document
            .get_page_text_positions_at_revision_json(&revision_id, 0, 0)
            .expect("positions"),
        document
            .get_text_range_geometry_at_revision_json(
                &revision_id,
                0,
                &geometry_request.to_string(),
            )
            .expect("geometry"),
        document
            .get_footnote_at_revision_json(&revision_id, 0, "chapter.xhtml#fn1")
            .expect("footnote"),
        document
            .get_footnotes_at_revision_json(&revision_id, 0)
            .expect("footnotes"),
        document
            .get_chapter_text_indices_at_revision_json(&revision_id, 0)
            .expect("chapter text indices"),
        document
            .get_revision_summary_at_revision_json(&revision_id, 0)
            .expect("revision summary"),
        document
            .get_revision_navigation_at_revision_json(&revision_id, 0)
            .expect("revision navigation"),
        document
            .get_revision_bundle_at_revision_json(&revision_id, 0, true)
            .expect("revision bundle"),
    ] {
        assert_revision(&parse(response), &revision_id, 0);
    }

    let resource = parse(
        document
            .get_resource_payload_at_revision_json(
                &revision_id,
                0,
                RuntimeResourceKind::Image,
                "Images/cover.png",
            )
            .expect("resource payload"),
    );
    assert_revision(&resource, &revision_id, 0);
    let planned = parse(
        document
            .prefetch_planned_frame_resources_at_revision_json(&revision_id, 0, 0)
            .expect("planned frame resource prefetch"),
    );
    assert_revision(&planned, &revision_id, 0);
    assert_eq!(planned["value"]["plan"]["centerSpreadIndex"], 0);
    document
        .release_revision_transfers_at_revision_json(&revision_id, 0)
        .expect("test transfers release");
}

#[test]
fn versioned_resources_are_leased_and_released_by_exact_version() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let initial = start_bounded(&mut document);
    let advanced = continue_once(&mut document, &initial);
    assert_eq!(advanced["revision"]["revisionVersion"], 1);

    let payload = parse(
        document
            .get_resource_payload_at_revision_json(
                "rev-1",
                1,
                RuntimeResourceKind::Image,
                "Images/cover.png",
            )
            .expect("version one resource is leased"),
    );
    assert_revision(&payload, "rev-1", 1);
    let transfer_id = payload["value"]["transferId"]
        .as_str()
        .expect("transfer id")
        .to_owned();
    let legacy_payload = parse(
        document
            .get_resource_payload_json("rev-1", RuntimeResourceKind::Image, "Images/cover.png")
            .expect("versionless API leases against the current version"),
    );
    let legacy_transfer_id = legacy_payload["transferId"]
        .as_str()
        .expect("legacy transfer id")
        .to_owned();
    let prefetch = parse(
        document
            .prefetch_resources_at_revision_json(
                "rev-1",
                1,
                r#"{"resources":[{"kind":"image","href":"Images/cover.png"}]}"#,
            )
            .expect("resource prefetch is versioned"),
    );
    assert_revision(&prefetch, "rev-1", 1);
    assert_eq!(
        prefetch["value"]["payloads"].as_array().map(Vec::len),
        Some(1)
    );
    let planned = parse(
        document
            .prefetch_planned_frame_resources_at_revision_json("rev-1", 1, 0)
            .expect("planned prefetch is versioned"),
    );
    assert_revision(&planned, "rev-1", 1);

    let old_release = parse(
        document
            .release_revision_transfers_at_revision_json("rev-1", 0)
            .expect("old release is scoped"),
    );
    assert_eq!(old_release["value"], 0);
    assert!(document.read_resource_transfer(&transfer_id).is_ok());
    assert!(document.read_resource_transfer(&legacy_transfer_id).is_ok());
    let current_release = parse(
        document
            .release_revision_transfers_at_revision_json("rev-1", 1)
            .expect("current release is scoped"),
    );
    assert!(current_release["value"]
        .as_u64()
        .is_some_and(|released| released >= 3));
    assert!(document.read_resource_transfer(&transfer_id).is_err());
    assert!(document
        .read_resource_transfer(&legacy_transfer_id)
        .is_err());
    assert_eq!(document.pending_resource_transfer_count(), 0);
}

#[test]
fn stale_unknown_and_exact_revision_release_are_distinct() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let initial = start_bounded(&mut document);
    let _advanced = continue_once(&mut document, &initial);

    let stale = document
        .get_revision_summary_at_revision_json("rev-1", 0)
        .expect_err("old revision handle is stale");
    assert_eq!(stale.code(), WasmRuntimeErrorCode::StaleRevisionVersion);
    let unknown = document
        .get_revision_summary_at_revision_json("rev-missing", 0)
        .expect_err("missing revision is typed");
    assert_eq!(unknown.code(), WasmRuntimeErrorCode::UnknownRevision);

    let stale_release = document
        .release_revision_at_revision_json("rev-1", 0)
        .expect_err("stale release cannot remove current revision");
    assert_eq!(
        stale_release.code(),
        WasmRuntimeErrorCode::StaleRevisionVersion
    );
    document
        .get_revision_summary_at_revision_json("rev-1", 1)
        .expect("current revision survived stale release");

    let released = parse(
        document
            .release_revision_at_revision_json("rev-1", 1)
            .expect("current revision releases"),
    );
    assert_eq!(released["value"]["releasedRevision"], true);
    let missing = document
        .get_revision_summary_at_revision_json("rev-1", 1)
        .expect_err("released revision is gone");
    assert_eq!(missing.code(), WasmRuntimeErrorCode::UnknownRevision);
}

fn start_bounded(document: &mut WasmRuntimeDocument) -> Value {
    parse(
        document
            .create_bounded_revision_json(
                &json!({
                    "layoutConfig": layout(),
                    "lineBreaking": "greedy",
                    "budget": { "maxTopLevelNodes": 1 }
                })
                .to_string(),
            )
            .expect("bounded revision starts"),
    )
}

fn continue_once(document: &mut WasmRuntimeDocument, advance: &Value) -> Value {
    parse(
        document
            .continue_revision_json(
                &json!({
                    "revisionId": advance["continuation"]["revisionId"],
                    "revisionVersion": advance["continuation"]["revisionVersion"],
                    "cursor": advance["continuation"]["cursor"],
                    "budget": { "maxTopLevelNodes": 1 }
                })
                .to_string(),
            )
            .expect("revision advances"),
    )
}
