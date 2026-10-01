//! The browser binding's reader-session queries answer byte for byte what
//! the Core session they wrap answers, so a browser host and a native host
//! that ask the same question read the same message.

use rito_core::runtime::{
    decode_reader_adjacent_request, decode_reader_annotation_request, decode_reader_artifact,
    decode_reader_exact_source_range_request, decode_reader_foreground_handoff,
    decode_reader_navigation_request, decode_reader_search_request,
    decode_reader_text_interaction_request, decode_reader_text_range_request,
    encode_reader_annotation_request, encode_reader_annotation_response, encode_reader_artifact,
    encode_reader_exact_source_range_request, encode_reader_exact_source_range_resolution,
    encode_reader_foreground_handoff_ack, encode_reader_navigation_request,
    encode_reader_navigation_result, encode_reader_search_request, encode_reader_search_response,
    encode_reader_text_interaction_request, encode_reader_text_interaction_response,
    encode_reader_text_range_geometry, encode_reader_text_range_request, ReaderAdjacentDirection,
    ReaderAnnotationQuery, ReaderAnnotationRequest, ReaderExactSourceRangeRequest,
    ReaderForegroundHandoff, ReaderNavigationQuery, ReaderNavigationRequest, ReaderSearchRequest,
    ReaderSelectionGranularity, ReaderSession, ReaderSourceRange, ReaderTextInteractionQuery,
    ReaderTextInteractionRequest, ReaderTextInteractionResult, ReaderTextPoint, ReaderTextPosition,
    ReaderTextRangeRequest,
};

use super::{
    queries::Query,
    tests::{
        adjacent_wire, foreground_handoff_wire, open_test_projection, request_wire,
        source_locator_fixture_epub, SESSION_ID,
    },
    ReaderSessionProjection,
};

fn sessions() -> (ReaderSession, ReaderSessionProjection, u64) {
    let publication = source_locator_fixture_epub();
    let mut direct = ReaderSession::open_owned_with_pinned_font_policy(
        SESSION_ID,
        publication.clone(),
        crate::tests::fixture::pinned_test_policy_input(),
    )
    .expect("direct Core session opens");
    let mut projection =
        open_test_projection(publication, SESSION_ID).expect("binding session opens");
    let request = request_wire(SESSION_ID, 1, "chapter.xhtml");
    let direct_artifact = direct
        .request_artifact(rito_core::runtime::decode_reader_artifact_request(&request).unwrap())
        .expect("direct artifact");
    let binding_artifact = projection
        .request_artifact(&request)
        .expect("binding artifact");
    assert_eq!(
        binding_artifact,
        encode_reader_artifact(&direct_artifact).unwrap()
    );
    let artifact_id = direct_artifact.artifact_id;
    let handoff = foreground_handoff_wire(SESSION_ID, None, artifact_id);
    direct
        .adopt_foreground_candidate(decode_reader_foreground_handoff(&handoff).unwrap())
        .expect("direct adopt");
    projection
        .adopt_foreground_candidate(&handoff)
        .expect("binding adopt");
    (direct, projection, artifact_id)
}

