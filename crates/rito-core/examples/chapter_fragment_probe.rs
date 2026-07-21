//! Lays whole EPUB chapters out through the fragment engine for the
//! browser oracle.
//!
//! Reads a JSON request on stdin: an EPUB path, registered font files, a
//! content width, and chapter idrefs. Each chapter goes through the full
//! production pipeline — parse, Stylo projection, reader-filtered fragment
//! tree — and is laid out in continuous space by the Parley-backed block
//! engine. The response carries every line's text and ink geometry so a
//! Node harness can diff them against pinned Chromium rendering the same
//! chapters with the same font bytes at the same content width.

use std::io::Read;

use rito_block::BlockFormattingContext;
use rito_core::fragment_bridge::ChapterFormattingTree;
use rito_core::layout::{
    create_layout_config, LayoutConfigInput, MarginInput, SpreadMode, TextMeasurementMode,
};
use rito_core::runtime::RuntimeDocument;
use rito_fragment::{
    CancelFlag, ConstraintSpace, FormattingContext, FormattingNodeContent, Fragment, InlineItem,
};
use rito_inline::ParleyInlineContext;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeRequest {
    epub_path: String,
    font_paths: Vec<String>,
    /// Book-embedded faces bound to their `@font-face` declared family
    /// names, exactly as the browser page loads them.
    #[serde(default)]
    named_fonts: Vec<ProbeNamedFont>,
    content_width_px: f64,
    chapter_idrefs: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeNamedFont {
    family: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeResponse {
    chapters: Vec<ProbeChapter>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeChapter {
    idref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    lines: Vec<ProbeLine>,
}

/// One laid-out line: text plus ink geometry in content-box coordinates.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeLine {
    text: String,
    x: f64,
    /// Line box top in content-box coordinates.
    y: f64,
    width: f64,
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
    let cancel = CancelFlag::new();
    let space = ConstraintSpace::continuous(request.content_width_px);

    let mut chapters = Vec::with_capacity(request.chapter_idrefs.len());
    for idref in &request.chapter_idrefs {
        let built = match document.chapter_formatting_tree(&revision.revision_id, idref) {
            Ok(built) => built,
            Err(error) => {
                chapters.push(ProbeChapter {
                    idref: idref.clone(),
                    error: Some(error.to_string()),
                    lines: Vec::new(),
                });
                continue;
            }
        };
        match engine.layout(&built.tree, built.tree.root(), &space, None, &cancel) {
            Ok(outcome) => {
                let mut lines = Vec::new();
                collect_lines(&outcome.fragments.root, &built, 0.0, 0.0, &mut lines);
                chapters.push(ProbeChapter {
                    idref: idref.clone(),
                    error: None,
                    lines,
                });
            }
            Err(error) => chapters.push(ProbeChapter {
                idref: idref.clone(),
                error: Some(error.to_string()),
                lines: Vec::new(),
            }),
        }
    }

    println!(
        "{}",
        serde_json::to_string(&ProbeResponse { chapters }).expect("probe response encodes")
    );
}

/// Flattens line fragments in document order, reassembling each line's text
/// from its source flow and measuring its ink extent (first glyph or image
/// to the last, trailing whitespace excluded).
fn collect_lines(
    fragment: &Fragment,
    built: &ChapterFormattingTree,
    x_offset: f64,
    y_offset: f64,
    lines: &mut Vec<ProbeLine>,
) {
    match fragment {
        Fragment::Box(inner) => {
            for child in &inner.children {
                collect_lines(
                    child,
                    built,
                    x_offset + inner.rect.x,
                    y_offset + inner.rect.y,
                    lines,
                );
            }
        }
        Fragment::Line(line) => {
            let FormattingNodeContent::InlineFlow { items } = &built.tree.node(line.source).content
            else {
                return;
            };
            let full_text: String = items
                .iter()
                .filter_map(|item| match item {
                    InlineItem::Text { text, .. } => Some(text.as_str()),
                    InlineItem::Image { .. } => None,
                })
                .collect();
            let mut start = u32::MAX;
            let mut end = 0_u32;
            let mut first_x = f64::INFINITY;
            let mut last_edge = f64::NEG_INFINITY;
            for child in &line.children {
                match child {
                    Fragment::Text(run) => {
                        start = start.min(run.text_start);
                        end = end.max(run.text_end);
                        first_x = first_x.min(run.rect.x);
                        last_edge = last_edge.max(run.rect.x + run.rect.width);
                    }
                    Fragment::Image(image) => {
                        first_x = first_x.min(image.rect.x);
                        last_edge = last_edge.max(image.rect.x + image.rect.width);
                    }
                    _ => {}
                }
            }
            if last_edge == f64::NEG_INFINITY {
                return;
            }
            let text = if start <= end && start != u32::MAX {
                full_text[start as usize..end as usize].to_owned()
            } else {
                String::new()
            };
            lines.push(ProbeLine {
                text,
                x: x_offset + line.rect.x + first_x,
                y: y_offset + line.rect.y,
                width: (last_edge - line.trailing_whitespace - first_x).max(0.0),
            });
        }
        Fragment::Text(_) | Fragment::Image(_) => {}
    }
}
