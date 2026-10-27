//! A vertical-rl page's records leave the session where its columns are
//! drawn: its hits, carets and selection rects in the artifact's
//! display-list space, the same space its pixels are in, paged or scrolled.
//! A scrolled window's records also move with its pixels by the device rows
//! it is drawn from, at any ratio.

use crate::render::{DisplayCommand, DisplayTextCommand};
use crate::runtime::tests::fixture::{long_paragraphs_fixture_epub, vertical_book_fixture_epub};
use crate::runtime::tests::pinned_font_policy_fixtures::{bundled_font, face, policy};
use crate::runtime::RuntimePinnedFontGenericRole;

use super::{tests::request, *};

const SESSION: u64 = 733;

fn open(publication: Vec<u8>) -> ReaderSession {
    ReaderSession::open_owned_with_pinned_font_policy(
        SESSION,
        publication,
        policy(vec![face(
            bundled_font("SourceHanSerifCN-Regular.otf"),
            RuntimePinnedFontGenericRole::Serif,
            Some("zh"),
        )]),
    )
    .expect("reader session opens")
}

fn at(href: &str, request_id: u64, mode: ReaderSpreadMode, ratio: f64) -> ReaderArtifactRequest {
    let mut request = request(SESSION, request_id, href);
    request.layout.spread_mode = mode;
    request.layout.render_ratio = ratio;
    request
}

/// The columns chapter's artifact at `ratio`, shown first, and its spread
/// `spread` peeked from it.
fn columns(mode: ReaderSpreadMode, ratio: f64, spread: u32) -> (ReaderSession, ReaderArtifact) {
    let mut session = open(vertical_book_fixture_epub());
    let href = session.publication().spine[1].href.clone();
    let first = session
        .request_artifact(at(&href, 1, mode, ratio))
        .expect("columns artifact");
    super::tests::adopt_initial(&mut session, SESSION, first.artifact_id);
    let artifact = session
        .peek_spread(ReaderSpreadRequest {
            session_id: SESSION,
            request_id: 2,
            from_artifact_id: first.artifact_id,
            spread_index: first.local_spread_index + spread,
        })
        .expect("spread publishes");
    (session, artifact)
}

/// Every run of text the artifact shows whole, in its display-list space,
/// clear of its block-start edge: a window also paints what comes near it,
/// which its clip cuts away, and a line across that edge is recorded by the
/// window it starts in.
fn painted_runs(session: &ReaderSession, artifact: &ReaderArtifact) -> Vec<DisplayTextCommand> {
    let (commands, (x, y)) = session
        .artifact_paint(artifact.artifact_id)
        .expect("artifact paints");
    let ratio = session.render_ratio();
    let page = &artifact.pages[0];
    commands
        .into_iter()
        .filter_map(|command| match command {
            DisplayCommand::PaintText(mut text) if !text.text.trim().is_empty() => {
                text.rect.x -= x / ratio;
                text.rect.y -= y / ratio;
                let clear = 8.0;
                let inside = text.rect.x >= 0.0
                    && text.rect.y >= 0.0
                    && text.rect.x + text.rect.width <= page.width
                    && text.rect.y + text.rect.height <= page.height;
                let off_the_edge =
                    text.rect.y >= clear && text.rect.x + text.rect.width <= page.width - clear;
                (inside && off_the_edge).then_some(text)
            }
            _ => None,
        })
        .collect()
}

fn records(session: &ReaderSession, artifact: &ReaderArtifact) -> ReaderPageRecords {
    session
        .read_page(artifact.artifact_id, artifact.pages[0].page_index)
        .expect("page records")
}

fn contains(rect: &ReaderRect, x: f64, y: f64) -> bool {
    (rect.x..=rect.x + rect.width).contains(&x) && (rect.y..=rect.y + rect.height).contains(&y)
}

