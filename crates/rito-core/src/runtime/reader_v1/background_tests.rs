use std::collections::BTreeSet;

use crate::runtime::tests::fixture::{
    cross_chapter_footnote_fixture_epub, source_locator_fixture_epub,
    source_locator_image_fixture_epub,
};

use super::session::READER_LIVE_ARTIFACT_CAP_V1;
use super::*;

#[test]
fn first_artifact_never_waits_for_publication_footnote_index() {
    let mut session = ReaderSessionV1::open_owned(210, cross_chapter_footnote_fixture_epub())
        .expect("reader session opens");
    let visible = session
        .request_artifact(artifact_request(210, 1, "chapter-1.xhtml"))
        .expect("first chapter resolves");

    assert_eq!(session.publication_footnote_source_scan_count(), 1);
    assert_eq!(session.publication_footnote_definition_parse_count(), 0);
    adopt_initial(&mut session, 210, visible.artifact_id);

    for _ in 0..4 {
        let before = session.publication_footnote_source_scan_count()
            + session.publication_footnote_definition_parse_count();
        let step = session
            .advance_background_once(background_request(210, visible.artifact_id, 1))
            .expect("one index quantum advances");
        assert_eq!(step.state, ReaderBackgroundStateV1::Indexing);
        assert!(step.artifact.is_none());
        assert_eq!(session.publication_revision_count(), 0);
        let after = session.publication_footnote_source_scan_count()
            + session.publication_footnote_definition_parse_count();
        assert_eq!(after, before + 1);
    }

    let started = session
        .advance_background_once(background_request(210, visible.artifact_id, 1))
        .expect("publication layout starts only after index completion");
    assert_eq!(started.state, ReaderBackgroundStateV1::Started);
}

#[test]
fn background_call_advances_at_most_one_publication_quantum() {
    let mut session = ReaderSessionV1::open_owned(201, source_locator_fixture_epub())
        .expect("reader session opens");
    let visible = session
        .request_artifact(artifact_request(201, 1, "chapter.xhtml#point-47"))
        .expect("tail intent resolves locally");
    adopt_initial(&mut session, 201, visible.artifact_id);

    let started = advance_past_indexing(&mut session, 201, visible.artifact_id, 1);
    assert_eq!(started.state, ReaderBackgroundStateV1::Started);
    assert!(started.artifact.is_none());
    assert_eq!(session.publication_revision_count(), 1);
    let mut previous_version = publication_version(&session);

    for _ in 0..3 {
        let advanced = session
            .advance_background_once(background_request(201, visible.artifact_id, 1))
            .expect("one publication quantum advances");
        assert_eq!(advanced.state, ReaderBackgroundStateV1::Advanced);
        assert!(advanced.artifact.is_none());
        let next_version = publication_version(&session);
        assert_eq!(
            next_version,
            previous_version + 1,
            "each call must expose exactly one revision-version step"
        );
        previous_version = next_version;
    }

    release_all(&mut session, [visible.artifact_id]);
    assert_eq!(
        session
            .dispose()
            .expect("session disposes")
            .released_artifacts,
        0
    );
}

