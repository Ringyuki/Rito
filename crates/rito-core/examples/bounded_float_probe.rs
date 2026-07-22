//! Reproduces the bounded-continuation float regression: growing a
//! revision quantum by quantum must produce the same pages as one big
//! quantum, and float columns must never carry negative coordinates.

use rito_core::layout::{
    create_layout_config, LayoutConfigInput, LineBreaking, MarginInput, SpreadMode,
    TextMeasurementMode,
};
use rito_core::runtime::{
    RuntimeBoundedRevisionRequest, RuntimeContinueRevisionRequest, RuntimeDocument,
    RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole, RuntimePinnedFontLanguageTag,
    RuntimePinnedFontPolicyInput, RuntimeRevisionWorkBudget,
};
use sha2::{Digest, Sha256};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let epub = std::fs::read(&args[1]).expect("epub reads");
    let fonts_dir = "apps/reader/src/assets/fonts";
    let face = |name: &str, language: &str| {
        let bytes = std::fs::read(format!("{fonts_dir}/{name}")).expect("font reads");
        RuntimePinnedFontFaceInput {
            expected_sha256: format!("{:x}", Sha256::digest(&bytes)),
            bytes,
            generic_role: RuntimePinnedFontGenericRole::Serif,
            language: Some(RuntimePinnedFontLanguageTag::parse(language).expect("tag")),
        }
    };
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &epub,
        RuntimePinnedFontPolicyInput {
            faces: vec![
                face("Tinos-Regular.ttf", "und"),
                face("SourceHanSerifCN-Regular.otf", "zh-Hans"),
            ],
        },
    )
    .expect("document opens");
    let mut layout_config = create_layout_config(LayoutConfigInput {
        width: 1218.0,
        height: 619.0,
        margin: MarginInput::All(50.0),
        spread: SpreadMode::Double,
        first_page_alone: true,
        spread_gap: 20.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        pagination_policy: None,
        text_measurement: Some(TextMeasurementMode::FontAware),
    });
    layout_config.page_width = 599.0;
    let mut advance = document
        .create_bounded_revision(RuntimeBoundedRevisionRequest {
            layout_config,
            line_breaking: LineBreaking::Greedy,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .expect("bounded revision starts");
    let mut guard = 0;
    while let Some(cursor) = advance.continuation.clone() {
        guard += 1;
        assert!(guard < 5000, "runaway continuation");
        advance = document
            .continue_revision(RuntimeContinueRevisionRequest {
                revision_id: advance.revision.revision_id.clone(),
                revision_version: advance.revision.revision_version,
                cursor: cursor.cursor,
                budget: RuntimeRevisionWorkBudget {
                    max_top_level_nodes: 32,
                },
            })
            .expect("revision continues");
    }
    let revision_id = advance.revision.revision_id.clone();
    let spread_count = advance.revision.known_extent.spread_count;
    for spread in 0..spread_count {
        let frame = document
            .get_frame(&revision_id, spread)
            .expect("frame builds");
        let mut negatives = Vec::new();
        let mut has_spear = false;
        for command in &frame.commands {
            if command["kind"] == "paintText" {
                let text = command["text"].as_str().unwrap_or("");
                if text.contains("S P E A R") {
                    has_spear = true;
                }
                let y = command["rect"]["y"].as_f64().unwrap_or(0.0);
                if y < -1.0 {
                    negatives.push(format!(
                        "y={y:.1} '{}'",
                        text.chars().take(10).collect::<String>()
                    ));
                }
            }
        }
        if has_spear || !negatives.is_empty() {
            println!("spread {spread}: negatives={}", negatives.len());
            for line in negatives.iter().take(4) {
                println!("  {line}");
            }
        }
    }
}
