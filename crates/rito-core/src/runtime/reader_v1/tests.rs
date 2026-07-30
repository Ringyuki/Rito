use crate::runtime::{
    tests::fixture::{
        layout as runtime_layout, long_chapter_window_fixture_epub, multi_chapter_fixture_epub,
        multi_chapter_image_fixture_epub, retained_adjacent_fixture_epub,
        source_locator_fixture_epub, source_locator_image_fixture_epub,
    },
    RuntimeDocument,
};

use super::{publication::ReaderRevisionBackingV1, session::READER_LIVE_ARTIFACT_CAP_V1, *};

#[test]
fn session_exposes_one_static_publication_snapshot() {
    let session = ReaderSessionV1::open_owned(39, multi_chapter_fixture_epub())
        .expect("reader session opens");
    let publication = session.publication_v1();

    assert_eq!(publication.session_id, 39);
    assert_eq!(publication.metadata.title, "Runtime document");
    assert_eq!(publication.metadata.identifier, "runtime");
    assert_eq!(publication.spine.len(), 3);
    assert_eq!(publication.toc.len(), 3);
    assert_eq!(publication.toc[1].toc_id, 1);
    assert_eq!(publication.toc[1].children[0].toc_id, 2);
    match &publication.toc[1].children[0].target {
        ReaderPublicationTocTargetV1::Locator {
            spine_index,
            locator,
        } => {
            assert_eq!(*spine_index, 1);
            assert_eq!(locator.href, "chapter-2.xhtml");
            assert_eq!(locator.anchor_id.as_deref(), Some("missing"));
        }
        target => panic!("expected canonical TOC locator, got {target:?}"),
    }

    let wire = encode_reader_publication_v1(publication).expect("publication encodes");
    assert_eq!(&wire[..8], b"RITOPUB1");
    assert_eq!(
        decode_reader_publication_v1(&wire).as_ref(),
        Ok(publication)
    );
}

#[test]
fn an_empty_href_opens_the_book_at_its_first_linear_chapter() {
    let mut session = ReaderSessionV1::open_owned(53, multi_chapter_fixture_epub())
        .expect("reader session opens");
    let first_spine_href = session.publication_v1().spine[0].href.clone();

    let artifact = session
        .request_artifact(request(53, 1, ""))
        .expect("a start-of-book locator resolves");

    assert_eq!(artifact.locator.href, first_spine_href);
    assert_eq!(artifact.local_page_index, 0);
}

#[test]
fn a_fragment_without_a_path_is_not_a_start_of_book_locator() {
    let mut session = ReaderSessionV1::open_owned(54, multi_chapter_fixture_epub())
        .expect("reader session opens");

    assert!(
        session
            .request_artifact(request(54, 1, "#point-47"))
            .is_err(),
        "a path-less fragment names no chapter"
    );
}