#[test]
fn newer_seek_makes_old_background_guards_stale_without_mutating_refs_or_intent() {
    let mut session = ReaderSessionV1::open_owned(202, source_locator_fixture_epub())
        .expect("reader session opens");
    let old_visible = session
        .request_artifact(artifact_request(202, 1, "chapter.xhtml#point-47"))
        .expect("old seek resolves");
    adopt_initial(&mut session, 202, old_visible.artifact_id);
    let pending_background = advance_to_candidate(&mut session, 202, old_visible.artifact_id, 64)
        .artifact
        .expect("old intent produces a background candidate");

    let current = session
        .request_artifact(artifact_request(202, 2, "chapter.xhtml#point-40"))
        .expect("newer seek produces a foreground candidate");
    assert_eq!(
        session.visible_artifact_id(),
        Some(old_visible.artifact_id),
        "request completion alone must not replace the visible artifact"
    );
    let live_before_foreground_adoption = session.live_artifact_count();
    let version_before_foreground_adoption = publication_version(&session);
    let blocked_advance = session
        .advance_background_once(background_request(202, old_visible.artifact_id, 1))
        .expect_err("background advancement yields to a pending foreground candidate");
    assert_eq!(blocked_advance.kind, ReaderErrorKindV1::StaleRequest);
    let blocked_handoff = session
        .adopt_background_candidate(ReaderBackgroundHandoffV1 {
            session_id: 202,
            expected_visible_artifact_id: old_visible.artifact_id,
            candidate_artifact_id: pending_background.artifact_id,
        })
        .expect_err("background adoption cannot supersede a foreground candidate");
    assert_eq!(blocked_handoff.kind, ReaderErrorKindV1::StaleRequest);
    assert_eq!(
        session.foreground_candidate_artifact_id(),
        Some(current.artifact_id)
    );
    assert_eq!(
        session.live_artifact_count(),
        live_before_foreground_adoption
    );
    assert_eq!(
        publication_version(&session),
        version_before_foreground_adoption
    );
    adopt_replacement(
        &mut session,
        202,
        old_visible.artifact_id,
        current.artifact_id,
    );
    let live_before = session.live_artifact_count();
    let revisions_before = session.publication_revision_count();
    let version_before = publication_version(&session);

    let stale_background = session
        .advance_background_once(background_request(202, old_visible.artifact_id, 1))
        .expect_err("old visible guard is stale");
    assert_eq!(stale_background.kind, ReaderErrorKindV1::StaleRequest);
    let stale_handoff = session
        .adopt_background_candidate(ReaderBackgroundHandoffV1 {
            session_id: 202,
            expected_visible_artifact_id: old_visible.artifact_id,
            candidate_artifact_id: old_visible.artifact_id,
        })
        .expect_err("old seek cannot adopt into the current intent");
    assert_eq!(stale_handoff.kind, ReaderErrorKindV1::StaleRequest);
    assert_eq!(session.live_artifact_count(), live_before);
    assert_eq!(session.publication_revision_count(), revisions_before);
    assert_eq!(publication_version(&session), version_before);

    let current_step = session
        .advance_background_once(background_request(202, current.artifact_id, 1))
        .expect("current intent remains usable");
    assert_eq!(current_step.intent_request_id, 2);
    assert_eq!(current_step.replaces_artifact_id, current.artifact_id);

    let mut artifact_ids = vec![old_visible.artifact_id, current.artifact_id];
    artifact_ids.push(pending_background.artifact_id);
    artifact_ids.extend(current_step.artifact.map(|artifact| artifact.artifact_id));
    release_all(&mut session, artifact_ids);
    assert_eq!(
        session
            .dispose()
            .expect("session disposes")
            .released_artifacts,
        0
    );
}

#[test]
fn background_candidate_adoption_is_cas_and_keeps_replaced_artifact_live() {
    let mut session = ReaderSessionV1::open_owned(203, source_locator_fixture_epub())
        .expect("reader session opens");
    let local = session
        .request_artifact(artifact_request(203, 1, "chapter.xhtml#point-0"))
        .expect("local first frame resolves");
    adopt_initial(&mut session, 203, local.artifact_id);
    let candidate_step = advance_to_candidate(&mut session, 203, local.artifact_id, 64);
    let candidate = candidate_step.artifact.expect("handoff candidate exists");
    assert_eq!(candidate_step.intent_request_id, 1);
    assert_eq!(candidate_step.replaces_artifact_id, local.artifact_id);
    assert_eq!(session.live_artifact_count(), 2);

    let wrong = session
        .adopt_background_candidate(ReaderBackgroundHandoffV1 {
            session_id: 203,
            expected_visible_artifact_id: local.artifact_id,
            candidate_artifact_id: local.artifact_id,
        })
        .expect_err("a non-pending artifact is not a handoff candidate");
    assert_eq!(wrong.kind, ReaderErrorKindV1::StaleRequest);
    assert_eq!(session.live_artifact_count(), 2);

    let handoff = ReaderBackgroundHandoffV1 {
        session_id: 203,
        expected_visible_artifact_id: local.artifact_id,
        candidate_artifact_id: candidate.artifact_id,
    };
    let ack = session
        .adopt_background_candidate(handoff)
        .expect("matching candidate adopts atomically");
    assert_eq!(ack.intent_request_id, 1);
    assert_eq!(ack.replaced_artifact_id, local.artifact_id);
    assert_eq!(ack.visible_artifact_id, candidate.artifact_id);
    assert_eq!(
        session.live_artifact_count(),
        2,
        "adoption must not release the old local artifact behind the host"
    );

    let repeated = session
        .adopt_background_candidate(handoff)
        .expect_err("the same CAS cannot be applied twice");
    assert_eq!(repeated.kind, ReaderErrorKindV1::StaleRequest);
    let no_longer_pending = session
        .adopt_background_candidate(ReaderBackgroundHandoffV1 {
            session_id: 203,
            expected_visible_artifact_id: candidate.artifact_id,
            candidate_artifact_id: candidate.artifact_id,
        })
        .expect_err("adopted artifact is no longer pending");
    assert_eq!(no_longer_pending.kind, ReaderErrorKindV1::StaleRequest);
    assert_eq!(session.live_artifact_count(), 2);

    assert!(session
        .release_artifact(local.artifact_id)
        .expect("host releases replaced local artifact"));
    assert_eq!(session.live_artifact_count(), 1);
    assert!(session
        .release_artifact(candidate.artifact_id)
        .expect("host releases adopted publication artifact"));
    assert_eq!(
        session
            .dispose()
            .expect("session disposes")
            .released_artifacts,
        0
    );
}

