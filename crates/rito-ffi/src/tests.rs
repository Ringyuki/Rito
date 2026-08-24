use std::{
    fs,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

use rito_core::runtime::{
    decode_reader_artifact_v1, decode_reader_background_advance_v1,
    decode_reader_background_handoff_ack_v1, decode_reader_footnote_v1,
    decode_reader_foreground_handoff_ack_v1, decode_reader_publication_v1,
    decode_reader_resource_v1, decode_reader_search_response_v1,
    decode_reader_text_range_geometry_v1, encode_reader_adjacent_request_v1,
    encode_reader_artifact_request_v1, encode_reader_background_handoff_v1,
    encode_reader_background_request_v1, encode_reader_foreground_handoff_v1,
    encode_reader_search_request_v1, encode_reader_text_range_request_v1,
    ReaderAdjacentDirectionV1, ReaderAdjacentRequestV1, ReaderArtifactRequestV1,
    ReaderBackgroundHandoffV1, ReaderBackgroundRequestV1, ReaderBackgroundStateV1,
    ReaderErrorKindV1, ReaderErrorV1, ReaderForegroundHandoffV1, ReaderLayoutV1, ReaderLocatorV1,
    ReaderResourceKindV1, ReaderSearchRequestV1, ReaderSpreadModeV1, ReaderTextPositionV1,
    ReaderTextRangeRequestV1, ReaderTextRenderingProfileV1, ReaderWorkBudgetV1,
    READER_FOREGROUND_HANDOFF_ACK_WIRE_BYTES_V1, READER_FOREGROUND_HANDOFF_WIRE_BYTES_V1,
    READER_WIRE_HEADER_BYTES_V1,
};

use crate::{
    abi::copy_owned_buffer_for_test, error::FfiError, rito_adopt_background_candidate_v1,
    rito_adopt_foreground_candidate_v1, rito_advance_background_v1, rito_buffer_free_v1,
    rito_commit_peeked_artifact_v1, rito_dispose_v1, rito_get_text_range_geometry_v1, rito_open_v1,
    rito_open_with_pinned_fonts_v1, rito_peek_adjacent_v1, rito_read_footnote_v1,
    rito_read_publication_v1, rito_read_resource_v1, rito_release_artifact_v1,
    rito_request_adjacent_v1, rito_request_artifact_v1, rito_search_v1, RitoOwnedBufferV1,
    RitoPinnedFontFaceV1, RITO_ACTOR_MAX_IN_FLIGHT_V1, RITO_PINNED_FONT_ROLE_SERIF_V1,
    RITO_PUBLICATION_WIRE_BYTES_MAX_V1, RITO_RESOURCE_KIND_IMAGE_V1,
    RITO_STATUS_ADJACENT_PENDING_V1, RITO_STATUS_ALREADY_EXISTS_V1, RITO_STATUS_BUSY_V1,
    RITO_STATUS_EXACT_SEEK_PENDING_V1, RITO_STATUS_INVALID_ARGUMENT_V1, RITO_STATUS_NOT_FOUND_V1,
    RITO_STATUS_OK_V1, RITO_STATUS_QUEUE_FULL_V1, RITO_STATUS_SESSION_TERMINATED_V1,
    RITO_STATUS_STALE_REQUEST_V1, RITO_STATUS_TARGET_NOT_PUBLISHED_V1,
    RITO_STATUS_UNSUPPORTED_PROFILE_V1,
};

static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(10_000);

#[test]
fn ffi_status_mapping_keeps_actionable_reader_failures_distinct() {
    for (kind, expected) in [
        (
            ReaderErrorKindV1::StaleRequest,
            RITO_STATUS_STALE_REQUEST_V1,
        ),
        (
            ReaderErrorKindV1::TargetNotPublished,
            RITO_STATUS_TARGET_NOT_PUBLISHED_V1,
        ),
        (
            ReaderErrorKindV1::UnsupportedTextProfile,
            RITO_STATUS_UNSUPPORTED_PROFILE_V1,
        ),
    ] {
        let error = FfiError::from(ReaderErrorV1 {
            kind,
            message: "typed status probe".to_owned(),
        });
        assert_eq!(error.status, expected);
    }

    let busy = FfiError::busy("actor admission cap reached");
    assert_eq!(busy.status, RITO_STATUS_BUSY_V1);
    assert_eq!(RITO_STATUS_QUEUE_FULL_V1, RITO_STATUS_BUSY_V1);
    assert_eq!(RITO_STATUS_EXACT_SEEK_PENDING_V1, 9);
    assert_eq!(RITO_STATUS_ADJACENT_PENDING_V1, 10);
    assert_eq!(RITO_STATUS_SESSION_TERMINATED_V1, 11);
    assert_eq!(RITO_ACTOR_MAX_IN_FLIGHT_V1, 8);
    assert_eq!(READER_FOREGROUND_HANDOFF_WIRE_BYTES_V1, 48);
    assert_eq!(READER_FOREGROUND_HANDOFF_ACK_WIRE_BYTES_V1, 48);
    assert_eq!(RITO_PUBLICATION_WIRE_BYTES_MAX_V1, 16 * 1024 * 1024);
}

#[test]
fn invalid_and_truncated_inputs_are_rejected_without_a_session() {
    let request = request(next_session_id());
    let wire = encode_reader_artifact_request_v1(&request).expect("request encodes");
    let invalid = call_open(&[], &wire);
    assert_eq!(invalid.status, RITO_STATUS_INVALID_ARGUMENT_V1);
    assert!(!invalid.error.is_empty());

    let truncated = call_open(&publication(), &wire[..wire.len() - 1]);
    assert_eq!(truncated.status, RITO_STATUS_INVALID_ARGUMENT_V1);
    assert!(!truncated.error.is_empty());
}

#[test]
fn foreground_candidate_is_invisible_until_explicit_cas_adoption() {
    let session_id = next_session_id();
    let open_wire =
        encode_reader_artifact_request_v1(&request(session_id)).expect("request encodes");
    let opened = call_open(&publication(), &open_wire);
    assert_eq!(opened.status, RITO_STATUS_OK_V1, "{}", opened.error);
    let candidate = decode_reader_artifact_v1(&opened.artifact).expect("candidate decodes");

    let background = encode_reader_background_request_v1(&ReaderBackgroundRequestV1 {
        session_id,
        expected_visible_artifact_id: candidate.artifact_id,
        max_top_level_nodes_per_quantum: 1,
    })
    .expect("background request encodes");
    assert_eq!(
        call_advance_background(session_id, &background).status,
        RITO_STATUS_INVALID_ARGUMENT_V1,
        "open must not publish its candidate implicitly"
    );

    let handoff = encode_reader_foreground_handoff_v1(&ReaderForegroundHandoffV1 {
        session_id,
        expected_visible_artifact_id: None,
        candidate_artifact_id: candidate.artifact_id,
    })
    .expect("foreground handoff encodes");
    let mut aliased_output = RitoOwnedBufferV1::EMPTY;
    let aliased_pointer = &mut aliased_output as *mut RitoOwnedBufferV1;
    assert_eq!(
        rito_adopt_foreground_candidate_v1(
            session_id,
            handoff.as_ptr(),
            u64::try_from(handoff.len()).expect("handoff length is representable"),
            aliased_pointer,
            aliased_pointer,
        ),
        RITO_STATUS_INVALID_ARGUMENT_V1
    );
    assert!(!copy_owned_buffer_for_test(&aliased_output).is_empty());
    rito_buffer_free_v1(&mut aliased_output);
    rito_buffer_free_v1(&mut aliased_output);
    let adopted = call_adopt_foreground(session_id, &handoff);
    assert_eq!(adopted.status, RITO_STATUS_OK_V1, "{}", adopted.error);
    assert_eq!(adopted.wire.len(), 48);
    let ack = decode_reader_foreground_handoff_ack_v1(&adopted.wire)
        .expect("foreground acknowledgement decodes");
    assert_eq!(ack.intent_request_id, candidate.request_id);
    assert_eq!(ack.replaced_artifact_id, None);
    assert_eq!(ack.visible_artifact_id, candidate.artifact_id);

    let stale = call_adopt_foreground(session_id, &handoff);
    assert_eq!(stale.status, RITO_STATUS_STALE_REQUEST_V1);
    assert!(stale.wire.is_empty());
    assert!(!stale.error.is_empty());
    assert_eq!(
        call_read_publication(session_id).status,
        RITO_STATUS_OK_V1,
        "a stale foreground CAS must not discard the actor"
    );
    assert_eq!(call_dispose(session_id), RITO_STATUS_OK_V1);
}

#[test]
fn open_release_and_dispose_are_owned_and_idempotent() {
    let session_id = next_session_id();
    let publication = publication();
    let wire = encode_reader_artifact_request_v1(&request(session_id)).expect("request encodes");
    let opened = call_open(&publication, &wire);
    assert_eq!(opened.status, RITO_STATUS_OK_V1, "{}", opened.error);
    let artifact = decode_reader_artifact_v1(&opened.artifact).expect("artifact decodes");
    assert_eq!(artifact.session_id, session_id);
    assert_eq!(artifact.locator.href, "OEBPS/Text/Section001.xhtml");
    let first_publication = call_read_publication(session_id);
    assert_eq!(
        first_publication.status, RITO_STATUS_OK_V1,
        "{}",
        first_publication.error
    );
    let second_publication = call_read_publication(session_id);
    assert_eq!(second_publication.status, RITO_STATUS_OK_V1);
    assert_eq!(second_publication.wire, first_publication.wire);
    assert!(
        first_publication.wire.len()
            <= usize::try_from(RITO_PUBLICATION_WIRE_BYTES_MAX_V1).unwrap()
    );
    let publication_snapshot = decode_reader_publication_v1(&first_publication.wire)
        .expect("publication metadata decodes");
    assert_eq!(publication_snapshot.session_id, session_id);
    assert!(!publication_snapshot.metadata.title.is_empty());
    assert!(publication_snapshot
        .spine
        .iter()
        .any(|item| item.href.ends_with("/Section001.xhtml")));
    let mut aliased_output = RitoOwnedBufferV1::EMPTY;
    let aliased_pointer = &mut aliased_output as *mut RitoOwnedBufferV1;
    assert_eq!(
        rito_read_publication_v1(session_id, aliased_pointer, aliased_pointer),
        RITO_STATUS_INVALID_ARGUMENT_V1
    );
    assert!(!copy_owned_buffer_for_test(&aliased_output).is_empty());
    rito_buffer_free_v1(&mut aliased_output);
    let display_image_href = artifact
        .resources
        .iter()
        .find(|resource| resource.href.ends_with("/0005_s.jpg"))
        .expect("artifact declares the real image")
        .href
        .clone();

    let mut reflow_request = request(session_id);
    reflow_request.request_id = 2;
    reflow_request.layout.viewport_width = 480.0;
    let reflow_wire =
        encode_reader_artifact_request_v1(&reflow_request).expect("reflow request encodes");
    let reflow = call_request_artifact(session_id, &reflow_wire);
    assert_eq!(reflow.status, RITO_STATUS_OK_V1, "{}", reflow.error);
    let reflow = decode_reader_artifact_v1(&reflow.artifact).expect("reflow artifact decodes");
    assert_eq!(reflow.session_id, session_id);
    assert_eq!(reflow.request_id, 2);
    assert_ne!(reflow.artifact_id, artifact.artifact_id);

    let mut mismatched_request = request(session_id + 1);
    mismatched_request.request_id = 3;
    let mismatched_wire =
        encode_reader_artifact_request_v1(&mismatched_request).expect("mismatched request encodes");
    assert_eq!(
        call_request_artifact(session_id, &mismatched_wire).status,
        RITO_STATUS_INVALID_ARGUMENT_V1
    );

    let image = call_read_resource(
        session_id,
        artifact.artifact_id,
        RITO_RESOURCE_KIND_IMAGE_V1,
        display_image_href.as_bytes(),
    );
    assert_eq!(image.status, RITO_STATUS_OK_V1, "{}", image.error);
    let image = decode_reader_resource_v1(&image.resource).expect("resource decodes");
    assert_eq!(image.artifact_id, artifact.artifact_id);
    assert_eq!(image.kind, ReaderResourceKindV1::Image);
    assert_eq!(image.href, display_image_href);
    assert_eq!(image.media_type, "image/jpeg");
    assert_eq!(image.bytes.len(), 71_220);
    assert_eq!(image.bytes.get(..3), Some(&[0xff, 0xd8, 0xff][..]));
    assert_eq!(
        image.bytes.get(image.bytes.len() - 2..),
        Some(&[0xff, 0xd9][..])
    );
    assert_eq!(image.width, Some(1_000));
    assert_eq!(image.height, Some(716));

    assert_eq!(
        call_read_resource(
            session_id + 999,
            artifact.artifact_id,
            RITO_RESOURCE_KIND_IMAGE_V1,
            display_image_href.as_bytes(),
        )
        .status,
        RITO_STATUS_NOT_FOUND_V1
    );
    assert_eq!(
        call_read_resource(
            session_id,
            artifact.artifact_id + 999,
            RITO_RESOURCE_KIND_IMAGE_V1,
            display_image_href.as_bytes(),
        )
        .status,
        RITO_STATUS_NOT_FOUND_V1
    );
    assert_eq!(
        call_read_resource(
            session_id,
            artifact.artifact_id,
            RITO_RESOURCE_KIND_IMAGE_V1,
            b"OEBPS/Images/missing.jpg",
        )
        .status,
        RITO_STATUS_INVALID_ARGUMENT_V1
    );
    assert_eq!(
        call_read_resource(
            session_id,
            artifact.artifact_id,
            u32::MAX,
            display_image_href.as_bytes(),
        )
        .status,
        RITO_STATUS_INVALID_ARGUMENT_V1
    );

    let duplicate = call_open(&publication, &wire);
    assert_eq!(duplicate.status, RITO_STATUS_ALREADY_EXISTS_V1);
    assert_eq!(
        call_release(session_id + 999, artifact.artifact_id),
        RITO_STATUS_NOT_FOUND_V1
    );
    assert_eq!(
        call_release(session_id, artifact.artifact_id),
        RITO_STATUS_OK_V1
    );
    assert_eq!(
        call_read_resource(
            session_id,
            artifact.artifact_id,
            RITO_RESOURCE_KIND_IMAGE_V1,
            display_image_href.as_bytes(),
        )
        .status,
        RITO_STATUS_NOT_FOUND_V1
    );
    assert_eq!(
        call_release(session_id, reflow.artifact_id),
        RITO_STATUS_OK_V1
    );
    assert_eq!(
        call_release(session_id, artifact.artifact_id),
        RITO_STATUS_OK_V1
    );
    assert_eq!(call_dispose(session_id), RITO_STATUS_OK_V1);
    let disposed_publication = call_read_publication(session_id);
    assert_eq!(disposed_publication.status, RITO_STATUS_NOT_FOUND_V1);
    assert!(disposed_publication.wire.is_empty());
    assert!(!disposed_publication.error.is_empty());
    assert_eq!(call_dispose(session_id), RITO_STATUS_OK_V1);
}

#[test]
fn pending_open_registers_a_ready_session_and_resumes_with_a_new_request_id() {
    let session_id = next_session_id();
    let publication = publication();
    let initial = pending_open_request(session_id, 10);
    let initial_wire =
        encode_reader_artifact_request_v1(&initial).expect("pending open request encodes");
    let opened = call_open(&publication, &initial_wire);

    assert_eq!(
        opened.status, RITO_STATUS_EXACT_SEEK_PENDING_V1,
        "{}",
        opened.error
    );
    assert!(opened.artifact.is_empty());
    assert!(!opened.error.is_empty());
    assert_eq!(call_read_publication(session_id).status, RITO_STATUS_OK_V1);
    assert_eq!(
        call_open(&publication, &initial_wire).status,
        RITO_STATUS_ALREADY_EXISTS_V1,
        "pending open must already own its session identity"
    );

    let mut wrong_session = initial.clone();
    wrong_session.session_id = session_id + 1;
    wrong_session.request_id = 11;
    let wrong_wire =
        encode_reader_artifact_request_v1(&wrong_session).expect("wrong-session retry encodes");
    assert_eq!(
        call_request_artifact(session_id, &wrong_wire).status,
        RITO_STATUS_INVALID_ARGUMENT_V1
    );
    assert_eq!(
        call_request_artifact(session_id, &initial_wire).status,
        RITO_STATUS_STALE_REQUEST_V1,
        "the open request id was already accepted"
    );

    let mut resumed = initial;
    resumed.request_id = 11;
    let one_quantum_wire =
        encode_reader_artifact_request_v1(&resumed).expect("bounded resume request encodes");
    let still_pending = call_request_artifact(session_id, &one_quantum_wire);
    assert_eq!(
        still_pending.status, RITO_STATUS_EXACT_SEEK_PENDING_V1,
        "{}",
        still_pending.error
    );
    assert!(still_pending.artifact.is_empty());
    assert_eq!(call_read_publication(session_id).status, RITO_STATUS_OK_V1);

    resumed.request_id = 12;
    resumed.work.max_top_level_nodes_per_quantum = 32;
    resumed.work.max_foreground_quanta = 512;
    let resumed_wire =
        encode_reader_artifact_request_v1(&resumed).expect("final resume request encodes");
    let result = call_request_artifact(session_id, &resumed_wire);
    assert_eq!(result.status, RITO_STATUS_OK_V1, "{}", result.error);
    let artifact = decode_reader_artifact_v1(&result.artifact).expect("resumed artifact decodes");
    assert_eq!(artifact.session_id, session_id);
    assert_eq!(artifact.request_id, 12);
    assert_eq!(artifact.revision_id, 1);
    assert_eq!(artifact.artifact_id, 1);
    assert_eq!(artifact.locator.progression, Some(0.95));

    assert_eq!(
        call_release(session_id, artifact.artifact_id),
        RITO_STATUS_OK_V1
    );
    assert_eq!(call_dispose(session_id), RITO_STATUS_OK_V1);
}

#[test]
fn disposing_a_pending_open_releases_the_session_for_reuse() {
    let session_id = next_session_id();
    let publication = publication();
    let initial = pending_open_request(session_id, 1);
    let initial_wire =
        encode_reader_artifact_request_v1(&initial).expect("pending open request encodes");
    assert_eq!(
        call_open(&publication, &initial_wire).status,
        RITO_STATUS_EXACT_SEEK_PENDING_V1
    );

    assert_eq!(call_dispose(session_id), RITO_STATUS_OK_V1);
    assert_eq!(
        call_read_publication(session_id).status,
        RITO_STATUS_NOT_FOUND_V1
    );

    let reopened_wire =
        encode_reader_artifact_request_v1(&request(session_id)).expect("reopen request encodes");
    let reopened = call_open(&publication, &reopened_wire);
    assert_eq!(reopened.status, RITO_STATUS_OK_V1, "{}", reopened.error);
    let artifact = decode_reader_artifact_v1(&reopened.artifact).expect("reopen artifact decodes");
    assert_eq!(artifact.artifact_id, 1);
    assert_eq!(call_dispose(session_id), RITO_STATUS_OK_V1);
}

#[test]
fn adjacent_request_is_actor_owned_strict_and_bounded() {
    let session_id = next_session_id();
    let publication = publication();
    let mut initial = request(session_id);
    initial.locator.href = "OEBPS/Text/Section011.xhtml".to_owned();
    let open_wire = encode_reader_artifact_request_v1(&initial).expect("request encodes");
    let opened = call_open(&publication, &open_wire);
    assert_eq!(opened.status, RITO_STATUS_OK_V1, "{}", opened.error);
    let first = decode_reader_artifact_v1(&opened.artifact).expect("first artifact decodes");

    let next_wire = adjacent_wire(session_id, 2, first.artifact_id);
    let next = call_request_adjacent(session_id, &next_wire);
    assert_eq!(next.status, RITO_STATUS_OK_V1, "{}", next.error);
    let next = decode_reader_artifact_v1(&next.artifact).expect("next artifact decodes");
    assert_ne!(next.artifact_id, first.artifact_id);
    assert_eq!(next.request_id, 2);
    assert_eq!(next.revision_id, first.revision_id);
    assert!(next.local_spread_index > first.local_spread_index);

    assert_eq!(
        call_request_adjacent(session_id, &next_wire[..next_wire.len() - 1]).status,
        RITO_STATUS_INVALID_ARGUMENT_V1
    );
    let mut trailing = next_wire.clone();
    trailing.push(0);
    assert_eq!(
        call_request_adjacent(session_id, &trailing).status,
        RITO_STATUS_INVALID_ARGUMENT_V1
    );
    let wrong_abi_session = call_request_adjacent(session_id + 1, &next_wire);
    assert_eq!(
        wrong_abi_session.status, RITO_STATUS_INVALID_ARGUMENT_V1,
        "{}",
        wrong_abi_session.error
    );
    assert_eq!(
        call_request_adjacent(session_id, &adjacent_wire(session_id, 1, next.artifact_id)).status,
        RITO_STATUS_STALE_REQUEST_V1
    );
    assert_eq!(
        call_request_adjacent(session_id, &adjacent_wire(session_id, 3, i64::MAX as u64)).status,
        RITO_STATUS_NOT_FOUND_V1
    );

    assert_eq!(
        call_release(session_id, first.artifact_id),
        RITO_STATUS_OK_V1
    );
    assert_eq!(
        call_release(session_id, next.artifact_id),
        RITO_STATUS_OK_V1
    );
    assert_eq!(call_dispose(session_id), RITO_STATUS_OK_V1);
}

#[test]
fn background_candidate_and_handoff_are_owned_actor_round_trips() {
    let session_id = next_session_id();
    let open_wire =
        encode_reader_artifact_request_v1(&request(session_id)).expect("request encodes");
    let opened = call_open(&publication(), &open_wire);
    assert_eq!(opened.status, RITO_STATUS_OK_V1, "{}", opened.error);
    let visible = decode_reader_artifact_v1(&opened.artifact).expect("artifact decodes");
    let foreground_handoff = encode_reader_foreground_handoff_v1(&ReaderForegroundHandoffV1 {
        session_id,
        expected_visible_artifact_id: None,
        candidate_artifact_id: visible.artifact_id,
    })
    .expect("initial foreground handoff encodes");
    let foreground_adopted = call_adopt_foreground(session_id, &foreground_handoff);
    assert_eq!(
        foreground_adopted.status, RITO_STATUS_OK_V1,
        "{}",
        foreground_adopted.error
    );

    let request = encode_reader_background_request_v1(&ReaderBackgroundRequestV1 {
        session_id,
        expected_visible_artifact_id: visible.artifact_id,
        max_top_level_nodes_per_quantum: 64,
    })
    .expect("background request encodes");
    let mut candidate = None;
    for _ in 0..128 {
        let result = call_advance_background(session_id, &request);
        assert_eq!(result.status, RITO_STATUS_OK_V1, "{}", result.error);
        let advance = decode_reader_background_advance_v1(&result.wire).expect("advance decodes");
        assert_eq!(advance.intent_request_id, 1);
        assert_eq!(advance.replaces_artifact_id, visible.artifact_id);
        if advance.artifact.is_some() {
            candidate = advance.artifact;
            break;
        }
        assert_ne!(advance.state, ReaderBackgroundStateV1::Complete);
    }
    let candidate = candidate.expect("publication reaches a handoff candidate");

    let handoff = encode_reader_background_handoff_v1(&ReaderBackgroundHandoffV1 {
        session_id,
        expected_visible_artifact_id: visible.artifact_id,
        candidate_artifact_id: candidate.artifact_id,
    })
    .expect("handoff encodes");
    let adopted = call_adopt_background(session_id, &handoff);
    assert_eq!(adopted.status, RITO_STATUS_OK_V1, "{}", adopted.error);
    let ack = decode_reader_background_handoff_ack_v1(&adopted.wire).expect("ack decodes");
    assert_eq!(ack.intent_request_id, 1);
    assert_eq!(ack.replaced_artifact_id, visible.artifact_id);
    assert_eq!(ack.visible_artifact_id, candidate.artifact_id);

    assert_eq!(
        call_release(session_id, visible.artifact_id),
        RITO_STATUS_OK_V1
    );
    assert_eq!(
        call_release(session_id, candidate.artifact_id),
        RITO_STATUS_OK_V1
    );
    assert_eq!(call_dispose(session_id), RITO_STATUS_OK_V1);
}

#[test]
fn malformed_fixed_handoff_and_background_messages_fail_before_registry_lookup() {
    let session_id = next_session_id();
    let foreground = encode_reader_foreground_handoff_v1(&ReaderForegroundHandoffV1 {
        session_id,
        expected_visible_artifact_id: None,
        candidate_artifact_id: 1,
    })
    .expect("foreground handoff encodes");
    assert_eq!(foreground.len(), 48);
    assert_eq!(
        call_adopt_foreground(session_id, &foreground[..foreground.len() - 1]).status,
        RITO_STATUS_INVALID_ARGUMENT_V1
    );
    let mut trailing_foreground = foreground.clone();
    trailing_foreground.push(0);
    assert_eq!(
        call_adopt_foreground(session_id, &trailing_foreground).status,
        RITO_STATUS_INVALID_ARGUMENT_V1
    );
    assert_eq!(
        call_adopt_foreground(session_id + 1, &foreground).status,
        RITO_STATUS_INVALID_ARGUMENT_V1
    );
    let mut zero_candidate = foreground;
    zero_candidate[40..48].fill(0);
    assert_eq!(
        call_adopt_foreground(session_id, &zero_candidate).status,
        RITO_STATUS_INVALID_ARGUMENT_V1
    );

    let request = encode_reader_background_request_v1(&ReaderBackgroundRequestV1 {
        session_id,
        expected_visible_artifact_id: 1,
        max_top_level_nodes_per_quantum: 1,
    })
    .expect("background request encodes");
    assert_eq!(
        call_advance_background(session_id, &request[..request.len() - 1]).status,
        RITO_STATUS_INVALID_ARGUMENT_V1
    );
    assert_eq!(
        call_advance_background(session_id + 1, &request).status,
        RITO_STATUS_INVALID_ARGUMENT_V1
    );

    let handoff = encode_reader_background_handoff_v1(&ReaderBackgroundHandoffV1 {
        session_id,
        expected_visible_artifact_id: 1,
        candidate_artifact_id: 2,
    })
    .expect("handoff encodes");
    assert_eq!(
        call_adopt_background(session_id, &handoff[..handoff.len() - 1]).status,
        RITO_STATUS_INVALID_ARGUMENT_V1
    );
    assert_eq!(
        call_adopt_background(session_id + 1, &handoff).status,
        RITO_STATUS_INVALID_ARGUMENT_V1
    );
}

#[test]
fn ffi_statuses_distinguish_terminal_and_unsupported_profile() {
    let unsupported_session_id = next_session_id();
    let mut unsupported = request(unsupported_session_id);
    unsupported.text_profile = ReaderTextRenderingProfileV1::PositionedGlyphRuns;
    let unsupported_wire =
        encode_reader_artifact_request_v1(&unsupported).expect("unsupported request encodes");
    assert_eq!(
        call_open(&publication(), &unsupported_wire).status,
        RITO_STATUS_UNSUPPORTED_PROFILE_V1
    );
    assert_eq!(
        call_read_publication(unsupported_session_id).status,
        RITO_STATUS_NOT_FOUND_V1,
        "a non-pending open failure must not register an actor"
    );
    let valid_wire = encode_reader_artifact_request_v1(&request(unsupported_session_id))
        .expect("valid replacement open encodes");
    let valid = call_open(&publication(), &valid_wire);
    assert_eq!(valid.status, RITO_STATUS_OK_V1, "{}", valid.error);
    assert_eq!(call_dispose(unsupported_session_id), RITO_STATUS_OK_V1);

    let terminal_session_id = next_session_id();
    let mut terminal = request(terminal_session_id);
    terminal.locator.href = "OEBPS/Text/backcover.xhtml".to_owned();
    let terminal_wire =
        encode_reader_artifact_request_v1(&terminal).expect("terminal request encodes");
    let opened = call_open(&publication(), &terminal_wire);
    assert_eq!(opened.status, RITO_STATUS_OK_V1, "{}", opened.error);
    let artifact = decode_reader_artifact_v1(&opened.artifact).expect("terminal artifact decodes");
    let beyond = call_request_adjacent(
        terminal_session_id,
        &adjacent_wire(terminal_session_id, 2, artifact.artifact_id),
    );
    assert_eq!(
        beyond.status, RITO_STATUS_TARGET_NOT_PUBLISHED_V1,
        "{}",
        beyond.error
    );
    assert_eq!(
        call_release(terminal_session_id, artifact.artifact_id),
        RITO_STATUS_OK_V1
    );
    assert_eq!(call_dispose(terminal_session_id), RITO_STATUS_OK_V1);
}

#[test]
fn ffi_rejects_external_ids_above_i64_max_without_signed_conversion() {
    let invalid_id = (i64::MAX as u64) + 1;
    let session_id = next_session_id();
    let mut wire =
        encode_reader_artifact_request_v1(&request(session_id)).expect("request encodes");
    let session_offset =
        usize::try_from(READER_WIRE_HEADER_BYTES_V1).expect("wire header size fits usize");
    wire[session_offset..session_offset + 8].copy_from_slice(&invalid_id.to_le_bytes());

    let rejected = call_open(&publication(), &wire);
    assert_eq!(rejected.status, RITO_STATUS_INVALID_ARGUMENT_V1);
    assert!(!rejected.error.contains("-9223372036854775808"));

    let valid_wire =
        encode_reader_artifact_request_v1(&request(session_id)).expect("request encodes");
    let opened = call_open(&publication(), &valid_wire);
    assert_eq!(opened.status, RITO_STATUS_OK_V1, "{}", opened.error);
    let artifact = decode_reader_artifact_v1(&opened.artifact).expect("artifact decodes");
    let mut adjacent = adjacent_wire(session_id, 2, artifact.artifact_id);
    let from_artifact_offset = session_offset + 16;
    adjacent[from_artifact_offset..from_artifact_offset + 8]
        .copy_from_slice(&invalid_id.to_le_bytes());
    let rejected_adjacent = call_request_adjacent(session_id, &adjacent);
    assert_eq!(rejected_adjacent.status, RITO_STATUS_INVALID_ARGUMENT_V1);
    assert!(!rejected_adjacent.error.contains("-9223372036854775808"));
    assert_eq!(
        call_release(session_id, invalid_id),
        RITO_STATUS_INVALID_ARGUMENT_V1
    );
    assert_eq!(
        call_read_publication(invalid_id).status,
        RITO_STATUS_INVALID_ARGUMENT_V1
    );
    assert_eq!(call_dispose(session_id), RITO_STATUS_OK_V1);
    assert_eq!(call_dispose(invalid_id), RITO_STATUS_INVALID_ARGUMENT_V1);
}

struct ResourceResult {
    status: u32,
    resource: Vec<u8>,
    error: String,
}

struct OpenResult {
    status: u32,
    artifact: Vec<u8>,
    error: String,
}

struct OwnedWireResult {
    status: u32,
    wire: Vec<u8>,
    error: String,
}

fn call_open(publication: &[u8], request: &[u8]) -> OpenResult {
    let mut artifact = RitoOwnedBufferV1::EMPTY;
    let mut error = RitoOwnedBufferV1::EMPTY;
    let status = rito_open_v1(
        publication.as_ptr(),
        u64::try_from(publication.len()).expect("publication length is representable"),
        request.as_ptr(),
        u64::try_from(request.len()).expect("request length is representable"),
        &mut artifact,
        &mut error,
    );
    let result = OpenResult {
        status,
        artifact: copy_owned_buffer_for_test(&artifact),
        error: String::from_utf8_lossy(&copy_owned_buffer_for_test(&error)).into_owned(),
    };
    rito_buffer_free_v1(&mut artifact);
    rito_buffer_free_v1(&mut artifact);
    rito_buffer_free_v1(&mut error);
    result
}

fn call_request_artifact(session_id: u64, request: &[u8]) -> OpenResult {
    let mut artifact = RitoOwnedBufferV1::EMPTY;
    let mut error = RitoOwnedBufferV1::EMPTY;
    let status = rito_request_artifact_v1(
        session_id,
        request.as_ptr(),
        u64::try_from(request.len()).expect("request length is representable"),
        &mut artifact,
        &mut error,
    );
    let result = OpenResult {
        status,
        artifact: copy_owned_buffer_for_test(&artifact),
        error: String::from_utf8_lossy(&copy_owned_buffer_for_test(&error)).into_owned(),
    };
    rito_buffer_free_v1(&mut artifact);
    rito_buffer_free_v1(&mut artifact);
    rito_buffer_free_v1(&mut error);
    result
}

fn call_request_adjacent(session_id: u64, request: &[u8]) -> OpenResult {
    let mut artifact = RitoOwnedBufferV1::EMPTY;
    let mut error = RitoOwnedBufferV1::EMPTY;
    let status = rito_request_adjacent_v1(
        session_id,
        request.as_ptr(),
        u64::try_from(request.len()).expect("request length is representable"),
        &mut artifact,
        &mut error,
    );
    let result = OpenResult {
        status,
        artifact: copy_owned_buffer_for_test(&artifact),
        error: String::from_utf8_lossy(&copy_owned_buffer_for_test(&error)).into_owned(),
    };
    rito_buffer_free_v1(&mut artifact);
    rito_buffer_free_v1(&mut artifact);
    rito_buffer_free_v1(&mut error);
    result
}

fn call_read_publication(session_id: u64) -> OwnedWireResult {
    let mut publication = RitoOwnedBufferV1::EMPTY;
    let mut error = RitoOwnedBufferV1::EMPTY;
    let status = rito_read_publication_v1(session_id, &mut publication, &mut error);
    let result = OwnedWireResult {
        status,
        wire: copy_owned_buffer_for_test(&publication),
        error: String::from_utf8_lossy(&copy_owned_buffer_for_test(&error)).into_owned(),
    };
    rito_buffer_free_v1(&mut publication);
    rito_buffer_free_v1(&mut publication);
    rito_buffer_free_v1(&mut error);
    result
}

fn call_advance_background(session_id: u64, request: &[u8]) -> OwnedWireResult {
    let mut advance = RitoOwnedBufferV1::EMPTY;
    let mut error = RitoOwnedBufferV1::EMPTY;
    let status = rito_advance_background_v1(
        session_id,
        request.as_ptr(),
        u64::try_from(request.len()).expect("request length is representable"),
        &mut advance,
        &mut error,
    );
    let result = OwnedWireResult {
        status,
        wire: copy_owned_buffer_for_test(&advance),
        error: String::from_utf8_lossy(&copy_owned_buffer_for_test(&error)).into_owned(),
    };
    rito_buffer_free_v1(&mut advance);
    rito_buffer_free_v1(&mut advance);
    rito_buffer_free_v1(&mut error);
    result
}

fn call_adopt_foreground(session_id: u64, request: &[u8]) -> OwnedWireResult {
    let mut ack = RitoOwnedBufferV1::EMPTY;
    let mut error = RitoOwnedBufferV1::EMPTY;
    let status = rito_adopt_foreground_candidate_v1(
        session_id,
        request.as_ptr(),
        u64::try_from(request.len()).expect("request length is representable"),
        &mut ack,
        &mut error,
    );
    let result = OwnedWireResult {
        status,
        wire: copy_owned_buffer_for_test(&ack),
        error: String::from_utf8_lossy(&copy_owned_buffer_for_test(&error)).into_owned(),
    };
    rito_buffer_free_v1(&mut ack);
    rito_buffer_free_v1(&mut ack);
    rito_buffer_free_v1(&mut error);
    result
}

fn call_adopt_background(session_id: u64, request: &[u8]) -> OwnedWireResult {
    let mut ack = RitoOwnedBufferV1::EMPTY;
    let mut error = RitoOwnedBufferV1::EMPTY;
    let status = rito_adopt_background_candidate_v1(
        session_id,
        request.as_ptr(),
        u64::try_from(request.len()).expect("request length is representable"),
        &mut ack,
        &mut error,
    );
    let result = OwnedWireResult {
        status,
        wire: copy_owned_buffer_for_test(&ack),
        error: String::from_utf8_lossy(&copy_owned_buffer_for_test(&error)).into_owned(),
    };
    rito_buffer_free_v1(&mut ack);
    rito_buffer_free_v1(&mut ack);
    rito_buffer_free_v1(&mut error);
    result
}

fn call_read_resource(session_id: u64, artifact_id: u64, kind: u32, href: &[u8]) -> ResourceResult {
    let mut resource = RitoOwnedBufferV1::EMPTY;
    let mut error = RitoOwnedBufferV1::EMPTY;
    let status = rito_read_resource_v1(
        session_id,
        artifact_id,
        kind,
        href.as_ptr(),
        u64::try_from(href.len()).expect("href length is representable"),
        &mut resource,
        &mut error,
    );
    let result = ResourceResult {
        status,
        resource: copy_owned_buffer_for_test(&resource),
        error: String::from_utf8_lossy(&copy_owned_buffer_for_test(&error)).into_owned(),
    };
    rito_buffer_free_v1(&mut resource);
    rito_buffer_free_v1(&mut resource);
    rito_buffer_free_v1(&mut error);
    result
}

fn call_read_footnote(session_id: u64, artifact_id: u64, key: &[u8]) -> ResourceResult {
    let mut footnote = RitoOwnedBufferV1::EMPTY;
    let mut error = RitoOwnedBufferV1::EMPTY;
    let status = rito_read_footnote_v1(
        session_id,
        artifact_id,
        key.as_ptr(),
        u64::try_from(key.len()).expect("key length is representable"),
        &mut footnote,
        &mut error,
    );
    let result = ResourceResult {
        status,
        resource: copy_owned_buffer_for_test(&footnote),
        error: String::from_utf8_lossy(&copy_owned_buffer_for_test(&error)).into_owned(),
    };
    rito_buffer_free_v1(&mut footnote);
    rito_buffer_free_v1(&mut error);
    result
}

fn call_release(session_id: u64, artifact_id: u64) -> u32 {
    let mut error = RitoOwnedBufferV1::EMPTY;
    let status = rito_release_artifact_v1(session_id, artifact_id, &mut error);
    rito_buffer_free_v1(&mut error);
    status
}

fn call_dispose(session_id: u64) -> u32 {
    let mut error = RitoOwnedBufferV1::EMPTY;
    let status = rito_dispose_v1(session_id, &mut error);
    rito_buffer_free_v1(&mut error);
    status
}

fn next_session_id() -> u64 {
    NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed)
}

