use crate::runtime::{
    tests::fixture::{
        layout as runtime_layout, long_chapter_window_fixture_epub, multi_chapter_fixture_epub,
        multi_chapter_image_fixture_epub, retained_adjacent_fixture_epub,
        source_locator_fixture_epub,
    },
    RuntimeDocument,
};

use super::{publication::ReaderRevisionBacking, session::READER_LIVE_ARTIFACT_CAP, *};

pub(super) fn open_test_session(
    session_id: u64,
    publication_bytes: Vec<u8>,
) -> Result<ReaderSession, ReaderError> {
    // Chapter-local pagination runs on the fragment engine, which
    // shapes with pinned faces only.
    ReaderSession::open_owned_with_pinned_font_policy(
        session_id,
        publication_bytes,
        crate::runtime::tests::fixture::pinned_test_font_policy(),
    )
}

#[test]
fn session_exposes_one_static_publication_snapshot() {
    let session =
        open_test_session(39, multi_chapter_fixture_epub()).expect("reader session opens");
    let publication = session.publication();

    assert_eq!(publication.session_id, 39);
    assert_eq!(publication.metadata.title, "Runtime document");
    assert_eq!(publication.metadata.identifier, "runtime");
    assert_eq!(publication.spine.len(), 3);
    assert_eq!(publication.toc.len(), 3);
    assert_eq!(publication.toc[1].toc_id, 1);
    assert_eq!(publication.toc[1].children[0].toc_id, 2);
    match &publication.toc[1].children[0].target {
        ReaderPublicationTocTarget::Locator {
            spine_index,
            locator,
        } => {
            assert_eq!(*spine_index, 1);
            assert_eq!(locator.href, "chapter-2.xhtml");
            assert_eq!(locator.anchor_id.as_deref(), Some("missing"));
        }
        target => panic!("expected canonical TOC locator, got {target:?}"),
    }

    let wire = encode_reader_publication(publication).expect("publication encodes");
    assert_eq!(&wire[..8], b"RITOPUB1");
    assert_eq!(decode_reader_publication(&wire).as_ref(), Ok(publication));
}

#[test]
fn an_empty_href_opens_the_book_at_its_first_linear_chapter() {
    let mut session =
        open_test_session(53, multi_chapter_fixture_epub()).expect("reader session opens");
    let first_spine_href = session.publication().spine[0].href.clone();

    let artifact = session
        .request_artifact(request(53, 1, ""))
        .expect("a start-of-book locator resolves");

    assert_eq!(artifact.locator.href, first_spine_href);
    assert_eq!(artifact.local_page_index, 0);
}

#[test]
fn a_fragment_without_a_path_is_not_a_start_of_book_locator() {
    let mut session =
        open_test_session(54, multi_chapter_fixture_epub()).expect("reader session opens");

    assert!(
        session
            .request_artifact(request(54, 1, "#point-47"))
            .is_err(),
        "a path-less fragment names no chapter"
    );
}

#[test]
fn exact_nonzero_locator_owns_first_artifact_and_lifecycle() {
    let mut session =
        open_test_session(41, source_locator_fixture_epub()).expect("reader session opens");
    let artifact = session
        .request_artifact(request(41, 7, "chapter.xhtml#point-47"))
        .expect("exact artifact resolves");

    assert_eq!(artifact.session_id, 41);
    assert_eq!(artifact.request_id, 7);
    assert_eq!(artifact.locator.anchor_id.as_deref(), Some("point-47"));
    assert!(artifact.local_page_index > 0);
    assert!(artifact.local_spread_index > 0);
    assert!(artifact
        .local_page_indexes
        .contains(&artifact.local_page_index));
    assert!(artifact.display_list.command_count > 0);
    assert!(!artifact.display_list.bytes.is_empty());
    assert!(!artifact.pages.is_empty());
    assert_eq!(session.live_artifact_count(), 1);

    let encoded = encode_reader_artifact(&artifact).expect("artifact encodes");
    assert_eq!(&encoded[..8], b"RITOART1");
    let decoded = decode_reader_artifact(&encoded).expect("artifact decodes");
    assert_eq!(decoded, artifact);

    assert!(session
        .release_artifact(artifact.artifact_id)
        .expect("first release"));
    assert!(!session
        .release_artifact(artifact.artifact_id)
        .expect("repeat release is idempotent"));
    assert_eq!(session.live_artifact_count(), 0);
}

#[test]
fn exact_seek_reuses_a_published_revision_without_layout_work() {
    let mut session =
        open_test_session(122, source_locator_fixture_epub()).expect("reader session opens");
    let first = session
        .request_artifact(request(122, 1, "chapter.xhtml#point-47"))
        .expect("exact source artifact resolves");
    adopt_initial(&mut session, 122, first.artifact_id);
    let revision_count = session.live_revision_count();
    let layout_quanta = session.exact_layout_quantum_count();

    let cached = session
        .request_artifact(request(122, 2, "chapter.xhtml#point-47"))
        .expect("published exact target reuses its revision");

    assert_eq!(cached.revision_id, first.revision_id);
    assert_eq!(cached.revision_version, first.revision_version);
    assert_eq!(cached.request_id, 2);
    assert_ne!(cached.artifact_id, first.artifact_id);
    assert_eq!(cached.locator, first.locator);
    assert_eq!(cached.matched_by, ReaderLocatorMatch::Anchor);
    assert_eq!(cached.local_page_index, first.local_page_index);
    assert_eq!(session.live_revision_count(), revision_count);
    assert_eq!(session.exact_layout_quantum_count(), layout_quanta);
    assert_eq!(session.exact_cache_hit_count(), 1);
    assert_eq!(session.visible_artifact_id(), Some(first.artifact_id));
    assert_eq!(
        session.foreground_candidate_artifact_id(),
        Some(cached.artifact_id)
    );

    adopt_replacement(&mut session, 122, first.artifact_id, cached.artifact_id);
    assert!(session
        .release_artifact(first.artifact_id)
        .expect("the old source stays live through cached candidate adoption"));
    assert_eq!(session.visible_artifact_id(), Some(cached.artifact_id));
}

#[test]
fn exact_href_seek_reuses_only_a_chapter_origin_revision() {
    let mut origin_session =
        open_test_session(127, source_locator_fixture_epub()).expect("origin reader session opens");
    let origin = origin_session
        .request_artifact(request(127, 1, "chapter.xhtml"))
        .expect("chapter-origin artifact resolves");
    let origin_quanta = origin_session.exact_layout_quantum_count();
    let cached_origin = origin_session
        .request_artifact(request(127, 2, "chapter.xhtml"))
        .expect("chapter href reuses a proven origin window");
    assert_eq!(cached_origin.revision_id, origin.revision_id);
    assert_eq!(origin_session.exact_cache_hit_count(), 1);
    assert_eq!(origin_session.exact_layout_quantum_count(), origin_quanta);

    let mut tail_session =
        open_test_session(128, source_locator_fixture_epub()).expect("tail reader session opens");
    let tail = tail_session
        .request_artifact(request(128, 1, "chapter.xhtml#point-47"))
        .expect("tail artifact resolves");
    let tail_quanta = tail_session.exact_layout_quantum_count();
    let chapter_start = tail_session
        .request_artifact(request(128, 2, "chapter.xhtml"))
        .expect("chapter href falls back instead of aliasing a tail-local page zero");
    assert_ne!(chapter_start.revision_id, tail.revision_id);
    assert_eq!(tail_session.exact_cache_hit_count(), 0);
    assert!(tail_session.exact_layout_quantum_count() > tail_quanta);
    assert!(chapter_start
        .pages
        .iter()
        .any(|page| page.text.contains("Source locator paragraph 0 ")));
}

#[test]
fn exact_cache_falls_back_for_layout_misses_only() {
    let mut session =
        open_test_session(123, source_locator_fixture_epub()).expect("reader session opens");
    let first = session
        .request_artifact(request(123, 1, "chapter.xhtml#point-0"))
        .expect("initial exact artifact resolves");
    let mut layout_change = request(123, 2, "chapter.xhtml#point-0");
    layout_change.layout.viewport_width = 360.0;
    let relayout = session
        .request_artifact(layout_change)
        .expect("different layout creates a fresh exact revision");
    let quanta_before_far_target = session.exact_layout_quantum_count();
    // The chapter paginated whole in one pass, so a far anchor in the
    // same chapter reuses the existing revision without new layout.
    let far = session
        .request_artifact(request(123, 3, "chapter.xhtml#point-47"))
        .expect("a far same-chapter anchor resolves from the whole-chapter revision");

    assert_ne!(relayout.revision_id, first.revision_id);
    assert_eq!(far.locator.anchor_id.as_deref(), Some("point-47"));
    assert_eq!(
        session.exact_layout_quantum_count(),
        quanta_before_far_target,
        "no new layout for a target inside an already-paginated chapter"
    );
}