#[test]
fn releasing_current_visible_fails_closed_without_orphaning_background_candidate() {
    let mut session = ReaderSessionV1::open_owned(208, source_locator_fixture_epub())
        .expect("reader session opens");
    let visible = session
        .request_artifact(artifact_request(208, 1, "chapter.xhtml#point-0"))
        .expect("initial foreground candidate resolves");
    adopt_initial(&mut session, 208, visible.artifact_id);
    let pending = advance_to_candidate(&mut session, 208, visible.artifact_id, 64)
        .artifact
        .expect("background candidate exists");
    assert_eq!(session.live_artifact_count(), 2);

    assert!(session
        .release_artifact(visible.artifact_id)
        .expect("current visible artifact releases"));
    assert!(!session.has_visible_intent());
    assert_eq!(session.visible_artifact_id(), None);
    let background = session
        .advance_background_once(background_request(208, visible.artifact_id, 1))
        .expect_err("released visible intent cannot schedule background work");
    assert_eq!(background.kind, ReaderErrorKindV1::InvalidRequest);
    let handoff = session
        .adopt_background_candidate(ReaderBackgroundHandoffV1 {
            session_id: 208,
            expected_visible_artifact_id: visible.artifact_id,
            candidate_artifact_id: pending.artifact_id,
        })
        .expect_err("pending background handoff fails closed with no visible intent");
    assert_eq!(handoff.kind, ReaderErrorKindV1::InvalidRequest);
    assert_eq!(session.live_artifact_count(), 1);
    assert!(session
        .release_artifact(pending.artifact_id)
        .expect("host can still release the independently owned candidate"));
    assert_eq!(session.live_artifact_count(), 0);
    assert_eq!(
        session
            .dispose()
            .expect("session disposes publication owner")
            .released_artifacts,
        0
    );
}

#[test]
fn adopted_publication_keeps_advancing_and_owns_adjacent_resources_and_disposal() {
    let mut session = ReaderSessionV1::open_owned(204, source_locator_image_fixture_epub())
        .expect("reader session opens");
    let local = session
        .request_artifact(artifact_request(204, 1, "chapter.xhtml#point-0"))
        .expect("image-bearing local frame resolves");
    adopt_initial(&mut session, 204, local.artifact_id);
    let candidate = advance_to_candidate(&mut session, 204, local.artifact_id, 1)
        .artifact
        .expect("publication candidate exists");
    session
        .adopt_background_candidate(ReaderBackgroundHandoffV1 {
            session_id: 204,
            expected_visible_artifact_id: local.artifact_id,
            candidate_artifact_id: candidate.artifact_id,
        })
        .expect("publication candidate adopts");

    let image = candidate
        .resources
        .iter()
        .find(|resource| resource.kind == ReaderResourceKindV1::Image)
        .expect("candidate declares the fixture image")
        .clone();
    let resource = session
        .read_resource(candidate.artifact_id, image.kind, &image.href)
        .expect("adopted publication artifact owns its resource");
    assert!(!resource.bytes.is_empty());

    let mut observed_advance = false;
    for _ in 0..128 {
        let before = publication_version(&session);
        let step = session
            .advance_background_once(background_request(204, candidate.artifact_id, 1))
            .expect("adopted publication continues cooperatively");
        match step.state {
            ReaderBackgroundStateV1::Advanced => {
                assert!(step.artifact.is_none());
                observed_advance = true;
                assert_eq!(publication_version(&session), before + 1);
            }
            ReaderBackgroundStateV1::Complete => {
                assert_eq!(publication_version(&session), before);
                // Completion offers one last candidate so the host can
                // learn the book's page count without turning a page.
                let final_candidate = step
                    .artifact
                    .expect("completion offers a final candidate");
                assert!(final_candidate.book_page_count.is_some(), "{final_candidate:?}");
                session
                    .release_artifact(final_candidate.artifact_id)
                    .expect("the completion candidate releases");
                break;
            }
            state => panic!("unexpected post-adoption background state: {state:?}"),
        }
    }
    assert!(observed_advance, "fixture must exercise post-adoption work");

    let next = session
        .request_adjacent(adjacent_request(
            204,
            2,
            candidate.artifact_id,
            ReaderAdjacentDirectionV1::Next,
        ))
        .expect("published adjacent spread projects without local reflow");
    assert_eq!(next.revision_id, candidate.revision_id);
    assert_ne!(next.artifact_id, candidate.artifact_id);

    assert!(session
        .release_artifact(local.artifact_id)
        .expect("replaced local artifact releases explicitly"));
    assert!(session
        .release_artifact(candidate.artifact_id)
        .expect("publication source artifact releases independently"));
    let disposed = session
        .dispose()
        .expect("remaining publication sibling disposes");
    assert_eq!(disposed.released_artifacts, 1);
}

