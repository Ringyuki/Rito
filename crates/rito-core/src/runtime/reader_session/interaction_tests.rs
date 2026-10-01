use crate::runtime::{
    annotation_target_to_json, tests::fixture::source_locator_fixture_epub, RuntimeDocument,
    RuntimeSourcePoint, RuntimeSourceRange, RuntimeTextPointRequest,
    RuntimeTextRangeFromPointsRequest, RuntimeTextRangeFromPointsResolution,
    RuntimeTextSelectionGranularity,
};

use super::{convert::layout_config, tests::open_test_session, *};

const SESSION: u64 = 171;
const CHAPTER: &str = "chapter.xhtml";

fn layout() -> ReaderLayout {
    ReaderLayout {
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
    }
}

fn open() -> (ReaderSession, ReaderArtifact) {
    let mut session = open_test_session(SESSION, source_locator_fixture_epub()).expect("opens");
    let artifact = session
        .request_artifact(ReaderArtifactRequest {
            session_id: SESSION,
            request_id: 1,
            layout: layout(),
            locator: ReaderLocator {
                href: String::new(),
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: None,
            },
            text_profile: ReaderTextRenderingProfile::PlatformStringRuns,
        })
        .expect("artifact resolves");
    (session, artifact)
}

/// The display-list centre of the first rect covering paragraph 0's `start..end`.
fn point_over(
    session: &mut ReaderSession,
    artifact_id: u64,
    start: u64,
    end: u64,
) -> ReaderTextPoint {
    let resolution = session
        .resolve_exact_source_range(ReaderExactSourceRangeRequest {
            session_id: SESSION,
            artifact_id,
            href: CHAPTER.to_owned(),
            range: ReaderSourceRange {
                start: ReaderSourcePoint {
                    node_path: vec![0, 0],
                    text_offset: start,
                },
                end: ReaderSourcePoint {
                    node_path: vec![0, 0],
                    text_offset: end,
                },
            },
        })
        .expect("range resolves");
    let rect = resolution.rects.first().expect("paragraph 0 is drawn");
    ReaderTextPoint {
        page_index: rect.page_index,
        x: rect.bounds.x + rect.bounds.width / 2.0,
        y: rect.bounds.y + rect.bounds.height / 2.0,
    }
}

fn interact(
    session: &mut ReaderSession,
    artifact_id: u64,
    query: ReaderTextInteractionQuery,
) -> ReaderTextInteractionResult {
    session
        .resolve_text_interaction(ReaderTextInteractionRequest {
            session_id: SESSION,
            artifact_id,
            query,
        })
        .expect("interaction resolves")
        .result
}

fn caret_at(session: &mut ReaderSession, artifact_id: u64, point: ReaderTextPoint) -> ReaderCaret {
    match interact(
        session,
        artifact_id,
        ReaderTextInteractionQuery::Caret { point },
    ) {
        ReaderTextInteractionResult::Caret(caret) => caret,
        other => panic!("caret expected, got {other:?}"),
    }
}

fn selection(result: ReaderTextInteractionResult) -> ReaderSelectionResult {
    match result {
        ReaderTextInteractionResult::Selection(selection) => *selection,
        other => panic!("selection expected, got {other:?}"),
    }
}

#[test]
fn a_caret_resolves_in_display_list_space_with_its_source_point() {
    let (mut session, artifact) = open();
    let point = point_over(&mut session, artifact.artifact_id, 0, 6);
    let caret = caret_at(&mut session, artifact.artifact_id, point);

    assert_eq!(caret.href, CHAPTER);
    assert_eq!(caret.source_point.node_path, vec![0, 0]);
    let geometry = caret.geometry.expect("the caret's page is drawn");
    assert!(geometry.y <= point.y && point.y <= geometry.y + geometry.height);
}

#[test]
fn word_and_paragraph_ranges_come_from_two_points() {
    let (mut session, artifact) = open();
    let point = point_over(&mut session, artifact.artifact_id, 0, 6);
    let word = selection(interact(
        &mut session,
        artifact.artifact_id,
        ReaderTextInteractionQuery::RangeFromPoints {
            anchor: point,
            focus: point,
            granularity: ReaderSelectionGranularity::Word,
        },
    ));
    assert_eq!(word.selection.selected_text, "Source");
    assert!(word.anchor_caret.is_some() && word.focus_caret.is_some());
    assert!(!word.selection.rects.is_empty());

    let paragraph = selection(interact(
        &mut session,
        artifact.artifact_id,
        ReaderTextInteractionQuery::RangeFromPoints {
            anchor: point,
            focus: point,
            granularity: ReaderSelectionGranularity::Paragraph,
        },
    ));
    assert!(paragraph
        .selection
        .selected_text
        .starts_with("Source locator paragraph 0 "));
}