#[test]
fn exact_nonzero_locator_owns_first_artifact_and_lifecycle() {
    let mut session = ReaderSessionV1::open_owned(41, source_locator_fixture_epub())
        .expect("reader session opens");
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

    let encoded = encode_reader_artifact_v1(&artifact).expect("artifact encodes");
    assert_eq!(&encoded[..8], b"RITOART1");
    let decoded = decode_reader_artifact_v1(&encoded).expect("artifact decodes");
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
    let mut session = ReaderSessionV1::open_owned(122, source_locator_fixture_epub())
        .expect("reader session opens");
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
    assert_eq!(cached.matched_by, ReaderLocatorMatchV1::Anchor);
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
    let mut origin_session = ReaderSessionV1::open_owned(127, source_locator_fixture_epub())
        .expect("origin reader session opens");
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

    let mut tail_session = ReaderSessionV1::open_owned(128, source_locator_fixture_epub())
        .expect("tail reader session opens");
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
fn exact_cache_falls_back_for_layout_cap_and_unpublished_target_misses() {
    let mut session = ReaderSessionV1::open_owned(123, source_locator_fixture_epub())
        .expect("reader session opens");
    let first = session
        .request_artifact(request(123, 1, "chapter.xhtml#point-0"))
        .expect("initial exact artifact resolves");
    let mut layout_change = request(123, 2, "chapter.xhtml#point-0");
    layout_change.layout.viewport_width = 360.0;
    let relayout = session
        .request_artifact(layout_change)
        .expect("different layout creates a fresh exact revision");
    let mut cap_change = request(123, 3, "chapter.xhtml#point-0");
    cap_change.work.local_page_cap = 8;
    let recap = session
        .request_artifact(cap_change)
        .expect("different page cap creates a fresh exact revision");
    let quanta_before_miss = session.exact_layout_quantum_count();
    let miss = session
        .request_artifact(request(123, 4, "chapter.xhtml#point-47"))
        .expect("an unpublished exact locator uses the retained exact fallback");

    assert_ne!(relayout.revision_id, first.revision_id);
    assert_ne!(recap.revision_id, first.revision_id);
    assert_ne!(miss.revision_id, first.revision_id);
    assert_eq!(miss.locator.anchor_id.as_deref(), Some("point-47"));
    assert_eq!(session.exact_cache_hit_count(), 0);
    assert!(session.exact_layout_quantum_count() > quanta_before_miss);
}

#[test]
fn rapid_cached_exact_candidates_keep_latest_cas_ownership() {
    let mut session = ReaderSessionV1::open_owned(124, source_locator_fixture_epub())
        .expect("reader session opens");
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
        .adopt_foreground_candidate(ReaderForegroundHandoffV1 {
            session_id: 124,
            expected_visible_artifact_id: Some(visible.artifact_id),
            candidate_artifact_id: stale_candidate.artifact_id,
        })
        .expect_err("superseded cached candidate cannot win CAS");
    assert_eq!(stale.kind, ReaderErrorKindV1::StaleRequest);
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
    let mut session = ReaderSessionV1::open_owned(42, source_locator_fixture_epub())
        .expect("reader session opens");
    let candidate = session
        .request_artifact(request(42, 1, "chapter.xhtml#point-0"))
        .expect("foreground candidate resolves");

    assert!(!session.has_visible_intent());
    assert_eq!(
        session.foreground_candidate_artifact_id(),
        Some(candidate.artifact_id)
    );
    let background = session
        .advance_background_once(ReaderBackgroundRequestV1 {
            session_id: 42,
            expected_visible_artifact_id: candidate.artifact_id,
            max_top_level_nodes_per_quantum: 1,
        })
        .expect_err("background work cannot observe an unadopted candidate");
    assert_eq!(background.kind, ReaderErrorKindV1::InvalidRequest);

    let ack = adopt_initial(&mut session, 42, candidate.artifact_id);
    assert_eq!(ack.intent_request_id, 1);
    assert_eq!(ack.replaced_artifact_id, None);
    assert_eq!(session.visible_artifact_id(), Some(candidate.artifact_id));
    assert_eq!(session.foreground_candidate_artifact_id(), None);
}

#[test]
fn foreground_cas_rejects_stale_expected_visible_without_mutation() {
    let mut session = ReaderSessionV1::open_owned(43, source_locator_fixture_epub())
        .expect("reader session opens");
    let visible = session
        .request_artifact(request(43, 1, "chapter.xhtml#point-0"))
        .expect("initial candidate resolves");
    adopt_initial(&mut session, 43, visible.artifact_id);
    let candidate = session
        .request_artifact(request(43, 2, "chapter.xhtml#point-1"))
        .expect("replacement candidate resolves");

    let stale = session
        .adopt_foreground_candidate(ReaderForegroundHandoffV1 {
            session_id: 43,
            expected_visible_artifact_id: None,
            candidate_artifact_id: candidate.artifact_id,
        })
        .expect_err("replacement cannot use the initial-adoption guard");
    assert_eq!(stale.kind, ReaderErrorKindV1::StaleRequest);
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
    let mut session = ReaderSessionV1::open_owned(44, source_locator_fixture_epub())
        .expect("reader session opens");
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
        .adopt_foreground_candidate(ReaderForegroundHandoffV1 {
            session_id: 44,
            expected_visible_artifact_id: Some(visible.artifact_id),
            candidate_artifact_id: stale_candidate.artifact_id,
        })
        .expect_err("superseded candidate cannot adopt");
    assert_eq!(stale.kind, ReaderErrorKindV1::StaleRequest);
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
        .adopt_foreground_candidate(ReaderForegroundHandoffV1 {
            session_id: 44,
            expected_visible_artifact_id: Some(visible.artifact_id),
            candidate_artifact_id: latest_candidate.artifact_id,
        })
        .expect_err("released candidate is not live enough to adopt");
    assert_eq!(released.kind, ReaderErrorKindV1::UnknownArtifact);
    assert_eq!(session.visible_artifact_id(), Some(visible.artifact_id));
}

#[test]
fn adjacent_and_seek_candidates_adopt_without_releasing_prior_frames() {
    let mut session = ReaderSessionV1::open_owned(45, source_locator_fixture_epub())
        .expect("reader session opens");
    let first = session
        .request_artifact(request(45, 1, "chapter.xhtml#point-0"))
        .expect("initial candidate resolves");
    adopt_initial(&mut session, 45, first.artifact_id);
    let adjacent = session
        .request_adjacent(adjacent(
            45,
            2,
            first.artifact_id,
            ReaderAdjacentDirectionV1::Next,
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
    let mut session = ReaderSessionV1::open_owned(46, multi_chapter_fixture_epub())
        .expect("reader session opens");
    let last = session
        .request_artifact(request(46, 1, "chapter-3.xhtml"))
        .expect("last chapter candidate resolves");
    adopt_initial(&mut session, 46, last.artifact_id);

    let terminal = session
        .request_adjacent(adjacent(
            46,
            2,
            last.artifact_id,
            ReaderAdjacentDirectionV1::Next,
        ))
        .expect_err("publication end is terminal");
    assert_eq!(terminal.kind, ReaderErrorKindV1::TargetNotPublished);
    assert_eq!(session.visible_artifact_id(), Some(last.artifact_id));
    assert_eq!(session.foreground_candidate_artifact_id(), None);
    assert_eq!(session.live_artifact_count(), 1);
}

#[test]
fn pending_exact_seek_preserves_visible_and_allocates_no_candidate() {
    let mut session = ReaderSessionV1::open_owned(47, source_locator_fixture_epub())
        .expect("reader session opens");
    let visible = session
        .request_artifact(request(47, 1, "chapter.xhtml#point-0"))
        .expect("initial candidate resolves");
    adopt_initial(&mut session, 47, visible.artifact_id);
    let mut pending = request(47, 2, "chapter.xhtml#point-47");
    pending.work.max_top_level_nodes_per_quantum = 1;
    pending.work.max_foreground_quanta = 1;

    let error = session
        .request_artifact(pending)
        .expect_err("bounded exact seek remains pending");
    assert_eq!(error.kind, ReaderErrorKindV1::TargetNotPublished);
    assert_eq!(session.visible_artifact_id(), Some(visible.artifact_id));
    assert_eq!(session.foreground_candidate_artifact_id(), None);
    assert_eq!(session.live_artifact_count(), 1);
    assert_eq!(session.pending_exact_seek_count(), 1);
    let background = session
        .advance_background_once(ReaderBackgroundRequestV1 {
            session_id: 47,
            expected_visible_artifact_id: visible.artifact_id,
            max_top_level_nodes_per_quantum: 1,
        })
        .expect_err("background work must yield to retained exact foreground work");
    assert_eq!(background.kind, ReaderErrorKindV1::StaleRequest);
    assert_eq!(session.visible_artifact_id(), Some(visible.artifact_id));
    assert_eq!(session.pending_exact_seek_count(), 1);
}

#[test]
fn same_chapter_adjacent_retries_retain_one_quantum_progress() {
    let mut session = ReaderSessionV1::open_owned(48, source_locator_fixture_epub())
        .expect("reader session opens");
    let mut initial = request(48, 1, "chapter.xhtml#point-0");
    initial.work.max_top_level_nodes_per_quantum = 1;
    initial.work.max_foreground_quanta = 1;
    // Sealed pages are the publication unit, so a single-node quantum cannot
    // publish the first spread immediately; the exact seek retains its owner
    // and each strictly-increasing retry performs exactly one more quantum.
    let mut next_request_id = 1_u64;
    let visible = loop {
        initial.request_id = next_request_id;
        next_request_id += 1;
        match session.request_artifact(initial.clone()) {
            Ok(artifact) => break artifact,
            Err(error) => {
                assert_eq!(error.kind, ReaderErrorKindV1::TargetNotPublished);
                assert_eq!(session.pending_exact_seek_count(), 1);
                assert!(
                    next_request_id <= 64,
                    "single-node exact retries must publish the first anchor"
                );
            }
        }
    };
    adopt_initial(&mut session, 48, visible.artifact_id);

    let first_adjacent_request_id = next_request_id;
    let mut adjacent = adjacent(
        48,
        first_adjacent_request_id,
        visible.artifact_id,
        ReaderAdjacentDirectionV1::Next,
    );
    next_request_id += 1;
    adjacent.work.max_top_level_nodes_per_quantum = 1;
    adjacent.work.max_foreground_quanta = 1;
    let pending = session
        .request_adjacent(adjacent)
        .expect_err("one additional node cannot publish the next spread");
    assert_eq!(pending.kind, ReaderErrorKindV1::TargetNotPublished);
    assert!(session.has_pending_adjacent_v1());
    assert_eq!(session.pending_adjacent_count(), 1);
    assert_eq!(session.pending_exact_seek_count(), 0);
    assert_eq!(session.visible_artifact_id(), Some(visible.artifact_id));

    let background = session
        .advance_background_once(ReaderBackgroundRequestV1 {
            session_id: 48,
            expected_visible_artifact_id: visible.artifact_id,
            max_top_level_nodes_per_quantum: 1,
        })
        .expect_err("background yields to retained adjacent work");
    assert_eq!(background.kind, ReaderErrorKindV1::StaleRequest);

    let mut resolved = None;
    for request_id in next_request_id..=next_request_id + 125 {
        adjacent.request_id = request_id;
        match session.request_adjacent(adjacent) {
            Ok(artifact) => {
                resolved = Some(artifact);
                break;
            }
            Err(error) => {
                assert_eq!(error.kind, ReaderErrorKindV1::TargetNotPublished);
                assert!(session.has_pending_adjacent_v1());
            }
        }
    }
    let resolved = resolved.expect("same adjacent intent eventually publishes from retained work");
    assert!(resolved.request_id > first_adjacent_request_id);
    assert!(!session.has_pending_adjacent_v1());
    assert_eq!(session.visible_artifact_id(), Some(visible.artifact_id));
}

#[test]
fn chapter_boundary_adjacent_reuses_retained_exact_owner() {
    let mut session = ReaderSessionV1::open_owned(49, retained_adjacent_fixture_epub())
        .expect("reader session opens");
    let visible = session
        .request_artifact(request(49, 1, "chapter-1.xhtml"))
        .expect("source chapter resolves");
    adopt_initial(&mut session, 49, visible.artifact_id);
    let mut adjacent = adjacent(
        49,
        2,
        visible.artifact_id,
        ReaderAdjacentDirectionV1::Previous,
    );
    adjacent.work.max_top_level_nodes_per_quantum = 1;
    adjacent.work.max_foreground_quanta = 1;

    let first = session
        .request_adjacent(adjacent)
        .expect_err("previous chapter tail needs cooperative continuation");
    assert_eq!(first.kind, ReaderErrorKindV1::TargetNotPublished);
    assert!(session.has_pending_adjacent_v1());
    assert!(session.has_pending_exact_seek_v1());
    let first_owner = session
        .pending_exact_seek_owner()
        .expect("boundary adjacent retains its exact owner");

    adjacent.request_id = 3;
    let second = session
        .request_adjacent(adjacent)
        .expect_err("the next single quantum remains pending");
    assert_eq!(second.kind, ReaderErrorKindV1::TargetNotPublished);
    let second_owner = session
        .pending_exact_seek_owner()
        .expect("same adjacent retry keeps its exact owner");
    assert_eq!(second_owner.revision_id, first_owner.revision_id);
    assert!(second_owner.revision_version > first_owner.revision_version);

    let mut resolved = None;
    for request_id in 4..=256 {
        adjacent.request_id = request_id;
        match session.request_adjacent(adjacent) {
            Ok(artifact) => {
                resolved = Some(artifact);
                break;
            }
            Err(error) => assert_eq!(error.kind, ReaderErrorKindV1::TargetNotPublished),
        }
    }
    let resolved = resolved.expect("previous chapter tail eventually resolves");
    assert_eq!(resolved.locator.href, "chapter-0.xhtml");
    assert!(!session.has_pending_adjacent_v1());
    assert!(!session.has_pending_exact_seek_v1());
}

#[test]
fn superseding_or_releasing_adjacent_source_cancels_retained_work() {
    let mut session = ReaderSessionV1::open_owned(50, retained_adjacent_fixture_epub())
        .expect("reader session opens");
    let source = session
        .request_artifact(request(50, 1, "chapter-1.xhtml"))
        .expect("source chapter resolves");
    let mut pending = adjacent(
        50,
        2,
        source.artifact_id,
        ReaderAdjacentDirectionV1::Previous,
    );
    pending.work.max_top_level_nodes_per_quantum = 1;
    pending.work.max_foreground_quanta = 1;
    session
        .request_adjacent(pending)
        .expect_err("boundary adjacent remains pending");
    assert!(session.has_pending_adjacent_v1());
    assert!(session.has_pending_exact_seek_v1());

    let replacement = session
        .request_artifact(request(50, 3, "chapter-1.xhtml"))
        .expect("different foreground intent supersedes retained adjacent work");
    assert!(!session.has_pending_adjacent_v1());
    assert!(!session.has_pending_exact_seek_v1());
    session
        .release_artifact(replacement.artifact_id)
        .expect("replacement releases");

    pending.request_id = 4;
    session
        .request_adjacent(pending)
        .expect_err("boundary adjacent can become pending again");
    assert!(session.has_pending_adjacent_v1());
    session
        .release_artifact(source.artifact_id)
        .expect("releasing the source cancels retained adjacent work");
    assert!(!session.has_pending_adjacent_v1());
    assert!(!session.has_pending_exact_seek_v1());
}

#[test]
fn session_rejects_wrong_identity_stale_request_and_unknown_artifact() {
    let mut session = ReaderSessionV1::open_owned(51, source_locator_fixture_epub())
        .expect("reader session opens");
    let wrong = session
        .request_artifact(request(52, 1, "chapter.xhtml#point-1"))
        .expect_err("wrong session is rejected");
    assert_eq!(wrong.kind, ReaderErrorKindV1::InvalidSession);

    let artifact = session
        .request_artifact(request(51, 2, "chapter.xhtml#point-1"))
        .expect("valid request resolves");
    let stale = session
        .request_artifact(request(51, 2, "chapter.xhtml#point-2"))
        .expect_err("same request id is stale");
    assert_eq!(stale.kind, ReaderErrorKindV1::StaleRequest);
    let unknown = session
        .release_artifact(artifact.artifact_id + 99)
        .expect_err("unknown artifact is rejected");
    assert_eq!(unknown.kind, ReaderErrorKindV1::UnknownArtifact);

    let ack = session.dispose().expect("session disposes");
    assert_eq!(ack.session_id, 51);
    assert_eq!(ack.released_artifacts, 1);
}

#[test]
fn session_rejects_external_id_sign_bit_before_lookup_or_work() {
    let high_bit = READER_EXTERNAL_ID_MAX_V1 + 1;
    let invalid_session = ReaderSessionV1::open_owned(high_bit, Vec::new())
        .expect_err("high-bit session id is rejected before publication parsing");
    assert_eq!(invalid_session.kind, ReaderErrorKindV1::InvalidSession);

    let mut session = ReaderSessionV1::open_owned(52, source_locator_fixture_epub())
        .expect("reader session opens");
    let mut invalid_request = request(52, high_bit, "chapter.xhtml#point-0");
    let invalid = session
        .request_artifact(invalid_request.clone())
        .expect_err("high-bit request id is rejected");
    assert_eq!(invalid.kind, ReaderErrorKindV1::InvalidRequest);

    invalid_request.request_id = 1;
    let artifact = session
        .request_artifact(invalid_request)
        .expect("valid request still resolves");
    let invalid = session
        .request_adjacent(adjacent(52, 2, high_bit, ReaderAdjacentDirectionV1::Next))
        .expect_err("high-bit artifact id is rejected before lookup");
    assert_eq!(invalid.kind, ReaderErrorKindV1::InvalidRequest);
    assert_eq!(
        session
            .release_artifact(high_bit)
            .expect_err("direct high-bit artifact release is rejected")
            .kind,
        ReaderErrorKindV1::InvalidRequest
    );
    session
        .release_artifact(artifact.artifact_id)
        .expect("valid artifact releases");
}

#[test]
fn failed_revision_retirement_restores_artifact_ownership() {
    let mut session = ReaderSessionV1::open_owned(53, source_locator_fixture_epub())
        .expect("reader session opens");
    let artifact = session
        .request_artifact(request(53, 1, "chapter.xhtml#point-0"))
        .expect("artifact resolves");
    let (backing, revision_id) = session
        .artifact_owner_backing(artifact.artifact_id)
        .expect("artifact owner is live");
    assert_eq!(backing, ReaderRevisionBackingV1::ChapterLocal);
    session.clear_retained_windows();
    let valid_version = session
        .runtime_revision_version(revision_id)
        .expect("revision owner is live");
    session.set_runtime_revision_version(revision_id, valid_version + 1);

    let error = session
        .release_artifact(artifact.artifact_id)
        .expect_err("stale runtime owner prevents retirement");
    assert_eq!(error.kind, ReaderErrorKindV1::EngineFailure);
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
    let mut session = ReaderSessionV1::open_owned(61, long_chapter_window_fixture_epub())
        .expect("reader session opens");
    let mut initial_request = request(61, 1, "chapter.xhtml#window-point-0");
    initial_request.work.max_top_level_nodes_per_quantum = 64;
    let first = session
        .request_artifact(initial_request)
        .expect("first spread resolves");
    let mut artifacts = vec![first];

    for request_id in 2..=u64::from(READER_LIVE_ARTIFACT_CAP_V1) {
        let next = session
            .request_adjacent(adjacent(
                61,
                request_id,
                artifacts.last().unwrap().artifact_id,
                ReaderAdjacentDirectionV1::Next,
            ))
            .expect("published adjacent spread resolves");
        assert_ne!(next.artifact_id, artifacts.last().unwrap().artifact_id);
        assert_eq!(next.revision_id, artifacts[0].revision_id);
        assert!(next.revision_version >= artifacts.last().unwrap().revision_version);
        artifacts.push(next);
    }

    assert_eq!(
        session.live_artifact_count(),
        READER_LIVE_ARTIFACT_CAP_V1
    );
    let capped = session
        .request_adjacent(adjacent(
            61,
            u64::from(READER_LIVE_ARTIFACT_CAP_V1) + 1,
            artifacts.last().unwrap().artifact_id,
            ReaderAdjacentDirectionV1::Next,
        ))
        .expect_err("an over-cap live artifact is rejected before doing work");
    assert_eq!(capped.kind, ReaderErrorKindV1::InvalidRequest);
    for artifact in artifacts.into_iter().rev() {
        session
            .release_artifact(artifact.artifact_id)
            .expect("shared artifacts release in any order");
    }
    assert_eq!(session.live_artifact_count(), 0);
}

#[test]
fn continuation_advances_shared_owner_without_invalidating_siblings() {
    let mut session = ReaderSessionV1::open_owned(71, source_locator_image_fixture_epub())
        .expect("reader session opens");
    let mut initial_request = request(71, 1, "chapter.xhtml#point-0");
    initial_request.work.max_top_level_nodes_per_quantum = 1;
    let first = session
        .request_artifact(initial_request)
        .expect("first bounded artifact resolves");
    let resource_ref = first
        .resources
        .iter()
        .find(|resource| resource.kind == ReaderResourceKindV1::Image)
        .expect("fixture image is declared")
        .clone();
    let second = session
        .request_adjacent(adjacent(
            71,
            2,
            first.artifact_id,
            ReaderAdjacentDirectionV1::Next,
        ))
        .expect("continuation publishes the adjacent spread");

    assert_eq!(second.revision_id, first.revision_id);
    assert!(second.revision_version > first.revision_version);
    let resource = session
        .read_resource(first.artifact_id, resource_ref.kind, &resource_ref.href)
        .expect("old artifact reads through the revision's advanced owner");
    assert!(!resource.bytes.is_empty());
    session
        .release_artifact(first.artifact_id)
        .expect("old sibling releases without retiring shared revision");
    let previous = session
        .request_adjacent(adjacent(
            71,
            3,
            second.artifact_id,
            ReaderAdjacentDirectionV1::Previous,
        ))
        .expect("remaining sibling still projects from the current owner");
    assert_eq!(previous.revision_id, second.revision_id);
    assert_eq!(previous.local_spread_index, first.local_spread_index);
    session
        .release_artifact(second.artifact_id)
        .expect("second sibling releases");
    session
        .release_artifact(previous.artifact_id)
        .expect("last sibling retires revision");
}

#[test]
fn page_cap_rolls_forward_and_retains_one_window_for_previous() {
    let mut session = ReaderSessionV1::open_owned(72, source_locator_image_fixture_epub())
        .expect("reader session opens");
    let mut initial_request = request(72, 1, "chapter.xhtml#point-0");
    initial_request.work.local_page_cap = 2;
    initial_request.work.max_top_level_nodes_per_quantum = 64;
    let first = session
        .request_artifact(initial_request)
        .expect("first capped spread resolves");
    let first_image = first
        .resources
        .iter()
        .find(|resource| resource.kind == ReaderResourceKindV1::Image)
        .expect("first window declares its image")
        .clone();
    let second = session
        .request_adjacent(ReaderAdjacentRequestV1 {
            session_id: 72,
            request_id: 2,
            from_artifact_id: first.artifact_id,
            direction: ReaderAdjacentDirectionV1::Next,
            work: ReaderWorkBudgetV1 {
                max_top_level_nodes_per_quantum: 8,
                max_foreground_quanta: 8,
                local_page_cap: 2,
            },
        })
        .expect("last published capped spread resolves without layout");
    assert_eq!(
        second.navigation.next,
        ReaderAdjacentAvailabilityV1::Pending
    );
    let rolled = session
        .request_adjacent(ReaderAdjacentRequestV1 {
            session_id: 72,
            request_id: 3,
            from_artifact_id: second.artifact_id,
            direction: ReaderAdjacentDirectionV1::Next,
            work: ReaderWorkBudgetV1 {
                max_top_level_nodes_per_quantum: 8,
                max_foreground_quanta: 8,
                local_page_cap: 2,
            },
        })
        .expect("page cap rolls into the next bounded revision");
    assert_ne!(rolled.revision_id, second.revision_id);
    assert_eq!(rolled.local_spread_index, 0);
    assert_ne!(
        rolled.pages, first.pages,
        "rollover must not replay page one"
    );
    assert!(!session
        .read_resource(first.artifact_id, first_image.kind, &first_image.href)
        .expect("old window resource remains readable after rollover")
        .bytes
        .is_empty());
    let previous = session
        .request_adjacent(ReaderAdjacentRequestV1 {
            session_id: 72,
            request_id: 4,
            from_artifact_id: rolled.artifact_id,
            direction: ReaderAdjacentDirectionV1::Previous,
            work: ReaderWorkBudgetV1 {
                max_top_level_nodes_per_quantum: 8,
                max_foreground_quanta: 8,
                local_page_cap: 2,
            },
        })
        .expect("retained adjacent window supports previous");
    assert_eq!(previous.revision_id, second.revision_id);
    assert_eq!(previous.local_spread_index, second.local_spread_index);
}

#[test]
fn adjacent_identity_boundaries_and_terminal_are_fail_closed() {
    let mut session = ReaderSessionV1::open_owned(81, multi_chapter_fixture_epub())
        .expect("reader session opens");
    let middle = session
        .request_artifact(request(81, 1, "chapter-2.xhtml"))
        .expect("middle chapter resolves");
    assert_eq!(
        middle.navigation.previous,
        ReaderAdjacentAvailabilityV1::ChapterBoundary
    );
    assert_eq!(
        middle.navigation.next,
        ReaderAdjacentAvailabilityV1::ChapterBoundary
    );

    let wrong = session
        .request_adjacent(adjacent(
            82,
            2,
            middle.artifact_id,
            ReaderAdjacentDirectionV1::Previous,
        ))
        .expect_err("wrong session is rejected");
    assert_eq!(wrong.kind, ReaderErrorKindV1::InvalidSession);
    let unknown = session
        .request_adjacent(adjacent(
            81,
            2,
            middle.artifact_id + 99,
            ReaderAdjacentDirectionV1::Previous,
        ))
        .expect_err("unknown source artifact is rejected");
    assert_eq!(unknown.kind, ReaderErrorKindV1::UnknownArtifact);

    let previous = session
        .request_adjacent(adjacent(
            81,
            2,
            middle.artifact_id,
            ReaderAdjacentDirectionV1::Previous,
        ))
        .expect("previous chapter boundary resolves");
    assert_eq!(previous.locator.href, "chapter-1.xhtml");
    let stale = session
        .request_adjacent(adjacent(
            81,
            2,
            middle.artifact_id,
            ReaderAdjacentDirectionV1::Next,
        ))
        .expect_err("reused adjacent request id is stale");
    assert_eq!(stale.kind, ReaderErrorKindV1::StaleRequest);

    let next = session
        .request_adjacent(adjacent(
            81,
            3,
            middle.artifact_id,
            ReaderAdjacentDirectionV1::Next,
        ))
        .expect("next chapter boundary resolves");
    assert_eq!(next.locator.href, "chapter-3.xhtml");
    assert_eq!(next.navigation.next, ReaderAdjacentAvailabilityV1::Terminal);
    let terminal = session
        .request_adjacent(adjacent(
            81,
            4,
            next.artifact_id,
            ReaderAdjacentDirectionV1::Next,
        ))
        .expect_err("publication end is explicit");
    assert_eq!(terminal.kind, ReaderErrorKindV1::TargetNotPublished);
    assert!(!session.has_pending_exact_seek_v1());
    assert!(!session.has_pending_adjacent_v1());
}

#[test]
fn artifact_resources_follow_their_revision_release_order() {
    let mut session = ReaderSessionV1::open_owned(91, multi_chapter_image_fixture_epub())
        .expect("reader session opens");
    let image = session
        .request_artifact(request(91, 1, "chapter-2.xhtml"))
        .expect("image artifact resolves");
    let image_ref = image
        .resources
        .iter()
        .find(|resource| resource.kind == ReaderResourceKindV1::Image)
        .expect("image resource is declared")
        .clone();
    let previous = session
        .request_adjacent(adjacent(
            91,
            2,
            image.artifact_id,
            ReaderAdjacentDirectionV1::Previous,
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
fn long_chapter_rollover_matches_full_layout_for_twenty_adjacent_pages() {
    let publication = long_chapter_window_fixture_epub();
    let mut reference = RuntimeDocument::open(&publication).expect("reference document");
    // Reader sessions measure font-aware; the full-layout reference must
    // measure the same way or its line breaks (and pages) diverge.
    let mut reference_layout = runtime_layout();
    reference_layout.text_measurement = crate::layout::TextMeasurementMode::FontAware;
    let reference_revision = reference
        .create_revision(&reference_layout)
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

    let mut session = ReaderSessionV1::open_owned(101, publication).expect("reader session");
    let mut first_request = request(101, 1, "chapter.xhtml");
    first_request.work.local_page_cap = 4;
    first_request.work.max_top_level_nodes_per_quantum = 8;
    first_request.work.max_foreground_quanta = 128;
    let mut current = session
        .request_artifact(first_request)
        .expect("first page artifact");
    let mut actual = vec![single_page_text(&current)];
    let mut request_id = 1u64;
    let mut checked_cross_window_previous = false;

    for _ in 0..20 {
        request_id += 1;
        let next = session
            .request_adjacent(adjacent_with_cap(
                101,
                request_id,
                current.artifact_id,
                ReaderAdjacentDirectionV1::Next,
                4,
            ))
            .expect("bounded adjacent page");
        actual.push(single_page_text(&next));
        if next.revision_id != current.revision_id && !checked_cross_window_previous {
            let expected_previous = single_page_text(&current);
            session
                .release_artifact(current.artifact_id)
                .expect("old boundary artifact releases while its window stays retained");
            request_id += 1;
            let previous = session
                .request_adjacent(adjacent_with_cap(
                    101,
                    request_id,
                    next.artifact_id,
                    ReaderAdjacentDirectionV1::Previous,
                    4,
                ))
                .expect("previous crosses the retained window boundary");
            assert_eq!(single_page_text(&previous), expected_previous);
            session
                .release_artifact(previous.artifact_id)
                .expect("previous projection releases");
            checked_cross_window_previous = true;
        } else {
            session
                .release_artifact(current.artifact_id)
                .expect("previous page artifact releases");
        }
        current = next;
        assert!(session.max_known_local_page_count() <= 4);
        assert!(session.retained_window_count() <= 2);
        assert!(session.live_revision_count() <= 3);
        assert!(
            session.cleanup_backlog_is_empty(),
            "rollover must not accumulate retired window owners"
        );
    }

    assert!(checked_cross_window_previous);
    assert_eq!(actual, expected, "rollover must have no page gap or replay");
    let ack = session.dispose().expect("all rollover owners dispose");
    assert_eq!(ack.released_artifacts, 1);
}

#[test]
fn exact_cache_does_not_reuse_an_evicted_window() {
    let mut session = ReaderSessionV1::open_owned(125, long_chapter_window_fixture_epub())
        .expect("reader session");
    let mut initial = request(125, 1, "chapter.xhtml#window-point-0");
    initial.work.local_page_cap = 4;
    initial.work.max_top_level_nodes_per_quantum = 8;
    initial.work.max_foreground_quanta = 128;
    let mut current = session
        .request_artifact(initial)
        .expect("first exact window resolves");
    let evicted_revision_id = current.revision_id;
    let mut request_id = 1u64;

    while session.has_live_revision(evicted_revision_id) {
        request_id += 1;
        assert!(request_id < 96, "fixture must reach a third bounded window");
        let next = session
            .request_adjacent(adjacent_with_cap(
                125,
                request_id,
                current.artifact_id,
                ReaderAdjacentDirectionV1::Next,
                4,
            ))
            .expect("adjacent work reaches the next retained window");
        session
            .release_artifact(current.artifact_id)
            .expect("old window artifact releases");
        current = next;
    }

    let cache_hits = session.exact_cache_hit_count();
    let layout_quanta = session.exact_layout_quantum_count();
    request_id += 1;
    let mut seek = request(125, request_id, "chapter.xhtml#window-point-0");
    seek.work.local_page_cap = 4;
    seek.work.max_top_level_nodes_per_quantum = 8;
    seek.work.max_foreground_quanta = 128;
    let recovered = session
        .request_artifact(seek)
        .expect("evicted target falls back to a fresh exact revision");

    assert_ne!(recovered.revision_id, evicted_revision_id);
    assert_eq!(session.exact_cache_hit_count(), cache_hits);
    assert!(session.exact_layout_quantum_count() > layout_quanta);
    assert!(recovered
        .pages
        .iter()
        .any(|page| page.text.contains("Window paragraph 000")));
}

#[test]
fn exact_cache_reuses_a_zero_ref_retained_window() {
    let mut session = ReaderSessionV1::open_owned(126, long_chapter_window_fixture_epub())
        .expect("reader session");
    let mut initial = request(126, 1, "chapter.xhtml#window-point-0");
    initial.work.local_page_cap = 4;
    initial.work.max_top_level_nodes_per_quantum = 8;
    initial.work.max_foreground_quanta = 128;
    let mut current = session
        .request_artifact(initial)
        .expect("first exact window resolves");
    let retained_revision_id = current.revision_id;
    let mut request_id = 1u64;

    while current.revision_id == retained_revision_id {
        request_id += 1;
        assert!(
            request_id < 48,
            "fixture must cross its first bounded window"
        );
        let next = session
            .request_adjacent(adjacent_with_cap(
                126,
                request_id,
                current.artifact_id,
                ReaderAdjacentDirectionV1::Next,
                4,
            ))
            .expect("adjacent work reaches the next retained window");
        session
            .release_artifact(current.artifact_id)
            .expect("old window artifact releases");
        current = next;
    }
    assert!(session.has_live_revision(retained_revision_id));
    let layout_quanta = session.exact_layout_quantum_count();
    request_id += 1;
    let mut seek = request(126, request_id, "chapter.xhtml#window-point-0");
    seek.locator.progression = Some(0.0);
    seek.work.local_page_cap = 4;
    seek.work.max_top_level_nodes_per_quantum = 8;
    seek.work.max_foreground_quanta = 1;
    let cached = session
        .request_artifact(seek)
        .expect("published target resolves from the retained window without work");

    assert_eq!(cached.revision_id, retained_revision_id);
    assert_eq!(cached.locator.anchor_id.as_deref(), Some("window-point-0"));
    assert_eq!(cached.locator.progression, Some(0.0));
    assert_eq!(session.exact_cache_hit_count(), 1);
    assert_eq!(session.exact_layout_quantum_count(), layout_quanta);
}

#[test]
fn exact_tail_locator_exhaustion_is_typed_and_retains_only_the_pending_owner() {
    let mut session = ReaderSessionV1::open_owned(102, long_chapter_window_fixture_epub())
        .expect("reader session");
    let mut tail_request = request(102, 1, "chapter.xhtml#window-point-519");
    tail_request.work.local_page_cap = 4;
    tail_request.work.max_top_level_nodes_per_quantum = 8;
    tail_request.work.max_foreground_quanta = 24;
    let error = session
        .request_artifact(tail_request.clone())
        .expect_err("bounded exact scan fails closed before accepting the tail target");

    assert_eq!(error.kind, ReaderErrorKindV1::TargetNotPublished);
    assert_eq!(session.live_artifact_count(), 0);
    assert_eq!(session.live_revision_count(), 0);
    assert_eq!(session.pending_exact_seek_count(), 1);
    assert!(session.has_pending_exact_seek_v1());
    assert!(!session.has_visible_intent());
    assert_eq!(session.foreground_candidate_artifact_id(), None);
    assert_eq!(session.live_runtime_chapter_local_revision_count(), 1);
    assert_eq!(session.live_continuation_count(), 1);
    assert_eq!(session.retained_window_count(), 0);
    assert!(session.cleanup_backlog_is_empty());

    tail_request.request_id = 2;
    tail_request.work.max_foreground_quanta = 512;
    let tail = session
        .request_artifact(tail_request)
        .expect("same exact target resumes the retained scan");
    assert_eq!(tail.request_id, 2);
    assert_eq!(tail.locator.anchor_id.as_deref(), Some("window-point-519"));
    assert!(tail
        .pages
        .iter()
        .any(|page| page.text.contains("Window paragraph 519")));
    assert!(!tail
        .pages
        .iter()
        .any(|page| page.text.contains("Window paragraph 000")));
    assert_eq!(session.pending_exact_seek_count(), 0);
    assert!(!session.has_pending_exact_seek_v1());
    assert_eq!(session.live_revision_count(), 1);
    assert_eq!(session.live_runtime_chapter_local_revision_count(), 1);
}

#[test]
fn same_exact_target_resumes_one_quantum_without_publishing_page_one() {
    let mut session =
        ReaderSessionV1::open_owned(106, source_locator_fixture_epub()).expect("reader session");
    let mut seek = request(106, 1, "chapter.xhtml#point-47");
    seek.work.max_top_level_nodes_per_quantum = 1;
    seek.work.max_foreground_quanta = 1;

    let first = session
        .request_artifact(seek.clone())
        .expect_err("one quantum cannot resolve the tail anchor");
    assert_eq!(first.kind, ReaderErrorKindV1::TargetNotPublished);
    assert_eq!(session.live_artifact_count(), 0);
    assert_eq!(session.live_revision_count(), 0);
    assert_eq!(session.pending_exact_seek_count(), 1);
    assert_eq!(session.foreground_candidate_artifact_id(), None);
    assert_eq!(session.live_runtime_chapter_local_revision_count(), 1);
    let first_owner = session
        .pending_exact_seek_owner()
        .expect("pending seek retains its runtime owner");

    let stale = session
        .request_artifact(seek.clone())
        .expect_err("pending continuation still enforces monotonic request ids");
    assert_eq!(stale.kind, ReaderErrorKindV1::StaleRequest);
    assert_eq!(
        session
            .pending_exact_seek_owner()
            .expect("stale retry cannot consume the owner"),
        first_owner
    );

    seek.request_id = 2;
    let second = session
        .request_artifact(seek.clone())
        .expect_err("the second bounded quantum is still pending");
    assert_eq!(second.kind, ReaderErrorKindV1::TargetNotPublished);
    assert_eq!(session.foreground_candidate_artifact_id(), None);
    let second_owner = session
        .pending_exact_seek_owner()
        .expect("same-target retry keeps the owner");
    assert_eq!(second_owner.revision_id, first_owner.revision_id);
    assert!(second_owner.revision_version > first_owner.revision_version);
    assert_eq!(session.live_runtime_chapter_local_revision_count(), 1);

    let mut artifact = None;
    for request_id in 3..=128 {
        seek.request_id = request_id;
        match session.request_artifact(seek.clone()) {
            Ok(resolved) => {
                artifact = Some(resolved);
                break;
            }
            Err(error) => assert_eq!(error.kind, ReaderErrorKindV1::TargetNotPublished),
        }
    }
    let artifact = artifact.expect("bounded same-target retries eventually resolve");
    assert_eq!(artifact.artifact_id, 1);
    assert_eq!(artifact.revision_id, 1);
    assert_eq!(artifact.locator.anchor_id.as_deref(), Some("point-47"));
    assert!(artifact.local_page_index > 0);
    assert!(artifact
        .pages
        .iter()
        .all(|page| !page.text.contains("Source locator paragraph 0 ")));
    assert_eq!(session.pending_exact_seek_count(), 0);
    assert_eq!(session.live_artifact_count(), 1);
}

#[test]
fn new_target_or_layout_supersedes_pending_owner_and_dispose_releases_it() {
    let mut session =
        ReaderSessionV1::open_owned(107, source_locator_fixture_epub()).expect("reader session");
    let mut seek = request(107, 1, "chapter.xhtml#point-47");
    seek.work.max_top_level_nodes_per_quantum = 1;
    seek.work.max_foreground_quanta = 1;
    session
        .request_artifact(seek.clone())
        .expect_err("first seek remains pending");
    let first_owner = session
        .pending_exact_seek_owner()
        .expect("first pending owner");

    seek.request_id = 2;
    seek.layout.viewport_width = 360.0;
    session
        .request_artifact(seek.clone())
        .expect_err("layout change starts a replacement pending seek");
    let relayout_owner = session
        .pending_exact_seek_owner()
        .expect("replacement layout owner");
    assert_ne!(relayout_owner.revision_id, first_owner.revision_id);
    assert_eq!(session.live_runtime_chapter_local_revision_count(), 1);
    assert_eq!(session.live_continuation_count(), 1);

    seek.request_id = 3;
    seek.locator.href = "chapter.xhtml#point-46".to_owned();
    session
        .request_artifact(seek)
        .expect_err("new target starts another replacement pending seek");
    let replacement_owner = session
        .pending_exact_seek_owner()
        .expect("replacement target owner");
    assert_ne!(replacement_owner.revision_id, relayout_owner.revision_id);
    assert_eq!(session.live_artifact_count(), 0);
    assert_eq!(session.live_runtime_chapter_local_revision_count(), 1);
    assert!(session.cleanup_backlog_is_empty());

    assert_eq!(
        session
            .dispose_in_place_for_test()
            .expect("dispose releases pending exact seek"),
        0
    );
    assert_eq!(session.pending_exact_seek_count(), 0);
    assert_eq!(session.live_runtime_chapter_local_revision_count(), 0);
    assert_eq!(session.live_continuation_count(), 0);
    assert!(session.cleanup_backlog_is_empty());
}

#[test]
fn exact_tail_locator_returns_only_its_target_window_with_sufficient_work() {
    let mut session = ReaderSessionV1::open_owned(105, long_chapter_window_fixture_epub())
        .expect("reader session");
    let mut tail_request = request(105, 1, "chapter.xhtml#window-point-519");
    tail_request.work.local_page_cap = 4;
    tail_request.work.max_top_level_nodes_per_quantum = 8;
    tail_request.work.max_foreground_quanta = 384;
    let tail = session
        .request_artifact(tail_request)
        .expect("tail locator scans bounded provisional windows with sufficient work");

    assert_eq!(tail.locator.anchor_id.as_deref(), Some("window-point-519"));
    assert!(tail.local_page_index < 4);
    assert!(tail
        .pages
        .iter()
        .any(|page| page.text.contains("Window paragraph 519")));
    assert!(!tail
        .pages
        .iter()
        .any(|page| page.text.contains("Window paragraph 000")));
    assert_eq!(session.live_revision_count(), 1);
    assert_eq!(session.retained_window_count(), 0);
    assert!(session.max_known_local_page_count() <= 4);
}

#[test]
fn double_spread_first_page_alone_rollover_matches_a_wider_reference_window() {
    let publication = long_chapter_window_fixture_epub();
    let narrow_windows = collect_double_spread_text(publication.clone(), 103, 4, 12);
    let reference_windows = collect_double_spread_text(publication, 104, 16, 12);
    assert_eq!(
        narrow_windows, reference_windows,
        "double-spread rollover must not skip or repeat pages"
    );
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
            "reader protocol v1 must not contain {forbidden}"
        );
    }
    assert!(!include_str!("types.rs").contains("usize"));
}

fn request(session_id: u64, request_id: u64, href: &str) -> ReaderArtifactRequestV1 {
    ReaderArtifactRequestV1 {
        session_id,
        request_id,
        layout: ReaderLayoutV1 {
            viewport_width: 420.0,
            viewport_height: 640.0,
            margin_top: 24.0,
            margin_right: 24.0,
            margin_bottom: 24.0,
            margin_left: 24.0,
            spread_mode: ReaderSpreadModeV1::Single,
            first_page_alone: true,
            spread_gap: 0.0,
            root_font_size: 16.0,
            line_height_override: None,
            font_family_override: None,
        },
        locator: ReaderLocatorV1 {
            href: href.to_owned(),
            anchor_id: None,
            source_point: None,
            source_range: None,
            progression: None,
        },
        work: ReaderWorkBudgetV1 {
            max_top_level_nodes_per_quantum: 32,
            max_foreground_quanta: 64,
            local_page_cap: 16,
        },
        text_profile: ReaderTextRenderingProfileV1::PlatformStringRuns,
    }
}

fn adjacent(
    session_id: u64,
    request_id: u64,
    from_artifact_id: u64,
    direction: ReaderAdjacentDirectionV1,
) -> ReaderAdjacentRequestV1 {
    ReaderAdjacentRequestV1 {
        session_id,
        request_id,
        from_artifact_id,
        direction,
        work: ReaderWorkBudgetV1 {
            max_top_level_nodes_per_quantum: 8,
            max_foreground_quanta: 64,
            local_page_cap: 16,
        },
    }
}

fn adjacent_with_cap(
    session_id: u64,
    request_id: u64,
    from_artifact_id: u64,
    direction: ReaderAdjacentDirectionV1,
    local_page_cap: u32,
) -> ReaderAdjacentRequestV1 {
    let mut request = adjacent(session_id, request_id, from_artifact_id, direction);
    request.work.local_page_cap = local_page_cap;
    request
}

fn adopt_initial(
    session: &mut ReaderSessionV1,
    session_id: u64,
    candidate_artifact_id: u64,
) -> ReaderForegroundHandoffAckV1 {
    session
        .adopt_foreground_candidate(ReaderForegroundHandoffV1 {
            session_id,
            expected_visible_artifact_id: None,
            candidate_artifact_id,
        })
        .expect("initial foreground candidate adopts")
}

fn adopt_replacement(
    session: &mut ReaderSessionV1,
    session_id: u64,
    expected_visible_artifact_id: u64,
    candidate_artifact_id: u64,
) -> ReaderForegroundHandoffAckV1 {
    session
        .adopt_foreground_candidate(ReaderForegroundHandoffV1 {
            session_id,
            expected_visible_artifact_id: Some(expected_visible_artifact_id),
            candidate_artifact_id,
        })
        .expect("replacement foreground candidate adopts")
}

fn single_page_text(artifact: &ReaderArtifactV1) -> String {
    assert_eq!(artifact.pages.len(), 1);
    artifact.pages[0].text.clone()
}

fn collect_double_spread_text(
    publication: Vec<u8>,
    session_id: u64,
    local_page_cap: u32,
    turn_count: usize,
) -> Vec<String> {
    let mut session = ReaderSessionV1::open_owned(session_id, publication).expect("reader session");
    let mut initial = request(session_id, 1, "chapter.xhtml");
    initial.layout.viewport_width = 900.0;
    initial.layout.spread_mode = ReaderSpreadModeV1::Double;
    initial.layout.first_page_alone = true;
    initial.layout.spread_gap = 20.0;
    initial.work.local_page_cap = local_page_cap;
    let mut current = session
        .request_artifact(initial)
        .expect("double-spread first artifact");
    let mut page_text = current
        .pages
        .iter()
        .map(|page| page.text.clone())
        .collect::<Vec<_>>();
    for turn in 0..turn_count {
        let next = session
            .request_adjacent(adjacent_with_cap(
                session_id,
                u64::try_from(turn).expect("turn id") + 2,
                current.artifact_id,
                ReaderAdjacentDirectionV1::Next,
                local_page_cap,
            ))
            .expect("double-spread adjacent artifact");
        page_text.extend(next.pages.iter().map(|page| page.text.clone()));
        session
            .release_artifact(current.artifact_id)
            .expect("old double-spread artifact releases");
        current = next;
    }
    session.dispose().expect("double-spread session disposes");
    page_text
}

#[test]
fn previous_chapter_tail_publishes_when_the_chapter_completes_within_budget() {
    use crate::runtime::tests::fixture::short_previous_chapter_fixture_epub;
    for tail in ["text", "trailing-image", "image-only", "hidden-tail", "ruby-tail", "svg-image", "empty-tail"] {
        let mut session =
            ReaderSessionV1::open_owned(97, short_previous_chapter_fixture_epub(tail))
                .expect("reader session opens");
        let visible = session
            .request_artifact(request(97, 1, "chapter-1.xhtml"))
            .expect("source chapter resolves");
        adopt_initial(&mut session, 97, visible.artifact_id);
        let mut prev = adjacent(
            97,
            2,
            visible.artifact_id,
            ReaderAdjacentDirectionV1::Previous,
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
                        ReaderErrorKindV1::TargetNotPublished,
                        "tail={tail}: unexpected error: {error:?}"
                    );
                    assert!(
                        session.has_pending_adjacent_v1(),
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
    let mut session = ReaderSessionV1::open_owned(120, long_chapter_window_fixture_epub())
        .expect("reader session opens");
    let visible = session
        .request_artifact(request(120, 1, ""))
        .expect("source chapter resolves");
    adopt_initial(&mut session, 120, visible.artifact_id);
    let next = session
        .request_adjacent(adjacent(
            120,
            2,
            visible.artifact_id,
            ReaderAdjacentDirectionV1::Next,
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
            ReaderAdjacentDirectionV1::Previous,
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
            ReaderAdjacentDirectionV1::Next,
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
            ReaderAdjacentDirectionV1::Next,
        ))
        .expect("in-chapter peek paginates its neighbor");
    assert_eq!(
        paginated_ahead.local_spread_index,
        next.local_spread_index + 1
    );

    // No foreground side effects: visible unchanged, nothing pending.
    assert_eq!(session.visible_artifact_id(), Some(next.artifact_id));
    assert!(!session.has_pending_adjacent_v1());
    assert!(!session.has_pending_exact_seek_v1());

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
    let mut session = ReaderSessionV1::open_owned(121, long_chapter_window_fixture_epub())
        .expect("reader session opens");
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
            ReaderAdjacentDirectionV1::Previous,
        ))
        .expect_err("boundary peek declines");
    assert_eq!(boundary.kind, ReaderErrorKindV1::TargetNotPublished);
    assert!(!session.has_pending_adjacent_v1());
    assert!(!session.has_pending_exact_seek_v1());
    assert_eq!(session.visible_artifact_id(), Some(visible.artifact_id));
}

#[test]
fn commit_peeked_artifact_is_a_pure_visible_swap() {
    let mut session = ReaderSessionV1::open_owned(122, long_chapter_window_fixture_epub())
        .expect("reader session opens");
    let visible = session
        .request_artifact(request(122, 1, ""))
        .expect("source chapter resolves");
    adopt_initial(&mut session, 122, visible.artifact_id);
    let second = session
        .request_adjacent(adjacent(
            122,
            2,
            visible.artifact_id,
            ReaderAdjacentDirectionV1::Next,
        ))
        .expect("in-chapter next resolves");
    adopt_replacement(&mut session, 122, visible.artifact_id, second.artifact_id);
    let peeked = session
        .peek_adjacent(adjacent(
            122,
            3,
            second.artifact_id,
            ReaderAdjacentDirectionV1::Previous,
        ))
        .expect("previous spread peeks");

    let ack = session
        .commit_peeked_artifact(ReaderForegroundHandoffV1 {
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
        .commit_peeked_artifact(ReaderForegroundHandoffV1 {
            session_id: 122,
            expected_visible_artifact_id: Some(peeked.artifact_id),
            candidate_artifact_id: peeked.artifact_id,
        })
        .expect_err("peeked commit does not replay");
    assert_eq!(replay.kind, ReaderErrorKindV1::InvalidRequest);

    // Non-peeked artifacts cannot take the fast path.
    let denied = session
        .commit_peeked_artifact(ReaderForegroundHandoffV1 {
            session_id: 122,
            expected_visible_artifact_id: Some(peeked.artifact_id),
            candidate_artifact_id: visible.artifact_id,
        })
        .expect_err("ordinary artifacts cannot fast-commit");
    assert_eq!(denied.kind, ReaderErrorKindV1::InvalidRequest);

    // Stale CAS is rejected.
    let peeked_again = session
        .peek_adjacent(adjacent(
            122,
            4,
            peeked.artifact_id,
            ReaderAdjacentDirectionV1::Next,
        ))
        .expect("next spread peeks");
    let stale = session
        .commit_peeked_artifact(ReaderForegroundHandoffV1 {
            session_id: 122,
            expected_visible_artifact_id: Some(second.artifact_id),
            candidate_artifact_id: peeked_again.artifact_id,
        })
        .expect_err("stale expected-visible is rejected");
    assert_eq!(stale.kind, ReaderErrorKindV1::StaleRequest);
}

#[test]
fn peek_crosses_single_page_chapter_boundaries_in_both_directions() {
    use crate::runtime::tests::fixture::many_chapter_fixture_epub;
    // The acceptance scenario: front matter made of single-page
    // chapters (image plates). Every drag-open must be able to peek its
    // neighbor — next peeks the following chapter's first spread,
    // previous the preceding chapter's last — and the turn fast path
    // commits the peeked artifact unchanged.
    let mut session = ReaderSessionV1::open_owned(123, many_chapter_fixture_epub(4))
        .expect("reader session opens");
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
                ReaderAdjacentDirectionV1::Next,
            ))
            .unwrap_or_else(|error| panic!("chapter {chapter} peeks next: {error:?}"));
        request_id += 1;
        assert_eq!(peeked.locator.href, format!("chapter-{chapter}.xhtml"));
        assert_eq!(session.visible_artifact_id(), Some(current.artifact_id));
        assert!(!session.has_pending_exact_seek_v1());
        assert!(!session.has_pending_adjacent_v1());
        session
            .commit_peeked_artifact(ReaderForegroundHandoffV1 {
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
                ReaderAdjacentDirectionV1::Previous,
            ))
            .unwrap_or_else(|error| panic!("chapter {chapter} peeks previous: {error:?}"));
        request_id += 1;
        assert_eq!(peeked.locator.href, format!("chapter-{chapter}.xhtml"));
        assert!(!session.has_pending_exact_seek_v1());
        session
            .commit_peeked_artifact(ReaderForegroundHandoffV1 {
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
            ReaderAdjacentDirectionV1::Previous,
        ))
        .expect_err("terminal boundary peek declines");
    assert_eq!(boundary.kind, ReaderErrorKindV1::TargetNotPublished);
    assert!(!session.has_pending_exact_seek_v1());
    assert_eq!(session.visible_artifact_id(), Some(current.artifact_id));
}

#[test]
fn artifact_hits_carry_footnote_keys_that_read_back_directly() {
    use crate::runtime::tests::fixture::interaction_target_fixture_epub;
    let mut session = ReaderSessionV1::open_owned(130, interaction_target_fixture_epub())
        .expect("reader session opens");
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
    assert_eq!(footnote.kind, ReaderFootnoteKindV1::Footnote);
    assert!(footnote.text.contains("Runtime note"), "{footnote:?}");
    assert!(footnote.html.contains("Runtime note"), "{footnote:?}");

    let unknown = session
        .read_footnote(visible.artifact_id, "Text/nope.xhtml#missing")
        .expect_err("unknown keys do not resolve");
    assert_eq!(unknown.kind, ReaderErrorKindV1::TargetNotPublished);
}

#[test]
fn chapter_local_artifacts_have_no_book_page_numbering() {
    let mut session = ReaderSessionV1::open_owned(131, long_chapter_window_fixture_epub())
        .expect("reader session opens");
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
    for (label, mut layout) in [
        ("single", crate::runtime::tests::fixture::layout()),
        ("double", crate::runtime::tests::fixture::double_layout()),
    ] {
        // reader_v1 always lays out font-aware; the reference revision
        // must match or the two disagree on advances for reasons that
        // have nothing to do with coordinate space.
        layout.text_measurement = crate::layout::TextMeasurementMode::FontAware;
        let mut document =
            crate::runtime::RuntimeDocument::open_owned(interaction_target_fixture_epub())
                .expect("document opens");
        let summary = document.create_revision(&layout).expect("revision");
        let frame = document
            .get_frame(&summary.revision_id, 0)
            .expect("frame publishes");
        // Where the pen actually draws every href-carrying command. One
        // href can paint more than once (a text link and an image link
        // sharing a target), so origins collect per href.
        let mut painted: std::collections::BTreeMap<String, Vec<(f64, f64)>> =
            std::collections::BTreeMap::new();
        for command in &frame.commands {
            let Some(object) = command.as_object() else {
                continue;
            };
            let (Some(href), Some(rect)) = (
                object.get("href").and_then(|value| value.as_str()),
                object.get("rect").and_then(|value| value.as_object()),
            ) else {
                continue;
            };
            let (Some(x), Some(y)) = (
                rect.get("x").and_then(serde_json::Value::as_f64),
                rect.get("y").and_then(serde_json::Value::as_f64),
            ) else {
                continue;
            };
            painted.entry(href.to_owned()).or_default().push((x, y));
        }
        assert!(!painted.is_empty(), "{label}: fixture must paint links");

        let mut session = ReaderSessionV1::open_owned(150, interaction_target_fixture_epub())
            .expect("reader session opens");
        let artifact = session
            .request_artifact(ReaderArtifactRequestV1 {
                layout: reader_layout(&layout),
                ..request(150, 1, "")
            })
            .expect("artifact resolves");
        let mut checked = 0;
        for hit in artifact.pages.iter().flat_map(|page| page.hits.iter()) {
            let Some(href) = hit.href.as_deref() else {
                continue;
            };
            let origins = painted
                .get(href)
                .unwrap_or_else(|| panic!("{label}: {href:?} is hit but never painted"));
            // The display list's JSON scalars ride the contract's f32
            // decimal snap, so the two carry the same geometry to within
            // that rounding, not bit for bit.
            assert!(
                origins.iter().any(|(x, y)| (x - hit.bounds.x).abs() < 0.01
                    && (y - hit.bounds.y).abs() < 0.01),
                "{label}: hit for {href:?} at {:?} is not where the display list paints it ({origins:?})",
                (hit.bounds.x, hit.bounds.y)
            );
            assert!(
                hit.bounds.x >= layout.margin_left && hit.bounds.y >= layout.margin_top,
                "{label}: hits sit inside the page margins, not at the page corner"
            );
            checked += 1;
        }
        assert!(checked > 0, "{label}: the fixture must publish link hits");
    }
}

#[test]
fn double_spread_hits_carry_their_page_offset() {
    // The right-hand page of a spread is translated by the display list;
    // its hits must carry the same translation or every tap on the right
    // page resolves against the left page's geometry.
    let layout = crate::runtime::tests::fixture::double_layout();
    let mut session =
        ReaderSessionV1::open_owned(151, crate::runtime::tests::fixture::fixture_epub())
            .expect("reader session opens");
    let artifact = session
        .request_artifact(ReaderArtifactRequestV1 {
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

fn reader_layout(config: &crate::layout::LayoutConfig) -> ReaderLayoutV1 {
    ReaderLayoutV1 {
        viewport_width: config.viewport_width,
        viewport_height: config.viewport_height,
        margin_top: config.margin_top,
        margin_right: config.margin_right,
        margin_bottom: config.margin_bottom,
        margin_left: config.margin_left,
        spread_mode: match config.spread_mode {
            crate::layout::SpreadMode::Single => ReaderSpreadModeV1::Single,
            crate::layout::SpreadMode::Double => ReaderSpreadModeV1::Double,
        },
        first_page_alone: config.first_page_alone,
        spread_gap: config.spread_gap,
        root_font_size: config.root_font_size,
        line_height_override: config.line_height_override,
        font_family_override: config.font_family_override.clone(),
    }
}
