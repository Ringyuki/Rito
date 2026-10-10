//! The page table of a revision and addressing a spread by its position
//! in it. The table is checked against a whole-book revision laid out in
//! one pass and read straight from the engine, so a host that draws pages
//! through a session reads the spreads, chapter ranges and TOC placements
//! the book has.

use crate::runtime::{
    tests::{
        fixture::{long_chapter_window_fixture_epub, toc_anchor_fixture_epub},
        revisions::{whole_book_pages, WholeBookPages},
    },
    RuntimeDocument,
};

use super::{
    convert::layout_config,
    session::READER_LIVE_ARTIFACT_CAP,
    tests::{adopt_initial, open_test_session, request},
    *,
};

const SESSION: u64 = 311;

fn double_layout() -> ReaderLayout {
    ReaderLayout {
        render_ratio: 1.0,
        viewport_width: 900.0,
        viewport_height: 640.0,
        margin_top: 24.0,
        margin_right: 24.0,
        margin_bottom: 24.0,
        margin_left: 24.0,
        spread_mode: ReaderSpreadMode::Double,
        first_page_alone: true,
        spread_gap: 20.0,
        root_font_size: 16.0,
        line_height_override: None,
        font_family_override: None,
        line_height_force: true,
        font_family_force: true,
    }
}

fn whole_book(bytes: &[u8], layout: ReaderLayout) -> WholeBookPages {
    let mut document = RuntimeDocument::open_pinned_for_tests(bytes).expect("opens");
    let revision = document
        .create_revision(&layout_config(layout).expect("layout"))
        .expect("revision");
    whole_book_pages(&mut document, &revision.revision_id)
}

fn layout_of(session: &mut ReaderSession, artifact_id: u64) -> ReaderRevisionLayout {
    match session
        .resolve_navigation(ReaderNavigationRequest {
            session_id: SESSION,
            query: ReaderNavigationQuery::Layout { artifact_id },
        })
        .expect("layout resolves")
    {
        ReaderNavigationResult::Layout(layout) => layout,
        other => panic!("a layout answer: {other:?}"),
    }
}

fn spread(
    session: &mut ReaderSession,
    request_id: u64,
    from_artifact_id: u64,
    spread_index: u32,
) -> Result<ReaderArtifact, ReaderError> {
    session.peek_spread(ReaderSpreadRequest {
        session_id: SESSION,
        request_id,
        from_artifact_id,
        spread_index,
    })
}

fn as_u32(value: usize) -> u32 {
    u32::try_from(value).expect("fixture counts fit u32")
}

/// Adopts the first whole-book candidate and returns it.
fn adopt_whole_book(session: &mut ReaderSession, visible_artifact_id: u64) -> ReaderArtifact {
    for _ in 0..256 {
        let step = session
            .advance_background_once(ReaderBackgroundRequest {
                session_id: SESSION,
                expected_visible_artifact_id: visible_artifact_id,
                max_top_level_nodes_per_quantum: 64,
            })
            .expect("background step succeeds");
        if let Some(candidate) = step.artifact {
            session
                .adopt_background_candidate(ReaderBackgroundHandoff {
                    session_id: SESSION,
                    expected_visible_artifact_id: visible_artifact_id,
                    candidate_artifact_id: candidate.artifact_id,
                })
                .expect("whole-book candidate adopts");
            return candidate;
        }
    }
    panic!("background did not produce a candidate within the fixture bound");
}

#[test]
fn a_chapter_layout_is_that_chapters_slice_of_the_whole_book_layout() {
    let bytes = toc_anchor_fixture_epub();
    let whole = whole_book(&bytes, request(SESSION, 1, "").layout);
    let mut request_id = 0;
    for (spine_index, chapter) in whole.chapters.iter().enumerate() {
        let (start, end) = (chapter.start_page, chapter.end_page);
        let mut session = open_test_session(SESSION, bytes.clone()).expect("opens");
        request_id += 1;
        let artifact = session
            .request_artifact(request(SESSION, request_id, &chapter.href))
            .expect("chapter resolves");
        let layout = layout_of(&mut session, artifact.artifact_id);

        assert_eq!(
            layout.page_count,
            as_u32(end - start + 1),
            "{}",
            chapter.href
        );
        assert_eq!(
            layout.chapters,
            vec![ReaderChapterPages {
                spine_index: as_u32(spine_index),
                start_page: 0,
                end_page: as_u32(end - start),
            }]
        );
        assert_eq!(
            layout.spreads,
            (0..layout.page_count)
                .map(|page| ReaderSpreadPages {
                    left_page_index: page,
                    right_page_index: None,
                })
                .collect::<Vec<_>>()
        );
        assert_eq!(
            layout.toc_targets,
            whole
                .toc_pages
                .iter()
                .filter(|(_, page_index)| (start..=end).contains(page_index))
                .map(|(toc_index, page_index)| ReaderTocTargetPage {
                    toc_id: as_u32(*toc_index),
                    page_index: as_u32(page_index - start),
                })
                .collect::<Vec<_>>(),
            "{}",
            chapter.href
        );
        assert_eq!(
            layout.active_toc_entry_by_page,
            whole.active_toc_entry_by_page[start..=end]
                .iter()
                .map(|entry| entry.map(as_u32))
                .collect::<Vec<_>>(),
            "{}",
            chapter.href
        );
    }
}

