//! Reproduces the reader's chapter-local preview path (position restore)
//! and dumps the target chapter's frame text for diagnosis.

use rito_core::layout::{
    create_layout_config, LayoutConfigInput, MarginInput, SpreadMode, TextMeasurementMode,
};
use rito_core::runtime::{
    RuntimeBoundedChapterLocalRevisionRequest, RuntimeDocument, RuntimePinnedFontFaceInput,
    RuntimePinnedFontGenericRole, RuntimePinnedFontPolicyInput, RuntimeRevisionWorkBudget,
    RuntimeSourceLocator,
};
use sha2::{Digest, Sha256};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let epub = std::fs::read(&args[1]).expect("epub reads");
    let fonts_dir = "apps/reader/src/assets/fonts";
    let face = |name: &str, language: Option<&str>| {
        let bytes = std::fs::read(format!("{fonts_dir}/{name}")).expect("font reads");
        RuntimePinnedFontFaceInput {
            expected_sha256: format!("{:x}", Sha256::digest(&bytes)),
            bytes,
            generic_role: RuntimePinnedFontGenericRole::Serif,
            language: language.map(|tag| {
                rito_core::runtime::RuntimePinnedFontLanguageTag::parse(tag).expect("tag")
            }),
        }
    };
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &epub,
        RuntimePinnedFontPolicyInput {
            faces: vec![
                face("Tinos-Regular.ttf", Some("und")),
                face("SourceHanSerifCN-Regular.otf", Some("zh-Hans")),
            ],
        },
    )
    .expect("document opens");
    let mut layout_config = create_layout_config(LayoutConfigInput {
        width: 823.5,
        height: 863.0,
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
    layout_config.viewport_width = 1667.0;
    let advance = document
        .create_bounded_chapter_local_revision(RuntimeBoundedChapterLocalRevisionRequest {
            layout_config,
            line_breaking: rito_core::layout::LineBreaking::Greedy,
            target_chapter_index: 10,
            target_locator: RuntimeSourceLocator {
                href: "Text/illu4-t.xhtml".to_owned(),
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: None,
            },
            local_page_cap: 16,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: std::env::args()
                    .nth(3)
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(64),
            },
            max_quanta: None,
        })
        .expect("chapter-local revision builds");
    eprintln!("target: {:?}", advance.target);
    eprintln!("extent: {:?}", advance.revision.known_extent);
    let handle = rito_core::runtime::RuntimeChapterLocalRevisionHandle {
        revision_id: advance.revision.revision_id.clone(),
        revision_version: advance.revision.revision_version,
        coordinate: advance.revision.coordinate.clone(),
    };
    for spread in 0..4 {
        match document.get_chapter_local_frame(&handle, spread) {
            Ok(frame) => {
                let texts: Vec<String> = frame
                    .commands
                    .iter()
                    .filter(|command| command["kind"] == "paintText")
                    .filter_map(|command| {
                        let text = command["text"].as_str()?;
                        let rect = &command["rect"];
                        Some(format!(
                            "x={:>4} y={:>4} '{}'",
                            rect["x"].as_f64().unwrap_or(-1.0).round(),
                            rect["y"].as_f64().unwrap_or(-1.0).round(),
                            text.chars().take(12).collect::<String>()
                        ))
                    })
                    .collect();
                println!("--- local spread {spread}: {} texts", texts.len());
                println!("{}", texts.join("\n"));
            }
            Err(error) => {
                println!("--- local spread {spread}: error {error:?}");
                break;
            }
        }
    }
}