#[test]
fn rapid_cached_exact_candidates_keep_latest_cas_ownership() {
    let mut session =
        open_test_session(124, source_locator_fixture_epub()).expect("reader session opens");
    let visible = session
        .request_artifact(request(124, 1, "chapter.xhtml#point-47"))
        .expect("initial exact artifact resolves");
    adopt_initial(&mut session, 124, visible.artifact_id);
    let layout_quanta = session.exact_layout_quantum_count();
    let stale_candidate = session
        .request_artifact(request(124, 2, "chapter.xhtml#point-47"))
        .expect("first cached candidate resolves");
    let latest_candidate = session
        .request_artifact(request(124, 3, "chapter.xhtml#point-47"))
        .expect("latest cached candidate resolves");

    assert_eq!(stale_candidate.revision_id, visible.revision_id);
    assert_eq!(latest_candidate.revision_id, visible.revision_id);
    assert_eq!(session.exact_layout_quantum_count(), layout_quanta);
    assert_eq!(session.exact_cache_hit_count(), 2);
    let stale = session
        .adopt_foreground_candidate(ReaderForegroundHandoff {
            session_id: 124,
            expected_visible_artifact_id: Some(visible.artifact_id),
            candidate_artifact_id: stale_candidate.artifact_id,
        })
        .expect_err("superseded cached candidate cannot win CAS");
    assert_eq!(stale.kind, ReaderErrorKind::StaleRequest);
    assert_eq!(session.visible_artifact_id(), Some(visible.artifact_id));
    assert_eq!(
        session.foreground_candidate_artifact_id(),
        Some(latest_candidate.artifact_id)
    );
    adopt_replacement(
        &mut session,
        124,
        visible.artifact_id,
        latest_candidate.artifact_id,
    );
}

#[test]
fn foreground_result_is_not_visible_until_initial_cas_adoption() {
    let mut session =
        open_test_session(42, source_locator_fixture_epub()).expect("reader session opens");
    let candidate = session
        .request_artifact(request(42, 1, "chapter.xhtml#point-0"))
        .expect("foreground candidate resolves");

    assert!(!session.has_visible_intent());
    assert_eq!(
        session.foreground_candidate_artifact_id(),
        Some(candidate.artifact_id)
    );
    let background = session
        .advance_background_once(ReaderBackgroundRequest {
            session_id: 42,
            expected_visible_artifact_id: candidate.artifact_id,
            max_top_level_nodes_per_quantum: 1,
        })
        .expect_err("background work cannot observe an unadopted candidate");
    assert_eq!(background.kind, ReaderErrorKind::InvalidRequest);

    let ack = adopt_initial(&mut session, 42, candidate.artifact_id);
    assert_eq!(ack.intent_request_id, 1);
    assert_eq!(ack.replaced_artifact_id, None);
    assert_eq!(session.visible_artifact_id(), Some(candidate.artifact_id));
    assert_eq!(session.foreground_candidate_artifact_id(), None);
}

#[test]
fn foreground_cas_rejects_stale_expected_visible_without_mutation() {
    let mut session =
        open_test_session(43, source_locator_fixture_epub()).expect("reader session opens");
    let visible = session
        .request_artifact(request(43, 1, "chapter.xhtml#point-0"))
        .expect("initial candidate resolves");
    adopt_initial(&mut session, 43, visible.artifact_id);
    let candidate = session
        .request_artifact(request(43, 2, "chapter.xhtml#point-1"))
        .expect("replacement candidate resolves");

    let stale = session
        .adopt_foreground_candidate(ReaderForegroundHandoff {
            session_id: 43,
            expected_visible_artifact_id: None,
            candidate_artifact_id: candidate.artifact_id,
        })
        .expect_err("replacement cannot use the initial-adoption guard");
    assert_eq!(stale.kind, ReaderErrorKind::StaleRequest);
    assert_eq!(session.visible_artifact_id(), Some(visible.artifact_id));
    assert_eq!(
        session.foreground_candidate_artifact_id(),
        Some(candidate.artifact_id),
        "failed CAS must leave the valid candidate available for the right guard"
    );

    adopt_replacement(&mut session, 43, visible.artifact_id, candidate.artifact_id);
    assert_eq!(session.visible_artifact_id(), Some(candidate.artifact_id));
}

#[test]
fn superseded_or_released_foreground_candidate_never_changes_visible() {
    let mut session =
        open_test_session(44, source_locator_fixture_epub()).expect("reader session opens");
    let visible = session
        .request_artifact(request(44, 1, "chapter.xhtml#point-0"))
        .expect("initial candidate resolves");
    adopt_initial(&mut session, 44, visible.artifact_id);
    let stale_candidate = session
        .request_artifact(request(44, 2, "chapter.xhtml#point-1"))
        .expect("first replacement resolves");
    let latest_candidate = session
        .request_artifact(request(44, 3, "chapter.xhtml#point-2"))
        .expect("newer replacement supersedes the first");

    let stale = session
        .adopt_foreground_candidate(ReaderForegroundHandoff {
            session_id: 44,
            expected_visible_artifact_id: Some(visible.artifact_id),
            candidate_artifact_id: stale_candidate.artifact_id,
        })
        .expect_err("superseded candidate cannot adopt");
    assert_eq!(stale.kind, ReaderErrorKind::StaleRequest);
    assert_eq!(session.visible_artifact_id(), Some(visible.artifact_id));
    assert!(session
        .release_artifact(stale_candidate.artifact_id)
        .expect("superseded candidate remains explicitly releasable"));
    assert_eq!(session.visible_artifact_id(), Some(visible.artifact_id));
    assert_eq!(
        session.foreground_candidate_artifact_id(),
        Some(latest_candidate.artifact_id)
    );
    assert!(session
        .release_artifact(latest_candidate.artifact_id)
        .expect("latest unadopted candidate releases"));
    assert_eq!(session.visible_artifact_id(), Some(visible.artifact_id));
    let released = session
        .adopt_foreground_candidate(ReaderForegroundHandoff {
            session_id: 44,
            expected_visible_artifact_id: Some(visible.artifact_id),
            candidate_artifact_id: latest_candidate.artifact_id,
        })
        .expect_err("released candidate is not live enough to adopt");
    assert_eq!(released.kind, ReaderErrorKind::UnknownArtifact);
    assert_eq!(session.visible_artifact_id(), Some(visible.artifact_id));
}

#[test]
fn adjacent_and_seek_candidates_adopt_without_releasing_prior_frames() {
    let mut session =
        open_test_session(45, source_locator_fixture_epub()).expect("reader session opens");
    let first = session
        .request_artifact(request(45, 1, "chapter.xhtml#point-0"))
        .expect("initial candidate resolves");
    adopt_initial(&mut session, 45, first.artifact_id);
    let adjacent = session
        .request_adjacent(adjacent(
            45,
            2,
            first.artifact_id,
            ReaderAdjacentDirection::Next,
        ))
        .expect("adjacent candidate resolves");
    assert_eq!(session.visible_artifact_id(), Some(first.artifact_id));
    adopt_replacement(&mut session, 45, first.artifact_id, adjacent.artifact_id);
    assert!(session
        .release_artifact(first.artifact_id)
        .expect("replaced frame remains live until the host releases it"));
    assert_eq!(session.visible_artifact_id(), Some(adjacent.artifact_id));

    let seek = session
        .request_artifact(request(45, 3, "chapter.xhtml#point-10"))
        .expect("seek candidate resolves");
    assert_eq!(session.visible_artifact_id(), Some(adjacent.artifact_id));
    adopt_replacement(&mut session, 45, adjacent.artifact_id, seek.artifact_id);
    assert!(session
        .release_artifact(adjacent.artifact_id)
        .expect("second replaced frame releases after seek adoption"));
    assert_eq!(session.visible_artifact_id(), Some(seek.artifact_id));
}

#[test]
fn terminal_foreground_request_preserves_visible_and_allocates_no_candidate() {
    let mut session =
        open_test_session(46, multi_chapter_fixture_epub()).expect("reader session opens");
    let last = session
        .request_artifact(request(46, 1, "chapter-3.xhtml"))
        .expect("last chapter candidate resolves");
    adopt_initial(&mut session, 46, last.artifact_id);

    let terminal = session
        .request_adjacent(adjacent(
            46,
            2,
            last.artifact_id,
            ReaderAdjacentDirection::Next,
        ))
        .expect_err("publication end is terminal");
    assert_eq!(terminal.kind, ReaderErrorKind::TargetNotPublished);
    assert_eq!(session.visible_artifact_id(), Some(last.artifact_id));
    assert_eq!(session.foreground_candidate_artifact_id(), None);
    assert_eq!(session.live_artifact_count(), 1);
}

#[test]
fn chapter_boundary_previous_resolves_the_tail_in_one_request() {
    // The fragment engine paginates the whole previous chapter in one
    // pass, so a backward chapter turn lands on its final page without
    // any cooperative-retry loop.
    let mut session =
        open_test_session(49, retained_adjacent_fixture_epub()).expect("reader session opens");
    let visible = session
        .request_artifact(request(49, 1, "chapter-1.xhtml"))
        .expect("source chapter resolves");
    adopt_initial(&mut session, 49, visible.artifact_id);
    let adjacent = adjacent(
        49,
        2,
        visible.artifact_id,
        ReaderAdjacentDirection::Previous,
    );

    let resolved = session
        .request_adjacent(adjacent)
        .expect("previous chapter tail resolves in one request");
    assert_eq!(resolved.locator.href, "chapter-0.xhtml");
    assert_eq!(resolved.locator.progression, Some(1.0));
    let last = resolved
        .local_page_indexes
        .last()
        .copied()
        .expect("tail artifact publishes pages");
    assert_eq!(
        usize::try_from(resolved.local_page_index).expect("page index fits"),
        usize::try_from(last).expect("page index fits"),
        "the tail artifact shows the chapter's final page"
    );
    assert!(!session.has_pending_adjacent());
}

