use serde_json::{json, Value};

use super::fixture::{fixture_document, layout};
use crate::{WasmRuntimeDocument, WasmRuntimeErrorCode};

#[test]
fn packed_frame_transport_uses_only_explicit_local_coordinates() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let advance = create_local(&mut document, 64);
    let owner = owner(&advance);
    let spread = advance["target"]["localSpreadIndex"].as_u64().unwrap_or(0) as usize;

    let metadata: Value = parse(
        document
            .get_chapter_local_frame_command_buffer_metadata_json(&owner.to_string(), spread)
            .expect("local packed metadata serializes"),
    );
    let bytes = document
        .read_chapter_local_frame_command_buffer(&owner.to_string(), spread)
        .expect("local packed bytes are available");

    assert_eq!(metadata["owner"], owner);
    assert_eq!(metadata["owner"]["coordinate"]["kind"], "chapterLocal");
    assert_eq!(metadata["localSpreadIndex"], spread);
    assert!(metadata.get("spreadIndex").is_none());
    assert!(metadata.get("revisionId").is_none());
    assert_eq!(metadata["byteLength"], bytes.len());
    assert!(!bytes.is_empty());
}

#[test]
fn local_transfers_are_exact_owner_scoped_and_generic_release_cannot_see_them() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let advance = create_local(&mut document, 64);
    let owner = owner(&advance);
    let payload: Value = parse(
        document
            .get_chapter_local_resource_payload_json(
                &owner.to_string(),
                rito_core::runtime::RuntimeResourceKind::Image,
                "Images/cover.png",
            )
            .expect("local image transfer is leased"),
    );
    let transfer_id = payload["transferId"]
        .as_str()
        .expect("transfer id")
        .to_owned();

    assert_eq!(payload["owner"], owner);
    assert!(transfer_id.starts_with("local-transfer-"));
    assert!(document.read_resource_transfer(&transfer_id).is_err());
    assert!(!document.release_revision(owner["revisionId"].as_str().expect("revision id")));
    assert!(document
        .read_chapter_local_resource_transfer(&owner.to_string(), &transfer_id)
        .is_ok());

    let mut forged = owner.clone();
    forged["coordinate"]["href"] = json!("forged.xhtml");
    let mismatch = document
        .release_chapter_local_resource_transfer(&forged.to_string(), &transfer_id)
        .expect_err("forged coordinate cannot release a local lease");
    assert_eq!(mismatch.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(document
        .read_chapter_local_resource_transfer(&owner.to_string(), &transfer_id)
        .is_ok());

    let released: Value = parse(
        document
            .release_chapter_local_revision_json(&owner.to_string())
            .expect("exact owner releases local revision"),
    );
    assert_eq!(released["owner"], owner);
    assert_eq!(released["releasedTransferCount"], 1);
    assert_eq!(released["releasedRevision"], true);
    assert!(document
        .read_chapter_local_resource_transfer(&owner.to_string(), &transfer_id)
        .is_err());
}

#[test]
fn frame_resource_aggregate_and_take_preserve_exact_local_ownership() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let advance = create_local(&mut document, 64);
    let owner = owner(&advance);
    let spread = advance["target"]["localSpreadIndex"].as_u64().unwrap_or(0) as usize;
    let response: Value = parse(
        document
            .prefetch_chapter_local_frame_resources_json(&owner.to_string(), spread)
            .expect("local frame resources are prefetched"),
    );

    assert_eq!(response["owner"], owner);
    assert_eq!(response["localSpreadIndex"], spread);
    assert!(response.get("spreadIndex").is_none());
    let payload = response["payloads"]
        .as_array()
        .and_then(|payloads| payloads.first())
        .expect("fixture frame carries its image");
    assert_eq!(payload["owner"], owner);
    let transfer_id = payload["transferId"].as_str().expect("transfer id");
    assert!(document.read_resource_transfer(transfer_id).is_err());

    let bytes = document
        .take_chapter_local_resource_transfer(&owner.to_string(), transfer_id)
        .expect("exact owner takes bytes");
    assert!(!bytes.is_empty());
    assert!(document
        .read_chapter_local_resource_transfer(&owner.to_string(), transfer_id)
        .is_err());

    let mut forged = owner.clone();
    forged["coordinate"]["href"] = json!("forged.xhtml");
    let error = document
        .prefetch_chapter_local_frame_resources_json(&forged.to_string(), spread)
        .expect_err("forged owner cannot aggregate frame resources");
    assert_eq!(error.code(), WasmRuntimeErrorCode::BadRequest);
}

