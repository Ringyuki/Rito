//! A request that covers every page: the rects and caret geometry of a
//! page the asking artifact does not draw are the ones that page's own
//! spread answers, so a host holding one artifact can place a range that
//! runs across spreads without publishing each of them.

use crate::runtime::tests::fixture::long_chapter_window_fixture_epub;

use super::{
    tests::{adopt_initial, open_test_session, request},
    *,
};

const SESSION: u64 = 419;

fn double(mut request: ReaderArtifactRequest) -> ReaderArtifactRequest {
    request.layout.viewport_width = 900.0;
    request.layout.spread_mode = ReaderSpreadMode::Double;
    request.layout.spread_gap = 20.0;
    request
}

fn interact(
    session: &mut ReaderSession,
    artifact_id: u64,
    query: ReaderTextInteractionQuery,
    every_page: bool,
) -> Result<ReaderTextInteractionResult, ReaderError> {
    session
        .resolve_text_interaction(ReaderTextInteractionRequest {
            session_id: SESSION,
            artifact_id,
            query,
            every_page,
        })
        .map(|response| response.result)
}

fn selection(result: Result<ReaderTextInteractionResult, ReaderError>) -> ReaderSelectionResult {
    match result.expect("interaction resolves") {
        ReaderTextInteractionResult::Selection(selection) => *selection,
        other => panic!("selection expected, got {other:?}"),
    }
}

fn caret(result: Result<ReaderTextInteractionResult, ReaderError>) -> ReaderCaret {
    match result.expect("interaction resolves") {
        ReaderTextInteractionResult::Caret(caret) => caret,
        other => panic!("caret expected, got {other:?}"),
    }
}

fn on_page(rects: &[ReaderExactSourceRect], page_index: u32) -> Vec<ReaderExactSourceRect> {
    rects
        .iter()
        .filter(|rect| rect.page_index == page_index)
        .copied()
        .collect()
}

fn spread_of(session: &mut ReaderSession, artifact_id: u64, page_index: u32) -> u32 {
    let layout = match session
        .resolve_navigation(ReaderNavigationRequest {
            session_id: SESSION,
            query: ReaderNavigationQuery::Layout { artifact_id },
        })
        .expect("layout resolves")
    {
        ReaderNavigationResult::Layout(layout) => layout,
        other => panic!("a layout answer: {other:?}"),
    };
    let index = layout
        .spreads
        .iter()
        .position(|spread| {
            spread.left_page_index == page_index || spread.right_page_index == Some(page_index)
        })
        .expect("the page is on a spread");
    u32::try_from(index).expect("fixture counts fit u32")
}

/// Extends a caret on the artifact's page in `slot` down until its focus
/// sits inside a page of a later spread. A page down keeps the slot.
fn range_across_spreads(
    session: &mut ReaderSession,
    artifact: &ReaderArtifact,
    slot: usize,
) -> (ReaderCaretAddress, ReaderCaretAddress) {
    let hit = artifact.pages[slot]
        .hits
        .iter()
        .find(|hit| !hit.text.trim().is_empty())
        .expect("the page has text");
    let anchor = caret(interact(
        session,
        artifact.artifact_id,
        ReaderTextInteractionQuery::Caret {
            point: ReaderTextPoint {
                page_index: hit.page_index,
                x: hit.bounds.x + 1.0,
                y: hit.bounds.y + hit.bounds.height / 2.0,
            },
        },
        false,
    ))
    .address;
    let drawn = artifact
        .pages
        .iter()
        .map(|page| page.page_index)
        .collect::<Vec<_>>();
    let mut step = |focus, movement| {
        selection(interact(
            session,
            artifact.artifact_id,
            ReaderTextInteractionQuery::Movement {
                anchor,
                focus,
                movement,
                preferred_inline_position: None,
                preferred_block_position: None,
            },
            false,
        ))
        .selection
        .focus
    };
    let mut focus = anchor;
    for _ in 0..4 {
        focus = step(focus, ReaderSelectionMovement::PageDown);
        if !drawn.contains(&focus.page_index) {
            // A page down can land on the page's first character, which
            // leaves the page outside the range: take a line of it.
            return (anchor, step(focus, ReaderSelectionMovement::LineDown));
        }
    }
    panic!("four pages down stay on the first spread");
}