#[test]
fn a_backward_walk_crosses_into_a_long_chapter_and_serves_every_page() {
    // The shape the windowed pipeline broke in the field: entering a
    // long chapter backward built a tail window, and walking past its
    // first page skipped the rest of the chapter. One-pass revisions
    // hold the whole chapter, so the walk must serve every page and
    // cross the start boundary only at local page zero.
    let publication = crate::runtime::tests::fixture::long_then_short_fixture_epub();
    let mut session = open_test_session(153, publication).expect("reader session");
    let visible = session
        .request_artifact(request(153, 1, "chapter-2.xhtml"))
        .expect("short follower resolves");
    adopt_initial(&mut session, 153, visible.artifact_id);

    let mut request_id = 1u64;
    request_id += 1;
    let mut current = session
        .request_adjacent(adjacent(
            153,
            request_id,
            visible.artifact_id,
            ReaderAdjacentDirection::Previous,
        ))
        .expect("previous chapter tail resolves");
    assert_eq!(current.locator.href, "chapter-1.xhtml");
    let tail_index = usize::try_from(current.local_page_index).expect("page index fits");
    assert!(
        tail_index + 1 > 16,
        "the fixture must exceed any local page cap (got {} pages)",
        tail_index + 1
    );

    let mut visited = 1usize;
    while current.local_page_index > 0 {
        request_id += 1;
        let next = session
            .request_adjacent(adjacent(
                153,
                request_id,
                current.artifact_id,
                ReaderAdjacentDirection::Previous,
            ))
            .expect("every backward page serves");
        assert_eq!(
            next.locator.href, "chapter-1.xhtml",
            "the walk must not leave the chapter before its first page"
        );
        assert_eq!(
            next.local_page_index + 1,
            current.local_page_index,
            "backward pages step one at a time"
        );
        session
            .release_artifact(current.artifact_id)
            .expect("previous artifact releases");
        current = next;
        visited += 1;
    }
    assert_eq!(visited, tail_index + 1, "every page of the chapter served");
    assert_eq!(
        current.navigation.previous,
        ReaderAdjacentAvailability::Terminal,
        "local page zero is the publication start here"
    );
}

#[test]
fn session_rejects_wrong_identity_stale_request_and_unknown_artifact() {
    let mut session =
        open_test_session(51, source_locator_fixture_epub()).expect("reader session opens");
    let wrong = session
        .request_artifact(request(52, 1, "chapter.xhtml#point-1"))
        .expect_err("wrong session is rejected");
    assert_eq!(wrong.kind, ReaderErrorKind::InvalidSession);

    let artifact = session
        .request_artifact(request(51, 2, "chapter.xhtml#point-1"))
        .expect("valid request resolves");
    let stale = session
        .request_artifact(request(51, 2, "chapter.xhtml#point-2"))
        .expect_err("same request id is stale");
    assert_eq!(stale.kind, ReaderErrorKind::StaleRequest);
    let unknown = session
        .release_artifact(artifact.artifact_id + 99)
        .expect_err("unknown artifact is rejected");
    assert_eq!(unknown.kind, ReaderErrorKind::UnknownArtifact);

    let ack = session.dispose().expect("session disposes");
    assert_eq!(ack.session_id, 51);
    assert_eq!(ack.released_artifacts, 1);
}

#[test]
fn session_rejects_external_id_sign_bit_before_lookup_or_work() {
    let high_bit = READER_EXTERNAL_ID_MAX + 1;
    let invalid_session = open_test_session(high_bit, Vec::new())
        .expect_err("high-bit session id is rejected before publication parsing");
    assert_eq!(invalid_session.kind, ReaderErrorKind::InvalidSession);

    let mut session =
        open_test_session(52, source_locator_fixture_epub()).expect("reader session opens");
    let mut invalid_request = request(52, high_bit, "chapter.xhtml#point-0");
    let invalid = session
        .request_artifact(invalid_request.clone())
        .expect_err("high-bit request id is rejected");
    assert_eq!(invalid.kind, ReaderErrorKind::InvalidRequest);

    invalid_request.request_id = 1;
    let artifact = session
        .request_artifact(invalid_request)
        .expect("valid request still resolves");
    let invalid = session
        .request_adjacent(adjacent(52, 2, high_bit, ReaderAdjacentDirection::Next))
        .expect_err("high-bit artifact id is rejected before lookup");
    assert_eq!(invalid.kind, ReaderErrorKind::InvalidRequest);
    assert_eq!(
        session
            .release_artifact(high_bit)
            .expect_err("direct high-bit artifact release is rejected")
            .kind,
        ReaderErrorKind::InvalidRequest
    );
    session
        .release_artifact(artifact.artifact_id)
        .expect("valid artifact releases");
}

#[test]
fn failed_revision_retirement_restores_artifact_ownership() {
    let mut session =
        open_test_session(53, source_locator_fixture_epub()).expect("reader session opens");
    let artifact = session
        .request_artifact(request(53, 1, "chapter.xhtml#point-0"))
        .expect("artifact resolves");
    let (backing, revision_id) = session
        .artifact_owner_backing(artifact.artifact_id)
        .expect("artifact owner is live");
    assert_eq!(backing, ReaderRevisionBacking::ChapterLocal);
    let valid_version = session
        .runtime_revision_version(revision_id)
        .expect("revision owner is live");
    session.set_runtime_revision_version(revision_id, valid_version + 1);

    let error = session
        .release_artifact(artifact.artifact_id)
        .expect_err("stale runtime owner prevents retirement");
    assert_eq!(error.kind, ReaderErrorKind::EngineFailure);
    assert!(session.has_live_artifact(artifact.artifact_id));
    assert_eq!(session.live_artifact_count(), 1);
    assert_eq!(
        session
            .revision_artifact_ref_count(revision_id)
            .expect("failed retirement keeps revision"),
        1
    );

    session.set_runtime_revision_version(revision_id, valid_version);
    assert!(session
        .release_artifact(artifact.artifact_id)
        .expect("restored owner releases transactionally"));
}

#[test]
fn three_published_flips_reuse_revision_without_reflow() {
    let mut session =
        open_test_session(61, long_chapter_window_fixture_epub()).expect("reader session opens");
    let first = session
        .request_artifact(request(61, 1, "chapter.xhtml#window-point-0"))
        .expect("first spread resolves");
    let mut artifacts = vec![first];

    for request_id in 2..=u64::from(READER_LIVE_ARTIFACT_CAP) {
        let next = session
            .request_adjacent(adjacent(
                61,
                request_id,
                artifacts.last().unwrap().artifact_id,
                ReaderAdjacentDirection::Next,
            ))
            .expect("published adjacent spread resolves");
        assert_ne!(next.artifact_id, artifacts.last().unwrap().artifact_id);
        assert_eq!(next.revision_id, artifacts[0].revision_id);
        assert!(next.revision_version >= artifacts.last().unwrap().revision_version);
        artifacts.push(next);
    }

    assert_eq!(session.live_artifact_count(), READER_LIVE_ARTIFACT_CAP);
    let capped = session
        .request_adjacent(adjacent(
            61,
            u64::from(READER_LIVE_ARTIFACT_CAP) + 1,
            artifacts.last().unwrap().artifact_id,
            ReaderAdjacentDirection::Next,
        ))
        .expect_err("an over-cap live artifact is rejected before doing work");
    assert_eq!(capped.kind, ReaderErrorKind::InvalidRequest);
    for artifact in artifacts.into_iter().rev() {
        session
            .release_artifact(artifact.artifact_id)
            .expect("shared artifacts release in any order");
    }
    assert_eq!(session.live_artifact_count(), 0);
}

