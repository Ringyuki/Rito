//! Engine side of the geometry-differential conformance harness.
//!
//! Reads a JSON request on stdin: a cases EPUB (each chapter is one
//! generated conformance case with an `id` on every element), the pinned
//! serif font, and the flow width. Lays every chapter out continuously
//! (no fragmentation) and prints each id-carrying box's border-box
//! rectangle in flow coordinates. The reference side records the same
//! elements' `getBoundingClientRect` in Chromium at the same width; the
//! comparator joins by id.

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
    epub_path: String,
    serif_font_path: String,
    serif_language: Option<String>,
    /// Extra pinned faces AHEAD of the serif face, mirroring a production
    /// policy that pins a Latin face before the CJK serif.
    #[serde(default)]
    leading_pinned_faces: Vec<ProbePinnedFace>,
    content_width: f64,
    /// Host-measured `line-height: normal` metrics, recorded by the same
    /// browser that recorded the geometry truth.
    #[serde(default)]
    host_line_metrics: Vec<HostMetricEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbePinnedFace {
    path: String,
    language: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostMetricEntry {
    family: String,
    size: f64,
    #[serde(default)]
    sample: String,
    height: f64,
    baseline: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeChapter {
    idref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    boxes: Vec<rito_core::runtime::ChapterLayoutBox>,
    degradations: Vec<String>,
}

fn main() {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .expect("probe request reads");
    let request: ProbeRequest = serde_json::from_str(&input).expect("probe request parses");

    let serif_bytes = std::fs::read(&request.serif_font_path).expect("serif font reads");
    let mut faces = Vec::new();
    for face in &request.leading_pinned_faces {
        let bytes = std::fs::read(&face.path).expect("leading pinned face reads");
        faces.push(RuntimePinnedFontFaceInput {
            expected_sha256: format!("{:x}", Sha256::digest(&bytes)),
            bytes,
            generic_role: RuntimePinnedFontGenericRole::Serif,
            language: face.language.as_deref().map(|value| {
                RuntimePinnedFontLanguageTag::parse(value).expect("language tag parses")
            }),
        });
    }
    faces.push(RuntimePinnedFontFaceInput {
        expected_sha256: format!("{:x}", Sha256::digest(&serif_bytes)),
        bytes: serif_bytes,
        generic_role: RuntimePinnedFontGenericRole::Serif,
        language: request.serif_language.as_deref().map(|value| {
            RuntimePinnedFontLanguageTag::parse(value).expect("language tag parses")
        }),
    });
    let policy = RuntimePinnedFontPolicyInput { faces };

    let bytes = std::fs::read(&request.epub_path).expect("cases epub reads");
    let mut document = RuntimeDocument::open_with_pinned_font_policy(&bytes, policy)
        .expect("cases epub opens");
    document.set_fragment_page_table_enabled(true);
    let layout_config = create_layout_config(LayoutConfigInput {
        width: request.content_width + 100.0,
        height: 650.0,
        margin: MarginInput::All(50.0),
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
    // Inject before the revision: the metrics pend until the fragment
    // engine initializes, so the paginated pass itself lays out with them
    // — the same world a steady-state reader session paginates in.
    for entry in &request.host_line_metrics {
        document.set_host_line_metric(
            &entry.family,
            entry.size,
            &entry.sample,
            rito_inline::HostNormalLineMetric {
                height: entry.height,
                baseline: entry.baseline,
            },
        );
    }
    let revision = document
        .create_revision(&layout_config)
        .expect("revision builds");

    // Requests recorded while the revision paginated (before injection)
    // are stale; drain them so what remains names metrics the geometry
    // pass itself could not satisfy.
    let _ = document.take_host_line_metric_requests();

    let chapters: Vec<ProbeChapter> = document
        .publication_info()
        .chapters
        .into_iter()
        .map(|chapter| {
            match document.chapter_layout_geometry(
                &revision.revision_id,
                &chapter.idref,
                request.content_width,
            ) {
                Ok(geometry) => ProbeChapter {
                    idref: chapter.idref,
                    error: None,
                    boxes: geometry.boxes,
                    degradations: geometry.degradations,
                },
                Err(error) => ProbeChapter {
                    idref: chapter.idref,
                    error: Some(error.to_string()),
                    boxes: Vec::new(),
                    degradations: Vec::new(),
                },
            }
        })
        .collect();
    // Metric pairs layout needed but no injection covered: a non-empty
    // list means the geometry below was laid out with fallback metrics,
    // which invalidates any comparison against the host's own rendering.
    let unmet = document.take_host_line_metric_requests();
    if !unmet.is_empty() {
        eprintln!(
            "[conformance] unmet host line metrics: {}",
            serde_json::to_string(&unmet).unwrap_or_default()
        );
    }
    println!("{}", serde_json::to_string(&chapters).expect("report encodes"));
}
