mod chapter_local;
mod continuation;
pub(crate) mod fixture;
mod pinned_font;
mod versioned;

use fixture::{layout, minimal_png, pinned_fixture_wasm_document, resource_payload, revision_id};
use rito_core::runtime::{
    RuntimeResourceKind, RuntimeResourceTransferPayload, RuntimeRevisionHandle,
};
use serde_json::Value;

use super::WasmRuntimeErrorCode;

#[test]
fn links_against_core() {
    assert_eq!(super::BOUNDARY_NAME, "rito-wasm");
    assert_eq!(super::core_engine_name(), "rito-core");
}

#[test]
fn returns_packed_frame_command_buffer_metadata_and_bytes() {
    let mut document = pinned_fixture_wasm_document();
    let revision_id = revision_id(&mut document);

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
    assert!(metadata["commandCount"]
        .as_u64()
        .is_some_and(|count| count > 0));
    assert!(metadata["commandHash"]
        .as_str()
        .is_some_and(|hash| !hash.is_empty()));
    assert!(metadata["fontFamilies"]
        .as_array()
        .is_some_and(|families| !families.is_empty()));
    assert_eq!(metadata["byteLength"], bytes.len());
    assert_eq!(&bytes[0..7], b"RITODL1");
    assert_eq!(metadata["protocolVersion"], 2);
    assert_eq!(metadata["ratio"], 1.0);
    assert!(metadata["primitiveCount"]
        .as_u64()
        .is_some_and(|count| count > 0));
}

#[test]
fn returns_publication_json_before_revision_creation() {
    let document = pinned_fixture_wasm_document();

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
    let mut document = pinned_fixture_wasm_document();
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
fn takes_resource_bytes_and_consumes_the_transfer_lease() {
    let mut document = pinned_fixture_wasm_document();
    let revision_id = revision_id(&mut document);
    let first = resource_payload(&mut document, &revision_id);
    let second = resource_payload(&mut document, &revision_id);

    let bytes = document
        .take_resource_transfer(&first.transfer_id)
        .expect("resource transfer is taken");

    assert_eq!(bytes, minimal_png());
    assert_eq!(document.pending_resource_transfer_count(), 1);
    assert!(document.read_resource_transfer(&first.transfer_id).is_err());
    assert!(document.take_resource_transfer(&first.transfer_id).is_err());
    assert!(!document.release_resource_transfer(&first.transfer_id));
    assert_eq!(document.release_revision_transfers(&revision_id), 1);
    assert!(document
        .read_resource_transfer(&second.transfer_id)
        .is_err());
    assert_eq!(document.pending_resource_transfer_count(), 0);
}

#[test]
fn gives_reused_resources_independent_transfer_leases() {
    let mut document = pinned_fixture_wasm_document();
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
    let mut document = pinned_fixture_wasm_document();
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
fn successful_transport_releases_previous_transfers_only_after_finish() {
    let mut document = pinned_fixture_wasm_document();
    let previous_revision_id = revision_id(&mut document);
    let previous_transfer = resource_payload(&mut document, &previous_revision_id);
    let revision = document
        .document
        .create_revision(&layout())
        .expect("candidate revision is created");
    let revision = RuntimeRevisionHandle::from(&revision);

    let (new_transfer_id, released_count) = document
        .finish_created_revision_transport(
            revision.clone(),
            Some(&previous_revision_id),
            |document, revision, released_count| {
                assert!(document
                    .read_resource_transfer(&previous_transfer.transfer_id)
                    .is_ok());
                let payload = resource_payload(document, &revision.revision_id);
                assert_eq!(document.pending_resource_transfer_count(), 2);
                Ok((payload.transfer_id, released_count))
            },
        )
        .expect("transport commits");

    assert_eq!(released_count, 1);
    assert!(document.document.has_revision(&revision.revision_id));
    assert!(document
        .read_resource_transfer(&previous_transfer.transfer_id)
        .is_err());
    assert_eq!(
        document
            .read_resource_transfer(&new_transfer_id)
            .expect("candidate transfer remains"),
        minimal_png()
    );
    assert_eq!(document.pending_resource_transfer_count(), 1);
}

#[test]
fn prefetches_resource_transfer_payloads() {
    let mut document = pinned_fixture_wasm_document();
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
    let mut document = pinned_fixture_wasm_document();
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
    let payload_count: usize = prefetch["spreads"]
        .as_array()
        .expect("spreads array")
        .iter()
        .map(|spread| spread["payloads"].as_array().map_or(0, Vec::len))
        .sum();
    assert_eq!(prefetch["pendingTransferCount"], payload_count);
    assert_eq!(
        document
            .read_resource_transfer(transfer_id)
            .expect("planned frame resource is readable"),
        minimal_png()
    );
}

#[test]
fn resource_prefetch_is_revision_gated_and_validated() {
    let mut document = pinned_fixture_wasm_document();
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
    let mut document = pinned_fixture_wasm_document();
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
    assert_eq!(search["results"][0]["source"]["status"], "resolved");
    assert_eq!(search["results"][0]["source"]["href"], "chapter.xhtml");
    assert!(
        search["results"][0]["source"]["sourceRange"]["end"]["textOffset"]
            .as_u64()
            .zip(search["results"][0]["source"]["sourceRange"]["start"]["textOffset"].as_u64())
            .is_some_and(|(end, start)| end > start)
    );
    assert_eq!(bad_request.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(bad_request
        .message()
        .contains("invalid search request JSON"));
}

#[test]
fn resolves_locator_json() {
    let mut document = pinned_fixture_wasm_document();
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
    let mut document = pinned_fixture_wasm_document();
    let revision_id = revision_id(&mut document);

    let error = document
        .resolve_locator_json(&revision_id, r#"{"href":1}"#)
        .expect_err("bad locator request fails");

    assert_eq!(error.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(error.message().contains("invalid locator request JSON"));
}

#[test]
fn returns_page_targets_json() {
    let mut document = pinned_fixture_wasm_document();
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
    let mut document = pinned_fixture_wasm_document();
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
    let mut document = pinned_fixture_wasm_document();
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
    let mut document = pinned_fixture_wasm_document();
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
fn reports_engine_errors_for_unknown_revision() {
    let mut document = pinned_fixture_wasm_document();
    let _ = revision_id(&mut document);

    let error = document
        .get_frame_command_buffer_metadata_json("rev-missing", 0)
        .expect_err("unknown revision fails");

    assert_eq!(error.code(), WasmRuntimeErrorCode::EngineError);
    assert_eq!(error.message(), "unknown revision: rev-missing");
}
