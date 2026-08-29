use rito_core::{
    epub::{
        LoadedBinaryResource, LoadedChapter, LoadedEpubDocument, LoadedTextResource, ManifestItem,
        PackageDocument, PackageMetadata, SpineItem, TocEntry,
    },
    layout::{create_layout_config, LayoutConfig, LayoutConfigInput, MarginInput, SpreadMode},
    runtime::{RuntimeResourceKind, RuntimeResourceTransferPayload},
};
use serde_json::Value;

use crate::WasmRuntimeDocument;

pub fn revision_id(document: &mut WasmRuntimeDocument) -> String {
    let json = document
        .create_full_revision_bundle_json(
            &serde_json::json!({
                "layoutConfig": layout(),
                "activeSpreadIndex": 0
            })
            .to_string(),
        )
        .expect("revision is created");
    let value: Value = serde_json::from_str(&json).expect("revision JSON parses");
    release_initial_frame_payloads(document, &value);
    value["bundle"]["revision"]["revisionId"]
        .as_str()
        .expect("revision id is present")
        .to_owned()
}

fn release_initial_frame_payloads(document: &mut WasmRuntimeDocument, value: &Value) {
    let Some(spreads) = value["initialFrameWindow"]["spreads"].as_array() else {
        return;
    };
    for spread in spreads {
        let Some(payloads) = spread["payloads"].as_array() else {
            continue;
        };
        for payload in payloads {
            if let Some(transfer_id) = payload["transferId"].as_str() {
                document.release_resource_transfer(transfer_id);
            }
        }
    }
}

pub fn resource_payload(
    document: &mut WasmRuntimeDocument,
    revision_id: &str,
) -> RuntimeResourceTransferPayload {
    let json = document
        .get_resource_payload_json(revision_id, RuntimeResourceKind::Image, "Images/cover.png")
        .expect("resource payload serializes");
    serde_json::from_str(&json).expect("resource payload parses")
}

pub fn layout() -> LayoutConfig {
    create_layout_config(LayoutConfigInput {
        width: 420.0,
        height: 640.0,
        margin: MarginInput::All(24.0),
        spread: SpreadMode::Single,
        first_page_alone: true,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        pagination_policy: None,
        text_measurement: None,
    })
}

pub fn fixture_document() -> LoadedEpubDocument {
    LoadedEpubDocument {
        package: PackageDocument {
            metadata: PackageMetadata {
                title: "WASM fixture".to_owned(),
                language: "en".to_owned(),
                identifier: "wasm-fixture".to_owned(),
                creator: None,
            },
            manifest: vec![ManifestItem {
                id: "chapter".to_owned(),
                href: "chapter.xhtml".to_owned(),
                media_type: "application/xhtml+xml".to_owned(),
                properties: Vec::new(),
            }],
            spine: vec![SpineItem {
                idref: "chapter".to_owned(),
                linear: true,
            }],
            toc: vec![TocEntry {
                label: "Chapter".to_owned(),
                href: "chapter.xhtml".to_owned(),
                children: Vec::new(),
            }],
        },
        stylesheets: vec![LoadedTextResource {
            href: "style.css".to_owned(),
            text: r#"p { color: #333; background-image: url("Images/cover.png"); background-size: contain; }"#
                .to_owned(),
        }],
        fonts: vec![LoadedBinaryResource {
            href: "Fonts/book.otf".to_owned(),
            media_type: "font/otf".to_owned(),
            byte_length: b"font-bytes".len(),
            byte_hash: None,
            bytes: b"font-bytes".to_vec(),
            width: None,
            height: None,
            dimensions_loaded: true,
        }],
        images: vec![LoadedBinaryResource {
            href: "Images/cover.png".to_owned(),
            media_type: "image/png".to_owned(),
            byte_length: minimal_png().len(),
            byte_hash: None,
            bytes: minimal_png(),
            width: Some(2),
            height: Some(3),
            dimensions_loaded: true,
        }],
        chapters: vec![LoadedChapter {
            idref: "chapter".to_owned(),
            href: "chapter.xhtml".to_owned(),
            linear: true,
            xhtml_source: r##"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><link rel="stylesheet" href="style.css"/></head><body><p id="intro">Hello WASM<a epub:type="noteref" href="#fn1">1</a></p><aside epub:type="footnote" id="fn1"><p>WASM note</p></aside><img src="Images/cover.png" alt="cover"/></body></html>"##
                .to_owned(),
            source_loaded: true,
            image_refs: None,
        }],
        archive_source: None,
    }
}