#[test]
fn a_kept_caret_extends_to_a_point_and_two_carets_bound_a_range() {
    let (mut session, artifact) = open();
    let start_point = point_over(&mut session, artifact.artifact_id, 0, 1);
    let start = caret_at(&mut session, artifact.artifact_id, start_point);
    let end_point = point_over(&mut session, artifact.artifact_id, 8, 14);
    let dragged = selection(interact(
        &mut session,
        artifact.artifact_id,
        ReaderTextInteractionQuery::RangeToPoint {
            anchor: start.address,
            focus: end_point,
        },
    ));
    // The middle of "S" is nearer the caret after it.
    assert_eq!(dragged.selection.selected_text, "ource loca");

    let between = selection(interact(
        &mut session,
        artifact.artifact_id,
        ReaderTextInteractionQuery::Range {
            anchor: dragged.selection.anchor,
            focus: dragged.selection.focus,
        },
    ));
    assert_eq!(
        between.selection.selected_text,
        dragged.selection.selected_text
    );
    assert!(between.anchor_caret.is_none());
}

#[test]
fn a_movement_steps_the_focus_and_echoes_its_preferred_positions() {
    let (mut session, artifact) = open();
    let caret_point = point_over(&mut session, artifact.artifact_id, 0, 1);
    let caret = caret_at(&mut session, artifact.artifact_id, caret_point);
    let moved = selection(interact(
        &mut session,
        artifact.artifact_id,
        ReaderTextInteractionQuery::Movement {
            anchor: caret.address,
            focus: caret.address,
            movement: ReaderSelectionMovement::WordRight,
            preferred_inline_position: None,
            preferred_block_position: None,
        },
    ));
    assert!(!moved.selection.selected_text.is_empty());
    assert!(moved.focus_caret.is_some());
}

#[test]
fn a_point_on_a_page_the_artifact_does_not_draw_is_rejected() {
    let (mut session, artifact) = open();
    let error = session
        .resolve_text_interaction(ReaderTextInteractionRequest {
            session_id: SESSION,
            artifact_id: artifact.artifact_id,
            query: ReaderTextInteractionQuery::Caret {
                point: ReaderTextPoint {
                    page_index: 40,
                    x: 50.0,
                    y: 50.0,
                },
            },
        })
        .expect_err("page 40 is not drawn");
    assert_eq!(error.kind, ReaderErrorKind::InvalidRequest);
}

/// The same point on the same page must select the same text, from the
/// same source, whether a session or a browser revision answers it.
#[test]
fn a_session_selection_matches_the_whole_book_revision() {
    let (mut session, artifact) = open();
    let point = point_over(&mut session, artifact.artifact_id, 16, 25);
    let word = selection(interact(
        &mut session,
        artifact.artifact_id,
        ReaderTextInteractionQuery::RangeFromPoints {
            anchor: point,
            focus: point,
            granularity: ReaderSelectionGranularity::Word,
        },
    ));

    let config = layout_config(layout()).expect("layout converts");
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&source_locator_fixture_epub()).expect("opens");
    let revision = document.create_revision(&config).expect("revision");
    let page_point = RuntimeTextPointRequest {
        page_index: point.page_index as usize,
        x: point.x - config.margin_left,
        y: point.y - config.margin_top,
    };
    let response = document
        .resolve_text_range_from_points_for_revision(
            &revision.revision_id,
            RuntimeTextRangeFromPointsRequest {
                anchor: page_point,
                focus: page_point,
                granularity: RuntimeTextSelectionGranularity::Word,
            },
        )
        .expect("browser path resolves");
    let RuntimeTextRangeFromPointsResolution::Resolved { range, .. } = response.resolution else {
        panic!("browser path resolves a word");
    };
    assert_eq!(word.selection.selected_text, range.selected_text);
    assert_eq!(
        word.selection.source_start_href,
        range.source_span.start.href
    );
    assert_eq!(
        word.selection.source_start.text_offset,
        range.source_span.start.source_point.text_offset as u64
    );
    assert_eq!(
        word.selection.source_end.text_offset,
        range.source_span.end.source_point.text_offset as u64
    );
}