#[test]
fn adjacent_identity_boundaries_and_terminal_are_fail_closed() {
    let mut session =
        open_test_session(81, multi_chapter_fixture_epub()).expect("reader session opens");
    let middle = session
        .request_artifact(request(81, 1, "chapter-2.xhtml"))
        .expect("middle chapter resolves");
    assert_eq!(
        middle.navigation.previous,
        ReaderAdjacentAvailability::ChapterBoundary
    );
    assert_eq!(
        middle.navigation.next,
        ReaderAdjacentAvailability::ChapterBoundary
    );

    let wrong = session
        .request_adjacent(adjacent(
            82,
            2,
            middle.artifact_id,
            ReaderAdjacentDirection::Previous,
        ))
        .expect_err("wrong session is rejected");
    assert_eq!(wrong.kind, ReaderErrorKind::InvalidSession);
    let unknown = session
        .request_adjacent(adjacent(
            81,
            2,
            middle.artifact_id + 99,
            ReaderAdjacentDirection::Previous,
        ))
        .expect_err("unknown source artifact is rejected");
    assert_eq!(unknown.kind, ReaderErrorKind::UnknownArtifact);

    let previous = session
        .request_adjacent(adjacent(
            81,
            2,
            middle.artifact_id,
            ReaderAdjacentDirection::Previous,
        ))
        .expect("previous chapter boundary resolves");
    assert_eq!(previous.locator.href, "chapter-1.xhtml");
    let stale = session
        .request_adjacent(adjacent(
            81,
            2,
            middle.artifact_id,
            ReaderAdjacentDirection::Next,
        ))
        .expect_err("reused adjacent request id is stale");
    assert_eq!(stale.kind, ReaderErrorKind::StaleRequest);

    let next = session
        .request_adjacent(adjacent(
            81,
            3,
            middle.artifact_id,
            ReaderAdjacentDirection::Next,
        ))
        .expect("next chapter boundary resolves");
    assert_eq!(next.locator.href, "chapter-3.xhtml");
    assert_eq!(next.navigation.next, ReaderAdjacentAvailability::Terminal);
    let terminal = session
        .request_adjacent(adjacent(
            81,
            4,
            next.artifact_id,
            ReaderAdjacentDirection::Next,
        ))
        .expect_err("publication end is explicit");
    assert_eq!(terminal.kind, ReaderErrorKind::TargetNotPublished);
    assert!(!session.has_pending_adjacent());
}

#[test]
fn artifact_resources_follow_their_revision_release_order() {
    let mut session =
        open_test_session(91, multi_chapter_image_fixture_epub()).expect("reader session opens");
    let image = session
        .request_artifact(request(91, 1, "chapter-2.xhtml"))
        .expect("image artifact resolves");
    let image_ref = image
        .resources
        .iter()
        .find(|resource| resource.kind == ReaderResourceKind::Image)
        .expect("image resource is declared")
        .clone();
    let previous = session
        .request_adjacent(adjacent(
            91,
            2,
            image.artifact_id,
            ReaderAdjacentDirection::Previous,
        ))
        .expect("previous chapter resolves");
    session
        .release_artifact(previous.artifact_id)
        .expect("unrelated revision releases first");
    let resource = session
        .read_resource(image.artifact_id, image_ref.kind, &image_ref.href)
        .expect("live artifact resource remains readable");
    assert!(!resource.bytes.is_empty());
    session
        .release_artifact(image.artifact_id)
        .expect("resource owner releases last");
}

#[test]
fn a_chapter_local_page_lays_images_out_with_their_real_dimensions() {
    // A chapter-local build must load image intrinsic dimensions before
    // bridging, exactly like the whole-book table: without them every
    // image degrades to the broken-image placeholder and its alt text
    // joins the flow — the chapter then paginates differently from the
    // book table and no background candidate can ever be adopted.
    let publication = crate::runtime::tests::fixture::image_plates_before_text_fixture_epub();
    let mut reference = RuntimeDocument::open_with_pinned_font_policy(
        &publication,
        crate::runtime::tests::fixture::pinned_test_font_policy(),
    )
    .expect("reference document");
    let reference_revision = reference
        .create_revision(&runtime_layout())
        .expect("full reference layout");
    let expected = (0..reference_revision.page_count)
        .map(|page_index| {
            reference
                .get_page_text_positions(&reference_revision.revision_id, page_index)
                .expect("reference page text")
                .text
        })
        .collect::<Vec<_>>();

    let mut session = open_test_session(97, publication).expect("reader session");
    let mut current = session
        .request_artifact(request(97, 1, "chapter.xhtml"))
        .expect("first page artifact");
    let mut actual = vec![single_page_text(&current)];
    let mut request_id = 1u64;
    for _ in 1..reference_revision.page_count {
        request_id += 1;
        let next = session
            .request_adjacent(adjacent(
                97,
                request_id,
                current.artifact_id,
                ReaderAdjacentDirection::Next,
            ))
            .expect("adjacent page");
        actual.push(single_page_text(&next));
        session
            .release_artifact(current.artifact_id)
            .expect("previous artifact releases");
        current = next;
    }
    for text in &actual {
        assert!(
            !text.contains("plate one"),
            "alt text in the flow means the image laid out as the broken-image placeholder: {text:?}"
        );
    }
    assert_eq!(actual, expected);
}

#[test]
fn an_open_locator_with_a_dead_source_point_degrades_to_progression() {
    // A persisted reading position can name content that no longer lays
    // out — a position saved on a broken-image placeholder's alt run
    // carries the image's node path, which owns no text span. Opening
    // with such a locator must fall back to its progression instead of
    // refusing to open the book.
    let publication = crate::runtime::tests::fixture::image_plates_before_text_fixture_epub();
    let mut session = open_test_session(141, publication).expect("reader session");
    let mut open = request(141, 1, "chapter.xhtml");
    open.locator.source_point = Some(ReaderSourcePoint {
        node_path: vec![0],
        text_offset: 0,
    });
    open.locator.progression = Some(1.0);
    let artifact = session
        .request_artifact(open)
        .expect("open degrades past the dead source point");
    assert_eq!(artifact.matched_by, ReaderLocatorMatch::Progression);
    assert!(
        artifact.local_page_index > 0,
        "progression 1.0 must land past the chapter start"
    );
}

#[test]
fn an_open_locator_with_only_a_dead_selector_degrades_to_the_chapter_start() {
    let publication = crate::runtime::tests::fixture::image_plates_before_text_fixture_epub();
    let mut session = open_test_session(142, publication).expect("reader session");
    let mut open = request(142, 1, "chapter.xhtml");
    open.locator.source_point = Some(ReaderSourcePoint {
        node_path: vec![97, 3],
        text_offset: 12,
    });
    let artifact = session
        .request_artifact(open)
        .expect("open degrades to the chapter itself");
    assert_eq!(artifact.matched_by, ReaderLocatorMatch::Href);
    assert_eq!(artifact.local_page_index, 0);
}

#[test]
fn an_open_locator_with_an_unknown_href_still_fails() {
    // The fallback ladder stops at the chapter: a missing resource is a
    // real error the host must see, not a place to guess.
    let publication = crate::runtime::tests::fixture::image_plates_before_text_fixture_epub();
    let mut session = open_test_session(143, publication).expect("reader session");
    let error = session
        .request_artifact(request(143, 1, "missing.xhtml"))
        .expect_err("an unknown href must stay a hard error");
    assert_eq!(error.kind, ReaderErrorKind::InvalidLocator);
}

#[test]
fn chapter_local_pages_match_the_whole_book_fragment_layout() {
    // The golden equivalence of the chapter-local cutover: the same
    // chapter paginated chapter-locally must produce page-for-page the
    // same text as the whole-book fragment page table.
    let publication = long_chapter_window_fixture_epub();
    let mut reference = RuntimeDocument::open_with_pinned_font_policy(
        &publication,
        crate::runtime::tests::fixture::pinned_test_font_policy(),
    )
    .expect("reference document");
    let reference_revision = reference
        .create_revision(&runtime_layout())
        .expect("full reference layout");
    assert!(
        reference_revision.page_count > 40,
        "generated fixture must exercise at least forty pages"
    );
    let expected = (0..=20)
        .map(|page_index| {
            reference
                .get_page_text_positions(&reference_revision.revision_id, page_index)
                .expect("reference page text")
                .text
        })
        .collect::<Vec<_>>();

    let mut session = open_test_session(101, publication).expect("reader session");
    let mut current = session
        .request_artifact(request(101, 1, "chapter.xhtml"))
        .expect("first page artifact");
    let mut actual = vec![single_page_text(&current)];
    let mut request_id = 1u64;
    for _ in 0..20 {
        request_id += 1;
        let next = session
            .request_adjacent(adjacent(
                101,
                request_id,
                current.artifact_id,
                ReaderAdjacentDirection::Next,
            ))
            .expect("adjacent page");
        actual.push(single_page_text(&next));
        session
            .release_artifact(current.artifact_id)
            .expect("previous artifact releases");
        current = next;
    }
    assert_eq!(actual, expected);
}

#[test]
fn exact_cache_does_not_reuse_an_evicted_revision() {
    // Retained zero-ref revisions are capped; walking far enough away
    // evicts the oldest, and a seek back must relayout instead of
    // resurrecting freed state.
    let mut session = open_test_session(
        125,
        crate::runtime::tests::fixture::many_chapter_fixture_epub(8),
    )
    .expect("reader session");
    let mut current = session
        .request_artifact(request(125, 1, "chapter-0.xhtml"))
        .expect("first chapter resolves");
    let evicted_revision_id = current.revision_id;
    let mut request_id = 1u64;
    while session.has_live_revision(evicted_revision_id) {
        request_id += 1;
        assert!(
            request_id < 64,
            "walking forward must evict the first chapter"
        );
        let next = session
            .request_adjacent(adjacent(
                125,
                request_id,
                current.artifact_id,
                ReaderAdjacentDirection::Next,
            ))
            .expect("adjacent walk crosses chapters");
        session
            .release_artifact(current.artifact_id)
            .expect("old artifact releases");
        current = next;
    }

    let cache_hits = session.exact_cache_hit_count();
    let layout_quanta = session.exact_layout_quantum_count();
    request_id += 1;
    let recovered = session
        .request_artifact(request(125, request_id, "chapter-0.xhtml"))
        .expect("evicted target falls back to a fresh exact revision");

    assert_ne!(recovered.revision_id, evicted_revision_id);
    assert_eq!(session.exact_cache_hit_count(), cache_hits);
    assert!(session.exact_layout_quantum_count() > layout_quanta);
}

