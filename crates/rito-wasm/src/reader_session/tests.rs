use std::{
    fs,
    io::{Cursor, Write},
    path::Path,
};

fn open_test_projection(
    publication: Vec<u8>,
    session_id: u64,
) -> Result<ReaderSessionProjection, super::ReaderProjectionError> {
    ReaderSessionProjection::open_with_pinned_font_policy(
        publication,
        session_id,
        crate::tests::fixture::pinned_test_policy_input(),
    )
}

use rito_core::runtime::{
    decode_reader_adjacent_request, decode_reader_artifact, decode_reader_artifact_request,
    decode_reader_background_advance, decode_reader_background_handoff,
    decode_reader_background_handoff_ack, decode_reader_background_request,
    decode_reader_foreground_handoff_ack, decode_reader_resource, encode_reader_adjacent_request,
    encode_reader_artifact, encode_reader_artifact_request, encode_reader_background_advance,
    encode_reader_background_handoff, encode_reader_background_handoff_ack,
    encode_reader_background_request, encode_reader_foreground_handoff, encode_reader_resource,
    ReaderAdjacentDirection, ReaderAdjacentRequest, ReaderArtifactRequest, ReaderBackgroundAdvance,
    ReaderBackgroundHandoff, ReaderBackgroundRequest, ReaderBackgroundState, ReaderError,
    ReaderErrorKind, ReaderForegroundHandoff, ReaderLayout, ReaderLocator, ReaderResourceKind,
    ReaderSession, ReaderSpreadMode, ReaderTextRenderingProfile,
    READER_BACKGROUND_HANDOFF_WIRE_BYTES, READER_BACKGROUND_REQUEST_WIRE_BYTES,
    READER_FOREGROUND_HANDOFF_WIRE_BYTES, READER_WIRE_HEADER_BYTES,
};
use zip::{write::FileOptions, ZipWriter};

use super::{
    ReaderProjectionError, ReaderProjectionErrorCode, ReaderSessionProjection, RitoReaderSession,
};

const SESSION_ID: u64 = (1u64 << 60) + 41;

#[test]
fn wasm_error_codes_match_actionable_core_reader_kinds() {
    for (kind, expected) in [
        (
            ReaderErrorKind::StaleRequest,
            ReaderProjectionErrorCode::StaleRequest,
        ),
        (
            ReaderErrorKind::TargetNotPublished,
            ReaderProjectionErrorCode::TargetNotPublished,
        ),
        (
            ReaderErrorKind::UnsupportedTextProfile,
            ReaderProjectionErrorCode::UnsupportedTextProfile,
        ),
    ] {
        let projected = ReaderProjectionError::from(ReaderError {
            kind,
            message: "typed code probe".to_owned(),
        });
        assert_eq!(projected.code, expected);
    }
}

#[test]
fn wasm_pending_query_projects_retained_adjacent_without_message_parsing() {
    let mut projection =
        open_test_projection(source_locator_fixture_epub(), SESSION_ID).expect("projection opens");
    // One-pass: the open resolves immediately, and an adjacent turn on a
    // whole-chapter revision publishes without retained cooperative work.
    let artifact_wire = projection
        .request_artifact(&request_wire(SESSION_ID, 1, "chapter.xhtml#point-0"))
        .expect("exact locator resolves in one request");
    let artifact = decode_reader_artifact(&artifact_wire).expect("artifact decodes");

    projection
        .request_adjacent(&adjacent_wire(
            SESSION_ID,
            2,
            artifact.artifact_id,
            ReaderAdjacentDirection::Next,
        ))
        .expect("the adjacent page publishes in one request");
    assert!(!projection.has_pending_adjacent());

    let wasm = RitoReaderSession { inner: projection };
    assert!(!wasm.has_pending_adjacent());
}

#[test]
fn foreground_handoff_binding_rejects_wrong_length_and_preserves_candidate_after_failed_cas() {
    let mut projection =
        open_test_projection(source_locator_fixture_epub(), SESSION_ID).expect("projection opens");
    let initial_wire = projection
        .request_artifact(&request_wire(SESSION_ID, 1, "chapter.xhtml#point-1"))
        .expect("initial candidate resolves");
    let initial = decode_reader_artifact(&initial_wire).expect("initial candidate decodes");
    let initial_handoff = foreground_handoff_wire(SESSION_ID, None, initial.artifact_id);
    assert_eq!(
        initial_handoff.len(),
        usize::try_from(READER_FOREGROUND_HANDOFF_WIRE_BYTES)
            .expect("foreground handoff size fits usize")
    );

    let wrong_length = projection
        .adopt_foreground_candidate(&initial_handoff[..initial_handoff.len() - 1])
        .expect_err("truncated foreground handoff is rejected");
    assert_eq!(wrong_length.code, ReaderProjectionErrorCode::InvalidWire);

    let initial_ack_wire = projection
        .adopt_foreground_candidate(&initial_handoff)
        .expect("initial foreground candidate adopts");
    let initial_ack = decode_reader_foreground_handoff_ack(&initial_ack_wire)
        .expect("initial foreground acknowledgement decodes");
    assert_eq!(initial_ack.intent_request_id, 1);
    assert_eq!(initial_ack.replaced_artifact_id, None);
    assert_eq!(initial_ack.visible_artifact_id, initial.artifact_id);

    let replacement_wire = projection
        .request_artifact(&request_wire(SESSION_ID, 2, "chapter.xhtml#point-2"))
        .expect("replacement candidate resolves");
    let replacement =
        decode_reader_artifact(&replacement_wire).expect("replacement candidate decodes");
    let stale = projection
        .adopt_foreground_candidate(&foreground_handoff_wire(
            SESSION_ID,
            None,
            replacement.artifact_id,
        ))
        .expect_err("replacement cannot use the initial CAS guard");
    assert_eq!(stale.code, ReaderProjectionErrorCode::StaleRequest);

    let mut wasm = RitoReaderSession { inner: projection };
    let replacement_ack_wire = wasm
        .adopt_foreground_candidate(foreground_handoff_wire(
            SESSION_ID,
            Some(initial.artifact_id),
            replacement.artifact_id,
        ))
        .unwrap_or_else(|_| panic!("WASM replacement handoff adopts"));
    let replacement_ack = decode_reader_foreground_handoff_ack(&replacement_ack_wire)
        .expect("replacement foreground acknowledgement decodes");
    assert_eq!(replacement_ack.intent_request_id, 2);
    assert_eq!(
        replacement_ack.replaced_artifact_id,
        Some(initial.artifact_id)
    );
    assert_eq!(replacement_ack.visible_artifact_id, replacement.artifact_id);
}