#[test]
fn a_whole_book_layout_matches_the_whole_book_revision() {
    let bytes = toc_anchor_fixture_epub();
    let whole = whole_book(&bytes, double_layout());
    let mut session = open_test_session(SESSION, bytes).expect("opens");
    let mut first = request(SESSION, 1, "chapter-1.xhtml");
    first.layout = double_layout();
    let visible = session.request_artifact(first).expect("chapter resolves");
    adopt_initial(&mut session, SESSION, visible.artifact_id);
    let candidate = adopt_whole_book(&mut session, visible.artifact_id);
    let layout = layout_of(&mut session, candidate.artifact_id);

    assert_eq!(layout.page_count, as_u32(whole.page_count));
    assert_eq!(Some(layout.page_count), candidate.book_page_count);
    assert_eq!(
        layout.spreads,
        whole
            .spreads
            .iter()
            .map(|(left, right)| ReaderSpreadPages {
                left_page_index: as_u32(*left),
                right_page_index: right.map(as_u32),
            })
            .collect::<Vec<_>>()
    );
    assert!(
        layout
            .spreads
            .iter()
            .any(|spread| spread.right_page_index.is_some()),
        "the fixture draws two pages side by side"
    );
    assert_eq!(
        layout.chapters,
        whole
            .chapters
            .iter()
            .enumerate()
            .map(|(spine_index, chapter)| ReaderChapterPages {
                spine_index: as_u32(spine_index),
                start_page: as_u32(chapter.start_page),
                end_page: as_u32(chapter.end_page),
            })
            .collect::<Vec<_>>()
    );
    assert_eq!(
        layout.toc_targets,
        whole
            .toc_pages
            .iter()
            .map(|(toc_index, page_index)| ReaderTocTargetPage {
                toc_id: as_u32(*toc_index),
                page_index: as_u32(*page_index),
            })
            .collect::<Vec<_>>()
    );
    assert_eq!(layout.toc_targets.len(), 4, "every entry is placed");
    assert_eq!(
        layout.active_toc_entry_by_page,
        whole
            .active_toc_entry_by_page
            .iter()
            .map(|entry| entry.map(as_u32))
            .collect::<Vec<_>>()
    );

    // Every spread of the table is reachable by its position and numbers
    // its pages the way the table does.
    for (index, pages) in layout.spreads.iter().enumerate() {
        let artifact = spread(
            &mut session,
            100 + index as u64,
            candidate.artifact_id,
            as_u32(index),
        )
        .expect("a spread of the whole book publishes");
        assert_eq!(artifact.local_spread_index, as_u32(index));
        assert_eq!(artifact.book_page_index, Some(pages.left_page_index));
        assert_eq!(artifact.book_page_count, Some(layout.page_count));
        let mut drawn = vec![pages.left_page_index];
        drawn.extend(pages.right_page_index);
        assert_eq!(artifact.local_page_indexes, drawn);
        session
            .release_artifact(artifact.artifact_id)
            .expect("a peeked spread releases");
    }
    let past_the_end = spread(
        &mut session,
        900,
        candidate.artifact_id,
        as_u32(layout.spreads.len()),
    )
    .expect_err("a spread past the table is refused");
    assert_eq!(past_the_end.kind, ReaderErrorKind::InvalidRequest);
}

