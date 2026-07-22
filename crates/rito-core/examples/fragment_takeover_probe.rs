//! Reports whether whole books hand pagination to the fragment engine.
//!
//! Reads a JSON request on stdin: pinned font paths and a list of EPUB
//! paths. Each book opens with the reader's pinned-font policy, builds an
//! eager font-aware revision with the fragment page table lever on, and
//! reports which backend ended up owning pagination. Books that stay
//! retained also report every chapter's fragment-tree error (the
//! representability or paint-capability reason), so the takeover gap is
//! attributable per book.

use std::io::Read;

use rito_core::layout::{
    create_layout_config, LayoutConfigInput, MarginInput, SpreadMode, TextMeasurementMode,
};
use rito_core::runtime::{
    RuntimeDocument, RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole,
    RuntimePinnedFontLanguageTag, RuntimePinnedFontPolicyInput,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeRequest {
    serif_font_path: String,
    serif_language: Option<String>,
    epub_paths: Vec<String>,
    #[serde(default)]
    viewport: Option<(f64, f64, f64)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeBook {
    epub_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    backend: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    page_count: Option<usize>,
    /// Why the book stayed retained, from the routing gate itself.
    #[serde(skip_serializing_if = "Option::is_none")]
    rejection: Option<String>,
    /// Chapters the fragment tree cannot represent, with reasons; empty
    /// for fragment-backed books.
    chapter_errors: Vec<ProbeChapterError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeChapterError {
    idref: String,
    error: String,
}

fn main() {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .expect("probe request reads");
    let request: ProbeRequest = serde_json::from_str(&input).expect("probe request parses");

    let serif_bytes = std::fs::read(&request.serif_font_path).expect("serif font reads");
    let policy = RuntimePinnedFontPolicyInput {
        faces: vec![RuntimePinnedFontFaceInput {
            expected_sha256: format!("{:x}", Sha256::digest(&serif_bytes)),
            bytes: serif_bytes,
            generic_role: RuntimePinnedFontGenericRole::Serif,
            language: request.serif_language.as_deref().map(|value| {
                RuntimePinnedFontLanguageTag::parse(value).expect("language tag parses")
            }),
        }],
    };

    let books: Vec<ProbeBook> = request
        .epub_paths
        .iter()
        .map(|path| probe_book(path, policy.clone(), request.viewport))
        .collect();
    println!("{}", serde_json::to_string(&books).expect("report encodes"));
}

fn probe_book(
    epub_path: &str,
    policy: RuntimePinnedFontPolicyInput,
    viewport: Option<(f64, f64, f64)>,
) -> ProbeBook {
    let mut book = ProbeBook {
        epub_path: epub_path.to_owned(),
        error: None,
        backend: None,
        page_count: None,
        rejection: None,
        chapter_errors: Vec::new(),
    };
    let bytes = match std::fs::read(epub_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            book.error = Some(format!("read failed: {error}"));
            return book;
        }
    };
    let mut document = match RuntimeDocument::open_with_pinned_font_policy(&bytes, policy) {
        Ok(document) => document,
        Err(error) => {
            book.error = Some(format!("open failed: {error}"));
            return book;
        }
    };
    document.set_fragment_page_table_enabled(true);
    let (width, height, margin) = viewport.unwrap_or((1218.0, 619.0, 50.0));
    let layout_config = create_layout_config(LayoutConfigInput {
        width,
        height,
        margin: MarginInput::All(margin),
        spread: SpreadMode::Double,
        first_page_alone: true,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        pagination_policy: None,
        text_measurement: Some(TextMeasurementMode::FontAware),
    });
    let revision = match document.create_revision(&layout_config) {
        Ok(revision) => revision,
        Err(error) => {
            book.error = Some(format!("revision failed: {error}"));
            return book;
        }
    };
    book.page_count = Some(revision.page_count);
    book.backend = document
        .revision_pagination_backend(&revision.revision_id)
        .map(str::to_owned);
    if book.backend.as_deref() == Some("fragment") {
        return book;
    }
    book.rejection = document.fragment_page_table_rejection_reason(&revision.revision_id);
    let idrefs: Vec<String> = document
        .publication_info()
        .chapters
        .into_iter()
        .map(|chapter| chapter.idref)
        .collect();
    for idref in idrefs {
        if let Err(error) = document.chapter_formatting_tree(&revision.revision_id, &idref) {
            book.chapter_errors.push(ProbeChapterError {
                idref,
                error: error.to_string(),
            });
        }
    }
    book
}