/// Each painted run sits inside a text hit holding its text, and every hit
/// of more than one character is a column, taller than wide.
fn assert_hits_cover_the_columns(session: &ReaderSession, artifact: &ReaderArtifact) {
    let painted = painted_runs(session, artifact);
    assert!(!painted.is_empty(), "the page paints text");
    let hits: Vec<_> = records(session, artifact)
        .hits
        .into_iter()
        .filter(|hit| hit.kind == ReaderHitKind::Text)
        .collect();
    for run in &painted {
        let (x, y) = (
            run.rect.x + run.rect.width / 2.0,
            run.rect.y + run.rect.height / 2.0,
        );
        assert!(
            hits.iter()
                .any(|hit| contains(&hit.bounds, x, y) && hit.text.contains(&*run.text)),
            "{:?} at {:?} has no hit over it at ratio {}: {:?}",
            run.text,
            run.rect,
            session.render_ratio(),
            hits.iter().map(|hit| hit.bounds).collect::<Vec<_>>()
        );
    }
    for hit in hits.iter().filter(|hit| hit.text.chars().count() > 1) {
        assert!(
            hit.bounds.height > hit.bounds.width,
            "{:?} is a column: {:?}",
            hit.text,
            hit.bounds
        );
    }
}

fn interact(
    session: &mut ReaderSession,
    artifact: &ReaderArtifact,
    query: ReaderTextInteractionQuery,
) -> ReaderTextInteractionResult {
    session
        .resolve_text_interaction(ReaderTextInteractionRequest {
            session_id: SESSION,
            artifact_id: artifact.artifact_id,
            query,
            every_page: false,
        })
        .expect("interaction resolves")
        .result
}

/// A point in the top quarter of a painted glyph's em box takes the caret
/// before that glyph: a segment across its column at the glyph's top, on a
/// vertical line.
fn assert_a_caret_runs_across_its_column(session: &mut ReaderSession, artifact: &ReaderArtifact) {
    let painted = painted_runs(session, artifact);
    let run = &painted[painted.len() / 2];
    let em = run.rect.width;
    let (x, y) = (run.rect.x + em / 2.0, run.rect.y + em / 4.0);
    let point = ReaderTextPoint {
        page_index: artifact.pages[0].page_index,
        x,
        y,
    };
    let ReaderTextInteractionResult::Caret(caret) = interact(
        session,
        artifact,
        ReaderTextInteractionQuery::Caret { point },
    ) else {
        panic!("a caret at {x}, {y}");
    };
    assert_eq!(caret.writing_mode, ReaderWritingMode::VerticalRl);
    let geometry = caret.geometry.expect("the artifact draws the caret");
    assert_eq!(geometry.height, 0.0, "{geometry:?} runs across the column");
    assert!(
        geometry.x <= x && x <= geometry.x + geometry.width,
        "{geometry:?} spans the column at {x}"
    );
    assert!(
        (geometry.y - run.rect.y).abs() < 0.01,
        "{geometry:?} sits at the glyph's top {}",
        run.rect.y
    );
}

/// A selection dragged from one column's head to a glyph three columns on
/// covers each glyph between with column-shaped rects.
fn assert_a_selection_is_drawn_as_columns(session: &mut ReaderSession, artifact: &ReaderArtifact) {
    let painted = painted_runs(session, artifact);
    let page_index = artifact.pages[0].page_index;
    let first = &painted[0];
    let em = first.rect.width;
    let mut columns: Vec<f64> = painted.iter().map(|run| run.rect.x).collect();
    columns.sort_by(|a, b| b.total_cmp(a));
    columns.dedup();
    let last_x = columns[3.min(columns.len() - 1)];
    let point = |x: f64, y: f64| ReaderTextPoint { page_index, x, y };
    let anchor = match interact(
        session,
        artifact,
        ReaderTextInteractionQuery::Caret {
            point: point(first.rect.x + em / 2.0, first.rect.y + em / 4.0),
        },
    ) {
        ReaderTextInteractionResult::Caret(caret) => caret.address,
        other => panic!("an anchor caret: {other:?}"),
    };
    let result = interact(
        session,
        artifact,
        ReaderTextInteractionQuery::RangeToPoint {
            anchor,
            focus: point(last_x + em / 2.0, first.rect.y + em * 2.75),
        },
    );
    let ReaderTextInteractionResult::Selection(selection) = result else {
        panic!("a selection");
    };
    let rects = &selection.selection.rects;
    assert!(rects.len() >= 3, "the selection spans columns: {rects:?}");
    for rect in rects
        .iter()
        .filter(|rect| rect.end_char_index - rect.start_char_index > 1)
    {
        assert!(
            rect.bounds.height > rect.bounds.width,
            "{:?} is a column",
            rect.bounds
        );
    }
    let covered = |x: f64, y: f64| rects.iter().any(|rect| contains(&rect.bounds, x, y));
    assert!(covered(first.rect.x + em / 2.0, first.rect.y + em / 2.0));
}

