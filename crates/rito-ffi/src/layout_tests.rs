//! A revision's page table and a spread addressed by its position, across
//! the C ABI.

use rito_core::runtime::{
    decode_reader_artifact, decode_reader_navigation_result, encode_reader_artifact_request,
    encode_reader_foreground_handoff, encode_reader_navigation_request,
    encode_reader_spread_request, ReaderForegroundHandoff, ReaderNavigationQuery,
    ReaderNavigationRequest, ReaderNavigationResult, ReaderSpreadRequest,
};

use crate::{
    rito_adopt_foreground_candidate, rito_commit_peeked_artifact, rito_dispose, rito_peek_spread,
    rito_resolve_navigation, RitoOwnedBuffer, RITO_STATUS_INVALID_ARGUMENT, RITO_STATUS_OK,
};

use super::tests::{call_open, call_owned_wire, next_session_id, publication, request};

fn length(bytes: &[u8]) -> u64 {
    u64::try_from(bytes.len()).expect("length fits")
}

#[test]
fn a_spread_named_by_the_layout_is_published_and_committed_across_the_abi() {
    let session_id = next_session_id();
    let open_wire = encode_reader_artifact_request(&request(session_id)).expect("request encodes");
    let opened = call_open(&publication(), &open_wire);
    assert_eq!(opened.status, RITO_STATUS_OK, "{}", opened.error);
    let first = decode_reader_artifact(&opened.artifact).expect("artifact decodes");
    let adopt = encode_reader_foreground_handoff(&ReaderForegroundHandoff {
        session_id,
        expected_visible_artifact_id: None,
        candidate_artifact_id: first.artifact_id,
    })
    .expect("handoff encodes");
    let adopted = call_owned_wire(|ack, error| {
        rito_adopt_foreground_candidate(session_id, adopt.as_ptr(), length(&adopt), ack, error)
    });
    assert_eq!(adopted.status, RITO_STATUS_OK, "{}", adopted.error);

    let layout_wire = encode_reader_navigation_request(&ReaderNavigationRequest {
        session_id,
        query: ReaderNavigationQuery::Layout {
            artifact_id: first.artifact_id,
        },
    })
    .expect("layout query encodes");
    let answered = call_owned_wire(|response, error| {
        rito_resolve_navigation(
            session_id,
            layout_wire.as_ptr(),
            length(&layout_wire),
            response,
            error,
        )
    });
    assert_eq!(answered.status, RITO_STATUS_OK, "{}", answered.error);
    let ReaderNavigationResult::Layout(layout) =
        decode_reader_navigation_result(&answered.wire).expect("layout decodes")
    else {
        panic!("a layout answer");
    };
    assert_eq!(layout.chapters.len(), 1, "one chapter is laid out");
    assert_eq!(layout.spreads.len(), layout.page_count as usize);
    let last = u32::try_from(layout.spreads.len() - 1).expect("spread count fits");

    let peek = |request_id: u64, spread_index: u32| {
        let wire = encode_reader_spread_request(&ReaderSpreadRequest {
            session_id,
            request_id,
            from_artifact_id: first.artifact_id,
            spread_index,
        })
        .expect("spread request encodes");
        call_owned_wire(|artifact: &mut RitoOwnedBuffer, error| {
            rito_peek_spread(session_id, wire.as_ptr(), length(&wire), artifact, error)
        })
    };
    let published = peek(2, last);
    assert_eq!(published.status, RITO_STATUS_OK, "{}", published.error);
    let target = decode_reader_artifact(&published.wire).expect("spread decodes");
    assert_eq!(target.local_spread_index, last);
    assert_eq!(
        target.local_page_indexes,
        vec![layout.spreads[last as usize].left_page_index]
    );

    let past_the_end = peek(3, last + 1);
    assert_eq!(past_the_end.status, RITO_STATUS_INVALID_ARGUMENT);
    assert!(past_the_end.wire.is_empty());

    let commit = encode_reader_foreground_handoff(&ReaderForegroundHandoff {
        session_id,
        expected_visible_artifact_id: Some(first.artifact_id),
        candidate_artifact_id: target.artifact_id,
    })
    .expect("handoff encodes");
    let committed = call_owned_wire(|ack, error| {
        rito_commit_peeked_artifact(session_id, commit.as_ptr(), length(&commit), ack, error)
    });
    assert_eq!(committed.status, RITO_STATUS_OK, "{}", committed.error);

    let mut error = RitoOwnedBuffer::EMPTY;
    assert_eq!(rito_dispose(session_id, &mut error), RITO_STATUS_OK);
}