#[test]
fn every_query_answers_the_bytes_core_answers() {
    let (mut direct, mut projection, artifact_id) = sessions();
    let artifact = decode_reader_artifact(
        &encode_reader_artifact(
            &direct
                .request_artifact(
                    rito_core::runtime::decode_reader_artifact_request(&request_wire(
                        SESSION_ID,
                        2,
                        "chapter.xhtml",
                    ))
                    .unwrap(),
                )
                .unwrap(),
        )
        .unwrap(),
    )
    .unwrap();
    projection
        .request_artifact(&request_wire(SESSION_ID, 2, "chapter.xhtml"))
        .expect("binding second artifact");
    let page = &artifact.pages[0];
    let hit = page
        .hits
        .iter()
        .find(|hit| !hit.text.is_empty())
        .expect("a text hit");

    let points = encode_reader_text_interaction_request(&ReaderTextInteractionRequest {
        session_id: SESSION_ID,
        artifact_id,
        query: ReaderTextInteractionQuery::RangeFromPoints {
            anchor: ReaderTextPoint {
                page_index: page.page_index,
                x: hit.bounds.x + 2.0,
                y: hit.bounds.y + hit.bounds.height / 2.0,
            },
            focus: ReaderTextPoint {
                page_index: page.page_index,
                x: hit.bounds.x + 2.0,
                y: hit.bounds.y + hit.bounds.height / 2.0,
            },
            granularity: ReaderSelectionGranularity::Word,
        },
    })
    .unwrap();
    let direct_interaction = direct
        .resolve_text_interaction(decode_reader_text_interaction_request(&points).unwrap())
        .expect("direct selection");
    assert_eq!(
        projection.query(&points, Query::TextInteraction).unwrap(),
        encode_reader_text_interaction_response(&direct_interaction).unwrap()
    );
    let ReaderTextInteractionResult::Selection(selection) = direct_interaction.result else {
        panic!("a word under a text hit selects");
    };
    let range = ReaderSourceRange {
        start: selection.selection.source_start.clone(),
        end: selection.selection.source_end.clone(),
    };
    let href = selection.selection.source_start_href.clone();

    let create = encode_reader_annotation_request(&ReaderAnnotationRequest {
        session_id: SESSION_ID,
        query: ReaderAnnotationQuery::Create {
            href: href.clone(),
            range: range.clone(),
        },
    })
    .unwrap();
    assert_eq!(
        projection.query(&create, Query::Annotation).unwrap(),
        encode_reader_annotation_response(
            &direct
                .resolve_annotation(decode_reader_annotation_request(&create).unwrap())
                .unwrap()
        )
        .unwrap()
    );

    let exact = encode_reader_exact_source_range_request(&ReaderExactSourceRangeRequest {
        session_id: SESSION_ID,
        artifact_id,
        href: href.clone(),
        range,
    })
    .unwrap();
    assert_eq!(
        projection.query(&exact, Query::ExactSourceRange).unwrap(),
        encode_reader_exact_source_range_resolution(
            &direct
                .resolve_exact_source_range(
                    decode_reader_exact_source_range_request(&exact).unwrap()
                )
                .unwrap()
        )
        .unwrap()
    );

    let search = encode_reader_search_request(&ReaderSearchRequest {
        session_id: SESSION_ID,
        artifact_id,
        query: "paragraph 3".to_owned(),
        case_sensitive: false,
        whole_word: false,
        limit: 4,
    })
    .unwrap();
    assert_eq!(
        projection.query(&search, Query::Search).unwrap(),
        encode_reader_search_response(
            &direct
                .search(decode_reader_search_request(&search).unwrap())
                .unwrap()
        )
        .unwrap()
    );

    let run = page.text_runs[0];
    let at = |char_index| ReaderTextPosition {
        block_index: run.block_index,
        line_index: run.line_index,
        run_index: run.run_index,
        char_index,
    };
    let geometry = encode_reader_text_range_request(&ReaderTextRangeRequest {
        session_id: SESSION_ID,
        artifact_id,
        page_index: page.page_index,
        start: at(0),
        end: at(5),
    })
    .unwrap();
    assert_eq!(
        projection
            .query(&geometry, Query::TextRangeGeometry)
            .unwrap(),
        encode_reader_text_range_geometry(
            &direct
                .get_text_range_geometry(decode_reader_text_range_request(&geometry).unwrap())
                .unwrap()
        )
        .unwrap()
    );

    let toc = encode_reader_navigation_request(&ReaderNavigationRequest {
        session_id: SESSION_ID,
        query: ReaderNavigationQuery::TocEntryAtPage {
            artifact_id,
            page_index: page.page_index,
        },
    })
    .unwrap();
    assert_eq!(
        projection.query(&toc, Query::Navigation).unwrap(),
        encode_reader_navigation_result(
            &direct
                .resolve_navigation(decode_reader_navigation_request(&toc).unwrap())
                .unwrap()
        )
        .unwrap()
    );

    assert!(projection
        .read_footnote(artifact_id, "chapter.xhtml#missing")
        .is_err());
    assert!(direct
        .read_footnote(artifact_id, "chapter.xhtml#missing")
        .is_err());
}

#[test]
fn a_peeked_page_commits_with_the_acknowledgement_core_gives() {
    let (mut direct, mut projection, artifact_id) = sessions();
    let peek = adjacent_wire(SESSION_ID, 2, artifact_id, ReaderAdjacentDirection::Next);
    let direct_peek = direct
        .peek_adjacent(decode_reader_adjacent_request(&peek).unwrap())
        .expect("direct peek");
    assert_eq!(
        projection.peek_adjacent(&peek).expect("binding peek"),
        encode_reader_artifact(&direct_peek).unwrap()
    );
    let commit = foreground_handoff_wire(SESSION_ID, Some(artifact_id), direct_peek.artifact_id);
    let direct_ack = direct
        .commit_peeked_artifact(ReaderForegroundHandoff {
            session_id: SESSION_ID,
            expected_visible_artifact_id: Some(artifact_id),
            candidate_artifact_id: direct_peek.artifact_id,
        })
        .expect("direct commit");
    assert_eq!(
        projection
            .commit_peeked_artifact(&commit)
            .expect("binding commit"),
        encode_reader_foreground_handoff_ack(&direct_ack).unwrap()
    );
    assert!(
        projection.commit_peeked_artifact(&commit).is_err(),
        "a committed peek cannot commit twice"
    );
}