#[test]
fn wasm_projection_is_byte_identical_to_core_for_a_nonfirst_page_locator() {
    let publication = source_locator_fixture_epub();
    let request_wire = request_wire(SESSION_ID, 7, "chapter.xhtml#point-47");

    let mut direct = ReaderSession::open_owned_with_pinned_font_policy(
        SESSION_ID,
        publication.clone(),
        crate::tests::fixture::pinned_test_policy_input(),
    )
    .expect("direct Core session opens");
    let direct_request =
        decode_reader_artifact_request(&request_wire).expect("request wire decodes");
    let direct_artifact = direct
        .request_artifact(direct_request)
        .expect("direct Core artifact resolves");
    let direct_wire =
        encode_reader_artifact(&direct_artifact).expect("direct Core artifact encodes");

    let mut wasm = RitoReaderSession::from_projection(
        open_test_projection(publication, SESSION_ID).expect("WASM reader session opens"),
    );
    let wasm_wire = wasm
        .request_artifact(request_wire)
        .unwrap_or_else(|_| panic!("WASM reader artifact resolves"));
    let wasm_artifact = decode_reader_artifact(&wasm_wire).expect("WASM artifact decodes");

    assert_eq!(wasm_wire, direct_wire);
    assert_eq!(
        wasm_artifact.display_list.semantic_digest,
        direct_artifact.display_list.semantic_digest
    );
    assert_eq!(wasm_artifact.locator.anchor_id.as_deref(), Some("point-47"));
    assert!(wasm_artifact.local_page_index > 0);
    assert!(wasm_artifact.local_spread_index > 0);
}

#[test]
fn adjacent_projection_is_core_identical_across_three_bounded_turns() {
    let publication = source_locator_fixture_epub();
    let first_request = request_wire(SESSION_ID, 1, "chapter.xhtml#point-1");
    let mut direct = ReaderSession::open_owned_with_pinned_font_policy(
        SESSION_ID,
        publication.clone(),
        crate::tests::fixture::pinned_test_policy_input(),
    )
    .expect("direct Core session opens");
    let direct_first = direct
        .request_artifact(
            decode_reader_artifact_request(&first_request).expect("first request decodes"),
        )
        .expect("direct first artifact resolves");

    let mut wasm = RitoReaderSession::from_projection(
        open_test_projection(publication, SESSION_ID).expect("WASM reader session opens"),
    );
    let wasm_first = wasm
        .request_artifact(first_request)
        .unwrap_or_else(|_| panic!("WASM first artifact resolves"));
    let wasm_first = decode_reader_artifact(&wasm_first).expect("WASM first artifact decodes");
    assert_eq!(wasm_first.artifact_id, direct_first.artifact_id);
    adopt_direct_foreground(&mut direct, None, direct_first.artifact_id);
    adopt_wasm_foreground(&mut wasm, None, wasm_first.artifact_id);

    let mut direct_from = direct_first;
    let mut wasm_from = wasm_first;
    for request_id in 2..=4 {
        let adjacent_wire = adjacent_wire(
            SESSION_ID,
            request_id,
            direct_from.artifact_id,
            ReaderAdjacentDirection::Next,
        );
        let direct_request =
            decode_reader_adjacent_request(&adjacent_wire).expect("adjacent request decodes");
        let direct_next = direct
            .request_adjacent(direct_request)
            .expect("direct adjacent artifact resolves");
        let direct_wire =
            encode_reader_artifact(&direct_next).expect("direct adjacent artifact encodes");

        let wasm_wire = wasm
            .request_adjacent(adjacent_wire)
            .unwrap_or_else(|_| panic!("WASM adjacent artifact resolves"));
        let wasm_next = decode_reader_artifact(&wasm_wire).expect("WASM adjacent artifact decodes");

        assert_eq!(wasm_wire, direct_wire);
        assert_eq!(wasm_next.request_id, request_id);
        assert_ne!(wasm_next.artifact_id, wasm_from.artifact_id);
        assert!(wasm_next.local_spread_index > wasm_from.local_spread_index);
        assert_eq!(wasm_next.revision_id, wasm_from.revision_id);

        adopt_direct_foreground(
            &mut direct,
            Some(direct_from.artifact_id),
            direct_next.artifact_id,
        );
        adopt_wasm_foreground(
            &mut wasm,
            Some(wasm_from.artifact_id),
            wasm_next.artifact_id,
        );

        direct_from = direct_next;
        wasm_from = wasm_next;
    }
}

