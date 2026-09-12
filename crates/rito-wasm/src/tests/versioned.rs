use rito_core::runtime::RuntimeResourceKind;
use serde_json::{json, Value};

use super::fixture::{layout, pinned_fixture_wasm_document, revision_id};
use crate::WasmRuntimeErrorCode;

fn parse(response: String) -> Value {
    serde_json::from_str(&response).expect("versioned response parses")
}

fn assert_revision(response: &Value, revision_id: &str, revision_version: u32) {
    assert_eq!(response["revision"]["revisionId"], revision_id);
    assert_eq!(response["revision"]["revisionVersion"], revision_version);
}

#[test]
fn versioned_raw_reads_return_stamped_envelopes() {
    let mut document = pinned_fixture_wasm_document();
    let revision_id = revision_id(&mut document);

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
fn versioned_revision_presentation_is_slim_and_exact() {
    let mut document = pinned_fixture_wasm_document();
    let config = layout();
    let created = parse(
        document
            .create_bounded_revision_json(
                &json!({
                    "layoutConfig": config,
                })
                .to_string(),
            )
            .expect("font-aware revision is created"),
    );
    let revision_id = created["revision"]["revisionId"]
        .as_str()
        .expect("font-aware revision id is present")
        .to_owned();
    let presentation = parse(
        document
            .get_revision_presentation_at_revision_json(&revision_id, 0)
            .expect("revision presentation is returned"),
    );
    let bundle = parse(
        document
            .get_revision_bundle_at_revision_json(&revision_id, 0, true)
            .expect("revision bundle is returned"),
    );

    assert_revision(&presentation, &revision_id, 0);
    let value = presentation["value"]
        .as_object()
        .expect("presentation value is an object");
    for field in ["revision", "navigation", "tocTargets", "fontFamilies"] {
        assert!(value.contains_key(field), "missing {field}");
    }
    // The fragment engine shapes with its own fonts and never asks the
    // host for vertical-metric samples.
    assert!(!value.contains_key("fontVerticalMetricDemands"));
    assert!(!value.contains_key("footnotes"));
    assert!(!value.contains_key("chapterTextIndices"));
    for field in [
        "revision",
        "navigation",
        "tocTargets",
        "fontFamilies",
        "fontVerticalMetricDemands",
        "requiredFontFaces",
    ] {
        assert_eq!(presentation["value"][field], bundle["value"][field]);
    }
}

#[test]
fn page_semantics_raw_binding_preserves_the_versioned_envelope_and_typed_errors() {
    let mut document = pinned_fixture_wasm_document();
    let revision_id = revision_id(&mut document);

    let response = parse(
        document
            .get_page_semantics_at_revision_json(&revision_id, 0, 0)
            .expect("page semantics are returned"),
    );

    assert_revision(&response, &revision_id, 0);
    assert_eq!(response["value"]["revisionId"], revision_id);
    assert_eq!(response["value"]["pageIndex"], 0);
    assert_eq!(response["value"]["spreadIndex"], 0);
    assert!(response["value"]["nodes"]
        .as_array()
        .is_some_and(|nodes| nodes.iter().any(|node| node["role"] == "paragraph")));

    let stale = document
        .get_page_semantics_at_revision_json(&revision_id, 1, 0)
        .expect_err("a stale semantics handle is rejected");
    assert_eq!(stale.code(), WasmRuntimeErrorCode::StaleRevisionVersion);
    let invalid_page = document
        .get_page_semantics_at_revision_json(&revision_id, 0, usize::MAX)
        .expect_err("an invalid semantics page is rejected");
    assert_eq!(invalid_page.code(), WasmRuntimeErrorCode::EngineError);
}

#[test]
fn page_reading_anchor_raw_binding_preserves_source_identity_and_typed_errors() {
    let mut document = pinned_fixture_wasm_document();
    let revision_id = revision_id(&mut document);

    let response = parse(
        document
            .get_page_reading_anchor_at_revision_json(&revision_id, 0, 0)
            .expect("page reading anchor is returned"),
    );

    assert_revision(&response, &revision_id, 0);
    assert_eq!(response["value"]["status"], "resolved");
    assert_eq!(response["value"]["revisionId"], revision_id);
    assert_eq!(response["value"]["pageIndex"], 0);
    assert_eq!(response["value"]["spreadIndex"], 0);
    assert_eq!(response["value"]["locator"]["href"], "chapter.xhtml");
    assert!(response["value"]["locator"]["sourcePoint"]["nodePath"]
        .as_array()
        .is_some());
    assert!(response["value"]["locator"]["sourcePoint"]["textOffset"]
        .as_u64()
        .is_some());

    let stale = document
        .get_page_reading_anchor_at_revision_json(&revision_id, 1, 0)
        .expect_err("a stale reading-anchor handle is rejected");
    assert_eq!(stale.code(), WasmRuntimeErrorCode::StaleRevisionVersion);
    let invalid_page = document
        .get_page_reading_anchor_at_revision_json(&revision_id, 0, usize::MAX)
        .expect_err("an invalid reading-anchor page is rejected");
    assert_eq!(invalid_page.code(), WasmRuntimeErrorCode::EngineError);
}

#[test]
fn versioned_exact_text_reads_return_stamped_typed_responses() {
    let mut document = pinned_fixture_wasm_document();
    let revision_id = revision_id(&mut document);
    let targets = parse(
        document
            .get_page_targets_at_revision_json(&revision_id, 0, 0)
            .expect("page targets are returned"),
    );
    let target = targets["value"]["entries"]
        .as_array()
        .and_then(|entries| entries.iter().find(|entry| entry["kind"] == "text"))
        .expect("fixture contains a text target");
    let bounds = &target["bounds"];
    let point_request = json!({
        "pageIndex": 0,
        "x": bounds["x"].as_f64().expect("target x")
            + bounds["width"].as_f64().expect("target width") / 2.0,
        "y": bounds["y"].as_f64().expect("target y")
            + bounds["height"].as_f64().expect("target height") / 2.0,
    });
    let caret = parse(
        document
            .resolve_text_caret_at_revision_json(&revision_id, 0, &point_request.to_string())
            .expect("caret response is returned"),
    );

    assert_revision(&caret, &revision_id, 0);
    assert_eq!(caret["value"]["pageIndex"], 0);
    assert_eq!(caret["value"]["spreadIndex"], 0);
    assert_eq!(caret["value"]["resolution"]["status"], "resolved");

    let address = json!({
        "pageIndex": 0,
        "blockIndex": target["blockIndex"],
        "lineIndex": target["lineIndex"],
        "runIndex": target["runIndex"],
        "charIndex": 0,
        "affinity": "downstream",
    });
    let range = parse(
        document
            .resolve_text_range_at_revision_json(
                &revision_id,
                0,
                &json!({ "anchor": address, "focus": address }).to_string(),
            )
            .expect("text range response is returned"),
    );

    assert_revision(&range, &revision_id, 0);
    assert_eq!(range["value"]["resolution"]["status"], "resolved");

    let point_range = parse(
        document
            .resolve_text_range_from_points_at_revision_json(
                &revision_id,
                0,
                &json!({
                    "anchor": point_request,
                    "focus": point_request,
                    "granularity": "word",
                })
                .to_string(),
            )
            .expect("point range response is returned"),
    );
    assert_revision(&point_range, &revision_id, 0);
    assert_eq!(point_range["value"]["resolution"]["status"], "resolved");

    let range_to_point = parse(
        document
            .resolve_text_range_to_point_at_revision_json(
                &revision_id,
                0,
                &json!({
                    "anchor": address,
                    "focus": point_request,
                })
                .to_string(),
            )
            .expect("range-to-point response is returned"),
    );
    assert_revision(&range_to_point, &revision_id, 0);
    assert_eq!(range_to_point["value"]["resolution"]["status"], "resolved");

    let movement_request = json!({
        "anchor": address,
        "focus": address,
        "movement": "characterRight",
    });
    let movement = parse(
        document
            .resolve_text_selection_movement_at_revision_json(
                &revision_id,
                0,
                &movement_request.to_string(),
            )
            .expect("text selection movement response is returned"),
    );
    assert_revision(&movement, &revision_id, 0);
    assert_eq!(movement["value"]["revisionId"], revision_id);
    assert_eq!(movement["value"]["resolution"]["status"], "resolved");
    for movement_name in ["paragraphPreviousStart", "paragraphNextStart"] {
        let response = parse(
            document
                .resolve_text_selection_movement_at_revision_json(
                    &revision_id,
                    0,
                    &json!({
                        "anchor": address,
                        "focus": address,
                        "movement": movement_name,
                    })
                    .to_string(),
                )
                .expect("paragraph start movement request is accepted"),
        );
        // A single-paragraph fixture reaches the document boundary in
        // either direction; the typed, stamped response is the contract.
        let status = response["value"]["resolution"]["status"]
            .as_str()
            .expect("movement status");
        assert!(status == "resolved" || status == "boundary", "{status}");
    }
    let stale_movement = document
        .resolve_text_selection_movement_at_revision_json(
            &revision_id,
            1,
            &movement_request.to_string(),
        )
        .expect_err("stale text selection movement is rejected");
    assert_eq!(
        stale_movement.code(),
        WasmRuntimeErrorCode::StaleRevisionVersion
    );

    // The first character of the fixture paragraph's text node; page
    // targets carry no click-source point of their own.
    let source_range_request = json!({
        "href": "chapter.xhtml",
        "sourceRange": {
            "start": { "nodePath": [0, 0], "textOffset": 0 },
            "end": { "nodePath": [0, 0], "textOffset": 1 },
        },
    });
    let source_range = parse(
        document
            .resolve_exact_source_range_at_revision_json(
                &revision_id,
                0,
                &source_range_request.to_string(),
            )
            .expect("exact source range response is returned"),
    );

    assert_revision(&source_range, &revision_id, 0);
    assert_eq!(source_range["value"]["revisionId"], revision_id);
    assert_eq!(source_range["value"]["resolution"]["status"], "resolved");

    let bad_point = document
        .resolve_text_caret_at_revision_json(&revision_id, 0, r#"{"pageIndex":0,"x":"bad","y":0}"#)
        .expect_err("malformed point request is rejected");
    let bad_range = document
        .resolve_text_range_at_revision_json(&revision_id, 0, r#"{"anchor":{"pageIndex":0}}"#)
        .expect_err("malformed range request is rejected");
    let bad_point_range = document
        .resolve_text_range_from_points_at_revision_json(
            &revision_id,
            0,
            r#"{"anchor":{"pageIndex":0,"x":0,"y":0},"focus":{"pageIndex":0,"x":0,"y":0},"granularity":"sentence"}"#,
        )
        .expect_err("malformed point range request is rejected");
    let bad_range_to_point = document
        .resolve_text_range_to_point_at_revision_json(
            &revision_id,
            0,
            r#"{"anchor":{"pageIndex":0},"focus":{"pageIndex":0,"x":0,"y":0}}"#,
        )
        .expect_err("malformed range-to-point request is rejected");
    let bad_movement = document
        .resolve_text_selection_movement_at_revision_json(
            &revision_id,
            0,
            r#"{"anchor":{"pageIndex":0},"focus":{"pageIndex":0},"movement":"sentenceForward"}"#,
        )
        .expect_err("malformed text selection movement is rejected");
    let bad_source_range = document
        .resolve_exact_source_range_at_revision_json(
            &revision_id,
            0,
            r#"{"href":"chapter.xhtml","source_range":{"start":{},"end":{}}}"#,
        )
        .expect_err("non-camel-case source range request is rejected");
    assert_eq!(bad_point.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(bad_point
        .message()
        .contains("invalid text point request JSON"));
    assert_eq!(bad_range.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(bad_range
        .message()
        .contains("invalid text range request JSON"));
    assert_eq!(bad_point_range.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(bad_point_range
        .message()
        .contains("invalid text range from points request JSON"));
    assert_eq!(bad_range_to_point.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(bad_range_to_point
        .message()
        .contains("invalid text range to point request JSON"));
    assert_eq!(bad_movement.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(bad_movement
        .message()
        .contains("invalid text selection movement request JSON"));
    assert_eq!(bad_source_range.code(), WasmRuntimeErrorCode::BadRequest);
    assert!(bad_source_range
        .message()
        .contains("invalid exact source range request JSON"));
}

#[test]
fn style_table_summary_is_versioned_and_deterministic() {
    let mut document = pinned_fixture_wasm_document();
    let revision_id = revision_id(&mut document);

    let summary = parse(
        document
            .get_style_table_summary_at_revision_json(&revision_id, 0)
            .expect("style table summary"),
    );
    assert_revision(&summary, &revision_id, 0);
    assert_eq!(summary["value"]["schemaVersion"], 1);
    assert_eq!(summary["value"]["isComplete"], true);
    assert!(summary["value"]["chapterCount"].as_u64().unwrap() > 0);
    let chapters = summary["value"]["chapters"].as_array().expect("chapters");
    for chapter in chapters {
        assert!(chapter["internedStyleCount"].as_u64().unwrap() > 0);
        assert!(chapter["inlineInternedStyleCount"].as_u64().unwrap() > 0);
        assert!(chapter["assignedNodeCount"].as_u64().unwrap() > 0);
        assert!(chapter["inlineAssignedNodeCount"].as_u64().unwrap() > 0);
    }
    let digest = summary["value"]["tableDigest"].as_str().expect("digest");
    assert_eq!(digest.len(), 16);
    let replayed = parse(
        document
            .get_style_table_summary_at_revision_json(&revision_id, 0)
            .expect("second style table summary"),
    );
    assert_eq!(summary, replayed);
}

#[test]
fn chapter_tree_report_is_versioned_and_deterministic() {
    let mut document = pinned_fixture_wasm_document();
    let revision_id = revision_id(&mut document);

    let report = parse(
        document
            .get_chapter_tree_report_at_revision_json(&revision_id, 0)
            .expect("chapter tree report"),
    );
    assert_revision(&report, &revision_id, 0);
    assert_eq!(report["value"]["schemaVersion"], 1);
    assert_eq!(report["value"]["isComplete"], true);
    let chapters = report["value"]["chapters"].as_array().expect("chapters");
    assert!(!chapters.is_empty());
    for chapter in chapters {
        if chapter["representable"] == true {
            assert!(chapter["formattingNodeCount"].as_u64().unwrap() > 0);
            assert_eq!(chapter["treeFingerprint"].as_str().unwrap().len(), 16);
        } else {
            assert!(!chapter["reason"].as_str().unwrap().is_empty());
        }
    }
    let replayed = parse(
        document
            .get_chapter_tree_report_at_revision_json(&revision_id, 0)
            .expect("second chapter tree report"),
    );
    assert_eq!(report, replayed);
}