#[test]
fn unpublished_publication_adjacent_advances_one_retained_foreground_quantum() {
    let mut session = ReaderSessionV1::open_owned(209, source_locator_fixture_epub())
        .expect("reader session opens");
    let local = session
        .request_artifact(artifact_request(209, 1, "chapter.xhtml#point-0"))
        .expect("local first frame resolves");
    adopt_initial(&mut session, 209, local.artifact_id);
    let publication = advance_to_candidate(&mut session, 209, local.artifact_id, 1)
        .artifact
        .expect("first publication spread becomes a candidate");
    session
        .adopt_background_candidate(ReaderBackgroundHandoffV1 {
            session_id: 209,
            expected_visible_artifact_id: local.artifact_id,
            candidate_artifact_id: publication.artifact_id,
        })
        .expect("publication candidate adopts");

    let mut adjacent = adjacent_request(
        209,
        2,
        publication.artifact_id,
        ReaderAdjacentDirectionV1::Next,
    );
    adjacent.work.max_top_level_nodes_per_quantum = 1;
    adjacent.work.max_foreground_quanta = 1;
    let before = publication_version(&session);
    let pending = session
        .request_adjacent(adjacent)
        .expect_err("one foreground quantum cannot publish the next spread");
    assert_eq!(pending.kind, ReaderErrorKindV1::TargetNotPublished);
    assert!(session.has_pending_adjacent_v1());
    assert_eq!(publication_version(&session), before + 1);
    let background = session
        .advance_background_once(background_request(209, publication.artifact_id, 1))
        .expect_err("background yields while publication adjacent owns continuation");
    assert_eq!(background.kind, ReaderErrorKindV1::StaleRequest);

    let mut resolved = None;
    for request_id in 3..=128 {
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
    let resolved = resolved.expect("retained publication work eventually publishes adjacent");
    assert_eq!(resolved.revision_id, publication.revision_id);
    assert!(!session.has_pending_adjacent_v1());
    assert_eq!(session.visible_artifact_id(), Some(publication.artifact_id));

    release_all(
        &mut session,
        [
            local.artifact_id,
            publication.artifact_id,
            resolved.artifact_id,
        ],
    );
    assert_eq!(
        session
            .dispose()
            .expect("publication session disposes")
            .released_artifacts,
        0
    );
}

#[test]
fn foreground_adjacent_replaces_intent_and_stales_old_background_request() {
    let mut session = ReaderSessionV1::open_owned(205, source_locator_fixture_epub())
        .expect("reader session opens");
    let first = session
        .request_artifact(artifact_request(205, 1, "chapter.xhtml#point-0"))
        .expect("first local artifact resolves");
    adopt_initial(&mut session, 205, first.artifact_id);
    let old_step = advance_past_indexing(&mut session, 205, first.artifact_id, 1);
    let old_candidates = old_step
        .artifact
        .as_ref()
        .map(|artifact| artifact.artifact_id)
        .into_iter()
        .collect::<Vec<_>>();

    let next = session
        .request_adjacent(adjacent_request(
            205,
            2,
            first.artifact_id,
            ReaderAdjacentDirectionV1::Next,
        ))
        .expect("foreground adjacent spread produces a candidate");
    assert_eq!(session.visible_artifact_id(), Some(first.artifact_id));
    let live_before_blocked_background = session.live_artifact_count();
    let version_before_blocked_background = publication_version(&session);
    let before_adoption_error = session
        .advance_background_once(background_request(205, first.artifact_id, 1))
        .expect_err("background work must yield to the pending foreground candidate");
    assert_eq!(before_adoption_error.kind, ReaderErrorKindV1::StaleRequest);
    assert_eq!(
        session.live_artifact_count(),
        live_before_blocked_background
    );
    assert_eq!(
        publication_version(&session),
        version_before_blocked_background
    );
    adopt_replacement(&mut session, 205, first.artifact_id, next.artifact_id);
    let live_before_stale = session.live_artifact_count();
    let version_before_stale = publication_version(&session);
    let stale = session
        .advance_background_once(background_request(205, first.artifact_id, 1))
        .expect_err("old foreground artifact no longer guards background work");
    assert_eq!(stale.kind, ReaderErrorKindV1::StaleRequest);
    assert_eq!(session.live_artifact_count(), live_before_stale);
    assert_eq!(publication_version(&session), version_before_stale);

    let current_step = session
        .advance_background_once(background_request(205, next.artifact_id, 1))
        .expect("adjacent artifact owns the current intent");
    assert_eq!(current_step.intent_request_id, 2);
    assert_eq!(current_step.replaces_artifact_id, next.artifact_id);

    let mut ids = vec![first.artifact_id, next.artifact_id];
    ids.extend(old_candidates);
    ids.extend(current_step.artifact.map(|artifact| artifact.artifact_id));
    release_all(&mut session, ids);
    assert_eq!(
        session
            .dispose()
            .expect("session disposes")
            .released_artifacts,
        0
    );
}

#[test]
fn same_layout_seek_reuses_existing_publication_without_another_quantum() {
    let mut session = ReaderSessionV1::open_owned(206, source_locator_fixture_epub())
        .expect("reader session opens");
    let first_local = session
        .request_artifact(artifact_request(206, 1, "chapter.xhtml#point-47"))
        .expect("tail local artifact resolves");
    adopt_initial(&mut session, 206, first_local.artifact_id);
    let first_publication = advance_to_candidate(&mut session, 206, first_local.artifact_id, 64)
        .artifact
        .expect("first publication candidate exists");
    session
        .adopt_background_candidate(ReaderBackgroundHandoffV1 {
            session_id: 206,
            expected_visible_artifact_id: first_local.artifact_id,
            candidate_artifact_id: first_publication.artifact_id,
        })
        .expect("first publication candidate adopts");
    assert!(session
        .release_artifact(first_local.artifact_id)
        .expect("old local artifact releases"));

    let second_local = session
        .request_artifact(artifact_request(206, 2, "chapter.xhtml#point-10"))
        .expect("same-layout seek resolves locally");
    adopt_replacement(
        &mut session,
        206,
        first_publication.artifact_id,
        second_local.artifact_id,
    );
    let version_before = publication_version(&session);
    let reused = session
        .advance_background_once(background_request(206, second_local.artifact_id, 1))
        .expect("covered locator reuses the existing publication");
    assert_eq!(reused.state, ReaderBackgroundStateV1::Reused);
    assert_eq!(reused.intent_request_id, 2);
    assert_eq!(reused.replaces_artifact_id, second_local.artifact_id);
    let reused_artifact = reused.artifact.expect("reuse returns a handoff candidate");
    assert_eq!(reused_artifact.revision_id, first_publication.revision_id);
    assert_eq!(session.publication_revision_count(), 1);
    assert_eq!(publication_version(&session), version_before);

    release_all(
        &mut session,
        [
            first_publication.artifact_id,
            second_local.artifact_id,
            reused_artifact.artifact_id,
        ],
    );
    assert_eq!(
        session
            .dispose()
            .expect("session disposes")
            .released_artifacts,
        0
    );
}

#[test]
fn live_artifact_cap_requires_and_then_consumes_one_candidate_reserve() {
    let mut session = ReaderSessionV1::open_owned(207, source_locator_fixture_epub())
        .expect("reader session opens");
    let mut locals = Vec::new();
    for request_id in 1..=u64::from(READER_LIVE_ARTIFACT_CAP_V1) {
        locals.push(
            session
                .request_artifact(artifact_request(207, request_id, "chapter.xhtml#point-0"))
                .expect("foreground artifact fits the live cap"),
        );
    }
    adopt_initial(
        &mut session,
        207,
        locals.last().expect("latest local").artifact_id,
    );
    assert_eq!(session.live_artifact_count(), READER_LIVE_ARTIFACT_CAP_V1);

    let no_reserve = session
        .advance_background_once(background_request(
            207,
            locals.last().expect("latest local").artifact_id,
            64,
        ))
        .expect_err("background candidate cannot exceed the live cap");
    assert_eq!(no_reserve.kind, ReaderErrorKindV1::InvalidRequest);
    assert_eq!(session.publication_revision_count(), 0);
    assert_eq!(session.live_artifact_count(), READER_LIVE_ARTIFACT_CAP_V1);

    assert!(session
        .release_artifact(locals[0].artifact_id)
        .expect("host opens one candidate reserve"));
    let latest = locals.last().expect("latest local");
    let candidate_step = advance_to_candidate(&mut session, 207, latest.artifact_id, 64);
    let candidate = candidate_step
        .artifact
        .expect("reserve holds one candidate");
    assert_eq!(session.live_artifact_count(), READER_LIVE_ARTIFACT_CAP_V1);
    assert_eq!(session.publication_revision_count(), 1);

    let pending = session
        .advance_background_once(background_request(207, latest.artifact_id, 64))
        .expect("pending candidate does not allocate a duplicate");
    assert_eq!(pending.state, ReaderBackgroundStateV1::CandidatePending);
    assert!(pending.artifact.is_none());
    assert_eq!(session.live_artifact_count(), READER_LIVE_ARTIFACT_CAP_V1);

    let next_request_id = u64::from(READER_LIVE_ARTIFACT_CAP_V1) + 1;
    let capped_foreground = session
        .request_artifact(artifact_request(207, next_request_id, "chapter.xhtml#point-1"))
        .expect_err("foreground cannot exceed the live cap");
    assert_eq!(capped_foreground.kind, ReaderErrorKindV1::InvalidRequest);
    assert!(session
        .release_artifact(candidate.artifact_id)
        .expect("candidate reserve releases explicitly"));
    let fifth = session
        .request_artifact(artifact_request(207, next_request_id, "chapter.xhtml#point-1"))
        .expect("capacity failure does not consume the request id");

    let mut ids = locals
        .iter()
        .skip(1)
        .map(|artifact| artifact.artifact_id)
        .collect::<Vec<_>>();
    ids.push(fifth.artifact_id);
    release_all(&mut session, ids);
    assert_eq!(
        session
            .dispose()
            .expect("session disposes")
            .released_artifacts,
        0
    );
}

fn artifact_request(session_id: u64, request_id: u64, href: &str) -> ReaderArtifactRequestV1 {
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
            max_top_level_nodes_per_quantum: 64,
            max_foreground_quanta: 128,
            local_page_cap: 16,
        },
        text_profile: ReaderTextRenderingProfileV1::PlatformStringRuns,
    }
}