#[test]
fn background_handoff_and_adopted_adjacent_are_byte_identical_to_core() {
    let publication = source_locator_fixture_epub();
    let first_request = request_wire(SESSION_ID, 1, "chapter.xhtml#point-0");
    let mut direct = ReaderSession::open_owned_with_pinned_font_policy(
        SESSION_ID,
        publication.clone(),
        crate::tests::fixture::pinned_test_policy_input(),
    )
    .expect("direct Core session opens");
    let direct_first = direct
        .request_artifact(
            decode_reader_artifact_request(&first_request).expect("first request decodes"),
        )
        .expect("direct first artifact resolves");

    let mut wasm = RitoReaderSession::from_projection(
        open_test_projection(publication, SESSION_ID).expect("WASM reader session opens"),
    );
    let wasm_first = wasm
        .request_artifact(first_request)
        .unwrap_or_else(|_| panic!("WASM first artifact resolves"));
    let wasm_first = decode_reader_artifact(&wasm_first).expect("WASM first artifact decodes");
    assert_eq!(wasm_first.artifact_id, direct_first.artifact_id);
    adopt_direct_foreground(&mut direct, None, direct_first.artifact_id);
    adopt_wasm_foreground(&mut wasm, None, wasm_first.artifact_id);

    let candidate = (0..256)
        .find_map(|_| {
            let request_wire = background_wire(SESSION_ID, direct_first.artifact_id, 64);
            let direct_step = direct
                .advance_background_once(
                    decode_reader_background_request(&request_wire)
                        .expect("background request decodes"),
                )
                .expect("direct background step succeeds");
            let direct_wire =
                encode_reader_background_advance(&direct_step).expect("direct step encodes");
            let wasm_wire = wasm
                .advance_background_once(request_wire)
                .unwrap_or_else(|_| panic!("WASM background step succeeds"));

            assert_eq!(wasm_wire, direct_wire);
            decode_reader_background_advance(&wasm_wire)
                .expect("WASM background result decodes")
                .artifact
        })
        .expect("publication reaches a handoff candidate");

    let first_handoff = handoff_wire(SESSION_ID, direct_first.artifact_id, candidate.artifact_id);
    let direct_ack = direct
        .adopt_background_candidate(
            decode_reader_background_handoff(&first_handoff).expect("handoff request decodes"),
        )
        .expect("direct handoff adopts");
    let direct_ack_wire =
        encode_reader_background_handoff_ack(&direct_ack).expect("direct ack encodes");
    let wasm_ack_wire = wasm
        .adopt_background_candidate(first_handoff)
        .unwrap_or_else(|_| panic!("WASM handoff adopts"));
    assert_eq!(wasm_ack_wire, direct_ack_wire);
    let wasm_ack = decode_reader_background_handoff_ack(&wasm_ack_wire).expect("WASM ack decodes");
    assert_eq!(wasm_ack.intent_request_id, 1);
    assert_eq!(wasm_ack.replaced_artifact_id, direct_first.artifact_id);
    assert_eq!(wasm_ack.visible_artifact_id, candidate.artifact_id);

    // The adopted candidate already carries the book page count; every
    // post-adoption step reports Complete with nothing further to offer.
    assert!(candidate.book_page_count.is_some(), "{candidate:?}");
    for _ in 0..3 {
        let request_wire = background_wire(SESSION_ID, candidate.artifact_id, 64);
        let direct_step = direct
            .advance_background_once(
                decode_reader_background_request(&request_wire)
                    .expect("post-adoption background request decodes"),
            )
            .expect("direct publication advances");
        let direct_wire =
            encode_reader_background_advance(&direct_step).expect("direct step encodes");
        let wasm_wire = wasm
            .advance_background_once(request_wire)
            .unwrap_or_else(|_| panic!("WASM publication advances"));
        assert_eq!(wasm_wire, direct_wire);
        let step =
            decode_reader_background_advance(&wasm_wire).expect("post-adoption result decodes");
        assert_eq!(step.state, ReaderBackgroundState::Complete);
        assert!(step.artifact.is_none());
    }

    let adjacent_wire = adjacent_wire(
        SESSION_ID,
        2,
        candidate.artifact_id,
        ReaderAdjacentDirection::Next,
    );
    let direct_next = direct
        .request_adjacent(
            decode_reader_adjacent_request(&adjacent_wire).expect("adjacent request decodes"),
        )
        .expect("direct adopted publication projects its next spread");
    let direct_next_wire =
        encode_reader_artifact(&direct_next).expect("direct adjacent artifact encodes");
    let wasm_next_wire = wasm
        .request_adjacent(adjacent_wire)
        .unwrap_or_else(|_| panic!("WASM adopted publication projects its next spread"));
    assert_eq!(wasm_next_wire, direct_next_wire);
    let wasm_next =
        decode_reader_artifact(&wasm_next_wire).expect("WASM adjacent artifact decodes");
    assert_eq!(wasm_next.revision_id, candidate.revision_id);

    for artifact_id in [
        direct_first.artifact_id,
        candidate.artifact_id,
        direct_next.artifact_id,
    ] {
        assert!(direct
            .release_artifact(artifact_id)
            .expect("direct artifact releases"));
        assert!(wasm
            .release_artifact(artifact_id)
            .unwrap_or_else(|_| panic!("WASM artifact releases")));
    }
    direct.dispose().expect("direct session disposes");
    assert!(wasm
        .dispose()
        .unwrap_or_else(|_| panic!("WASM session disposes")));
}