/// `focus_slot` is the slot of its spread the range's last page sits in.
fn every_page_matches_each_spread(first_request: ReaderArtifactRequest, focus_slot: usize) {
    let mut session =
        open_test_session(SESSION, long_chapter_window_fixture_epub()).expect("opens");
    let first = session
        .request_artifact(first_request)
        .expect("first chapter resolves");
    adopt_initial(&mut session, SESSION, first.artifact_id);
    let (anchor, focus) = range_across_spreads(&mut session, &first, focus_slot);
    let range = ReaderTextInteractionQuery::Range { anchor, focus };

    let drawn = selection(interact(&mut session, first.artifact_id, range, false));
    let every = selection(interact(&mut session, first.artifact_id, range, true));
    assert!(drawn.selection.rects.iter().all(|rect| first
        .pages
        .iter()
        .any(|page| page.page_index == rect.page_index)));
    assert!(every
        .selection
        .rects
        .iter()
        .any(|rect| rect.page_index == focus.page_index));
    for page in &first.pages {
        assert_eq!(
            on_page(&every.selection.rects, page.page_index),
            on_page(&drawn.selection.rects, page.page_index),
            "a page the artifact draws reads the same either way"
        );
    }

    // The focus page, asked of the spread that draws it.
    let focus_spread = spread_of(&mut session, first.artifact_id, focus.page_index);
    let own = session
        .peek_spread(ReaderSpreadRequest {
            session_id: SESSION,
            request_id: 2,
            from_artifact_id: first.artifact_id,
            spread_index: focus_spread,
        })
        .expect("the focus spread publishes");
    assert_eq!(own.pages[focus_slot].page_index, focus.page_index);
    let own_rects = selection(interact(&mut session, own.artifact_id, range, false))
        .selection
        .rects;
    assert!(!on_page(&own_rects, focus.page_index).is_empty());
    for page in &own.pages {
        assert_eq!(
            on_page(&every.selection.rects, page.page_index),
            on_page(&own_rects, page.page_index),
            "page {} is placed as its own spread places it",
            page.page_index
        );
    }

    // A point and a caret on a page the first artifact does not draw.
    let far = on_page(&own_rects, focus.page_index)[0];
    let far_point = ReaderTextInteractionQuery::Caret {
        point: ReaderTextPoint {
            page_index: far.page_index,
            x: far.bounds.x + 1.0,
            y: far.bounds.y + far.bounds.height / 2.0,
        },
    };
    let rejected = interact(&mut session, first.artifact_id, far_point, false)
        .expect_err("the first artifact does not draw the focus page");
    assert_eq!(rejected.kind, ReaderErrorKind::InvalidRequest);
    let reached = caret(interact(&mut session, first.artifact_id, far_point, true));
    let owned = caret(interact(&mut session, own.artifact_id, far_point, false));
    assert_eq!(reached, owned);
    assert!(reached.geometry.is_some());

    // The same range as a durable source range.
    assert_eq!(
        every.selection.source_start_href,
        every.selection.source_end_href
    );
    let mut source = ReaderExactSourceRangeRequest {
        session_id: SESSION,
        artifact_id: first.artifact_id,
        href: every.selection.source_start_href.clone(),
        range: ReaderSourceRange {
            start: every.selection.source_start.clone(),
            end: every.selection.source_end.clone(),
        },
        every_page: false,
    };
    let source_drawn = session
        .resolve_exact_source_range(source.clone())
        .expect("the source range resolves");
    source.every_page = true;
    let source_every = session
        .resolve_exact_source_range(source)
        .expect("the source range resolves");
    assert_eq!(source_drawn.rects, drawn.selection.rects);
    assert_eq!(source_every.rects, every.selection.rects);
    assert_eq!(source_every.first_page_index, source_drawn.first_page_index);
}

#[test]
fn every_page_matches_each_spread_one_page_at_a_time() {
    every_page_matches_each_spread(request(SESSION, 1, ""), 0);
}

#[test]
fn every_page_matches_each_spread_two_pages_at_a_time() {
    // The range ends on a right-hand page, drawn one page and a gap over.
    every_page_matches_each_spread(double(request(SESSION, 1, "")), 1);
}
