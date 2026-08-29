//! Dumps one chapter's frame text geometry from BOTH the chapter-local
//! reader path and the whole-book fragment table, at the same layout
//! config, so their vertical rhythm can be diffed on a real book.
//! Usage:
//!   cargo run -p rito-core --example chapter-local-geometry-probe -- \
//!     <book.epub> <chapter-index> <href>

use rito_core::layout::{
    create_layout_config, LayoutConfigInput, MarginInput, SpreadMode, TextMeasurementMode,
};
use rito_core::runtime::{
    RuntimeBoundedChapterLocalRevisionRequest, RuntimeDocument, RuntimePinnedFontFaceInput,
    RuntimePinnedFontGenericRole, RuntimePinnedFontPolicyInput, RuntimeRevisionWorkBudget,
    RuntimeSourceLocator,
};
use sha2::{Digest, Sha256};

fn policy() -> RuntimePinnedFontPolicyInput {
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
    RuntimePinnedFontPolicyInput {
        faces: vec![
            face("Tinos-Regular.ttf", Some("und")),
            face("SourceHanSerifCN-Regular.otf", Some("zh-Hans")),
        ],
    }
}

fn config() -> rito_core::layout::LayoutConfig {
    create_layout_config(LayoutConfigInput {
        width: 631.0,
        height: 1280.0,
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
    })
}

fn print_texts(label: &str, commands: &[serde_json::Value]) {
    let texts: Vec<String> = commands
        .iter()
        .filter(|command| command["kind"] == "paintText")
        .filter_map(|command| {
            let text = command["text"].as_str()?;
            let rect = &command["rect"];
            Some(format!(
                "  y={:>7.2} x={:>7.2} '{}'",
                rect["y"].as_f64().unwrap_or(-1.0),
                rect["x"].as_f64().unwrap_or(-1.0),
                text.chars().take(14).collect::<String>()
            ))
        })
        .take(20)
        .collect();
    println!("{label}: {} texts", texts.len());
    println!("{}", texts.join("\n"));
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let epub = std::fs::read(&args[1]).expect("epub reads");
    let chapter_index: usize = args[2].parse().expect("chapter index");
    let href = args[3].clone();

    // Chapter-local reader path.
    let mut document =
        RuntimeDocument::open_with_pinned_font_policy(&epub, policy()).expect("document opens");
    let advance = document
        .create_bounded_chapter_local_revision(RuntimeBoundedChapterLocalRevisionRequest {
            layout_config: config(),
            line_breaking: rito_core::layout::LineBreaking::Greedy,
            target_chapter_index: chapter_index,
            target_locator: RuntimeSourceLocator {
                href: href.clone(),
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: None,
            },
            local_page_cap: 16,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 64,
            },
            max_quanta: None,
        })
        .expect("chapter-local revision builds");
    let handle = rito_core::runtime::RuntimeChapterLocalRevisionHandle {
        revision_id: advance.revision.revision_id.clone(),
        revision_version: advance.revision.revision_version,
        coordinate: advance.revision.coordinate.clone(),
    };
    let frame = document
        .get_chapter_local_frame(&handle, 0)
        .expect("chapter-local frame");
    print_texts("== chapter-local spread 0 ==", &frame.commands);

    // Whole-book fragment table at the same config.
    let mut reference =
        RuntimeDocument::open_with_pinned_font_policy(&epub, policy()).expect("reference opens");
    reference.set_fragment_page_table_enabled(true);
    let revision = reference
        .create_revision(&config())
        .expect("whole-book layout");
    let resolution = reference
        .resolve_source_locator(
            &revision.revision_id,
            RuntimeSourceLocator {
                href,
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: None,
            },
        )
        .expect("chapter resolves");
    let rito_core::runtime::RuntimeSourceLocatorResolution::Resolved { spread_index, .. } =
        resolution
    else {
        panic!("chapter did not resolve: {resolution:?}");
    };
    let frame = reference
        .get_frame(&revision.revision_id, spread_index)
        .expect("whole-book frame");
    print_texts("== whole-book chapter first spread ==", &frame.commands);

    // Chapter-local build on the SAME document the whole book already
    // laid out through: bit-identical trees diverging here would pin the
    // divergence on engine state accumulated across chapters.
    let advance = reference
        .create_bounded_chapter_local_revision(RuntimeBoundedChapterLocalRevisionRequest {
            layout_config: config(),
            line_breaking: rito_core::layout::LineBreaking::Greedy,
            target_chapter_index: chapter_index,
            target_locator: RuntimeSourceLocator {
                href: args[3].clone(),
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: None,
            },
            local_page_cap: 16,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 64,
            },
            max_quanta: None,
        })
        .expect("chapter-local on warmed document builds");
    let handle = rito_core::runtime::RuntimeChapterLocalRevisionHandle {
        revision_id: advance.revision.revision_id.clone(),
        revision_version: advance.revision.revision_version,
        coordinate: advance.revision.coordinate.clone(),
    };
    let frame = reference
        .get_chapter_local_frame(&handle, 0)
        .expect("warmed chapter-local frame");
    print_texts("== chapter-local on warmed document ==", &frame.commands);
}