#[test]
fn each_background_transport_call_matches_exactly_one_core_quantum() {
    let publication = source_locator_fixture_epub();
    let first_request = request_wire(SESSION_ID, 1, "chapter.xhtml#point-47");
    let mut direct = ReaderSession::open_owned_with_pinned_font_policy(
        SESSION_ID,
        publication.clone(),
        crate::tests::fixture::pinned_test_policy_input(),
    )
    .expect("direct Core session opens");
    let direct_first = direct
        .request_artifact(
            decode_reader_artifact_request(&first_request).expect("first request decodes"),
        )
        .expect("direct tail artifact resolves");
    let mut projection =
        open_test_projection(publication, SESSION_ID).expect("WASM projection opens");
    let projected_first = projection
        .request_artifact(&first_request)
        .expect("projected tail artifact resolves");
    let projected_first =
        decode_reader_artifact(&projected_first).expect("projected artifact decodes");
    assert_eq!(projected_first.artifact_id, direct_first.artifact_id);
    adopt_direct_foreground(&mut direct, None, direct_first.artifact_id);
    adopt_projected_foreground(&mut projection, None, projected_first.artifact_id);

    // The cooperative footnote index drains one quantum per call before
    // publication layout starts; both transports must mirror every step.
    let mut indexing_calls = 0_usize;
    let mut post_index_calls = 0_usize;
    while post_index_calls < 4 {
        let request_wire = background_wire(SESSION_ID, direct_first.artifact_id, 1);
        let direct_step = direct
            .advance_background_once(
                decode_reader_background_request(&request_wire)
                    .expect("background request decodes"),
            )
            .expect("one direct quantum succeeds");
        let direct_wire =
            encode_reader_background_advance(&direct_step).expect("direct result encodes");
        let projected_wire = projection
            .advance_background_once(&request_wire)
            .expect("one projected quantum succeeds");
        let projected_step =
            decode_reader_background_advance(&projected_wire).expect("projected result decodes");

        assert_eq!(projected_wire, direct_wire);
        match projected_step.state {
            ReaderBackgroundState::Indexing => {
                assert_eq!(
                    post_index_calls, 0,
                    "indexing quanta precede publication layout"
                );
                indexing_calls += 1;
                assert!(
                    indexing_calls <= 32,
                    "cooperative index drains in bounded quanta"
                );
            }
            state => {
                assert_eq!(
                    state,
                    if post_index_calls == 0 {
                        ReaderBackgroundState::Started
                    } else {
                        // One-pass: the book is already paginated; later
                        // calls report the unadopted candidate.
                        ReaderBackgroundState::CandidatePending
                    }
                );
                // One-pass background pagination publishes the whole book
                // at Started and carries the first candidate with it.
                if post_index_calls == 0 {
                    assert!(
                        projected_step.artifact.is_some(),
                        "Started carries the first publication candidate"
                    );
                }
                post_index_calls += 1;
            }
        }
        if projected_step.state == ReaderBackgroundState::Indexing {
            assert!(projected_step.artifact.is_none());
        }
    }
}

#[test]
fn stale_background_cas_is_typed_and_does_not_replace_the_new_intent() {
    let mut session =
        open_test_projection(source_locator_fixture_epub(), SESSION_ID).expect("projection opens");
    let old_wire = session
        .request_artifact(&request_wire(SESSION_ID, 1, "chapter.xhtml#point-0"))
        .expect("old local artifact resolves");
    let old = decode_reader_artifact(&old_wire).expect("old artifact decodes");
    adopt_projected_foreground(&mut session, None, old.artifact_id);
    let candidate = advance_projection_to_candidate(&mut session, old.artifact_id, 64)
        .artifact
        .expect("old intent gets a handoff candidate");

    let current_wire = session
        .request_artifact(&request_wire(SESSION_ID, 2, "chapter.xhtml#point-40"))
        .expect("new local artifact resolves");
    let current = decode_reader_artifact(&current_wire).expect("current artifact decodes");
    adopt_projected_foreground(&mut session, Some(old.artifact_id), current.artifact_id);
    let stale = session
        .adopt_background_candidate(&handoff_wire(
            SESSION_ID,
            old.artifact_id,
            candidate.artifact_id,
        ))
        .expect_err("old compare-and-swap guard is stale");
    assert_eq!(stale.code, ReaderProjectionErrorCode::StaleRequest);

    let current_step_wire = session
        .advance_background_once(&background_wire(SESSION_ID, current.artifact_id, 1))
        .expect("new visible intent remains current");
    let current_step = decode_reader_background_advance(&current_step_wire)
        .expect("current background result decodes");
    assert_eq!(current_step.intent_request_id, 2);
    assert_eq!(current_step.replaces_artifact_id, current.artifact_id);

    let mut artifact_ids = vec![old.artifact_id, candidate.artifact_id, current.artifact_id];
    artifact_ids.extend(current_step.artifact.map(|artifact| artifact.artifact_id));
    artifact_ids.sort_unstable();
    artifact_ids.dedup();
    for artifact_id in artifact_ids {
        assert!(session
            .release_artifact(artifact_id)
            .expect("live artifact releases"));
    }
    assert!(session.dispose().expect("projection disposes"));
}