#[test]
fn a_vertical_pages_records_lie_on_the_columns_it_paints() {
    let (mut session, artifact) = columns(ReaderSpreadMode::Single, 1.0, 0);
    assert_hits_cover_the_columns(&session, &artifact);
    assert_a_caret_runs_across_its_column(&mut session, &artifact);
    assert_a_selection_is_drawn_as_columns(&mut session, &artifact);
}

#[test]
fn a_leftward_windows_records_lie_on_the_columns_it_paints_at_any_ratio() {
    for ratio in [1.0, 1.5, 2.625] {
        let (mut session, artifact) = columns(ReaderSpreadMode::Scrolled, ratio, 1);
        assert_hits_cover_the_columns(&session, &artifact);
        assert_a_caret_runs_across_its_column(&mut session, &artifact);
        assert_a_selection_is_drawn_as_columns(&mut session, &artifact);
    }
}

#[test]
fn a_horizontal_caret_has_no_width_and_reads_horizontally() {
    let mut session = open(long_paragraphs_fixture_epub());
    let href = session.publication().spine[0].href.clone();
    let artifact = session
        .request_artifact(at(&href, 1, ReaderSpreadMode::Single, 1.0))
        .expect("artifact");
    let run = painted_runs(&session, &artifact)[0].clone();
    let point = ReaderTextPoint {
        page_index: artifact.pages[0].page_index,
        x: run.rect.x + 1.0,
        y: run.rect.y + run.rect.height / 2.0,
    };
    let ReaderTextInteractionResult::Caret(caret) = interact(
        &mut session,
        &artifact,
        ReaderTextInteractionQuery::Caret { point },
    ) else {
        panic!("a caret");
    };
    assert_eq!(caret.writing_mode, ReaderWritingMode::HorizontalTb);
    let geometry = caret.geometry.expect("drawn");
    assert_eq!(geometry.width, 0.0);
    assert!(geometry.height > 0.0);
}

/// The tops of the text hits a window records, in its display-list space.
fn hit_tops(session: &ReaderSession, artifact: &ReaderArtifact) -> Vec<f64> {
    records(session, artifact)
        .hits
        .into_iter()
        .filter(|hit| hit.kind == ReaderHitKind::Text)
        .map(|hit| hit.bounds.y)
        .collect()
}

/// The first window of the chapter at `ratio`, and its windows `spreads`.
fn windows(ratio: f64, spreads: std::ops::Range<u32>) -> (ReaderSession, Vec<ReaderArtifact>) {
    let mut session = open(long_paragraphs_fixture_epub());
    let href = session.publication().spine[0].href.clone();
    let first = session
        .request_artifact(at(&href, 1, ReaderSpreadMode::Scrolled, ratio))
        .expect("first window");
    super::tests::adopt_initial(&mut session, SESSION, first.artifact_id);
    let windows = spreads
        .map(|spread| {
            session
                .peek_spread(ReaderSpreadRequest {
                    session_id: SESSION,
                    request_id: 2 + u64::from(spread),
                    from_artifact_id: first.artifact_id,
                    spread_index: spread,
                })
                .expect("window publishes")
        })
        .collect();
    (session, windows)
}