#[test]
fn exact_cache_reuses_the_whole_chapter_revision_for_a_repeat_target() {
    // The whole chapter paginates once; a repeat seek to the same
    // target is a pure cache hit with zero further layout.
    let mut session =
        open_test_session(126, long_chapter_window_fixture_epub()).expect("reader session");
    let current = session
        .request_artifact(request(126, 1, "chapter.xhtml#window-point-0"))
        .expect("first exact target resolves");
    let layout_quanta = session.exact_layout_quantum_count();

    let cached = session
        .request_artifact(request(126, 2, "chapter.xhtml#window-point-0"))
        .expect("repeat target resolves from the cached revision");

    assert_eq!(cached.revision_id, current.revision_id);
    assert_eq!(cached.locator.anchor_id.as_deref(), Some("window-point-0"));
    assert_eq!(session.exact_cache_hit_count(), 1);
    assert_eq!(session.exact_layout_quantum_count(), layout_quanta);
}

#[test]
fn exact_tail_locator_resolves_from_the_whole_chapter_revision() {
    let mut session =
        open_test_session(105, long_chapter_window_fixture_epub()).expect("reader session");
    let tail = session
        .request_artifact(request(105, 1, "chapter.xhtml#window-point-519"))
        .expect("tail locator resolves from the one-pass chapter revision");

    assert_eq!(tail.locator.anchor_id.as_deref(), Some("window-point-519"));
    assert!(tail
        .pages
        .iter()
        .any(|page| page.text.contains("Window paragraph 519")));
    assert_eq!(session.live_revision_count(), 1);
}

#[test]
fn protocol_source_has_no_platform_or_dynamic_primary_wire_types() {
    let sources = [
        include_str!("types.rs"),
        include_str!("session.rs"),
        include_str!("artifact.rs"),
        include_str!("publication_info.rs"),
        include_str!("publication_info/validate.rs"),
        include_str!("wire.rs"),
        include_str!("wire/encode/publication.rs"),
        include_str!("wire/decode/publication.rs"),
    ]
    .join("\n");
    for forbidden in [
        "serde_json",
        "serde::",
        "#[serde",
        "JsValue",
        "Canvas",
        "Worker",
        "WebView",
        "Flutter",
        "dart:",
        "Dom",
    ] {
        assert!(
            !sources.contains(forbidden),
            "the reader protocol must not contain {forbidden}"
        );
    }
    assert!(!include_str!("types.rs").contains("usize"));
}

fn request(session_id: u64, request_id: u64, href: &str) -> ReaderArtifactRequest {
    ReaderArtifactRequest {
        session_id,
        request_id,
        layout: ReaderLayout {
            render_ratio: 1.0,
            viewport_width: 420.0,
            viewport_height: 640.0,
            margin_top: 24.0,
            margin_right: 24.0,
            margin_bottom: 24.0,
            margin_left: 24.0,
            spread_mode: ReaderSpreadMode::Single,
            first_page_alone: true,
            spread_gap: 0.0,
            root_font_size: 16.0,
            line_height_override: None,
            font_family_override: None,
        },
        locator: ReaderLocator {
            href: href.to_owned(),
            anchor_id: None,
            source_point: None,
            source_range: None,
            progression: None,
        },
        text_profile: ReaderTextRenderingProfile::PlatformStringRuns,
    }
}

fn adjacent(
    session_id: u64,
    request_id: u64,
    from_artifact_id: u64,
    direction: ReaderAdjacentDirection,
) -> ReaderAdjacentRequest {
    ReaderAdjacentRequest {
        session_id,
        request_id,
        from_artifact_id,
        direction,
    }
}

fn adopt_initial(
    session: &mut ReaderSession,
    session_id: u64,
    candidate_artifact_id: u64,
) -> ReaderForegroundHandoffAck {
    session
        .adopt_foreground_candidate(ReaderForegroundHandoff {
            session_id,
            expected_visible_artifact_id: None,
            candidate_artifact_id,
        })
        .expect("initial foreground candidate adopts")
}

fn adopt_replacement(
    session: &mut ReaderSession,
    session_id: u64,
    expected_visible_artifact_id: u64,
    candidate_artifact_id: u64,
) -> ReaderForegroundHandoffAck {
    session
        .adopt_foreground_candidate(ReaderForegroundHandoff {
            session_id,
            expected_visible_artifact_id: Some(expected_visible_artifact_id),
            candidate_artifact_id,
        })
        .expect("replacement foreground candidate adopts")
}

fn single_page_text(artifact: &ReaderArtifact) -> String {
    assert_eq!(artifact.pages.len(), 1);
    artifact.pages[0].text.clone()
}

#[test]
fn previous_chapter_tail_publishes_when_the_chapter_completes_within_budget() {
    use crate::runtime::tests::fixture::short_previous_chapter_fixture_epub;
    for tail in [
        "text",
        "trailing-image",
        "image-only",
        "hidden-tail",
        "ruby-tail",
        "svg-image",
        "empty-tail",
    ] {
        let mut session = open_test_session(97, short_previous_chapter_fixture_epub(tail))
            .expect("reader session opens");
        let visible = session
            .request_artifact(request(97, 1, "chapter-1.xhtml"))
            .expect("source chapter resolves");
        adopt_initial(&mut session, 97, visible.artifact_id);
        let mut prev = adjacent(
            97,
            2,
            visible.artifact_id,
            ReaderAdjacentDirection::Previous,
        );
        let mut resolved = None;
        for request_id in 2..=64 {
            prev.request_id = request_id;
            match session.request_adjacent(prev) {
                Ok(artifact) => {
                    resolved = Some(artifact);
                    break;
                }
                Err(error) => {
                    assert_eq!(
                        error.kind,
                        ReaderErrorKind::TargetNotPublished,
                        "tail={tail}: unexpected error: {error:?}"
                    );
                    assert!(
                        session.has_pending_adjacent(),
                        "tail={tail}: previous-tail request became terminal: {error:?}"
                    );
                }
            }
        }
        let resolved =
            resolved.unwrap_or_else(|| panic!("tail={tail}: previous chapter tail never resolves"));
        assert_eq!(resolved.locator.href, "chapter-0.xhtml", "tail={tail}");
    }
}

#[test]
fn peek_publishes_known_neighbors_without_foreground_side_effects() {
    let mut session =
        open_test_session(120, long_chapter_window_fixture_epub()).expect("reader session opens");
    let visible = session
        .request_artifact(request(120, 1, ""))
        .expect("source chapter resolves");
    adopt_initial(&mut session, 120, visible.artifact_id);
    let next = session
        .request_adjacent(adjacent(
            120,
            2,
            visible.artifact_id,
            ReaderAdjacentDirection::Next,
        ))
        .expect("in-chapter next resolves");
    adopt_replacement(&mut session, 120, visible.artifact_id, next.artifact_id);

    // Peek previous from the second spread, and peek next from the
    // retained first-spread artifact (its neighbor is already laid out).
    let peeked_previous = session
        .peek_adjacent(adjacent(
            120,
            10,
            next.artifact_id,
            ReaderAdjacentDirection::Previous,
        ))
        .expect("previous spread peeks");
    assert_eq!(
        peeked_previous.local_page_index, visible.local_page_index,
        "previous peek republishes the already-laid-out spread"
    );
    let peeked_next = session
        .peek_adjacent(adjacent(
            120,
            11,
            visible.artifact_id,
            ReaderAdjacentDirection::Next,
        ))
        .expect("next spread peeks");
    assert_eq!(peeked_next.local_page_index, next.local_page_index);
    // An unpaginated in-chapter neighbor paginates within the peek's
    // own budget — shared revision progress, not a foreground effect.
    let paginated_ahead = session
        .peek_adjacent(adjacent(
            120,
            12,
            next.artifact_id,
            ReaderAdjacentDirection::Next,
        ))
        .expect("in-chapter peek paginates its neighbor");
    assert_eq!(
        paginated_ahead.local_spread_index,
        next.local_spread_index + 1
    );

    // No foreground side effects: visible unchanged, nothing pending.
    assert_eq!(session.visible_artifact_id(), Some(next.artifact_id));
    assert!(!session.has_pending_adjacent());

    // Peeked artifacts are live and releasable like any other artifact.
    assert!(session.has_live_artifact(peeked_previous.artifact_id));
    session
        .release_artifact(peeked_previous.artifact_id)
        .expect("peeked artifact releases");
    session
        .release_artifact(peeked_next.artifact_id)
        .expect("peeked artifact releases");
    session
        .release_artifact(paginated_ahead.artifact_id)
        .expect("peeked artifact releases");
    assert_eq!(session.visible_artifact_id(), Some(next.artifact_id));
}