#[test]
fn a_spread_reached_by_position_is_the_spread_reached_by_turning() {
    let mut session =
        open_test_session(SESSION, long_chapter_window_fixture_epub()).expect("opens");
    let visible = session
        .request_artifact(request(SESSION, 1, ""))
        .expect("first chapter resolves");
    adopt_initial(&mut session, SESSION, visible.artifact_id);
    let layout = layout_of(&mut session, visible.artifact_id);
    assert!(
        layout.spreads.len() >= 4,
        "the fixture spans several spreads"
    );

    let mut turned = visible.clone();
    let mut request_id = 1;
    for index in 1..layout.spreads.len() {
        request_id += 1;
        let next = session
            .peek_adjacent(ReaderAdjacentRequest {
                session_id: SESSION,
                request_id,
                from_artifact_id: turned.artifact_id,
                direction: ReaderAdjacentDirection::Next,
            })
            .expect("the next spread peeks");
        request_id += 1;
        let direct = spread(&mut session, request_id, visible.artifact_id, as_u32(index))
            .expect("the spread publishes by position");
        assert_eq!(direct.local_spread_index, as_u32(index));
        assert_eq!(direct.local_page_indexes, next.local_page_indexes);
        assert_eq!(direct.display_list, next.display_list, "spread {index}");
        assert_eq!(direct.locator, next.locator, "spread {index}");
        assert_eq!(direct.navigation, next.navigation, "spread {index}");
        assert_eq!(direct.book_page_index, None);
        if turned.artifact_id != visible.artifact_id {
            session
                .release_artifact(turned.artifact_id)
                .expect("a peeked spread releases");
        }
        session
            .release_artifact(direct.artifact_id)
            .expect("a peeked spread releases");
        turned = next;
    }

    // Nothing above touched the foreground.
    assert_eq!(session.visible_artifact_id(), Some(visible.artifact_id));
    assert!(!session.has_pending_adjacent());
}

#[test]
fn a_spread_reached_by_position_commits_and_turns_like_any_page() {
    let mut session =
        open_test_session(SESSION, long_chapter_window_fixture_epub()).expect("opens");
    let visible = session
        .request_artifact(request(SESSION, 1, ""))
        .expect("first chapter resolves");
    adopt_initial(&mut session, SESSION, visible.artifact_id);
    let last = as_u32(layout_of(&mut session, visible.artifact_id).spreads.len() - 1);

    let target = spread(&mut session, 2, visible.artifact_id, last).expect("the last spread");
    let ack = session
        .commit_peeked_artifact(ReaderForegroundHandoff {
            session_id: SESSION,
            expected_visible_artifact_id: Some(visible.artifact_id),
            candidate_artifact_id: target.artifact_id,
        })
        .expect("a spread reached by position commits");
    assert_eq!(ack.visible_artifact_id, target.artifact_id);
    assert_eq!(ack.replaced_artifact_id, Some(visible.artifact_id));

    let previous = session
        .request_adjacent(ReaderAdjacentRequest {
            session_id: SESSION,
            request_id: 3,
            from_artifact_id: target.artifact_id,
            direction: ReaderAdjacentDirection::Previous,
        })
        .expect("the previous spread resolves");
    assert_eq!(previous.local_spread_index, last - 1);
}

#[test]
fn a_spread_request_fails_closed_without_publishing() {
    let mut session =
        open_test_session(SESSION, long_chapter_window_fixture_epub()).expect("opens");
    let visible = session
        .request_artifact(request(SESSION, 5, ""))
        .expect("first chapter resolves");
    adopt_initial(&mut session, SESSION, visible.artifact_id);
    let spread_count = as_u32(layout_of(&mut session, visible.artifact_id).spreads.len());
    let live = session.live_artifact_count();

    let past_the_end = spread(&mut session, 6, visible.artifact_id, spread_count)
        .expect_err("a spread past the table is refused");
    assert_eq!(past_the_end.kind, ReaderErrorKind::InvalidRequest);
    let stale = spread(&mut session, 5, visible.artifact_id, 0)
        .expect_err("a request id that is not newer is refused");
    assert_eq!(stale.kind, ReaderErrorKind::StaleRequest);
    let unknown = spread(&mut session, 7, visible.artifact_id + 99, 0)
        .expect_err("an artifact the session does not hold is refused");
    assert_eq!(unknown.kind, ReaderErrorKind::UnknownArtifact);
    let other_session = session
        .peek_spread(ReaderSpreadRequest {
            session_id: SESSION + 1,
            request_id: 8,
            from_artifact_id: visible.artifact_id,
            spread_index: 0,
        })
        .expect_err("another session's request is refused");
    assert_eq!(other_session.kind, ReaderErrorKind::InvalidSession);
    assert_eq!(session.live_artifact_count(), live);

    // Each published spread holds one live slot until it is released.
    let mut request_id = 10;
    while session.live_artifact_count() < READER_LIVE_ARTIFACT_CAP {
        request_id += 1;
        spread(&mut session, request_id, visible.artifact_id, 1).expect("a spread publishes");
    }
    let full = spread(&mut session, request_id + 1, visible.artifact_id, 1)
        .expect_err("a full artifact table refuses another spread");
    assert_eq!(full.kind, ReaderErrorKind::InvalidRequest);
}

fn layout_request_fixture() -> ReaderNavigationRequest {
    ReaderNavigationRequest {
        session_id: 7,
        query: ReaderNavigationQuery::Layout { artifact_id: 9 },
    }
}

