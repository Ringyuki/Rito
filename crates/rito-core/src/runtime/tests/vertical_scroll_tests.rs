//! A scrolled book whose pages progress right to left: its vertical-rl
//! chapters run leftwards as strips, column after column, and a chapter
//! that runs across that axis is paginated, each page one window.

use super::fixture::{layout, vertical_book_fixture_epub};
use super::pinned_font_policy_fixtures::{bundled_font, face, policy};
use crate::fragment_window::ScrollAxis;
use crate::layout::{LayoutConfig, SpreadMode};
use crate::render::{encode_reader_primitive_list, Primitive, PrimitiveList};
use crate::runtime::page_artifact::FragmentPageArtifact;
use crate::runtime::{RuntimeDocument, RuntimePinnedFontGenericRole};

const RATIOS: [f64; 4] = [1.0, 1.5, 2.625, 3.0];

fn scrolled() -> LayoutConfig {
    let mut layout = layout();
    layout.spread_mode = SpreadMode::Scrolled;
    layout
}

fn document() -> RuntimeDocument {
    RuntimeDocument::open_with_pinned_font_policy(
        &vertical_book_fixture_epub(),
        policy(vec![face(
            bundled_font("SourceHanSerifCN-Regular.otf"),
            RuntimePinnedFontGenericRole::Serif,
            Some("zh"),
        )]),
    )
    .expect("vertical book opens")
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
fn a_right_to_left_book_scrolls_its_vertical_chapter_leftwards_and_pages_its_plate() {
    let mut document = document();
    let summary = document
        .create_revision(&scrolled())
        .expect("scrolled revision is created");
    let layout = &document.revisions[&summary.revision_id].fragment_layout;
    let chapters: Vec<_> = layout.chapters().map(|(chapter, _)| chapter).collect();
    // The horizontal plate runs across the book's axis: paginated, one
    // window a page, as long as a page is wide.
    let config = scrolled();
    assert_eq!(chapters[0].extent, None);
    assert_eq!(
        layout.chapter_extent(&chapters[0].idref),
        Some(chapters[0].page_count as f64 * config.page_width)
    );
    // The vertical chapter is one strip whose windows run leftwards.
    let strip = layout.chapter_strip(1).expect("vertical strip lays out");
    let windows = strip.windows();
    assert_eq!(windows.axis(), ScrollAxis::Left);
    assert!(windows.count() > 2, "the columns take several windows");
    assert_eq!(chapters[1].page_count, windows.count());
    assert_eq!(chapters[1].extent, Some(windows.extent()));
    assert_eq!(windows.length(), config.page_width);
}

#[test]
fn a_leftward_chapters_windows_record_each_run_once_in_order() {
    let mut document = document();
    let summary = document
        .create_revision(&scrolled())
        .expect("scrolled revision is created");
    let layout = &document.revisions[&summary.revision_id].fragment_layout;
    let strip = layout.chapter_strip(1).expect("vertical strip lays out");
    let recorded: Vec<String> = (0..strip.windows().count())
        .flat_map(|window| run_texts(&strip.window_artifact(window)))
        .collect();
    assert_eq!(recorded, run_texts(&strip.whole_artifact()));
}

/// A leftward window paints in its chapter's coordinates exactly what the
/// pair of it and the window right of it paints there, so moving each onto
/// its own origin by whole device columns tiles the chapter.
#[test]
fn a_leftward_window_draws_its_content_as_the_pair_with_the_window_right_of_it() {
    let mut document = document();
    let summary = document
        .create_revision(&scrolled())
        .expect("scrolled revision is created");
    let layout = &document.revisions[&summary.revision_id].fragment_layout;
    let strip = layout.chapter_strip(1).expect("vertical strip lays out");
    let images = |href: &str| document.image_size(href);
    for ratio in RATIOS {
        let encoded = |primitive: &Primitive| {
            encode_reader_primitive_list(&PrimitiveList {
                ratio,
                commands: vec![primitive.clone()],
            })
            .expect("primitive encodes")
            .bytes
        };
        for first in 0..strip.windows().count() - 1 {
            let left = strip
                .lowered_content(first + 1..first + 2, ratio, &images)
                .expect("window lowers");
            assert!(!left.commands.is_empty(), "window {} paints", first + 1);
            let pair = strip
                .lowered_content(first..first + 2, ratio, &images)
                .expect("pair lowers");
            let pair: Vec<Vec<u8>> = pair.commands.iter().map(encoded).collect();
            let mut drawn = pair.iter();
            for primitive in &left.commands {
                let bytes = encoded(primitive);
                assert!(
                    drawn.any(|by_pair| *by_pair == bytes),
                    "ratio {ratio} window {}: {primitive:?} is not drawn by the pair",
                    first + 1
                );
            }
        }
    }
}

#[test]
fn a_leftward_spread_is_its_window_framed_by_the_strip_and_a_plate_is_a_page() {
    let mut document = document();
    let summary = document
        .create_revision(&scrolled())
        .expect("scrolled revision is created");
    let revision = &document.revisions[&summary.revision_id];
    let layout = &revision.fragment_layout;
    let session = revision.chapter_engine_session();
    let (_, start) = layout.chapters().nth(1).expect("the vertical chapter");
    let strip = layout.chapter_strip(1).expect("vertical strip lays out");
    for ratio in RATIOS {
        let plate = session
            .frame(0, ratio)
            .expect("plate frames")
            .expect("plate is published");
        assert_eq!(plate.device_origin, (0.0, 0.0));
        for window in 0..strip.windows().count() {
            let frame = session
                .frame(start + window, ratio)
                .expect("window frames")
                .expect("window is published");
            assert_eq!(
                frame.device_origin,
                strip.windows().device_origin(window, ratio)
            );
            let (commands, origin) = strip
                .window_frame(strip.whole(), window..window + 1, ratio)
                .expect("window paints");
            assert_eq!(origin, frame.device_origin);
            assert_eq!(
                frame.commands.to_vec(),
                commands,
                "window {window} at {ratio}"
            );
        }
    }
}
