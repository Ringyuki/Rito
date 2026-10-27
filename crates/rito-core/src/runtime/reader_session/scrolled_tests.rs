//! A scrolled reader session: each chapter's windows are its spreads, an
//! artifact says where its locator's line starts in its window, and the
//! revision's layout says how long each chapter runs and which way.

use crate::runtime::tests::fixture::long_paragraphs_fixture_epub;

use super::{
    tests::{adopt_initial, open_test_session, request},
    *,
};

const SESSION: u64 = 512;

fn scrolled(request_id: u64, locator: ReaderLocator) -> ReaderArtifactRequest {
    let mut request = request(SESSION, request_id, &locator.href);
    request.layout.spread_mode = ReaderSpreadMode::Scrolled;
    request.locator = locator;
    request
}

fn layout_of(session: &mut ReaderSession, artifact_id: u64) -> ReaderRevisionLayout {
    match session
        .resolve_navigation(ReaderNavigationRequest {
            session_id: SESSION,
            query: ReaderNavigationQuery::Layout {
                artifact_id,
                whole: true,
            },
        })
        .expect("layout resolves")
    {
        ReaderNavigationResult::Layout(layout) => layout,
        other => panic!("a layout answer: {other:?}"),
    }
}

#[test]
fn a_scrolled_session_serves_windows_and_says_how_long_its_chapters_run() {
    let mut session =
        open_test_session(SESSION, long_paragraphs_fixture_epub()).expect("reader session opens");
    let href = session.publication().spine[0].href.clone();
    let first = session
        .request_artifact(scrolled(
            1,
            ReaderLocator {
                href: href.clone(),
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: Some(0.5),
            },
        ))
        .expect("scrolled artifact");
    adopt_initial(&mut session, SESSION, first.artifact_id);

    // A progression is a position among the chapter's windows: the window
    // half way through them, shown from its top.
    let layout = layout_of(&mut session, first.artifact_id);
    assert_eq!(layout.scroll_axis, Some(ReaderScrollAxis::Down));
    let chapter = layout.chapters[0];
    let extent = chapter
        .extent
        .expect("a scrolled chapter says how long it runs");
    let window_length = 640.0;
    let span = chapter.end_page - chapter.start_page;
    assert_eq!(
        first.local_page_index,
        (f64::from(span) * 0.5).round() as u32
    );
    assert_eq!(first.target_block_offset, None);
    assert_eq!(first.pages[0].height, window_length);

    // The chapter's last window ends where the chapter does.
    let last = layout.spreads.len() - 1;
    let last_artifact = session
        .peek_spread(ReaderSpreadRequest {
            session_id: SESSION,
            request_id: 2,
            from_artifact_id: first.artifact_id,
            spread_index: u32::try_from(last).expect("spread index"),
        })
        .expect("last window publishes");
    assert_eq!(
        last_artifact.pages[0].height,
        extent - last as f64 * window_length
    );
    // A spread's locator is its reading point, whose line it is shown from.
    let height = last_artifact.pages[0].height;
    assert!(last_artifact
        .target_block_offset
        .is_some_and(|offset| (0.0..height).contains(&offset)));
}

#[test]
fn a_scrolled_session_holds_more_live_windows_than_a_paged_one() {
    use super::session::READER_SCROLLED_LIVE_ARTIFACT_CAP;

    let mut session =
        open_test_session(SESSION, long_paragraphs_fixture_epub()).expect("reader session opens");
    let href = session.publication().spine[0].href.clone();
    let at = |request_id: u64| {
        scrolled(
            request_id,
            ReaderLocator {
                href: href.clone(),
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: None,
            },
        )
    };
    for request_id in 1..=u64::from(READER_SCROLLED_LIVE_ARTIFACT_CAP) {
        session
            .request_artifact(at(request_id))
            .expect("a window fits the scrolled cap");
    }
    let capped = session
        .request_artifact(at(u64::from(READER_SCROLLED_LIVE_ARTIFACT_CAP) + 1))
        .expect_err("the scrolled cap holds");
    assert_eq!(capped.kind, ReaderErrorKind::InvalidRequest);
}