#[test]
fn peek_declines_at_the_terminal_publication_boundary() {
    let mut session =
        open_test_session(121, long_chapter_window_fixture_epub()).expect("reader session opens");
    let visible = session
        .request_artifact(request(121, 1, ""))
        .expect("first chapter resolves");
    adopt_initial(&mut session, 121, visible.artifact_id);

    // Previous from the first spread of the first chapter is the
    // publication's terminal boundary, so the peek declines.
    let boundary = session
        .peek_adjacent(adjacent(
            121,
            5,
            visible.artifact_id,
            ReaderAdjacentDirection::Previous,
        ))
        .expect_err("boundary peek declines");
    assert_eq!(boundary.kind, ReaderErrorKind::TargetNotPublished);
    assert!(!session.has_pending_adjacent());
    assert_eq!(session.visible_artifact_id(), Some(visible.artifact_id));
}

#[test]
fn commit_peeked_artifact_is_a_pure_visible_swap() {
    let mut session =
        open_test_session(122, long_chapter_window_fixture_epub()).expect("reader session opens");
    let visible = session
        .request_artifact(request(122, 1, ""))
        .expect("source chapter resolves");
    adopt_initial(&mut session, 122, visible.artifact_id);
    let second = session
        .request_adjacent(adjacent(
            122,
            2,
            visible.artifact_id,
            ReaderAdjacentDirection::Next,
        ))
        .expect("in-chapter next resolves");
    adopt_replacement(&mut session, 122, visible.artifact_id, second.artifact_id);
    let peeked = session
        .peek_adjacent(adjacent(
            122,
            3,
            second.artifact_id,
            ReaderAdjacentDirection::Previous,
        ))
        .expect("previous spread peeks");

    let ack = session
        .commit_peeked_artifact(ReaderForegroundHandoff {
            session_id: 122,
            expected_visible_artifact_id: Some(second.artifact_id),
            candidate_artifact_id: peeked.artifact_id,
        })
        .expect("peeked artifact commits");
    assert_eq!(ack.replaced_artifact_id, Some(second.artifact_id));
    assert_eq!(ack.visible_artifact_id, peeked.artifact_id);
    assert_eq!(session.visible_artifact_id(), Some(peeked.artifact_id));

    // A second commit of the same artifact is rejected: it left the
    // peeked set on adoption.
    let replay = session
        .commit_peeked_artifact(ReaderForegroundHandoff {
            session_id: 122,
            expected_visible_artifact_id: Some(peeked.artifact_id),
            candidate_artifact_id: peeked.artifact_id,
        })
        .expect_err("peeked commit does not replay");
    assert_eq!(replay.kind, ReaderErrorKind::InvalidRequest);

    // Non-peeked artifacts cannot take the fast path.
    let denied = session
        .commit_peeked_artifact(ReaderForegroundHandoff {
            session_id: 122,
            expected_visible_artifact_id: Some(peeked.artifact_id),
            candidate_artifact_id: visible.artifact_id,
        })
        .expect_err("ordinary artifacts cannot fast-commit");
    assert_eq!(denied.kind, ReaderErrorKind::InvalidRequest);

    // Stale CAS is rejected.
    let peeked_again = session
        .peek_adjacent(adjacent(
            122,
            4,
            peeked.artifact_id,
            ReaderAdjacentDirection::Next,
        ))
        .expect("next spread peeks");
    let stale = session
        .commit_peeked_artifact(ReaderForegroundHandoff {
            session_id: 122,
            expected_visible_artifact_id: Some(second.artifact_id),
            candidate_artifact_id: peeked_again.artifact_id,
        })
        .expect_err("stale expected-visible is rejected");
    assert_eq!(stale.kind, ReaderErrorKind::StaleRequest);
}

#[test]
fn peek_crosses_single_page_chapter_boundaries_in_both_directions() {
    use crate::runtime::tests::fixture::many_chapter_fixture_epub;
    // The acceptance scenario: front matter made of single-page
    // chapters (image plates). Every drag-open must be able to peek its
    // neighbor — next peeks the following chapter's first spread,
    // previous the preceding chapter's last — and the turn fast path
    // commits the peeked artifact unchanged.
    let mut session =
        open_test_session(123, many_chapter_fixture_epub(4)).expect("reader session opens");
    let visible = session
        .request_artifact(request(123, 1, "chapter-0.xhtml"))
        .expect("first chapter resolves");
    adopt_initial(&mut session, 123, visible.artifact_id);

    let mut current = visible;
    let mut request_id = 10;
    for chapter in 1..4 {
        let peeked = session
            .peek_adjacent(adjacent(
                123,
                request_id,
                current.artifact_id,
                ReaderAdjacentDirection::Next,
            ))
            .unwrap_or_else(|error| panic!("chapter {chapter} peeks next: {error:?}"));
        request_id += 1;
        assert_eq!(peeked.locator.href, format!("chapter-{chapter}.xhtml"));
        assert_eq!(session.visible_artifact_id(), Some(current.artifact_id));
        assert!(!session.has_pending_adjacent());
        session
            .commit_peeked_artifact(ReaderForegroundHandoff {
                session_id: 123,
                expected_visible_artifact_id: Some(current.artifact_id),
                candidate_artifact_id: peeked.artifact_id,
            })
            .expect("peeked chapter commits");
        session
            .release_artifact(current.artifact_id)
            .expect("outgoing spread releases");
        current = peeked;
    }

    for chapter in (0..3).rev() {
        let peeked = session
            .peek_adjacent(adjacent(
                123,
                request_id,
                current.artifact_id,
                ReaderAdjacentDirection::Previous,
            ))
            .unwrap_or_else(|error| panic!("chapter {chapter} peeks previous: {error:?}"));
        request_id += 1;
        assert_eq!(peeked.locator.href, format!("chapter-{chapter}.xhtml"));
        session
            .commit_peeked_artifact(ReaderForegroundHandoff {
                session_id: 123,
                expected_visible_artifact_id: Some(current.artifact_id),
                candidate_artifact_id: peeked.artifact_id,
            })
            .expect("peeked chapter commits");
        session
            .release_artifact(current.artifact_id)
            .expect("outgoing spread releases");
        current = peeked;
    }

    // Terminal book boundary still declines without leaving state.
    let boundary = session
        .peek_adjacent(adjacent(
            123,
            request_id,
            current.artifact_id,
            ReaderAdjacentDirection::Previous,
        ))
        .expect_err("terminal boundary peek declines");
    assert_eq!(boundary.kind, ReaderErrorKind::TargetNotPublished);
    assert_eq!(session.visible_artifact_id(), Some(current.artifact_id));
}

#[test]
fn artifact_hits_carry_footnote_keys_that_read_back_directly() {
    use crate::runtime::tests::fixture::interaction_target_fixture_epub;
    let mut session =
        open_test_session(130, interaction_target_fixture_epub()).expect("reader session opens");
    let visible = session
        .request_artifact(request(130, 1, ""))
        .expect("first chapter resolves");

    let hits = visible
        .pages
        .iter()
        .flat_map(|page| page.hits.iter())
        .collect::<Vec<_>>();
    let noteref = hits
        .iter()
        .find(|hit| hit.footnote_key.is_some())
        .expect("the noteref hit carries a footnote key");
    // A plain internal link on the same page must NOT be classified as
    // a footnote, or hosts would open popups for ordinary links.
    assert!(
        hits.iter()
            .any(|hit| hit.href.is_some() && hit.footnote_key.is_none()),
        "ordinary links must stay unclassified: {hits:?}"
    );
    assert!(!noteref.footnote_pending, "{noteref:?}");
    let key = noteref.footnote_key.clone().expect("key");
    assert!(
        key.contains('#'),
        "the key is the canonical href#fragment form: {key}"
    );

    // The host passes the key back verbatim — no normalization.
    let footnote = session
        .read_footnote(visible.artifact_id, &key)
        .expect("footnote reads back");
    assert_eq!(footnote.key, key);
    assert_eq!(footnote.kind, ReaderFootnoteKind::Footnote);
    assert!(footnote.text.contains("Runtime note"), "{footnote:?}");
    assert!(footnote.html.contains("Runtime note"), "{footnote:?}");

    let unknown = session
        .read_footnote(visible.artifact_id, "Text/nope.xhtml#missing")
        .expect_err("unknown keys do not resolve");
    assert_eq!(unknown.kind, ReaderErrorKind::TargetNotPublished);
}

#[test]
fn chapter_local_artifacts_have_no_book_page_numbering() {
    let mut session =
        open_test_session(131, long_chapter_window_fixture_epub()).expect("reader session opens");
    let visible = session
        .request_artifact(request(131, 1, ""))
        .expect("first chapter resolves");
    // A window ordinal restarts at every rollover, so publishing it as
    // a book page number would be a lie. The field stays absent.
    assert_eq!(visible.book_page_index, None);
    assert_eq!(visible.book_page_count, None);
}