#[test]
fn projection_reports_typed_wire_and_session_errors() {
    let mut session =
        open_test_projection(source_locator_fixture_epub(), SESSION_ID).expect("projection opens");
    let valid = request_wire(SESSION_ID, 1, "chapter.xhtml#point-47");

    let truncated = session
        .request_artifact(&valid[..valid.len() - 1])
        .expect_err("truncated wire is rejected");
    assert_eq!(truncated.code, ReaderProjectionErrorCode::InvalidWire);

    let wrong_session = request_wire(SESSION_ID + 1, 1, "chapter.xhtml#point-47");
    let wrong_session = session
        .request_artifact(&wrong_session)
        .expect_err("wrong session is rejected");
    assert_eq!(
        wrong_session.code,
        ReaderProjectionErrorCode::InvalidSession
    );

    let artifact_wire = session
        .request_artifact(&request_wire(SESSION_ID, 2, "chapter.xhtml#point-1"))
        .expect("source artifact resolves");
    let artifact = decode_reader_artifact(&artifact_wire).expect("source artifact decodes");
    let adjacent = adjacent_wire(
        SESSION_ID,
        3,
        artifact.artifact_id,
        ReaderAdjacentDirection::Next,
    );
    let truncated = session
        .request_adjacent(&adjacent[..adjacent.len() - 1])
        .expect_err("truncated adjacent wire is rejected");
    assert_eq!(truncated.code, ReaderProjectionErrorCode::InvalidWire);
    let mut trailing = adjacent.clone();
    trailing.push(0);
    let trailing = session
        .request_adjacent(&trailing)
        .expect_err("trailing adjacent wire bytes are rejected");
    assert_eq!(trailing.code, ReaderProjectionErrorCode::InvalidWire);

    let wrong_session = adjacent_wire(
        SESSION_ID + 1,
        3,
        artifact.artifact_id,
        ReaderAdjacentDirection::Next,
    );
    let wrong_session = session
        .request_adjacent(&wrong_session)
        .expect_err("wrong adjacent session is rejected");
    assert_eq!(
        wrong_session.code,
        ReaderProjectionErrorCode::InvalidSession
    );
}

#[test]
fn background_wires_reject_truncation_trailing_bytes_and_top_bit_ids() {
    let mut session =
        open_test_projection(source_locator_fixture_epub(), SESSION_ID).expect("projection opens");
    let artifact_wire = session
        .request_artifact(&request_wire(SESSION_ID, 1, "chapter.xhtml#point-0"))
        .expect("source artifact resolves");
    let artifact = decode_reader_artifact(&artifact_wire).expect("source artifact decodes");

    let request = background_wire(SESSION_ID, artifact.artifact_id, 1);
    assert_eq!(
        request.len(),
        usize::try_from(READER_BACKGROUND_REQUEST_WIRE_BYTES)
            .expect("background wire size fits usize")
    );
    let truncated = session
        .advance_background_once(&request[..request.len() - 1])
        .expect_err("truncated background request is rejected");
    assert_eq!(truncated.code, ReaderProjectionErrorCode::InvalidWire);
    let mut trailing = request.clone();
    trailing.push(0);
    let trailing = session
        .advance_background_once(&trailing)
        .expect_err("trailing background bytes are rejected");
    assert_eq!(trailing.code, ReaderProjectionErrorCode::InvalidWire);
    let wrong_session = session
        .advance_background_once(&background_wire(SESSION_ID + 1, artifact.artifact_id, 1))
        .expect_err("wrong background session is rejected");
    assert_eq!(
        wrong_session.code,
        ReaderProjectionErrorCode::InvalidSession
    );

    let invalid_id = (i64::MAX as u64) + 1;
    let mut high_expected = request;
    let expected_offset =
        usize::try_from(READER_WIRE_HEADER_BYTES).expect("wire header size fits usize") + 8;
    high_expected[expected_offset..expected_offset + 8].copy_from_slice(&invalid_id.to_le_bytes());
    let high_expected = session
        .advance_background_once(&high_expected)
        .expect_err("top-bit background identity is rejected");
    assert_eq!(high_expected.code, ReaderProjectionErrorCode::InvalidWire);
    assert!(!high_expected.message.contains("-9223372036854775808"));

    let handoff = handoff_wire(SESSION_ID, artifact.artifact_id, artifact.artifact_id);
    assert_eq!(
        handoff.len(),
        usize::try_from(READER_BACKGROUND_HANDOFF_WIRE_BYTES)
            .expect("handoff wire size fits usize")
    );
    let truncated = session
        .adopt_background_candidate(&handoff[..handoff.len() - 1])
        .expect_err("truncated handoff request is rejected");
    assert_eq!(truncated.code, ReaderProjectionErrorCode::InvalidWire);
    let mut trailing = handoff.clone();
    trailing.push(0);
    let trailing = session
        .adopt_background_candidate(&trailing)
        .expect_err("trailing handoff bytes are rejected");
    assert_eq!(trailing.code, ReaderProjectionErrorCode::InvalidWire);
    let wrong_session = session
        .adopt_background_candidate(&handoff_wire(
            SESSION_ID + 1,
            artifact.artifact_id,
            artifact.artifact_id,
        ))
        .expect_err("wrong handoff session is rejected");
    assert_eq!(
        wrong_session.code,
        ReaderProjectionErrorCode::InvalidSession
    );

    let mut high_candidate = handoff;
    let candidate_offset =
        usize::try_from(READER_WIRE_HEADER_BYTES).expect("wire header size fits usize") + 16;
    high_candidate[candidate_offset..candidate_offset + 8]
        .copy_from_slice(&invalid_id.to_le_bytes());
    let high_candidate = session
        .adopt_background_candidate(&high_candidate)
        .expect_err("top-bit handoff identity is rejected");
    assert_eq!(high_candidate.code, ReaderProjectionErrorCode::InvalidWire);
    assert!(!high_candidate.message.contains("-9223372036854775808"));
}

