use serde_json::{json, Value};

use super::fixture::{layout, pinned_test_policy_input};
use crate::{WasmRuntimeDocument, WasmRuntimeErrorCode};

#[test]
fn a_document_opened_from_shards_lays_out_alone_and_names_an_image_shard() {
    let epub = crate::reader_session::tests::book_10_publication();
    let mut counter = 3u8;
    let mut random = |buffer: &mut [u8]| {
        for byte in buffer {
            counter = counter.wrapping_mul(29).wrapping_add(11);
            *byte = counter;
        }
    };
    let packed = rito_core::epub::shard::pack_publication(
        &epub,
        rito_core::epub::shard::PackOptions { encrypt: true },
        &mut random,
    )
    .expect("packs");
    let runtime = rito_core::runtime::RuntimeDocument::open_shards_with_pinned_font_policy(
        &packed.skeleton.bytes,
        packed.skeleton.key.as_ref(),
        pinned_test_policy_input(),
    )
    .expect("opens from the skeleton");
    let chapter_index = runtime
        .document()
        .chapters
        .iter()
        .position(|chapter| chapter.href == "OEBPS/Text/Section001.xhtml")
        .expect("chapter one");
    let mut document = WasmRuntimeDocument::from_runtime_document(runtime);
    let created: Value = serde_json::from_str(
        &document
            .create_chapter_local_revision_json(
                &json!({
                    "layoutConfig": layout(),
                    "targetChapterIndex": chapter_index,
                    "targetLocator": { "href": "OEBPS/Text/Section001.xhtml" }
                })
                .to_string(),
            )
            .expect("laid out from the skeleton"),
    )
    .expect("parses");
    let owner = json!({
        "revisionId": created["revision"]["revisionId"],
        "revisionVersion": created["revision"]["revisionVersion"],
        "coordinate": created["revision"]["coordinate"]
    })
    .to_string();
    let image = rito_core::runtime::RuntimeResourceKind::Image;
    let spread = spread_drawing(&mut document, &owner, "../Images/0005_s.jpg");
    assert_eq!(
        spread["pendingResources"],
        json!([{ "kind": "image", "href": "../Images/0005_s.jpg" }]),
        "a frame whose image has not arrived still prefetches, naming it pending"
    );
    assert_eq!(spread["missingResources"], json!([]));

    let pending = document
        .get_chapter_local_resource_payload_json(&owner, image, "../Images/0005_s.jpg")
        .expect_err("the image has not arrived");
    assert_eq!(pending.code(), WasmRuntimeErrorCode::ResourcePending);
    assert_eq!(pending.pending_shards().len(), 1);
    let payload: Value = serde_json::from_str(&crate::binding::error_json_string_for_tests(
        pending.clone(),
    ))
    .expect("error payload parses");
    assert_eq!(payload["code"], "resource-pending");
    assert_eq!(
        payload["pendingShards"],
        json!(pending.pending_shards().to_vec())
    );

    assert_eq!(
        document
            .supply_shard(&[0u8; 4], None)
            .expect_err("garbage is refused")
            .code(),
        WasmRuntimeErrorCode::BadRequest
    );
    let shard = &packed.shards[pending.pending_shards()[0] as usize - 1];
    let key = shard.key.as_ref().map(|key| key.as_bytes().to_vec());
    document
        .supply_shard(&shard.bytes, key.as_deref())
        .expect("supplies");
    document
        .get_chapter_local_resource_payload_json(&owner, image, "../Images/0005_s.jpg")
        .expect("reads once supplied");
    let spread = spread_drawing(&mut document, &owner, "../Images/0005_s.jpg");
    assert!(spread.get("pendingResources").is_none());
    assert_eq!(spread["payloads"][0]["href"], "../Images/0005_s.jpg");
}

/// The chapter-local frame resource prefetch of the first spread that
/// draws `href`, whether it arrived or not.
fn spread_drawing(document: &mut WasmRuntimeDocument, owner: &str, href: &str) -> Value {
    for spread_index in 0..64 {
        let response: Value = serde_json::from_str(
            &document
                .prefetch_chapter_local_frame_resources_json(owner, spread_index)
                .expect("a frame prefetch never waits on a shard"),
        )
        .expect("parses");
        let names = |list: &Value| {
            list.as_array()
                .into_iter()
                .flatten()
                .any(|resource| resource["href"] == href)
        };
        if names(&response["payloads"]) || names(&response["pendingResources"]) {
            return response;
        }
    }
    panic!("no spread draws {href}");
}
