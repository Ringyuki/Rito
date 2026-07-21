//! Measures the Parley-backed inline provider's line breaking against a
//! browser.
//!
//! Reads a JSON request on stdin: registered font files, a max advance, a
//! font size, and a list of paragraph texts. Each paragraph is laid out
//! through the production provider path — a `FormattingTree` inline flow
//! with typed styles, laid out by `rito_inline::ParleyInlineContext` — and
//! the resulting line texts are written as JSON on stdout. A Node-side
//! harness feeds pinned Chromium the identical inputs and diffs the two
//! line sequences; the parity number is regression evidence for the
//! provider the fragment pipeline actually ships.

use std::io::Read;

use rito_fragment::{
    CancelFlag, ConstraintSpace, FormattingContext, FormattingNode, FormattingNodeContent,
    FormattingNodeId, FormattingTree, FormattingTreeStyles, Fragment, InlineItem,
};
use rito_inline::{plain_paragraph_style, ParleyInlineContext};
use rito_style_contract::{
    FontFamilies, FontFamily, FontFamilyName, InlineStyleTableV1, LayoutStyleId, LayoutStyleTableV1,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpikeRequest {
    font_paths: Vec<String>,
    font_size_px: f32,
    max_advance_px: f32,
    paragraphs: Vec<SpikeParagraph>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpikeParagraph {
    text: String,
    #[serde(default)]
    first_line_indent_px: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpikeResponse {
    families: Vec<String>,
    paragraphs: Vec<Vec<SpikeLine>>,
}

/// One laid-out line: its text plus ink geometry in paragraph coordinates.
/// `x` is the first glyph's inline offset (so an indented first line starts
/// at the indent) and `width` the ink extent excluding trailing whitespace,
/// matching what per-character ranges measure in a browser.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpikeLine {
    text: String,
    x: f64,
    width: f64,
}

fn main() {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .expect("spike request reads");
    let request: SpikeRequest = serde_json::from_str(&input).expect("spike request parses");

    let font_blobs = request
        .font_paths
        .iter()
        .map(|path| std::fs::read(path).expect("font file reads"))
        .collect();
    let context = ParleyInlineContext::new(font_blobs).expect("fonts register");
    let families = FontFamilies::new(
        context
            .registered_families()
            .iter()
            .map(|name| FontFamily::Named(FontFamilyName::new(name.clone())))
            .collect(),
    )
    .expect("at least one family registered");

    let space = ConstraintSpace::continuous(f64::from(request.max_advance_px));
    let cancel = CancelFlag::new();
    let mut paragraphs = Vec::with_capacity(request.paragraphs.len());
    for paragraph in &request.paragraphs {
        let mut inline = InlineStyleTableV1::new(1);
        let style = inline
            .intern_for_node(
                0,
                plain_paragraph_style(
                    families.clone(),
                    request.font_size_px,
                    paragraph.first_line_indent_px,
                ),
            )
            .expect("paragraph style interns");
        let tree = FormattingTree::with_styles(
            vec![FormattingNode {
                style: LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::InlineFlow {
                    items: vec![InlineItem::Text {
                        text: paragraph.text.clone(),
                        style,
                    }],
                },
                children: Vec::new(),
            }],
            FormattingNodeId(0),
            FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("paragraph tree builds");
        let outcome = context
            .layout(&tree, tree.root(), &space, None, &cancel)
            .expect("paragraph lays out");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("inline outcome root is a box fragment");
        };
        let mut lines = Vec::new();
        for line in &root.children {
            let Fragment::Line(line) = line else {
                panic!("inline children are line fragments");
            };
            let mut start = u32::MAX;
            let mut end = 0_u32;
            let mut first_x = f64::INFINITY;
            let mut last_edge = f64::NEG_INFINITY;
            for run in &line.children {
                let Fragment::Text(run) = run else {
                    panic!("line children are text fragments");
                };
                start = start.min(run.text_start);
                end = end.max(run.text_end);
                first_x = first_x.min(run.rect.x);
                last_edge = last_edge.max(run.rect.x + run.rect.width);
            }
            assert!(start <= end, "lines carry at least one text fragment");
            lines.push(SpikeLine {
                text: paragraph.text[start as usize..end as usize].to_string(),
                x: line.rect.x + first_x,
                width: (last_edge - line.trailing_whitespace - first_x).max(0.0),
            });
        }
        paragraphs.push(lines);
    }

    let response = SpikeResponse {
        families: context.registered_families().to_vec(),
        paragraphs,
    };
    println!(
        "{}",
        serde_json::to_string(&response).expect("spike response encodes")
    );
}