#[test]
fn successful_continuation_releases_only_the_predecessor_owner_leases() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let initial = create_local(&mut document, 1);
    let previous_owner = owner(&initial);
    let payload: Value = parse(
        document
            .get_chapter_local_resource_payload_json(
                &previous_owner.to_string(),
                rito_core::runtime::RuntimeResourceKind::Image,
                "Images/cover.png",
            )
            .expect("predecessor lease"),
    );
    let transfer_id = payload["transferId"].as_str().expect("transfer id");
    let continuation = initial["continuation"].clone();
    assert!(
        continuation.is_object(),
        "fixture must yield a continuation"
    );

    let advanced: Value = parse(
        document
            .continue_chapter_local_revision_json(
                &json!({
                    "continuation": continuation,
                    "budget": { "maxTopLevelNodes": 32 }
                })
                .to_string(),
            )
            .expect("local continuation advances"),
    );

    assert_eq!(advanced["releasedPreviousOwnerTransferCount"], 1);
    assert_eq!(advanced["releasedPreviousOwner"], previous_owner);
    assert_eq!(
        advanced["revision"]["coordinate"],
        previous_owner["coordinate"]
    );
    assert!(document
        .read_chapter_local_resource_transfer(&previous_owner.to_string(), transfer_id)
        .is_err());
}

#[test]
fn forged_continuation_target_preserves_the_exact_owner_and_its_leases() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let initial = create_local(&mut document, 1);
    let previous_owner = owner(&initial);
    let payload: Value = parse(
        document
            .get_chapter_local_resource_payload_json(
                &previous_owner.to_string(),
                rito_core::runtime::RuntimeResourceKind::Image,
                "Images/cover.png",
            )
            .expect("predecessor lease"),
    );
    let transfer_id = payload["transferId"].as_str().expect("transfer id");
    let continuation = initial["continuation"].clone();
    let mut forged = continuation.clone();
    forged["targetLocator"]["anchorId"] = json!("intro");

    let error = document
        .continue_chapter_local_revision_json(
            &json!({
                "continuation": forged,
                "budget": { "maxTopLevelNodes": 32 }
            })
            .to_string(),
        )
        .expect_err("implicit local retarget is rejected");
    assert_eq!(error.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(document
        .read_chapter_local_resource_transfer(&previous_owner.to_string(), transfer_id)
        .is_ok());
    assert!(document
        .continue_chapter_local_revision_json(
            &json!({
                "continuation": continuation,
                "budget": { "maxTopLevelNodes": 32 }
            })
            .to_string(),
        )
        .is_ok());
}

#[test]
fn full_owner_is_required_by_summary_frame_and_release_boundaries() {
    let mut document = WasmRuntimeDocument::from_loaded_document(fixture_document());
    let advance = create_local(&mut document, 64);
    let owner = owner(&advance);
    let mut forged = owner.clone();
    forged["coordinate"]["chapterIndex"] = json!(1);

    for error in [
        document
            .get_chapter_local_revision_summary_json(&forged.to_string())
            .expect_err("forged summary owner fails"),
        document
            .get_chapter_local_frame_json(&forged.to_string(), 0)
            .expect_err("forged frame owner fails"),
        document
            .release_chapter_local_revision_json(&forged.to_string())
            .expect_err("forged release owner fails"),
    ] {
        assert_eq!(error.code(), WasmRuntimeErrorCode::BadRequest);
    }
    assert!(document
        .get_chapter_local_revision_summary_json(&owner.to_string())
        .is_ok());
    assert!(document
        .get_revision_summary_json(owner["revisionId"].as_str().expect("revision id"))
        .is_err());
}

fn create_local(document: &mut WasmRuntimeDocument, budget: usize) -> Value {
    let advance = parse(
        document
            .create_bounded_chapter_local_revision_json(
                &json!({
                    "layoutConfig": layout(),
                    "lineBreaking": "greedy",
                    "targetChapterIndex": 0,
                    "targetLocator": { "href": "chapter.xhtml" },
                    "localPageCap": 4,
                    "budget": { "maxTopLevelNodes": budget }
                })
                .to_string(),
            )
            .expect("chapter-local revision starts"),
    );
    assert!(advance.get("releasedPreviousOwner").is_none());
    assert!(advance.get("releasedPreviousOwnerTransferCount").is_none());
    advance
}

fn owner(advance: &Value) -> Value {
    json!({
        "revisionId": advance["revision"]["revisionId"],
        "revisionVersion": advance["revision"]["revisionVersion"],
        "coordinate": advance["revision"]["coordinate"]
    })
}

fn parse(json: String) -> Value {
    serde_json::from_str(&json).expect("JSON parses")
}
