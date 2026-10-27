//! A chapter's strip read through its windows.

use super::fixture::{
    long_paragraphs_fixture_epub, paint_command_kitchen_sink_fixture_epub, pinned_test_font_policy,
};
use crate::layout::{
    create_layout_config, LayoutConfig, LayoutConfigInput, MarginInput, SpreadMode,
};
use crate::runtime::page_artifact::FragmentPageArtifact;
use crate::runtime::scroll_strip::ChapterStrip;
use crate::runtime::source_locator::PaginationTarget;
use crate::runtime::RuntimeDocument;

/// A short window, so every chapter takes several and their boundaries
/// cross tables, images and ruby.
fn short_windows() -> LayoutConfig {
    create_layout_config(LayoutConfigInput {
        width: 420.0,
        height: 240.0,
        margin: MarginInput::All(24.0),
        spread: SpreadMode::Single,
        first_page_alone: false,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        device_pixel_ratio: 1.0,
    })
}

fn strip_of(bytes: &[u8]) -> ChapterStrip {
    let mut document =
        RuntimeDocument::open_with_pinned_font_policy(bytes, pinned_test_font_policy())
            .expect("fixture opens");
    let build = document
        .build_chapter_local_fragment_layout(&short_windows(), 0, &PaginationTarget::Start)
        .expect("chapter builds");
    build.layout.chapter_strip(0).expect("strip lays out")
}

/// The text of each run an artifact records, in order.
fn run_texts(artifact: &FragmentPageArtifact) -> Vec<String> {
    let text: Vec<u16> = artifact.page_text().encode_utf16().collect();
    artifact
        .interaction_runs()
        .iter()
        .map(|run| String::from_utf16_lossy(&text[run.start..run.end]))
        .collect()
}

#[test]
fn a_chapters_windows_record_each_of_its_runs_once_in_order() {
    for bytes in [
        long_paragraphs_fixture_epub(),
        paint_command_kitchen_sink_fixture_epub(),
    ] {
        let strip = strip_of(&bytes);
        let windows = strip.windows();
        assert!(windows.count() > 1, "the chapter takes several windows");
        let recorded: Vec<String> = (0..windows.count())
            .flat_map(|window| run_texts(&strip.window_artifact(window)))
            .collect();
        assert_eq!(recorded, run_texts(&strip.whole_artifact()));
    }
}

#[test]
fn a_window_records_its_runs_from_its_own_top() {
    let strip = strip_of(&long_paragraphs_fixture_epub());
    let windows = strip.windows();
    for window in 0..windows.count() {
        let artifact = strip.window_artifact(window);
        let runs = artifact.interaction_runs();
        assert!(!runs.is_empty(), "window {window} records text");
        for run in runs {
            assert!(
                (0.0..windows.length()).contains(&run.y),
                "window {window}: a run at {} starts outside the window",
                run.y
            );
        }
    }
}

