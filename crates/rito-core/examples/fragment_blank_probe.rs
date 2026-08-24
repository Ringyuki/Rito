//! Reproduces the browser reader's fragment pagination natively for one
//! EPUB and reports, per spread, what the frame actually contains — the
//! oracle for "the page renders blank in the demo" reports.
//!
//! Usage: fragment-blank-probe <epub-path> [max-spreads]

use rito_core::layout::{
    create_layout_config, LayoutConfigInput, MarginInput, SpreadMode, TextMeasurementMode,
};
use rito_core::runtime::{
    RuntimeDocument, RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole,
    RuntimePinnedFontLanguageTag, RuntimePinnedFontPolicyInput,
};

const TINOS: &str = "apps/reader/src/assets/fonts/Tinos-Regular.ttf";
const TINOS_SHA: &str = "60a0e8ef0c04dd5dd69ffe91025fa2ae5836cbd35600a82ba031977557e2cb61";
const SOURCE_HAN: &str = "apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf";
const SOURCE_HAN_SHA: &str = "3754ea669c530e2473354f8f6d9f79680a44d7e26ec7d00eeabee4a7e0753c5d";

fn main() {
    let epub = std::env::args()
        .nth(1)
        .expect("usage: <epub> [max-spreads]");
    let max_spreads: usize = std::env::args()
        .nth(2)
        .map(|value| value.parse().expect("max-spreads parses"))
        .unwrap_or(usize::MAX);
    let root = std::env::var("RITO_ROOT").unwrap_or_else(|_| ".".to_owned());
    let bytes = std::fs::read(&epub).expect("epub reads");
    let no_pinned = std::env::var_os("RITO_NO_PINNED").is_some();
    let policy = RuntimePinnedFontPolicyInput {
        faces: if no_pinned {
            Vec::new()
        } else {
            vec![
                RuntimePinnedFontFaceInput {
                    bytes: std::fs::read(format!("{root}/{TINOS}")).expect("tinos reads"),
                    expected_sha256: TINOS_SHA.to_owned(),
                    generic_role: RuntimePinnedFontGenericRole::Serif,
                    language: None,
                },
                RuntimePinnedFontFaceInput {
                    bytes: std::fs::read(format!("{root}/{SOURCE_HAN}")).expect("source han reads"),
                    expected_sha256: SOURCE_HAN_SHA.to_owned(),
                    generic_role: RuntimePinnedFontGenericRole::Serif,
                    language: Some(RuntimePinnedFontLanguageTag::parse("zh-hans").unwrap()),
                },
            ]
        },
    };
    let mut document =
        RuntimeDocument::open_owned_with_pinned_font_policy(bytes, policy).expect("document opens");
    document.set_fragment_page_table_enabled(true);
    let layout_config = create_layout_config(LayoutConfigInput {
        width: 600.0,
        height: 750.0,
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
    let summary = document
        .create_revision(&layout_config)
        .expect("revision builds");
    println!(
        "revision {} backend {:?} spreads {} pages {}",
        summary.revision_id, summary.pagination_backend, summary.spread_count, summary.page_count
    );
    let mut blank = 0usize;
    for spread in 0..summary.spread_count.min(max_spreads) {
        let frame = document
            .get_frame(&summary.revision_id, spread)
            .expect("frame builds");
        let text = frame.command_counts.get("paintText").copied().unwrap_or(0);
        let image = frame.command_counts.get("paintImage").copied().unwrap_or(0);
        if text == 0 && image == 0 {
            blank += 1;
        }
        println!(
            "spread {spread}: pages {:?} text {text} image {image} counts {:?}",
            frame.page_indexes, frame.command_counts
        );
    }
    println!("blank {blank}/{}", summary.spread_count.min(max_spreads));
}
