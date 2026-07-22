//! Reproduces the demo's reader-v1 session path over a local EPUB and
//! dumps the target chapter's page text, to compare the session pipeline
//! against the frame pipeline.

use rito_core::runtime::{
    ReaderArtifactRequestV1, ReaderLayoutV1, ReaderLocatorV1, ReaderSessionV1, ReaderSpreadModeV1,
    ReaderTextRenderingProfileV1, ReaderWorkBudgetV1,
};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&args[1]).expect("epub reads");
    let href = args.get(2).cloned().unwrap_or_else(|| "Text/illu4-t.xhtml".to_owned());
    let mut session = ReaderSessionV1::open_owned(1, bytes).expect("session opens");
    let artifact = session
        .request_artifact(ReaderArtifactRequestV1 {
            session_id: 1,
            request_id: 1,
            layout: ReaderLayoutV1 {
                viewport_width: 833.0,
                viewport_height: 429.0,
                margin_top: 32.0,
                margin_right: 32.0,
                margin_bottom: 32.0,
                margin_left: 32.0,
                spread_mode: ReaderSpreadModeV1::Double,
                first_page_alone: true,
                spread_gap: 0.0,
                root_font_size: 16.0,
                line_height_override: None,
                font_family_override: None,
            },
            locator: ReaderLocatorV1 {
                href,
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: None,
            },
            work: ReaderWorkBudgetV1 {
                max_top_level_nodes_per_quantum: 32,
                max_foreground_quanta: 256,
                local_page_cap: 16,
            },
            text_profile: ReaderTextRenderingProfileV1::PlatformStringRuns,
        })
        .expect("artifact resolves");
    for (index, page) in artifact.pages.iter().enumerate() {
        println!("--- page {index} ---");
        println!("{}", page.text);
    }
}