#[test]
fn release_and_dispose_are_idempotent_and_disposed_requests_are_typed() {
    let mut session =
        open_test_projection(source_locator_fixture_epub(), SESSION_ID).expect("projection opens");
    let artifact_wire = session
        .request_artifact(&request_wire(SESSION_ID, 1, "chapter.xhtml#point-47"))
        .expect("artifact resolves");
    let artifact = decode_reader_artifact(&artifact_wire).expect("artifact decodes");

    assert!(session
        .release_artifact(artifact.artifact_id)
        .expect("first release succeeds"));
    assert!(!session
        .release_artifact(artifact.artifact_id)
        .expect("second release is a no-op"));
    assert!(session.dispose().expect("first disposal succeeds"));
    assert!(!session.dispose().expect("second disposal is a no-op"));
    assert!(!session
        .release_artifact(artifact.artifact_id)
        .expect("release after disposal is a no-op"));

    let disposed = session
        .request_artifact(&request_wire(SESSION_ID, 2, "chapter.xhtml#point-46"))
        .expect_err("disposed session rejects new work");
    assert_eq!(disposed.code, ReaderProjectionErrorCode::SessionDisposed);
    let disposed = session
        .advance_background_once(&background_wire(SESSION_ID, artifact.artifact_id, 1))
        .expect_err("disposed session rejects background work");
    assert_eq!(disposed.code, ReaderProjectionErrorCode::SessionDisposed);
    let disposed = session
        .adopt_background_candidate(&handoff_wire(
            SESSION_ID,
            artifact.artifact_id,
            artifact.artifact_id,
        ))
        .expect_err("disposed session rejects handoff work");
    assert_eq!(disposed.code, ReaderProjectionErrorCode::SessionDisposed);
}

#[test]
fn one_session_supports_followup_seek_reflow_and_rejects_stale_request_ids() {
    let mut session =
        open_test_projection(source_locator_fixture_epub(), SESSION_ID).expect("projection opens");
    let first_wire = session
        .request_artifact(&request_wire(SESSION_ID, 10, "chapter.xhtml#point-1"))
        .expect("first artifact resolves");
    let first = decode_reader_artifact(&first_wire).expect("first artifact decodes");
    let second_wire = session
        .request_artifact(&request_wire(SESSION_ID, 11, "chapter.xhtml#point-47"))
        .expect("follow-up seek resolves");
    let second = decode_reader_artifact(&second_wire).expect("second artifact decodes");

    assert_eq!(first.request_id, 10);
    assert_eq!(second.request_id, 11);
    assert_ne!(first.artifact_id, second.artifact_id);
    assert_eq!(second.locator.anchor_id.as_deref(), Some("point-47"));
    assert!(second.local_page_index > first.local_page_index);

    let stale = session
        .request_artifact(&request_wire(SESSION_ID, 10, "chapter.xhtml#point-2"))
        .expect_err("older request id is rejected");
    assert_eq!(stale.code, ReaderProjectionErrorCode::StaleRequest);
    assert!(session
        .release_artifact(first.artifact_id)
        .expect("first artifact releases"));
    assert!(session
        .release_artifact(second.artifact_id)
        .expect("second artifact releases"));
    assert!(session.dispose().expect("session disposes"));
}

#[test]
fn resource_projection_is_core_identical_for_the_real_0005_image() {
    let publication = book_10_publication();
    let artifact_request = request_wire(SESSION_ID, 1, "OEBPS/Text/Section001.xhtml");

    let mut direct = ReaderSession::open_owned_with_pinned_font_policy(
        SESSION_ID,
        publication.clone(),
        crate::tests::fixture::pinned_test_policy_input(),
    )
    .expect("direct Core session opens");
    let direct_request =
        decode_reader_artifact_request(&artifact_request).expect("request decodes");
    let direct_artifact = direct
        .request_artifact(direct_request)
        .expect("direct artifact resolves");
    let display_href = direct_artifact
        .resources
        .iter()
        .find(|resource| resource.href.ends_with("/0005_s.jpg"))
        .expect("artifact declares the real image")
        .href
        .clone();
    let direct_resource = direct
        .read_resource(
            direct_artifact.artifact_id,
            ReaderResourceKind::Image,
            &display_href,
        )
        .expect("direct resource resolves");
    let direct_wire = encode_reader_resource(&direct_resource).expect("direct resource encodes");

    let mut wasm = RitoReaderSession::from_projection(
        open_test_projection(publication, SESSION_ID).expect("WASM reader session opens"),
    );
    let artifact_wire = wasm
        .request_artifact(artifact_request)
        .unwrap_or_else(|_| panic!("WASM artifact resolves"));
    let artifact = decode_reader_artifact(&artifact_wire).expect("artifact decodes");
    assert!(artifact
        .resources
        .iter()
        .any(|resource| resource.href == display_href));
    let wasm_wire = wasm
        .read_resource(artifact.artifact_id, 0, display_href.clone())
        .unwrap_or_else(|_| panic!("WASM resource resolves"));
    let resource = decode_reader_resource(&wasm_wire).expect("resource wire decodes");

    assert_eq!(wasm_wire, direct_wire);
    assert_eq!(&wasm_wire[..8], b"RITORES1");
    assert_eq!(resource.kind, ReaderResourceKind::Image);
    assert_eq!(resource.href, display_href);
    assert_eq!(resource.media_type, "image/jpeg");
    assert_eq!(resource.bytes.len(), 71_220);
    assert_eq!(resource.bytes.get(..3), Some(&[0xff, 0xd8, 0xff][..]));
    assert_eq!(resource.width, Some(1_000));
    assert_eq!(resource.height, Some(716));
}