fn publication() -> Vec<u8> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/rito/tests/fixtures/books/book-10.epub");
    fs::read(path).expect("book-10 fixture is readable")
}

fn request(session_id: u64) -> ReaderArtifactRequestV1 {
    ReaderArtifactRequestV1 {
        session_id,
        request_id: 1,
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
            href: "OEBPS/Text/Section001.xhtml".to_owned(),
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

fn pending_open_request(session_id: u64, request_id: u64) -> ReaderArtifactRequestV1 {
    let mut request = request(session_id);
    request.request_id = request_id;
    request.locator.href = "OEBPS/Text/Section013.xhtml".to_owned();
    request.locator.progression = Some(0.95);
    request.work = ReaderWorkBudgetV1 {
        max_top_level_nodes_per_quantum: 1,
        max_foreground_quanta: 1,
        local_page_cap: 4,
    };
    request
}

fn adjacent_wire(session_id: u64, request_id: u64, from_artifact_id: u64) -> Vec<u8> {
    encode_reader_adjacent_request_v1(&ReaderAdjacentRequestV1 {
        session_id,
        request_id,
        from_artifact_id,
        direction: ReaderAdjacentDirectionV1::Next,
        work: ReaderWorkBudgetV1 {
            max_top_level_nodes_per_quantum: 32,
            max_foreground_quanta: 64,
            local_page_cap: 16,
        },
    })
    .expect("adjacent request encodes")
}

#[test]
fn pinned_font_open_declares_embedded_publication_faces() {
    let session_id = next_session_id();
    let epub_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/reader/src/assets/demo.epub");
    let epub = fs::read(epub_path).expect("demo fixture is readable");
    let pinned_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/reader/src/assets/fonts/Tinos-Regular.ttf");
    let pinned = fs::read(pinned_path).expect("pinned face is readable");
    let sha256 = {
        use sha2::{Digest, Sha256};
        let digest: [u8; 32] = Sha256::digest(&pinned).into();
        let mut hex = [0u8; 64];
        for (index, byte) in digest.iter().enumerate() {
            let table = b"0123456789abcdef";
            hex[index * 2] = table[usize::from(byte >> 4)];
            hex[index * 2 + 1] = table[usize::from(byte & 0x0f)];
        }
        hex
    };
    let face = RitoPinnedFontFaceV1 {
        bytes_data: pinned.as_ptr(),
        bytes_len: u64::try_from(pinned.len()).expect("face length is representable"),
        sha256_hex: sha256,
        generic_role: RITO_PINNED_FONT_ROLE_SERIF_V1,
        language_data: std::ptr::null(),
        language_len: 0,
    };
    let wire = encode_reader_artifact_request_v1(&request(session_id)).expect("request encodes");

    let mut artifact = RitoOwnedBufferV1::EMPTY;
    let mut error = RitoOwnedBufferV1::EMPTY;
    let status = rito_open_with_pinned_fonts_v1(
        epub.as_ptr(),
        u64::try_from(epub.len()).expect("epub length is representable"),
        wire.as_ptr(),
        u64::try_from(wire.len()).expect("request length is representable"),
        &face,
        1,
        &mut artifact,
        &mut error,
    );
    let artifact_bytes = copy_owned_buffer_for_test(&artifact);
    let error_text = String::from_utf8_lossy(&copy_owned_buffer_for_test(&error)).into_owned();
    rito_buffer_free_v1(&mut artifact);
    rito_buffer_free_v1(&mut error);
    assert_eq!(status, RITO_STATUS_OK_V1, "{error_text}");
    let decoded = decode_reader_artifact_v1(&artifact_bytes).expect("artifact decodes");
    assert!(
        !decoded.fonts.is_empty(),
        "a pinned-font open must declare the embedded faces its layout used"
    );
    assert!(decoded
        .resources
        .iter()
        .any(|resource| resource.kind == ReaderResourceKindV1::Font));
    call_dispose(session_id);
}

#[test]
fn peek_and_commit_round_trip_without_foreground_side_effects() {
    let session_id = next_session_id();
    let mut open_request = request(session_id);
    // Section013 spans many pages, so the in-chapter neighbors peek
    // without any layout work.
    open_request.locator.href = "OEBPS/Text/Section013.xhtml".to_owned();
    let open_wire = encode_reader_artifact_request_v1(&open_request).expect("request encodes");
    let opened = call_open(&publication(), &open_wire);
    assert_eq!(opened.status, RITO_STATUS_OK_V1, "{}", opened.error);
    let first = decode_reader_artifact_v1(&opened.artifact).expect("artifact decodes");
    let adopted = call_adopt_foreground(
        session_id,
        &encode_reader_foreground_handoff_v1(&ReaderForegroundHandoffV1 {
            session_id,
            expected_visible_artifact_id: None,
            candidate_artifact_id: first.artifact_id,
        })
        .expect("handoff encodes"),
    );
    assert_eq!(adopted.status, RITO_STATUS_OK_V1, "{}", adopted.error);

    // Advance one spread so the previous neighbor is laid out, then peek.
    let next_wire = encode_reader_adjacent_request_v1(&ReaderAdjacentRequestV1 {
        session_id,
        request_id: 2,
        from_artifact_id: first.artifact_id,
        direction: ReaderAdjacentDirectionV1::Next,
        work: request(session_id).work,
    })
    .expect("adjacent encodes");
    let next = call_request_adjacent(session_id, &next_wire);
    assert_eq!(next.status, RITO_STATUS_OK_V1, "{}", next.error);
    let next = decode_reader_artifact_v1(&next.artifact).expect("next decodes");
    let adopted_next = call_adopt_foreground(
        session_id,
        &encode_reader_foreground_handoff_v1(&ReaderForegroundHandoffV1 {
            session_id,
            expected_visible_artifact_id: Some(first.artifact_id),
            candidate_artifact_id: next.artifact_id,
        })
        .expect("handoff encodes"),
    );
    assert_eq!(
        adopted_next.status, RITO_STATUS_OK_V1,
        "{}",
        adopted_next.error
    );

    let peek_wire = encode_reader_adjacent_request_v1(&ReaderAdjacentRequestV1 {
        session_id,
        request_id: 3,
        from_artifact_id: next.artifact_id,
        direction: ReaderAdjacentDirectionV1::Previous,
        work: request(session_id).work,
    })
    .expect("peek encodes");
    let mut artifact_out = RitoOwnedBufferV1::EMPTY;
    let mut error_out = RitoOwnedBufferV1::EMPTY;
    let status = rito_peek_adjacent_v1(
        session_id,
        peek_wire.as_ptr(),
        u64::try_from(peek_wire.len()).expect("length fits"),
        &mut artifact_out,
        &mut error_out,
    );
    let peeked_bytes = copy_owned_buffer_for_test(&artifact_out);
    let error_text = String::from_utf8_lossy(&copy_owned_buffer_for_test(&error_out)).into_owned();
    rito_buffer_free_v1(&mut artifact_out);
    rito_buffer_free_v1(&mut error_out);
    assert_eq!(status, RITO_STATUS_OK_V1, "{error_text}");
    let peeked = decode_reader_artifact_v1(&peeked_bytes).expect("peeked decodes");
    assert_eq!(peeked.local_page_index, first.local_page_index);

    // Fast-path commit of the peeked artifact.
    let commit_wire = encode_reader_foreground_handoff_v1(&ReaderForegroundHandoffV1 {
        session_id,
        expected_visible_artifact_id: Some(next.artifact_id),
        candidate_artifact_id: peeked.artifact_id,
    })
    .expect("handoff encodes");
    let mut ack_out = RitoOwnedBufferV1::EMPTY;
    let mut commit_error = RitoOwnedBufferV1::EMPTY;
    let commit_status = rito_commit_peeked_artifact_v1(
        session_id,
        commit_wire.as_ptr(),
        u64::try_from(commit_wire.len()).expect("length fits"),
        &mut ack_out,
        &mut commit_error,
    );
    let ack_bytes = copy_owned_buffer_for_test(&ack_out);
    let commit_error_text =
        String::from_utf8_lossy(&copy_owned_buffer_for_test(&commit_error)).into_owned();
    rito_buffer_free_v1(&mut ack_out);
    rito_buffer_free_v1(&mut commit_error);
    assert_eq!(commit_status, RITO_STATUS_OK_V1, "{commit_error_text}");
    let ack = decode_reader_foreground_handoff_ack_v1(&ack_bytes).expect("ack decodes");
    assert_eq!(ack.visible_artifact_id, peeked.artifact_id);
    assert_eq!(ack.replaced_artifact_id, Some(next.artifact_id));

    call_dispose(session_id);
}

#[test]
fn footnote_hits_read_back_through_the_abi() {
    let session_id = next_session_id();
    let open_wire =
        encode_reader_artifact_request_v1(&request(session_id)).expect("request encodes");
    let opened = call_open(&publication(), &open_wire);
    assert_eq!(opened.status, RITO_STATUS_OK_V1, "{}", opened.error);
    let artifact = decode_reader_artifact_v1(&opened.artifact).expect("artifact decodes");

    // The corpus book carries real notereds; walk forward until a page
    // publishes one, then read its definition with the key verbatim.
    let mut current = artifact;
    let mut found = None;
    for request_id in 2..26 {
        if let Some(key) = current
            .pages
            .iter()
            .flat_map(|page| page.hits.iter())
            .find_map(|hit| hit.footnote_key.clone().filter(|_| !hit.footnote_pending))
        {
            found = Some((current.artifact_id, key));
            break;
        }
        let wire = encode_reader_adjacent_request_v1(&ReaderAdjacentRequestV1 {
            session_id,
            request_id,
            from_artifact_id: current.artifact_id,
            direction: ReaderAdjacentDirectionV1::Next,
            work: request(session_id).work,
        })
        .expect("adjacent encodes");
        let next = call_request_adjacent(session_id, &wire);
        if next.status != RITO_STATUS_OK_V1 {
            break;
        }
        current = decode_reader_artifact_v1(&next.artifact).expect("next decodes");
    }

    if let Some((artifact_id, key)) = found {
        let result = call_read_footnote(session_id, artifact_id, key.as_bytes());
        assert_eq!(result.status, RITO_STATUS_OK_V1, "{}", result.error);
        let footnote = decode_reader_footnote_v1(&result.resource).expect("footnote wire decodes");
        assert_eq!(footnote.key, key);
        assert_eq!(footnote.artifact_id, artifact_id);
        assert!(!footnote.text.is_empty(), "{footnote:?}");
    }

    // An unknown key is a clean typed failure, never a crash.
    let missing = call_read_footnote(session_id, current.artifact_id, b"nope.xhtml#missing");
    assert_eq!(missing.status, RITO_STATUS_TARGET_NOT_PUBLISHED_V1);
    let empty = call_read_footnote(session_id, current.artifact_id, b"");
    assert_eq!(empty.status, RITO_STATUS_INVALID_ARGUMENT_V1);
    call_dispose(session_id);
}

#[test]
fn text_range_geometry_crosses_the_abi_in_display_list_space() {
    let session_id = next_session_id();
    let open_wire =
        encode_reader_artifact_request_v1(&request(session_id)).expect("request encodes");
    let opened = call_open(&publication(), &open_wire);
    assert_eq!(opened.status, RITO_STATUS_OK_V1, "{}", opened.error);
    let mut artifact = decode_reader_artifact_v1(&opened.artifact).expect("artifact decodes");
    // The opening spread of the corpus book can be a plate with no text
    // runs; walk forward until a page actually carries one.
    for request_id in 2..14 {
        if artifact.pages.iter().any(|page| !page.text_runs.is_empty()) {
            break;
        }
        let wire = encode_reader_adjacent_request_v1(&ReaderAdjacentRequestV1 {
            session_id,
            request_id,
            from_artifact_id: artifact.artifact_id,
            direction: ReaderAdjacentDirectionV1::Next,
            work: request(session_id).work,
        })
        .expect("adjacent encodes");
        let next = call_request_adjacent(session_id, &wire);
        if next.status != RITO_STATUS_OK_V1 {
            break;
        }
        let previous = artifact.artifact_id;
        artifact = decode_reader_artifact_v1(&next.artifact).expect("next decodes");
        call_release(session_id, previous);
    }
    let page = artifact
        .pages
        .iter()
        .find(|page| !page.text_runs.is_empty())
        .expect("a page with text");
    let run = page.text_runs.first().copied().expect("a text run");

    let wire = encode_reader_text_range_request_v1(&ReaderTextRangeRequestV1 {
        session_id,
        artifact_id: artifact.artifact_id,
        page_index: page.page_index,
        start: ReaderTextPositionV1 {
            block_index: run.block_index,
            line_index: run.line_index,
            run_index: run.run_index,
            char_index: 0,
        },
        end: ReaderTextPositionV1 {
            block_index: run.block_index,
            line_index: run.line_index,
            run_index: run.run_index,
            char_index: 1,
        },
    })
    .expect("text range request encodes");
    let mut geometry_out = RitoOwnedBufferV1::EMPTY;
    let mut error_out = RitoOwnedBufferV1::EMPTY;
    let status = rito_get_text_range_geometry_v1(
        session_id,
        wire.as_ptr(),
        u64::try_from(wire.len()).expect("length"),
        &mut geometry_out,
        &mut error_out,
    );
    let bytes = copy_owned_buffer_for_test(&geometry_out);
    let error = String::from_utf8_lossy(&copy_owned_buffer_for_test(&error_out)).into_owned();
    rito_buffer_free_v1(&mut geometry_out);
    rito_buffer_free_v1(&mut error_out);
    assert_eq!(status, RITO_STATUS_OK_V1, "{error}");

    let geometry = decode_reader_text_range_geometry_v1(&bytes).expect("geometry decodes");
    assert_eq!(geometry.artifact_id, artifact.artifact_id);
    assert_eq!(geometry.page_index, page.page_index);
    assert!(!geometry.rects.is_empty());
    // Same space as the hits the same artifact published.
    let margin_left = request(session_id).layout.margin_left;
    for rect in &geometry.rects {
        assert!(rect.bounds.x >= margin_left, "{rect:?}");
    }
    call_dispose(session_id);
}

#[test]
fn search_crosses_the_abi_with_locators_and_context() {
    let session_id = next_session_id();
    let mut open_request = request(session_id);
    // The corpus book opens on a plate; search needs rendered text.
    open_request.locator.href = "OEBPS/Text/Section013.xhtml".to_owned();
    let open_wire = encode_reader_artifact_request_v1(&open_request).expect("request encodes");
    let opened = call_open(&publication(), &open_wire);
    assert_eq!(opened.status, RITO_STATUS_OK_V1, "{}", opened.error);
    let artifact = decode_reader_artifact_v1(&opened.artifact).expect("artifact decodes");
    let needle = artifact
        .pages
        .iter()
        .flat_map(|page| page.text.split_whitespace())
        .find(|word| word.chars().count() >= 2)
        .expect("the chapter renders text")
        .to_owned();

    let wire = encode_reader_search_request_v1(&ReaderSearchRequestV1 {
        session_id,
        artifact_id: artifact.artifact_id,
        query: needle.clone(),
        case_sensitive: false,
        whole_word: false,
        limit: 16,
    })
    .expect("search request encodes");
    let mut response_out = RitoOwnedBufferV1::EMPTY;
    let mut error_out = RitoOwnedBufferV1::EMPTY;
    let status = rito_search_v1(
        session_id,
        wire.as_ptr(),
        u64::try_from(wire.len()).expect("length"),
        &mut response_out,
        &mut error_out,
    );
    let bytes = copy_owned_buffer_for_test(&response_out);
    let error = String::from_utf8_lossy(&copy_owned_buffer_for_test(&error_out)).into_owned();
    rito_buffer_free_v1(&mut response_out);
    rito_buffer_free_v1(&mut error_out);
    assert_eq!(status, RITO_STATUS_OK_V1, "{error}");

    let response = decode_reader_search_response_v1(&bytes).expect("response decodes");
    assert_eq!(response.artifact_id, artifact.artifact_id);
    assert_eq!(response.query, needle);
    let hit = response.results.first().expect("the word is found");
    assert!(hit.context.contains(&needle), "{hit:?}");
    // A durable anchor is what a host stores; page indexes move.
    assert!(hit.locator.is_some(), "{hit:?}");
    call_dispose(session_id);
}
