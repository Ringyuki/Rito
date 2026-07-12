use std::path::Path;

use rito_core::epub::open_runtime_document_owned;
use rito_core::layout::TextMeasurementMode;
use rito_core::runtime::decode_runtime_bundle;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{WasmRuntimeDocument, WasmRuntimeErrorCode};

use super::fixture::layout;

#[test]
fn legacy_open_reports_an_empty_canonical_policy() {
    let (epub, _) = demo_epub_and_font();
    let document = WasmRuntimeDocument::open(epub).expect("legacy document opens");
    let summary = summary(&document);

    assert_eq!(summary["schemaVersion"], 1);
    assert!(summary["policyId"]
        .as_str()
        .is_some_and(|value| value.len() == 64));
    assert_eq!(summary["faces"], json!([]));
}

#[test]
fn valid_metadata_and_separate_bytes_open_and_return_the_rust_summary() {
    let (epub, font) = demo_epub_and_font();
    let hash = sha256_hex(&font);
    let document = open(epub, metadata(&hash, Some("JA")), vec![font]);
    let summary = summary(&document);
    let face = &summary["faces"][0];

    assert_eq!(face["sha256"], hash);
    assert_eq!(face["shapeFingerprint"], &hash[..16]);
    assert_eq!(face["familyAlias"], format!("__RitoPinned_{hash}"));
    assert_eq!(face["language"], "ja");
    assert_eq!(face["genericRole"], "serif");
    assert!(face.get("bytes").is_none());
}

#[test]
fn rejects_bad_schema_count_types_language_and_json_bytes() {
    let (epub, font) = demo_epub_and_font();
    let hash = sha256_hex(&font);
    let cases = [
        (json!({"schemaVersion": 2, "faces": []}), vec![]),
        (metadata(&hash, None), vec![]),
        (
            json!({"schemaVersion": 1, "faces": [{
                "expectedSha256": hash, "genericRole": 7
            }]}),
            vec![font.clone()],
        ),
        (
            metadata(&sha256_hex(&font), Some("zh--hant")),
            vec![font.clone()],
        ),
        (metadata(&"0".repeat(63), None), vec![font.clone()]),
        (
            json!({"schemaVersion": 1, "faces": [
                {"expectedSha256": sha256_hex(&font), "genericRole": "serif"},
                {"expectedSha256": sha256_hex(&font), "genericRole": "sansSerif"}
            ]}),
            vec![font.clone(), font.clone()],
        ),
        (
            json!({"schemaVersion": 1, "faces": [{
                "expectedSha256": sha256_hex(&font),
                "genericRole": "serif",
                "bytes": [1, 2, 3]
            }]}),
            vec![font],
        ),
    ];

    for (metadata, bytes) in cases {
        let error = WasmRuntimeDocument::open_with_pinned_font_policy(
            epub.clone(),
            &metadata.to_string(),
            bytes,
        )
        .err()
        .expect("invalid metadata is rejected");
        assert_eq!(error.code(), WasmRuntimeErrorCode::BadRequest);
    }
}

#[test]
fn core_rejects_hash_mismatch_and_unparseable_font_bytes() {
    let (epub, font) = demo_epub_and_font();
    let bad_hash = WasmRuntimeDocument::open_with_pinned_font_policy(
        epub.clone(),
        &metadata(&"0".repeat(64), None).to_string(),
        vec![font],
    )
    .err()
    .expect("hash mismatch is rejected");
    let invalid_font = vec![1, 2, 3];
    let bad_font = WasmRuntimeDocument::open_with_pinned_font_policy(
        epub,
        &metadata(&sha256_hex(&invalid_font), None).to_string(),
        vec![invalid_font],
    )
    .err()
    .expect("invalid font is rejected");

    assert_eq!(bad_hash.code(), WasmRuntimeErrorCode::EngineError);
    assert!(bad_hash.message().contains("SHA-256 mismatch"));
    assert_eq!(bad_font.code(), WasmRuntimeErrorCode::EngineError);
    assert!(bad_font.message().contains("not a parseable"));
}

#[test]
fn reader_json_and_ritorb1_preserve_required_font_faces() {
    let (epub, font) = demo_epub_and_font();
    let metadata = metadata(&sha256_hex(&font), None);
    let mut json_document = open(epub.clone(), metadata.clone(), vec![font.clone()]);
    let mut binary_document = open(epub, metadata, vec![font]);
    let mut config = layout();
    config.text_measurement = TextMeasurementMode::FontAware;
    let request = json!({
        "layoutConfig": config,
        "lineBreaking": "greedy",
        "activeSpreadIndex": 0,
        "mode": "full",
    })
    .to_string();
    let json: Value = serde_json::from_str(
        &json_document
            .create_reader_view_revision_bundle_json(&request, true)
            .expect("reader JSON is returned"),
    )
    .expect("reader JSON parses");
    let binary = binary_document
        .create_reader_view_revision_bundle_bytes(&request, true)
        .expect("reader RITORB1 is returned");
    let binary = decode_runtime_bundle(&binary).expect("reader RITORB1 decodes");

    for bundle in [
        &json["result"]["bundle"],
        &binary.payload["result"]["bundle"],
    ] {
        let required = &bundle["requiredFontFaces"];
        assert_eq!(required["schemaVersion"], 1);
        assert_eq!(required["revisionId"], bundle["revision"]["revisionId"]);
        let face = required["faces"]
            .as_array()
            .and_then(|faces| faces.first())
            .expect("demo revision requires an embedded font face");
        assert!(face["family"]
            .as_str()
            .is_some_and(|value| !value.is_empty()));
        assert!(face["shapeFingerprint"]
            .as_str()
            .is_some_and(|value| value.len() == 16));
        assert!(face["byteLength"].as_u64().is_some_and(|value| value > 0));
    }
}

fn open(epub: Vec<u8>, metadata: Value, fonts: Vec<Vec<u8>>) -> WasmRuntimeDocument {
    WasmRuntimeDocument::open_with_pinned_font_policy(epub, &metadata.to_string(), fonts)
        .expect("pinned document opens")
}

fn metadata(hash: &str, language: Option<&str>) -> Value {
    let mut face = json!({
        "expectedSha256": hash,
        "genericRole": "serif"
    });
    if let Some(language) = language {
        face["language"] = json!(language);
    }
    json!({
        "schemaVersion": 1,
        "faces": [face]
    })
}

fn summary(document: &WasmRuntimeDocument) -> Value {
    serde_json::from_str(&document.pinned_font_policy_json().unwrap()).unwrap()
}

fn demo_epub_and_font() -> (Vec<u8>, Vec<u8>) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/reader/src/assets/demo.epub");
    let epub = std::fs::read(path).expect("demo EPUB reads");
    let mut loaded = open_runtime_document_owned(epub.clone()).expect("demo EPUB opens");
    loaded.ensure_all_fonts_loaded().expect("demo fonts load");
    let font = loaded
        .fonts
        .iter()
        .find(|font| ttf_parser::Face::parse(&font.bytes, 0).is_ok())
        .expect("demo contains a parseable font")
        .bytes
        .clone();
    (epub, font)
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