#[test]
fn wasm_projection_uses_core_wire_types_without_a_json_schema_copy() {
    let source = include_str!("../reader_session.rs");

    assert!(!source.contains("serde_json"));
    assert!(!source.contains("struct ReaderArtifact"));
    assert!(!source.contains("struct ReaderArtifactRequest"));
    assert!(!source.contains("struct ReaderBackgroundRequest"));
    assert!(!source.contains("struct ReaderBackgroundHandoff"));
    assert!(source.contains("session_id: u64"));
    assert!(source.contains("artifact_id: u64"));
    assert!(source.contains("js_name = requestAdjacent"));
    assert!(source.contains("js_name = hasPendingAdjacent"));
    assert!(source.contains("js_name = adoptForegroundCandidate"));
    assert!(source.contains("js_name = advanceBackgroundOnce"));
    assert!(source.contains("js_name = adoptBackgroundCandidate"));
}

#[test]
fn adjacent_wire_preserves_bigint_sized_identities_without_a_number_hop() {
    let high_id = (1u64 << 60) + 73;
    let wire = adjacent_wire(
        high_id,
        high_id + 1,
        high_id + 2,
        ReaderAdjacentDirection::Previous,
    );
    let decoded = decode_reader_adjacent_request(&wire).expect("adjacent wire decodes");

    assert_eq!(decoded.session_id, high_id);
    assert_eq!(decoded.request_id, high_id + 1);
    assert_eq!(decoded.from_artifact_id, high_id + 2);
    assert_eq!(decoded.direction, ReaderAdjacentDirection::Previous);
    assert_eq!(&wire[..8], b"RITONAV1");
}

#[test]
fn background_wires_preserve_bigint_sized_identities_without_a_number_hop() {
    let high_id = (1u64 << 60) + 91;
    let request_wire = background_wire(high_id, high_id + 1, 7);
    let request =
        decode_reader_background_request(&request_wire).expect("background request decodes");
    assert_eq!(request.session_id, high_id);
    assert_eq!(request.expected_visible_artifact_id, high_id + 1);
    assert_eq!(request.max_top_level_nodes_per_quantum, 7);
    assert_eq!(&request_wire[..8], b"RITOBGQ1");

    let handoff_wire = handoff_wire(high_id, high_id + 1, high_id + 2);
    let handoff = decode_reader_background_handoff(&handoff_wire).expect("handoff request decodes");
    assert_eq!(handoff.session_id, high_id);
    assert_eq!(handoff.expected_visible_artifact_id, high_id + 1);
    assert_eq!(handoff.candidate_artifact_id, high_id + 2);
    assert_eq!(&handoff_wire[..8], b"RITOHOF1");
}

#[test]
fn wasm_projection_rejects_top_bit_ids_instead_of_converting_them_to_negative() {
    let invalid_id = (i64::MAX as u64) + 1;
    let invalid_session = ReaderSessionProjection::open(source_locator_fixture_epub(), invalid_id)
        .expect_err("top-bit session identity is rejected");
    assert_eq!(
        invalid_session.code,
        ReaderProjectionErrorCode::InvalidSession
    );
    assert!(!invalid_session.message.contains("-9223372036854775808"));

    let mut session =
        open_test_projection(source_locator_fixture_epub(), SESSION_ID).expect("projection opens");
    let artifact_wire = session
        .request_artifact(&request_wire(SESSION_ID, 1, "chapter.xhtml#point-1"))
        .expect("source artifact resolves");
    let artifact = decode_reader_artifact(&artifact_wire).expect("source artifact decodes");
    let mut adjacent = adjacent_wire(
        SESSION_ID,
        2,
        artifact.artifact_id,
        ReaderAdjacentDirection::Next,
    );
    let request_id_offset =
        usize::try_from(READER_WIRE_HEADER_BYTES).expect("wire header size fits usize") + 8;
    adjacent[request_id_offset..request_id_offset + 8].copy_from_slice(&invalid_id.to_le_bytes());
    let invalid_wire = session
        .request_adjacent(&adjacent)
        .expect_err("top-bit request identity is rejected at wire decode");
    assert_eq!(invalid_wire.code, ReaderProjectionErrorCode::InvalidWire);
    assert!(!invalid_wire.message.contains("-9223372036854775808"));

    let invalid_artifact = session
        .release_artifact(invalid_id)
        .expect_err("top-bit artifact identity is rejected by the session API");
    assert_eq!(
        invalid_artifact.code,
        ReaderProjectionErrorCode::InvalidRequest
    );
}

fn request_wire(session_id: u64, request_id: u64, href: &str) -> Vec<u8> {
    encode_reader_artifact_request(&ReaderArtifactRequest {
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
    })
    .expect("request encodes")
}

fn adjacent_wire(
    session_id: u64,
    request_id: u64,
    from_artifact_id: u64,
    direction: ReaderAdjacentDirection,
) -> Vec<u8> {
    encode_reader_adjacent_request(&ReaderAdjacentRequest {
        session_id,
        request_id,
        from_artifact_id,
        direction,
    })
    .expect("adjacent request encodes")
}

fn background_wire(
    session_id: u64,
    expected_visible_artifact_id: u64,
    max_top_level_nodes_per_quantum: u32,
) -> Vec<u8> {
    encode_reader_background_request(&ReaderBackgroundRequest {
        session_id,
        expected_visible_artifact_id,
        max_top_level_nodes_per_quantum,
    })
    .expect("background request encodes")
}