pub fn multi_chapter_document() -> LoadedEpubDocument {
    LoadedEpubDocument {
        package: PackageDocument {
            metadata: PackageMetadata {
                title: "WASM multi chapter fixture".to_owned(),
                language: "en".to_owned(),
                identifier: "wasm-multi-fixture".to_owned(),
                creator: None,
            },
            manifest: vec![
                ManifestItem {
                    id: "chapter-1".to_owned(),
                    href: "chapter-1.xhtml".to_owned(),
                    media_type: "application/xhtml+xml".to_owned(),
                    properties: Vec::new(),
                },
                ManifestItem {
                    id: "chapter-2".to_owned(),
                    href: "chapter-2.xhtml".to_owned(),
                    media_type: "application/xhtml+xml".to_owned(),
                    properties: Vec::new(),
                },
            ],
            spine: vec![
                SpineItem {
                    idref: "chapter-1".to_owned(),
                    linear: true,
                },
                SpineItem {
                    idref: "chapter-2".to_owned(),
                    linear: true,
                },
            ],
            toc: Vec::new(),
        },
        stylesheets: Vec::new(),
        fonts: Vec::new(),
        images: Vec::new(),
        chapters: vec![
            loaded_chapter("chapter-1", "chapter-1.xhtml", "Chapter one"),
            loaded_chapter("chapter-2", "chapter-2.xhtml", "Chapter two active window"),
        ],
        archive_source: None,
    }
}

fn loaded_chapter(idref: &str, href: &str, text: &str) -> LoadedChapter {
    LoadedChapter {
        idref: idref.to_owned(),
        href: href.to_owned(),
        linear: true,
        xhtml_source: format!(r#"<html><body><p>{text}</p></body></html>"#),
        source_loaded: true,
        image_refs: None,
    }
}

pub fn minimal_png() -> Vec<u8> {
    let mut bytes = vec![0u8; 33];
    bytes[0..8].copy_from_slice(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
    bytes[12..16].copy_from_slice(b"IHDR");
    bytes[16..20].copy_from_slice(&2u32.to_be_bytes());
    bytes[20..24].copy_from_slice(&3u32.to_be_bytes());
    bytes
}

/// Pinned test policy for wasm-side sessions: chapter-local pagination
/// shapes with pinned faces only.
pub fn pinned_test_policy_input() -> rito_core::runtime::RuntimePinnedFontPolicyInput {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"
    );
    let bytes = std::fs::read(path).expect("pinned Tinos test font reads");
    rito_core::runtime::RuntimePinnedFontPolicyInput {
        faces: vec![rito_core::runtime::RuntimePinnedFontFaceInput {
            expected_sha256: {
                use sha2::{Digest, Sha256};
                format!("{:x}", Sha256::digest(&bytes))
            },
            bytes,
            generic_role: rito_core::runtime::RuntimePinnedFontGenericRole::Serif,
            language: None,
        }],
    }
}

/// A wasm document over the in-memory fixture with the pinned test
/// policy attached (chapter-local builds require pinned faces).
pub fn pinned_fixture_wasm_document() -> crate::WasmRuntimeDocument {
    let document =
        rito_core::runtime::RuntimeDocument::from_loaded_document_with_pinned_font_policy(
            fixture_document(),
            pinned_test_policy_input(),
        )
        .expect("pinned fixture document builds");
    crate::WasmRuntimeDocument::from_runtime_document(document)
}