fn adjacent_request(
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

fn background_request(
    session_id: u64,
    expected_visible_artifact_id: u64,
    max_top_level_nodes_per_quantum: u32,
) -> ReaderBackgroundRequestV1 {
    ReaderBackgroundRequestV1 {
        session_id,
        expected_visible_artifact_id,
        max_top_level_nodes_per_quantum,
    }
}

fn adopt_initial(session: &mut ReaderSessionV1, session_id: u64, candidate_artifact_id: u64) {
    let ack = session
        .adopt_foreground_candidate(ReaderForegroundHandoffV1 {
            session_id,
            expected_visible_artifact_id: None,
            candidate_artifact_id,
        })
        .expect("initial foreground candidate adopts");
    assert_eq!(ack.replaced_artifact_id, None);
    assert_eq!(ack.visible_artifact_id, candidate_artifact_id);
}

fn adopt_replacement(
    session: &mut ReaderSessionV1,
    session_id: u64,
    expected_visible_artifact_id: u64,
    candidate_artifact_id: u64,
) {
    let ack = session
        .adopt_foreground_candidate(ReaderForegroundHandoffV1 {
            session_id,
            expected_visible_artifact_id: Some(expected_visible_artifact_id),
            candidate_artifact_id,
        })
        .expect("replacement foreground candidate adopts");
    assert_eq!(ack.replaced_artifact_id, Some(expected_visible_artifact_id));
    assert_eq!(ack.visible_artifact_id, candidate_artifact_id);
}

fn advance_to_candidate(
    session: &mut ReaderSessionV1,
    session_id: u64,
    visible_artifact_id: u64,
    max_top_level_nodes_per_quantum: u32,
) -> ReaderBackgroundAdvanceV1 {
    for _ in 0..256 {
        let step = session
            .advance_background_once(background_request(
                session_id,
                visible_artifact_id,
                max_top_level_nodes_per_quantum,
            ))
            .expect("background step succeeds");
        if step.artifact.is_some() {
            return step;
        }
        assert_ne!(
            step.state,
            ReaderBackgroundStateV1::Complete,
            "publication completed without covering the canonical visible locator"
        );
    }
    panic!("background did not produce a candidate within the fixture bound");
}

fn advance_past_indexing(
    session: &mut ReaderSessionV1,
    session_id: u64,
    visible_artifact_id: u64,
    max_top_level_nodes_per_quantum: u32,
) -> ReaderBackgroundAdvanceV1 {
    for _ in 0..256 {
        let step = session
            .advance_background_once(background_request(
                session_id,
                visible_artifact_id,
                max_top_level_nodes_per_quantum,
            ))
            .expect("background index/layout step succeeds");
        if step.state != ReaderBackgroundStateV1::Indexing {
            return step;
        }
        assert!(step.artifact.is_none());
        assert_eq!(session.publication_revision_count(), 0);
    }
    panic!("background indexing did not complete within the fixture bound");
}

fn publication_version(session: &ReaderSessionV1) -> u32 {
    session
        .active_publication_revision_version()
        .expect("active publication revision exists")
}

fn release_all(session: &mut ReaderSessionV1, artifact_ids: impl IntoIterator<Item = u64>) {
    for artifact_id in artifact_ids.into_iter().collect::<BTreeSet<_>>() {
        assert!(session
            .release_artifact(artifact_id)
            .expect("live artifact releases"));
    }
}

fn plate_adjacent(
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

#[test]
fn publication_turns_cross_image_only_plates_in_both_directions() {
    use crate::runtime::tests::fixture::image_plate_fixture_epub;
    let mut session = ReaderSessionV1::open_owned(220, image_plate_fixture_epub())
        .expect("reader session opens");
    let visible = session
        .request_artifact(artifact_request(220, 1, "chapter-0.xhtml"))
        .expect("first chapter resolves");
    adopt_initial(&mut session, 220, visible.artifact_id);

    let candidate = advance_to_candidate(&mut session, 220, visible.artifact_id, 64)
        .artifact
        .expect("publication produces a handoff candidate");
    session
        .adopt_background_candidate(ReaderBackgroundHandoffV1 {
            session_id: 220,
            expected_visible_artifact_id: visible.artifact_id,
            candidate_artifact_id: candidate.artifact_id,
        })
        .expect("publication candidate adopts");
    // Finish publication layout so every spread is published.
    for _ in 0..256 {
        let step = session
            .advance_background_once(background_request(220, candidate.artifact_id, 64))
            .expect("background completes");
        if step.state == ReaderBackgroundStateV1::Complete {
            break;
        }
    }

    // Turn forward through the image-only plate to the last chapter,
    // then all the way back. Every spread must publish an artifact —
    // text-free plates included (the durable-anchor fallback).
    let mut current = candidate.clone();
    let mut request_id = 100;
    let mut forward = Vec::new();
    loop {
        let step = session.request_adjacent(plate_adjacent(
            220,
            request_id,
            current.artifact_id,
            ReaderAdjacentDirectionV1::Next,
        ));
        request_id += 1;
        match step {
            Ok(next) => {
                adopt_replacement(&mut session, 220, current.artifact_id, next.artifact_id);
                session
                    .release_artifact(current.artifact_id)
                    .expect("old spread releases");
                forward.push(next.local_spread_index);
                current = next;
            }
            Err(error) => {
                assert_eq!(
                    error.kind,
                    ReaderErrorKindV1::TargetNotPublished,
                    "forward turn must only stop at the publication boundary: {error:?}"
                );
                assert!(error.message.contains("terminal"), "{error:?}");
                break;
            }
        }
    }
    assert!(
        forward.len() >= 2,
        "the book must span the plate: {forward:?}"
    );

    loop {
        let step = session.request_adjacent(plate_adjacent(
            220,
            request_id,
            current.artifact_id,
            ReaderAdjacentDirectionV1::Previous,
        ));
        request_id += 1;
        match step {
            Ok(previous) => {
                adopt_replacement(&mut session, 220, current.artifact_id, previous.artifact_id);
                session
                    .release_artifact(current.artifact_id)
                    .expect("old spread releases");
                current = previous;
            }
            Err(error) => {
                assert_eq!(
                    error.kind,
                    ReaderErrorKindV1::TargetNotPublished,
                    "backward turn must only stop at the publication boundary: {error:?}"
                );
                assert!(error.message.contains("terminal"), "{error:?}");
                break;
            }
        }
    }
    assert_eq!(current.local_spread_index, 0);
}

#[test]
fn peek_and_fast_commit_work_from_publication_artifacts() {
    use crate::runtime::tests::fixture::image_plate_fixture_epub;
    let mut session = ReaderSessionV1::open_owned(221, image_plate_fixture_epub())
        .expect("reader session opens");
    let visible = session
        .request_artifact(artifact_request(221, 1, "chapter-0.xhtml"))
        .expect("first chapter resolves");
    adopt_initial(&mut session, 221, visible.artifact_id);
    let candidate = advance_to_candidate(&mut session, 221, visible.artifact_id, 64)
        .artifact
        .expect("publication produces a handoff candidate");
    session
        .adopt_background_candidate(ReaderBackgroundHandoffV1 {
            session_id: 221,
            expected_visible_artifact_id: visible.artifact_id,
            candidate_artifact_id: candidate.artifact_id,
        })
        .expect("publication candidate adopts");

    // The adopted spread's neighbor may not be laid out by the
    // background pump yet — peek must reach it with its own bounded
    // cooperative pagination, exactly like a forward turn would.
    let peeked = session
        .peek_adjacent(plate_adjacent(
            221,
            50,
            candidate.artifact_id,
            ReaderAdjacentDirectionV1::Next,
        ))
        .expect("publication neighbor peeks");
    assert_eq!(peeked.local_spread_index, candidate.local_spread_index + 1);

    let ack = session
        .commit_peeked_artifact(ReaderForegroundHandoffV1 {
            session_id: 221,
            expected_visible_artifact_id: Some(candidate.artifact_id),
            candidate_artifact_id: peeked.artifact_id,
        })
        .expect("peeked publication artifact commits");
    assert_eq!(ack.visible_artifact_id, peeked.artifact_id);
    assert_eq!(ack.replaced_artifact_id, Some(candidate.artifact_id));

    let back = session
        .peek_adjacent(plate_adjacent(
            221,
            51,
            peeked.artifact_id,
            ReaderAdjacentDirectionV1::Previous,
        ))
        .expect("previous publication neighbor peeks");
    assert_eq!(back.local_spread_index, candidate.local_spread_index);
}

#[test]
fn publication_artifacts_number_pages_book_wide() {
    use crate::runtime::tests::fixture::image_plate_fixture_epub;
    let mut session = ReaderSessionV1::open_owned(222, image_plate_fixture_epub())
        .expect("reader session opens");
    let visible = session
        .request_artifact(artifact_request(222, 1, "chapter-0.xhtml"))
        .expect("first chapter resolves");
    // Before the whole-book layout exists there is no book numbering.
    assert_eq!(visible.book_page_index, None);
    assert_eq!(visible.book_page_count, None);
    adopt_initial(&mut session, 222, visible.artifact_id);

    let candidate = advance_to_candidate(&mut session, 222, visible.artifact_id, 64)
        .artifact
        .expect("publication produces a handoff candidate");
    // The publication candidate is book-wide numbered from the start;
    // the total only appears once its layout is complete.
    assert_eq!(candidate.book_page_index, Some(0));
    session
        .adopt_background_candidate(ReaderBackgroundHandoffV1 {
            session_id: 222,
            expected_visible_artifact_id: visible.artifact_id,
            candidate_artifact_id: candidate.artifact_id,
        })
        .expect("publication candidate adopts");
    for _ in 0..256 {
        let step = session
            .advance_background_once(background_request(222, candidate.artifact_id, 64))
            .expect("background advances");
        if step.state == ReaderBackgroundStateV1::Complete {
            break;
        }
    }

    let second = session
        .request_adjacent(plate_adjacent(
            222,
            60,
            candidate.artifact_id,
            ReaderAdjacentDirectionV1::Next,
        ))
        .expect("next spread resolves");
    let count = second
        .book_page_count
        .expect("a completed publication publishes its page count");
    assert!(count >= 2, "{count}");
    assert_eq!(second.book_page_index, Some(1));
    assert!(
        second.book_page_index.is_some_and(|index| index < count),
        "book page index must fall inside the book: {second:?}"
    );
}

#[test]
fn completion_hands_the_book_page_count_to_a_reader_who_never_turns() {
    use crate::runtime::tests::fixture::many_chapter_fixture_epub;
    // Long enough that the first handoff candidate is minted while the
    // whole-book layout is still growing — the exact window where the
    // total used to be unreachable without a page turn.
    let mut session = ReaderSessionV1::open_owned(223, many_chapter_fixture_epub(24))
        .expect("reader session opens");
    let visible = session
        .request_artifact(artifact_request(223, 1, "chapter-0.xhtml"))
        .expect("first chapter resolves");
    adopt_initial(&mut session, 223, visible.artifact_id);
    let candidate = advance_to_candidate(&mut session, 223, visible.artifact_id, 64)
        .artifact
        .expect("publication produces a handoff candidate");
    assert_eq!(
        candidate.book_page_count, None,
        "an in-progress layout has no total yet"
    );
    session
        .adopt_background_candidate(ReaderBackgroundHandoffV1 {
            session_id: 223,
            expected_visible_artifact_id: visible.artifact_id,
            candidate_artifact_id: candidate.artifact_id,
        })
        .expect("publication candidate adopts");
    session
        .release_artifact(visible.artifact_id)
        .expect("the chapter-local artifact releases");

    // Pump to completion without ever turning a page.
    let mut final_candidate = None;
    let mut completions = 0;
    for _ in 0..512 {
        let step = session
            .advance_background_once(background_request(223, candidate.artifact_id, 64))
            .expect("background advances");
        if step.state == ReaderBackgroundStateV1::Complete {
            completions += 1;
            if let Some(artifact) = step.artifact {
                assert!(final_candidate.is_none(), "the offer must happen once");
                final_candidate = Some(artifact);
            }
            if completions >= 3 {
                break;
            }
        }
    }
    let final_candidate =
        final_candidate.expect("completion offers a candidate carrying the total");
    assert!(completions >= 3, "later Complete steps must stay quiet");
    let total = final_candidate
        .book_page_count
        .expect("the completion candidate carries the book page count");
    assert!(total >= 1, "{total}");
    assert_eq!(
        final_candidate.book_page_index, candidate.book_page_index,
        "the completion candidate is the same page, only better numbered"
    );

    // It rides the ordinary adopt channel — no new host API.
    session
        .adopt_background_candidate(ReaderBackgroundHandoffV1 {
            session_id: 223,
            expected_visible_artifact_id: candidate.artifact_id,
            candidate_artifact_id: final_candidate.artifact_id,
        })
        .expect("the completion candidate adopts like any other");
}