fn layout_result_fixture() -> ReaderNavigationResult {
    ReaderNavigationResult::Layout(ReaderRevisionLayout {
        page_count: 5,
        spreads: vec![
            ReaderSpreadPages {
                left_page_index: 0,
                right_page_index: None,
            },
            ReaderSpreadPages {
                left_page_index: 1,
                right_page_index: Some(2),
            },
            ReaderSpreadPages {
                left_page_index: 3,
                right_page_index: Some(4),
            },
        ],
        chapters: vec![
            ReaderChapterPages {
                spine_index: 1,
                start_page: 0,
                end_page: 2,
            },
            ReaderChapterPages {
                spine_index: 3,
                start_page: 3,
                end_page: 4,
            },
        ],
        toc_targets: vec![
            ReaderTocTargetPage {
                toc_id: 2,
                page_index: 0,
            },
            ReaderTocTargetPage {
                toc_id: 6,
                page_index: 3,
            },
        ],
        active_toc_entry_by_page: vec![None, Some(2), Some(2), Some(6), Some(6)],
    })
}

fn spread_request_fixture() -> ReaderSpreadRequest {
    ReaderSpreadRequest {
        session_id: 7,
        request_id: 12,
        from_artifact_id: 9,
        spread_index: 258,
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn unhex(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).expect("hex"))
        .collect()
}

/// Produced by the encoder; the `rito_flutter` and `@ritojs/core-wasm`
/// layout wire tests pin the same bytes.
const LAYOUT_REQUEST_HEX: &str = concat!(
    "5249544f4e565131010000002500000000000000070000000000000004090000",
    "0000000000",
);

/// Produced by the encoder; the `rito_flutter` and `@ritojs/core-wasm`
/// layout wire tests pin the same bytes.
const LAYOUT_RESULT_HEX: &str = concat!(
    "5249544f4e565231010000007d00000000000000030500000003000000000000",
    "0000010000000102000000030000000104000000020000000100000000000000",
    "0200000003000000030000000400000002000000020000000000000006000000",
    "0300000005000000000102000000010200000001060000000106000000",
);

/// Produced by the encoder; the `rito_flutter` and `@ritojs/core-wasm`
/// layout wire tests pin the same bytes.
const SPREAD_REQUEST_HEX: &str = concat!(
    "5249544f5350513101000000300000000000000007000000000000000c000000",
    "00000000090000000000000002010000",
);

#[test]
fn layout_and_spread_wire_fixtures_are_pinned_byte_for_byte() {
    assert_eq!(
        hex(&encode_reader_navigation_request(&layout_request_fixture()).unwrap()),
        LAYOUT_REQUEST_HEX
    );
    assert_eq!(
        hex(&encode_reader_navigation_result(&layout_result_fixture()).unwrap()),
        LAYOUT_RESULT_HEX
    );
    let spread = encode_reader_spread_request(&spread_request_fixture()).unwrap();
    assert_eq!(hex(&spread), SPREAD_REQUEST_HEX);
    assert_eq!(spread.len(), READER_SPREAD_REQUEST_WIRE_BYTES as usize);
    assert_eq!(
        decode_reader_navigation_request(&unhex(LAYOUT_REQUEST_HEX)),
        Ok(layout_request_fixture())
    );
    assert_eq!(
        decode_reader_navigation_result(&unhex(LAYOUT_RESULT_HEX)),
        Ok(layout_result_fixture())
    );
    assert_eq!(
        decode_reader_spread_request(&unhex(SPREAD_REQUEST_HEX)),
        Ok(spread_request_fixture())
    );
}

#[test]
fn layout_and_spread_wires_reject_every_truncated_prefix_and_trailing_bytes() {
    let request = unhex(LAYOUT_REQUEST_HEX);
    let result = unhex(LAYOUT_RESULT_HEX);
    let spread = unhex(SPREAD_REQUEST_HEX);
    for length in 0..request.len() {
        assert!(decode_reader_navigation_request(&request[..length]).is_err());
    }
    for length in 0..result.len() {
        assert!(decode_reader_navigation_result(&result[..length]).is_err());
    }
    for length in 0..spread.len() {
        assert!(decode_reader_spread_request(&spread[..length]).is_err());
    }
    for message in [&request, &result, &spread] {
        // A message that declares its own length correctly but carries a
        // byte no field reads.
        let mut longer = message.to_vec();
        longer.push(0);
        let total = u64::try_from(longer.len()).expect("length fits");
        longer[12..20].copy_from_slice(&total.to_le_bytes());
        assert!(decode_reader_navigation_request(&longer).is_err());
        assert!(decode_reader_navigation_result(&longer).is_err());
        assert!(decode_reader_spread_request(&longer).is_err());
    }
    // The ids a spread request carries are external ids: zero is refused.
    let mut zero_artifact = spread.clone();
    zero_artifact[36..44].fill(0);
    assert!(decode_reader_spread_request(&zero_artifact).is_err());
}
