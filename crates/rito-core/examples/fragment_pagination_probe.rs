//! Paginates whole EPUBs through the fragment engine and reports coverage.
//!
//! Reads a JSON request on stdin: an EPUB path, registered font files, and
//! optional `@font-face` bindings. The book goes through the production
//! pipeline — parse, Stylo projection, revision build — and every chapter
//! with retained style tables is paginated into the revision's page content
//! box by the Parley-backed block engine, then painted into display
//! commands. The response is the runtime's fragment page report: per
//! chapter, either page and command counts or the exact fail-closed reason.

use std::io::Read;

use rito_block::BlockFormattingContext;
use rito_core::layout::{
    create_layout_config, LayoutConfigInput, MarginInput, SpreadMode, TextMeasurementMode,
};
use rito_core::runtime::RuntimeDocument;
use rito_inline::ParleyInlineContext;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeRequest {
    epub_path: String,
    font_paths: Vec<String>,
    /// Book-embedded faces bound to their `@font-face` declared family
    /// names, exactly as the browser page loads them.
    #[serde(default)]
    named_fonts: Vec<ProbeNamedFont>,
    /// When set, respond with this chapter's full per-page command stream
    /// instead of the coverage report.
    #[serde(default)]
    dump_chapter_idref: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeNamedFont {
    family: String,
    path: String,
}

fn main() {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .expect("probe request reads");
    let request: ProbeRequest = serde_json::from_str(&input).expect("probe request parses");

    let epub_bytes = std::fs::read(&request.epub_path).expect("epub reads");
    let mut document = RuntimeDocument::open(&epub_bytes).expect("document opens");
    let layout_config = create_layout_config(LayoutConfigInput {
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
        text_measurement: Some(TextMeasurementMode::FontAware),
    });
    let revision = document
        .create_revision(&layout_config)
        .expect("revision builds");

    let font_blobs = request
        .font_paths
        .iter()
        .map(|path| std::fs::read(path).expect("font file reads"))
        .collect();
    let mut inline_context = ParleyInlineContext::new(font_blobs).expect("fonts register");
    for named in &request.named_fonts {
        let bytes = std::fs::read(&named.path).expect("named font file reads");
        inline_context
            .register_named_font(&named.family, bytes)
            .expect("named font registers");
    }
    let engine = BlockFormattingContext::new(inline_context);

    if let Some(idref) = &request.dump_chapter_idref {
        let pages = document
            .fragment_chapter_page_commands(&revision.revision_id, idref, &engine)
            .expect("chapter page commands build");
        println!(
            "{}",
            serde_json::to_string(&pages).expect("commands encode")
        );
        return;
    }
    let report = document
        .fragment_page_report(&revision.revision_id, &engine)
        .expect("fragment page report builds");
    println!(
        "{}",
        serde_json::to_string(&report).expect("report encodes")
    );
}