#[test]
fn artifact_hits_share_the_display_list_coordinate_space() {
    use crate::runtime::tests::fixture::interaction_target_fixture_epub;
    // A host hit-tests against the pixels it painted. If the artifact's
    // hits and its display list disagree by the page margins, every tap
    // lands short — which is exactly what shipped before this test.
    //
    // Fragment paint commands carry no hrefs (link hotspots live only in
    // the artifact hits), so the painted reference is the text-run
    // origins of the link labels, from a fragment-engine reference
    // revision of the same book.
    for (label, layout) in [
        ("single", crate::runtime::tests::fixture::layout()),
        ("double", crate::runtime::tests::fixture::double_layout()),
    ] {
        let mut document = crate::runtime::RuntimeDocument::open_with_pinned_font_policy(
            &interaction_target_fixture_epub(),
            crate::runtime::tests::fixture::pinned_test_font_policy(),
        )
        .expect("document opens");
        let summary = document.create_revision(&layout).expect("revision");
        let frame = document
            .frame_commands_for_tests(&summary.revision_id, 0)
            .expect("frame publishes");
        let mut painted: std::collections::BTreeMap<String, Vec<(f64, f64)>> =
            std::collections::BTreeMap::new();
        for command in &frame.commands {
            let (crate::render::DisplayCommand::PaintText(input)
            | crate::render::DisplayCommand::PaintRuby(input)) = command
            else {
                continue;
            };
            painted
                .entry(input.text.clone())
                .or_default()
                .push((input.rect.x, input.rect.y));
        }
        assert!(!painted.is_empty(), "{label}: fixture must paint text");

        let mut session = open_test_session(150, interaction_target_fixture_epub())
            .expect("reader session opens");
        let artifact = session
            .request_artifact(ReaderArtifactRequest {
                layout: reader_layout(&layout),
                ..request(150, 1, "")
            })
            .expect("artifact resolves");
        // The fixture's text links and their labels.
        let link_labels = [
            ("#intro", "internal"),
            ("https://example.com/help#reader", "external"),
        ];
        let mut checked = 0;
        for (href, label_text) in link_labels {
            let origins = painted
                .get(label_text)
                .unwrap_or_else(|| panic!("{label}: label {label_text:?} is never painted"));
            let matched = artifact
                .pages
                .iter()
                .flat_map(|page| page.hits.iter())
                .filter(|hit| hit.href.as_deref() == Some(href))
                .any(|hit| {
                    origins.iter().any(|(x, y)| {
                        // Same inline start; the text run's rect top sits
                        // inside the link's line box, so y agrees to the
                        // half-leading, not exactly.
                        (x - hit.bounds.x).abs() < 0.01 && (y - hit.bounds.y).abs() < 4.0
                    })
                });
            assert!(
                matched,
                "{label}: no hit for {href:?} matches its painted label at {origins:?}"
            );
            checked += 1;
        }
        assert!(checked > 0, "{label}: the fixture must publish link hits");
        for hit in artifact.pages.iter().flat_map(|page| page.hits.iter()) {
            assert!(
                hit.bounds.x >= layout.margin_left && hit.bounds.y >= layout.margin_top,
                "{label}: hits sit inside the page margins, not at the page corner"
            );
        }
    }
}

#[test]
fn double_spread_hits_carry_their_page_offset() {
    // The right-hand page of a spread is translated by the display list;
    // its hits must carry the same translation or every tap on the right
    // page resolves against the left page's geometry.
    let layout = crate::runtime::tests::fixture::double_layout();
    let mut session = open_test_session(
        151,
        crate::runtime::tests::fixture::long_source_text_fixture_epub(),
    )
    .expect("reader session opens");
    let artifact = session
        .request_artifact(ReaderArtifactRequest {
            layout: reader_layout(&layout),
            ..request(151, 1, "")
        })
        .expect("artifact resolves");
    assert_eq!(
        artifact.pages.len(),
        2,
        "the fixture must fill a double spread: {:?}",
        artifact.local_page_indexes
    );
    let right_origin = layout.page_width + layout.spread_gap + layout.margin_left;
    for hit in &artifact.pages[1].hits {
        assert!(
            hit.bounds.x >= right_origin,
            "right-page hit {:?} must sit past {right_origin}",
            hit.bounds
        );
    }
    for node in &artifact.pages[1].semantics {
        assert!(node.bounds.x >= right_origin, "{node:?}");
    }
}

fn reader_layout(config: &crate::layout::LayoutConfig) -> ReaderLayout {
    ReaderLayout {
        render_ratio: 1.0,
        viewport_width: config.viewport_width,
        viewport_height: config.viewport_height,
        margin_top: config.margin_top,
        margin_right: config.margin_right,
        margin_bottom: config.margin_bottom,
        margin_left: config.margin_left,
        spread_mode: match config.spread_mode {
            crate::layout::SpreadMode::Single => ReaderSpreadMode::Single,
            crate::layout::SpreadMode::Double => ReaderSpreadMode::Double,
        },
        first_page_alone: config.first_page_alone,
        spread_gap: config.spread_gap,
        root_font_size: config.root_font_size,
        line_height_override: config.line_height_override,
        font_family_override: config.font_family_override.clone(),
    }
}

#[test]
fn text_range_geometry_lands_in_display_list_space() {
    let mut session = open_test_session(160, crate::runtime::tests::fixture::fixture_epub())
        .expect("reader session opens");
    let artifact = session
        .request_artifact(request(160, 1, ""))
        .expect("artifact resolves");
    let page = artifact.pages.first().expect("a page");
    let run = page.text_runs.first().copied().expect("a text run");

    let geometry = session
        .get_text_range_geometry(ReaderTextRangeRequest {
            session_id: 160,
            artifact_id: artifact.artifact_id,
            page_index: page.page_index,
            start: ReaderTextPosition {
                block_index: run.block_index,
                line_index: run.line_index,
                run_index: run.run_index,
                char_index: 0,
            },
            end: ReaderTextPosition {
                block_index: run.block_index,
                line_index: run.line_index,
                run_index: run.run_index,
                char_index: 1,
            },
        })
        .expect("the first run resolves geometry");
    assert_eq!(geometry.artifact_id, artifact.artifact_id);
    assert!(!geometry.rects.is_empty());

    // Highlights are painted onto the same surface the display list
    // drew, so the rect must carry the page origin like a hit does.
    let layout = crate::runtime::tests::fixture::layout();
    for rect in &geometry.rects {
        assert!(
            rect.bounds.x >= layout.margin_left && rect.bounds.y >= layout.margin_top,
            "geometry must be display-list space, not content-box: {rect:?}"
        );
    }

    // A range no page holds is a typed failure, not a panic.
    let missing = session
        .get_text_range_geometry(ReaderTextRangeRequest {
            session_id: 160,
            artifact_id: artifact.artifact_id,
            page_index: page.page_index,
            start: ReaderTextPosition {
                block_index: 9_999,
                line_index: 0,
                run_index: 0,
                char_index: 0,
            },
            end: ReaderTextPosition {
                block_index: 9_999,
                line_index: 0,
                run_index: 0,
                char_index: 1,
            },
        })
        .expect_err("an unknown range fails");
    assert_eq!(missing.kind, ReaderErrorKind::EngineFailure);
}

#[test]
fn search_hits_feed_straight_into_text_geometry() {
    let mut session = open_test_session(170, crate::runtime::tests::fixture::fixture_epub())
        .expect("reader session opens");
    let artifact = session
        .request_artifact(request(170, 1, ""))
        .expect("artifact resolves");
    // Take a word the fixture actually renders, straight off the page.
    let page = artifact.pages.first().expect("a page");
    let needle = page
        .text
        .split_whitespace()
        .find(|word| word.chars().count() >= 3)
        .expect("the fixture page has a word")
        .to_owned();

    let response = session
        .search(ReaderSearchRequest {
            session_id: 170,
            artifact_id: artifact.artifact_id,
            query: needle.clone(),
            case_sensitive: false,
            whole_word: false,
            limit: 8,
        })
        .expect("search runs");
    assert_eq!(response.artifact_id, artifact.artifact_id);
    assert_eq!(response.query, needle);
    let hit = response.results.first().expect("the word is found");
    assert!(hit.context.contains(&needle), "{hit:?}");
    // A durable anchor is what a host stores; page indexes move.
    assert!(
        hit.locator.is_some(),
        "a text hit must carry a storable locator: {hit:?}"
    );

    // The whole point of the positions: they resolve to paintable
    // geometry without the host inventing coordinates.
    let geometry = session
        .get_text_range_geometry(ReaderTextRangeRequest {
            session_id: 170,
            artifact_id: artifact.artifact_id,
            page_index: hit.page_index,
            start: hit.start,
            end: hit.end,
        })
        .expect("a hit resolves to geometry");
    assert!(!geometry.rects.is_empty());

    // A limit is honoured and reported rather than silently applied.
    let capped = session
        .search(ReaderSearchRequest {
            session_id: 170,
            artifact_id: artifact.artifact_id,
            query: "e".to_owned(),
            case_sensitive: false,
            whole_word: false,
            limit: 1,
        })
        .expect("capped search runs");
    assert!(capped.results.len() <= 1);
    if capped.truncated {
        assert_eq!(capped.results.len(), 1);
    }

    let empty = session
        .search(ReaderSearchRequest {
            session_id: 170,
            artifact_id: artifact.artifact_id,
            query: String::new(),
            case_sensitive: false,
            whole_word: false,
            limit: 8,
        })
        .expect_err("an empty query is rejected");
    assert_eq!(empty.kind, ReaderErrorKind::InvalidRequest);
}