#[test]
fn annotation_targets_are_the_bytes_the_document_writes() {
    let (mut session, _) = open();
    let range = ReaderSourceRange {
        start: ReaderSourcePoint {
            node_path: vec![0, 0],
            text_offset: 0,
        },
        end: ReaderSourcePoint {
            node_path: vec![0, 0],
            text_offset: 6,
        },
    };
    let created = session
        .resolve_annotation(ReaderAnnotationRequest {
            session_id: SESSION,
            query: ReaderAnnotationQuery::Create {
                href: CHAPTER.to_owned(),
                range,
            },
        })
        .expect("target is built");
    assert_eq!(created.level, ReaderAnnotationLevel::Created);

    let mut document =
        RuntimeDocument::open_pinned_for_tests(&source_locator_fixture_epub()).expect("opens");
    let expected = document
        .create_annotation_target(
            CHAPTER,
            &RuntimeSourceRange {
                start: RuntimeSourcePoint {
                    node_path: vec![0, 0],
                    text_offset: 0,
                },
                end: RuntimeSourcePoint {
                    node_path: vec![0, 0],
                    text_offset: 6,
                },
            },
        )
        .expect("document builds the target");
    assert_eq!(created.target_json, annotation_target_to_json(&expected));

    let found = session
        .resolve_annotation(ReaderAnnotationRequest {
            session_id: SESSION,
            query: ReaderAnnotationQuery::Resolve {
                target_json: created.target_json.clone(),
            },
        })
        .expect("target resolves");
    assert_eq!(found.level, ReaderAnnotationLevel::Exact);
    assert_eq!(found.target_json, created.target_json);
}

#[test]
fn an_orphaned_or_malformed_target_is_reported_not_thrown() {
    let (mut session, _) = open();
    let orphan = annotation_target_to_json(&crate::runtime::AnnotationTarget {
        version: 1,
        href: "missing.xhtml".to_owned(),
        source_range: RuntimeSourceRange {
            start: RuntimeSourcePoint {
                node_path: vec![0],
                text_offset: 0,
            },
            end: RuntimeSourcePoint {
                node_path: vec![0],
                text_offset: 1,
            },
        },
        quote: crate::runtime::AnnotationQuote {
            exact: "x".to_owned(),
            prefix: String::new(),
            suffix: String::new(),
        },
        position: crate::runtime::AnnotationPosition {
            start: 0,
            end: 1,
            chapter_length: 1,
        },
    });
    let found = session
        .resolve_annotation(ReaderAnnotationRequest {
            session_id: SESSION,
            query: ReaderAnnotationQuery::Resolve {
                target_json: orphan,
            },
        })
        .expect("an orphan is an answer");
    assert_eq!(found.level, ReaderAnnotationLevel::OrphanedHrefNotFound);
    assert!(found.target_json.is_empty());

    let error = session
        .resolve_annotation(ReaderAnnotationRequest {
            session_id: SESSION,
            query: ReaderAnnotationQuery::Resolve {
                target_json: "{\"version\":2}".to_owned(),
            },
        })
        .expect_err("a malformed target is the caller's error");
    assert_eq!(error.kind, ReaderErrorKind::InvalidRequest);
}

#[test]
fn interaction_messages_round_trip_and_reject_every_truncated_prefix() {
    let (mut session, artifact) = open();
    let point = point_over(&mut session, artifact.artifact_id, 0, 6);
    let request = ReaderTextInteractionRequest {
        session_id: SESSION,
        artifact_id: artifact.artifact_id,
        query: ReaderTextInteractionQuery::RangeFromPoints {
            anchor: point,
            focus: point,
            granularity: ReaderSelectionGranularity::Paragraph,
        },
    };
    let response = session.resolve_text_interaction(request).expect("resolves");
    let annotation = ReaderAnnotationRequest {
        session_id: SESSION,
        query: ReaderAnnotationQuery::Resolve {
            target_json: "{}".to_owned(),
        },
    };
    let annotation_response = ReaderAnnotationResponse {
        level: ReaderAnnotationLevel::Quote,
        target_json: "{\"version\":1}".to_owned(),
    };

    let messages = [
        encode_reader_text_interaction_request(&request).expect("request encodes"),
        encode_reader_text_interaction_response(&response).expect("response encodes"),
        encode_reader_annotation_request(&annotation).expect("annotation request encodes"),
        encode_reader_annotation_response(&annotation_response).expect("annotation encodes"),
    ];
    assert_eq!(
        decode_reader_text_interaction_request(&messages[0]),
        Ok(request)
    );
    assert_eq!(
        decode_reader_text_interaction_response(&messages[1]),
        Ok(response)
    );
    assert_eq!(
        decode_reader_annotation_request(&messages[2]),
        Ok(annotation)
    );
    assert_eq!(
        decode_reader_annotation_response(&messages[3]),
        Ok(annotation_response)
    );
    for bytes in &messages {
        for length in 0..bytes.len() {
            let prefix = &bytes[..length];
            assert!(
                decode_reader_text_interaction_request(prefix).is_err()
                    && decode_reader_text_interaction_response(prefix).is_err()
                    && decode_reader_annotation_request(prefix).is_err()
                    && decode_reader_annotation_response(prefix).is_err(),
                "a {length}-byte prefix must not decode"
            );
        }
    }
}
