//! Compares text-line geometry between the retained and fragment
//! pagination backends for one book under one layout config.
//!
//! Reads a JSON request on stdin (font path + epub path + optional
//! viewport + spread count), builds two revisions of the same book — one
//! with the fragment page-table lever off, one with it on — and reports
//! each backend's painted text lines (text prefix, x, y, per-line
//! advance) for the first N spreads, plus a first-divergence summary the
//! caller can diff without pixel tooling.

use std::io::Read;

use rito_core::layout::{
    create_layout_config, LayoutConfigInput, MarginInput, SpreadMode, TextMeasurementMode,
};
use rito_core::runtime::{
    RuntimeDocument, RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole,
    RuntimePinnedFontLanguageTag, RuntimePinnedFontPolicyInput,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeRequest {
    serif_font_path: String,
    serif_language: Option<String>,
    epub_path: String,
    #[serde(default)]
    viewport: Option<(f64, f64, f64)>,
    #[serde(default)]
    spread_count: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeLine {
    text: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeSpread {
    spread_index: usize,
    lines: Vec<ProbeLine>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeReport {
    retained_pages: usize,
    fragment_pages: usize,
    retained: Vec<ProbeSpread>,
    fragment: Vec<ProbeSpread>,
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
    let (width, height, margin) = request.viewport.unwrap_or((1200.0, 750.0, 50.0));
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
    let bytes = std::fs::read(&request.epub_path).expect("epub reads");
    let spread_count = request.spread_count.unwrap_or(6);

    let mut collect = |fragment: bool| -> (usize, Vec<ProbeSpread>) {
        let mut document = RuntimeDocument::open_with_pinned_font_policy(&bytes, policy.clone())
            .expect("document opens");
        document.set_fragment_page_table_enabled(fragment);
        let revision = document
            .create_revision(&layout_config)
            .expect("revision builds");
        if fragment {
            assert_eq!(
                document.revision_pagination_backend(&revision.revision_id),
                Some("fragment"),
                "rejection: {:?}",
                document.fragment_page_table_rejection_reason(&revision.revision_id),
            );
        }
        let mut spreads = Vec::new();
        for spread_index in 0..spread_count.min(revision.spread_count) {
            let frame = document
                .get_frame(&revision.revision_id, spread_index)
                .expect("frame builds");
            let mut lines = Vec::new();
            for command in &frame.commands {
                if command.get("kind").and_then(Value::as_str) != Some("paintText") {
                    continue;
                }
                let text = command
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let rect = command.get("rect").cloned().unwrap_or_default();
                let field = |name: &str| rect.get(name).and_then(Value::as_f64).unwrap_or(f64::NAN);
                lines.push(ProbeLine {
                    text: text.chars().take(16).collect(),
                    x: field("x"),
                    y: field("y"),
                    width: field("width"),
                    height: field("height"),
                });
            }
            spreads.push(ProbeSpread {
                spread_index,
                lines,
            });
        }
        (revision.page_count, spreads)
    };

    let (retained_pages, retained) = collect(false);
    let (fragment_pages, fragment) = collect(true);
    let report = ProbeReport {
        retained_pages,
        fragment_pages,
        retained,
        fragment,
    };
    println!(
        "{}",
        serde_json::to_string(&report).expect("report encodes")
    );
}