#[test]
fn every_kitchen_sink_page_survives_display_list_encoding() {
    // Artifact publication encodes each spread's fragment commands into
    // the V1 wire; a value outside the encoder's domain fails the whole
    // session ("<field> is not representable by the reader protocol"). Walk
    // every page of a style-heavy chapter so the full command stream
    // crosses the encoder.
    let mut session = open_test_session(
        163,
        crate::runtime::tests::fixture::paint_command_kitchen_sink_fixture_epub(),
    )
    .expect("reader session opens");
    let mut current = session
        .request_artifact(request(163, 1, "chapter.xhtml"))
        .expect("first styled page encodes");
    let mut request_id = 1u64;
    while current.navigation.next == ReaderAdjacentAvailability::Available {
        request_id += 1;
        let next = session
            .request_adjacent(adjacent(
                163,
                request_id,
                current.artifact_id,
                ReaderAdjacentDirection::Next,
            ))
            .expect("every styled page encodes");
        session
            .release_artifact(current.artifact_id)
            .expect("previous page releases");
        current = next;
    }
}

#[test]
fn selection_geometry_spans_the_font_grid_box() {
    // Chromium's native selection rect spans the font box (the serving
    // font's whole-pixel ascent and descent), not the declared line box:
    // Tinos at 32px is 29 + 7 = 36 tall on a 48px fixed line-height.
    let chapter: &[u8] = br#"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p class="sel">HELLO GRID WORLD</p></body></html>"#;
    let epub = crate::runtime::tests::fixture::fixture_epub_with_chapter_and_stylesheet(
        chapter,
        ".sel { font-size: 32px; line-height: 48px; }",
    );
    let mut session = open_test_session(164, epub).expect("reader session opens");
    let artifact = session
        .request_artifact(request(164, 1, ""))
        .expect("artifact resolves");
    let page = artifact.pages.first().expect("a page");
    let run = page.text_runs.first().copied().expect("a text run");
    let geometry = session
        .get_text_range_geometry(ReaderTextRangeRequest {
            session_id: 164,
            artifact_id: artifact.artifact_id,
            page_index: page.page_index,
            start: ReaderTextPosition {
                block_index: run.block_index,
                line_index: run.line_index,
                run_index: run.run_index,
                char_index: 0,
            },
            end: ReaderTextPosition {
                block_index: run.block_index,
                line_index: run.line_index,
                run_index: run.run_index,
                char_index: 5,
            },
        })
        .expect("range resolves geometry");
    let height = geometry.rects.first().expect("a rect").bounds.height;
    assert!(
        (height - 36.0).abs() < 1e-9,
        "the rect spans the font box (29 + 7), got {height}"
    );
}

#[test]
fn a_render_ratio_change_repaints_without_a_new_revision() {
    let mut session = open_test_session(166, crate::runtime::tests::fixture::fixture_epub())
        .expect("reader session opens");
    let at_one = session
        .request_artifact(request(166, 1, ""))
        .expect("artifact at ratio 1");
    // The ratio rides the request's layout record: the host says what
    // grid it rasterizes at with every artifact it asks for.
    let mut on_finer_grid = request(166, 2, "");
    on_finer_grid.layout.render_ratio = 2.0;
    let at_two = session
        .request_artifact(on_finer_grid)
        .expect("artifact at ratio 2");
    assert_eq!(
        session.render_ratio(),
        2.0,
        "the layout's ratio becomes the session's"
    );
    assert_eq!(
        at_one.revision_id, at_two.revision_id,
        "a ratio change never re-paginates"
    );
    assert_ne!(at_one.artifact_id, at_two.artifact_id);
    assert_ne!(
        at_one.display_list.semantic_digest, at_two.display_list.semantic_digest,
        "the ratio-2 display list snaps on the finer grid"
    );
    for ratio in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        let error = session
            .set_render_ratio(ratio)
            .expect_err("a non-positive or non-finite ratio fails closed");
        assert_eq!(error.kind, ReaderErrorKind::InvalidRequest);
    }
    assert_eq!(
        session.render_ratio(),
        2.0,
        "a rejected ratio leaves the current one"
    );
}

/// The source-locator fixture's chapter is 48 `<p id="point-N">`
/// paragraphs, so `[n, 0]` is paragraph n's text node — the same
/// addressing a host stores when a reader saves a highlight.
const FIXTURE_CHAPTER_HREF: &str = "chapter.xhtml";

fn fixture_source_range(paragraph: usize, start: u64, end: u64) -> ReaderSourceRange {
    ReaderSourceRange {
        start: ReaderSourcePoint {
            node_path: vec![paragraph as u32, 0],
            text_offset: start,
        },
        end: ReaderSourcePoint {
            node_path: vec![paragraph as u32, 0],
            text_offset: end,
        },
    }
}

#[test]
fn exact_source_range_projects_a_durable_anchor_into_display_list_space() {
    let mut session =
        open_test_session(161, source_locator_fixture_epub()).expect("reader session opens");
    let artifact = session
        .request_artifact(request(161, 1, ""))
        .expect("artifact resolves");

    let resolution = session
        .resolve_exact_source_range(ReaderExactSourceRangeRequest {
            session_id: 161,
            artifact_id: artifact.artifact_id,
            href: FIXTURE_CHAPTER_HREF.to_owned(),
            range: fixture_source_range(0, 0, 15),
        })
        .expect("a range in the first paragraph resolves");

    assert_eq!(resolution.artifact_id, artifact.artifact_id);
    assert_eq!(resolution.status, ReaderExactSourceRangeStatus::Resolved);
    assert_eq!(resolution.selected_text, "Source locator ");
    assert_eq!(resolution.first_page_index, Some(0));
    assert!(
        !resolution.rects.is_empty(),
        "paragraph 0 is on the page this artifact draws"
    );

    // A stored highlight is painted onto the surface the display list
    // drew, so the rects carry the page origin exactly like hits do.
    let layout = crate::runtime::tests::fixture::layout();
    for rect in &resolution.rects {
        assert!(
            rect.bounds.x >= layout.margin_left && rect.bounds.y >= layout.margin_top,
            "geometry must be display-list space, not content-box: {rect:?}"
        );
        assert!(rect.end_char_index > rect.start_char_index);
    }
}

#[test]
fn exact_source_range_answers_for_a_page_this_artifact_does_not_draw() {
    let mut session =
        open_test_session(163, source_locator_fixture_epub()).expect("reader session opens");
    let artifact = session
        .request_artifact(request(163, 1, ""))
        .expect("artifact resolves");
    let drawn = artifact.local_page_indexes.clone();

    // The last paragraph is far past the opened page. The range still
    // resolves — the host learns which page to navigate to — but this
    // artifact has no geometry to paint it with.
    let resolution = session
        .resolve_exact_source_range(ReaderExactSourceRangeRequest {
            session_id: 163,
            artifact_id: artifact.artifact_id,
            href: FIXTURE_CHAPTER_HREF.to_owned(),
            range: fixture_source_range(47, 0, 15),
        })
        .expect("a range later in the chapter resolves");

    assert_eq!(resolution.status, ReaderExactSourceRangeStatus::Resolved);
    let first_page = resolution
        .first_page_index
        .expect("a resolved range reports where it starts");
    assert!(
        !drawn.contains(&first_page),
        "the fixture's last paragraph must not share the opened page"
    );
    assert!(
        resolution.rects.is_empty(),
        "rects are display-list space and only exist for pages this artifact draws"
    );
}

#[test]
fn exact_source_range_reports_a_stale_anchor_instead_of_painting_over_it() {
    let mut session =
        open_test_session(162, source_locator_fixture_epub()).expect("reader session opens");
    let artifact = session
        .request_artifact(request(162, 1, ""))
        .expect("artifact resolves");

    // A node path the chapter does not have cannot project, and the
    // engine says so rather than guessing a nearby run.
    let missing = session
        .resolve_exact_source_range(ReaderExactSourceRangeRequest {
            session_id: 162,
            artifact_id: artifact.artifact_id,
            href: FIXTURE_CHAPTER_HREF.to_owned(),
            range: fixture_source_range(9_999, 0, 4),
        })
        .expect_err("a node path outside the chapter fails");
    assert_eq!(missing.kind, ReaderErrorKind::EngineFailure);

    // A resource the publication does not hold is the same story.
    let unknown_href = session
        .resolve_exact_source_range(ReaderExactSourceRangeRequest {
            session_id: 162,
            artifact_id: artifact.artifact_id,
            href: "not-in-the-manifest.xhtml".to_owned(),
            range: fixture_source_range(0, 0, 4),
        })
        .expect_err("an unknown href fails");
    assert_eq!(unknown_href.kind, ReaderErrorKind::EngineFailure);
}