/// The scroll-seam instrument's lowering step (`tools/paint-parity/seams.mjs`):
/// neighbouring windows of a synthetic and a real chapter lowered one by
/// one and as one run, at every ratio, for the pens to raster and the
/// instrument to stack. The runs' pinned faces are named as the pens
/// register them and every image draws the pens' synthetic bitmap, so the
/// rasters hold real glyphs and real image boxes. Skips itself unless
/// `RITO_SCROLL_SEAMS_OUT` names the output.
#[test]
fn lower_scroll_seam_fixtures() {
    use std::{env, fs, path::Path, sync::Arc};

    use serde_json::json;
    use sha2::{Digest, Sha256};

    use super::pinned_font_policy_fixtures::{face, policy};
    use crate::render::{encode_reader_primitive_list, Primitive, PrimitiveList};
    use crate::runtime::RuntimePinnedFontGenericRole::Serif;

    let Some(out) = env::var_os("RITO_SCROLL_SEAMS_OUT") else {
        eprintln!("RITO_SCROLL_SEAMS_OUT not set; seam lowering skipped.");
        return;
    };
    let lowered_dir = Path::new(&out).join("lowered");
    fs::create_dir_all(&lowered_dir).expect("create the lowered directory");
    let workspace = |relative: &str| format!("{}/../../{relative}", env!("CARGO_MANIFEST_DIR"));
    let read = |relative: &str| fs::read(workspace(relative)).expect("workspace file reads");
    let tinos = read("apps/reader/src/assets/fonts/Tinos-Regular.ttf");
    let han = read("apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf");
    let alias =
        |bytes: &[u8]| -> Arc<str> { format!("__RitoPinned_{:x}", Sha256::digest(bytes)).into() };
    let families: Vec<(Arc<str>, Arc<str>)> = vec![
        (alias(&tinos), "Tinos".into()),
        (alias(&han), "Source Han Serif CN".into()),
    ];
    let normalize = |list: &mut PrimitiveList| {
        for primitive in &mut list.commands {
            match primitive {
                Primitive::Text(run) | Primitive::Ruby(run) => {
                    if let Some((_, family)) = families
                        .iter()
                        .find(|(alias, _)| *alias == run.paint.font.family)
                    {
                        run.paint.font.family = Arc::clone(family);
                    }
                }
                Primitive::DrawImage { src, .. } | Primitive::ImageFallback { src, .. } => {
                    *src = "synthetic:gradient32".to_owned();
                }
                _ => {}
            }
        }
    };
    let both_faces = policy(vec![
        face(tinos.clone(), Serif, Some("und")),
        face(han.clone(), Serif, Some("zh-Hans")),
    ]);
    // Each case with the fewest windows a chapter must take to be lowered.
    let cases = [
        (
            "paragraphs",
            long_paragraphs_fixture_epub(),
            pinned_test_font_policy(),
            2,
        ),
        (
            "styled",
            paint_command_kitchen_sink_fixture_epub(),
            pinned_test_font_policy(),
            2,
        ),
        (
            "book01",
            read("packages/rito/tests/fixtures/books/book-01.epub"),
            both_faces,
            4,
        ),
    ];
    for (case, bytes, faces, fewest) in cases {
        let mut document =
            RuntimeDocument::open_with_pinned_font_policy(&bytes, faces).expect("case opens");
        let mut taken = 0;
        for chapter in 0..document.document.package.spine.len() {
            if taken == 2 {
                break;
            }
            let Ok(build) = document.build_chapter_local_fragment_layout(
                &seam_windows(),
                chapter,
                &PaginationTarget::Start,
            ) else {
                continue;
            };
            let Ok(strip) = build.layout.chapter_strip(0) else {
                continue;
            };
            let windows = strip.windows();
            if windows.count() < fewest {
                continue;
            }
            taken += 1;
            let pairs = windows.count() - 1;
            let mut firsts: Vec<usize> = (0..4).map(|step| step * pairs / 4).collect();
            firsts.dedup();
            for ratio in [1.0, 1.25, 1.5, 2.0, 2.625, 3.0] {
                for &first in &firsts {
                    for (part, run) in [
                        ("a", first..first + 1),
                        ("b", first + 1..first + 2),
                        ("ab", first..first + 2),
                    ] {
                        let rows = windows.device_rows(run.start, ratio).start
                            ..windows.device_rows(run.end - 1, ratio).end;
                        let mut lowered = strip
                            .lowered_window(run, ratio, &|href| document.image_size(href))
                            .expect("window lowers");
                        normalize(&mut lowered);
                        let name = format!("seam-{case}-c{chapter}-r{ratio}-w{first}-{part}");
                        let encoded =
                            encode_reader_primitive_list(&lowered).expect("window encodes");
                        fs::write(lowered_dir.join(format!("{name}.ritodl")), &encoded.bytes)
                            .expect("write the lowered list");
                        let meta = json!({
                            "name": name,
                            "width": seam_windows().page_width,
                            "height": (rows.end - rows.start) / ratio,
                            "ratio": ratio,
                            "primitiveCount": lowered.commands.len(),
                        });
                        fs::write(
                            lowered_dir.join(format!("{name}.json")),
                            serde_json::to_string_pretty(&meta).expect("metadata is JSON"),
                        )
                        .expect("write the lowered metadata");
                    }
                }
            }
            eprintln!(
                "lowered {case} chapter {chapter}: {} windows",
                windows.count()
            );
        }
        assert!(
            taken > 0,
            "{case} has a chapter of {fewest} windows or more"
        );
    }
}

/// The seam instrument's window: a phone-wide page, short enough that a
/// chapter takes several.
fn seam_windows() -> LayoutConfig {
    create_layout_config(LayoutConfigInput {
        width: 390.0,
        height: 300.0,
        margin: MarginInput::Axis { x: 20.0, y: 24.0 },
        spread: SpreadMode::Single,
        first_page_alone: false,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        device_pixel_ratio: 1.0,
    })
}