fn handoff_wire(
    session_id: u64,
    expected_visible_artifact_id: u64,
    candidate_artifact_id: u64,
) -> Vec<u8> {
    encode_reader_background_handoff(&ReaderBackgroundHandoff {
        session_id,
        expected_visible_artifact_id,
        candidate_artifact_id,
    })
    .expect("background handoff encodes")
}

fn foreground_handoff_wire(
    session_id: u64,
    expected_visible_artifact_id: Option<u64>,
    candidate_artifact_id: u64,
) -> Vec<u8> {
    encode_reader_foreground_handoff(&ReaderForegroundHandoff {
        session_id,
        expected_visible_artifact_id,
        candidate_artifact_id,
    })
    .expect("foreground handoff encodes")
}

fn adopt_direct_foreground(
    session: &mut ReaderSession,
    expected_visible_artifact_id: Option<u64>,
    candidate_artifact_id: u64,
) {
    session
        .adopt_foreground_candidate(ReaderForegroundHandoff {
            session_id: SESSION_ID,
            expected_visible_artifact_id,
            candidate_artifact_id,
        })
        .expect("direct foreground candidate adopts");
}

fn adopt_projected_foreground(
    session: &mut ReaderSessionProjection,
    expected_visible_artifact_id: Option<u64>,
    candidate_artifact_id: u64,
) {
    session
        .adopt_foreground_candidate(&foreground_handoff_wire(
            SESSION_ID,
            expected_visible_artifact_id,
            candidate_artifact_id,
        ))
        .expect("projected foreground candidate adopts");
}

fn adopt_wasm_foreground(
    session: &mut RitoReaderSession,
    expected_visible_artifact_id: Option<u64>,
    candidate_artifact_id: u64,
) {
    let wire = session
        .adopt_foreground_candidate(foreground_handoff_wire(
            SESSION_ID,
            expected_visible_artifact_id,
            candidate_artifact_id,
        ))
        .unwrap_or_else(|_| panic!("WASM foreground candidate adopts"));
    decode_reader_foreground_handoff_ack(&wire).expect("WASM foreground acknowledgement decodes");
}

fn advance_projection_to_candidate(
    session: &mut ReaderSessionProjection,
    visible_artifact_id: u64,
    max_top_level_nodes_per_quantum: u32,
) -> ReaderBackgroundAdvance {
    for _ in 0..256 {
        let wire = session
            .advance_background_once(&background_wire(
                SESSION_ID,
                visible_artifact_id,
                max_top_level_nodes_per_quantum,
            ))
            .expect("background step succeeds");
        let step = decode_reader_background_advance(&wire).expect("background result decodes");
        if step.artifact.is_some() {
            return step;
        }
        assert_ne!(
            step.state,
            ReaderBackgroundState::Complete,
            "publication completed without covering the visible locator"
        );
    }
    panic!("background did not produce a candidate within the fixture bound");
}

fn source_locator_fixture_epub() -> Vec<u8> {
    let paragraphs = (0..48)
        .map(|index| {
            format!(
                r#"<p id="point-{index}">Source locator paragraph {index} has enough text to wrap across several lines in a narrow reader viewport.</p>"#
            )
        })
        .collect::<String>();
    let chapter = format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>{paragraphs}</body></html>"#
    );
    fixture_epub_with_chapter(chapter.as_bytes())
}

fn book_10_publication() -> Vec<u8> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/rito/tests/fixtures/books/book-10.epub");
    fs::read(path).expect("book-10 fixture is readable")
}

fn fixture_epub_with_chapter(chapter: &[u8]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    add_file(
        &mut writer,
        options,
        "META-INF/container.xml",
        br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
    );
    add_file(
        &mut writer,
        options,
        "OPS/package.opf",
        br#"<?xml version="1.0"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>WASM Reader V1</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="id">wasm-reader</dc:identifier>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>"#,
    );
    add_file(&mut writer, options, "OPS/chapter.xhtml", chapter);
    writer.finish().expect("zip finalizes").into_inner()
}

fn add_file(
    writer: &mut ZipWriter<Cursor<Vec<u8>>>,
    options: FileOptions<'_, ()>,
    path: &str,
    bytes: &[u8],
) {
    writer.start_file(path, options).expect("zip entry starts");
    writer.write_all(bytes).expect("zip entry is written");
}

#[test]
fn tmp_pt_margin_probe() {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    add_file(
        &mut writer,
        options,
        "META-INF/container.xml",
        br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
    );
    add_file(
        &mut writer,
        options,
        "OPS/package.opf",
        br#"<?xml version="1.0"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>PT Probe</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="id">pt-probe</dc:identifier>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="stylesheet.css" media-type="text/css"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>"#,
    );
    add_file(
        &mut writer,
        options,
        "OPS/stylesheet.css",
        br#".calibre_2 { display: block; text-indent: 0; margin: 0 }
.calibre_10 { display: block; text-align: left; text-indent: 0; margin: 7pt 0 0 }"#,
    );
    add_file(
        &mut writer,
        options,
        "OPS/chapter.xhtml",
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" type="text/css" href="stylesheet.css"/></head><body><p class="calibre_2" id="point-0">PENGUIN BOOKS</p><p class="calibre_10">Published by the Penguin Group</p></body></html>"#,
    );
    let epub = writer.finish().expect("zip finalizes").into_inner();

    let mut projection = open_test_projection(epub, SESSION_ID).expect("projection opens");
    let request = request_wire(SESSION_ID, 1, "chapter.xhtml#point-0");
    projection.request_artifact(&request).expect("artifact");
}