#[test]
fn a_downward_windows_records_move_with_its_pixels_by_whole_device_rows() {
    // 640 × 4/3 is no whole number of device rows: every window but the
    // first is drawn from a row that is not its CSS start, and moved onto
    // its own origin by the rows. At ratio 1 the rows are the CSS starts,
    // and the layout is the same at every ratio.
    let ratio = 4.0 / 3.0;
    let (exact, exact_windows) = windows(1.0, 1..4);
    let (session, windows) = windows(ratio, 1..4);
    for (spread, (window, exact_window)) in (1u32..).zip(windows.iter().zip(&exact_windows)) {
        let length = exact_window.pages[0].height;
        let start = f64::from(spread) * length;
        let drawn_from = (start * ratio + 0.5).floor() / ratio;
        if spread == 1 {
            assert_ne!(drawn_from, start, "window 1 starts off the device grid");
        }
        let tops = hit_tops(&session, window);
        let exact_tops = hit_tops(&exact, exact_window);
        assert!(!tops.is_empty(), "window {spread} records text");
        assert_eq!(tops.len(), exact_tops.len());
        for (top, exact_top) in tops.iter().zip(&exact_tops) {
            assert!(
                (top + drawn_from - (exact_top + start)).abs() < 1e-6,
                "window {spread}: a hit at {top} is not where its line is drawn ({})",
                exact_top + start - drawn_from
            );
        }
    }
}

/// The engine's side of `tools/corpus-oracle/vertical-rects-probe.mjs`: the
/// first page of the vertical fixture's columns, as the probe lays its
/// paragraphs out in Chromium, each character's range rects and the caret
/// before it, in the page's display-list space and the probe's JSON shape.
/// `tools/corpus-oracle/vertical-rects-compare.mjs` reads the two.
#[test]
#[ignore = "writes the engine's vertical records for the Chromium comparison"]
fn dump_vertical_records() {
    let path = std::env::var("RITO_VERTICAL_RECORDS_DUMP")
        .expect("RITO_VERTICAL_RECORDS_DUMP names the file to write");
    let (mut session, artifact) = columns(ReaderSpreadMode::Single, 1.0, 0);
    let href = session.publication().spine[1].href.clone();
    let rect = |bounds: &ReaderRect| {
        serde_json::json!({
            "x": bounds.x, "y": bounds.y, "width": bounds.width, "height": bounds.height,
        })
    };
    let mut paragraphs = Vec::new();
    for paragraph in 0..3u32 {
        let mut characters = Vec::new();
        for offset in 0..144u64 {
            let point = |text_offset| ReaderSourcePoint {
                node_path: vec![paragraph, 0],
                text_offset,
            };
            let rects: Vec<ReaderRect> = session
                .resolve_exact_source_range(ReaderExactSourceRangeRequest {
                    session_id: SESSION,
                    artifact_id: artifact.artifact_id,
                    href: href.clone(),
                    range: ReaderSourceRange {
                        start: point(offset),
                        end: point(offset + 1),
                    },
                    every_page: false,
                })
                .expect("range resolves")
                .rects
                .into_iter()
                .map(|placed| placed.bounds)
                .collect();
            let caret = rects.first().and_then(|first| {
                let at = ReaderTextPoint {
                    page_index: artifact.pages[0].page_index,
                    x: first.x + first.width / 2.0,
                    y: first.y + first.height / 4.0,
                };
                match interact(
                    &mut session,
                    &artifact,
                    ReaderTextInteractionQuery::Caret { point: at },
                ) {
                    ReaderTextInteractionResult::Caret(caret) => caret.geometry,
                    _ => None,
                }
            });
            characters.push(serde_json::json!({
                "offset": offset,
                "rects": rects.iter().map(rect).collect::<Vec<_>>(),
                "caret": caret.iter().map(|geometry| serde_json::json!({
                    "x": geometry.x, "y": geometry.y,
                    "width": geometry.width, "height": geometry.height,
                })).collect::<Vec<_>>(),
            }));
        }
        paragraphs
            .push(serde_json::json!({ "id": format!("p{paragraph}"), "characters": characters }));
    }
    let dump =
        serde_json::json!({ "width": 420, "height": 640, "margin": 24, "rects": paragraphs });
    std::fs::write(
        path,
        serde_json::to_string_pretty(&dump).expect("dump encodes"),
    )
    .expect("dump writes");
}
