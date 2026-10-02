use serde_json::json;

use super::fixture::{layout, pinned_test_policy_input};
use crate::{WasmRuntimeDocument, WasmRuntimeErrorCode};

#[test]
fn a_document_opened_from_shards_reports_missing_shards_by_id() {
    let epub = crate::reader_session::tests::source_locator_fixture_epub();
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
    let mut document = WasmRuntimeDocument::from_runtime_document(runtime);
    let request = json!({
        "layoutConfig": layout(),
        "targetChapterIndex": 0,
        "targetLocator": { "href": "chapter.xhtml" }
    })
    .to_string();

    let pending = document
        .create_chapter_local_revision_json(&request)
        .expect_err("the chapter has not arrived");
    assert_eq!(pending.code(), WasmRuntimeErrorCode::ResourcePending);
    assert!(!pending.pending_shards().is_empty());
    let payload: serde_json::Value = serde_json::from_str(
        &crate::binding::error_json_string_for_tests(pending.clone()),
    )
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
    for shard_id in pending.pending_shards() {
        let shard = &packed.shards[*shard_id as usize - 1];
        let key = shard.key.as_ref().map(|key| key.as_bytes().to_vec());
        document
            .supply_shard(&shard.bytes, key.as_deref())
            .expect("supplies");
    }
    document
        .create_chapter_local_revision_json(&request)
        .expect("the chapter arrived");
}
