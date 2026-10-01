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
    let created_target = created.target.clone().expect("a created target");
    assert_eq!(created_target.json, annotation_target_to_json(&expected));
    assert_eq!(created_target.exact, "Source");

    let found = session
        .resolve_annotation(ReaderAnnotationRequest {
            session_id: SESSION,
            query: ReaderAnnotationQuery::Resolve {
                target_json: created_target.json.clone(),
            },
        })
        .expect("target resolves");
    assert_eq!(found.level, ReaderAnnotationLevel::Exact);
    assert_eq!(found.target, created.target);
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
    assert!(found.target.is_none());

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
    let annotation_response = quote_annotation_fixture();

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

pub(super) fn movement_request_fixture() -> ReaderTextInteractionRequest {
    ReaderTextInteractionRequest {
        session_id: 7,
        artifact_id: 9,
        query: ReaderTextInteractionQuery::Movement {
            anchor: ReaderCaretAddress {
                page_index: 3,
                position: ReaderTextPosition {
                    block_index: 2,
                    line_index: 1,
                    run_index: 0,
                    char_index: 4,
                },
                affinity: ReaderCaretAffinity::Downstream,
            },
            focus: ReaderCaretAddress {
                page_index: 4,
                position: ReaderTextPosition {
                    block_index: 0,
                    line_index: 0,
                    run_index: 1,
                    char_index: 6,
                },
                affinity: ReaderCaretAffinity::Upstream,
            },
            movement: ReaderSelectionMovement::LineDown,
            preferred_inline_position: Some(120.5),
            preferred_block_position: None,
        },
    }
}

pub(super) fn points_request_fixture() -> ReaderTextInteractionRequest {
    ReaderTextInteractionRequest {
        session_id: 7,
        artifact_id: 9,
        query: ReaderTextInteractionQuery::RangeFromPoints {
            anchor: ReaderTextPoint {
                page_index: 3,
                x: 12.5,
                y: 40.0,
            },
            focus: ReaderTextPoint {
                page_index: 3,
                x: 20.0,
                y: 41.0,
            },
            granularity: ReaderSelectionGranularity::Paragraph,
        },
    }
}

pub(super) fn selection_response_fixture() -> ReaderTextInteractionResponse {
    let address = |page_index, char_index, affinity| ReaderCaretAddress {
        page_index,
        position: ReaderTextPosition {
            block_index: 2,
            line_index: 1,
            run_index: 0,
            char_index,
        },
        affinity,
    };
    let point = |text_offset| ReaderSourcePoint {
        node_path: vec![1, 0, 4],
        text_offset,
    };
    ReaderTextInteractionResponse {
        artifact_id: 9,
        result: ReaderTextInteractionResult::Selection(Box::new(ReaderSelectionResult {
            anchor_caret: Some(ReaderCaret {
                address: address(3, 4, ReaderCaretAffinity::Downstream),
                geometry: Some(ReaderCaretGeometry {
                    x: 12.5,
                    y: 40.0,
                    height: 18.0,
                }),
                href: "OEBPS/chapter-2.xhtml".to_owned(),
                source_point: point(12),
            }),
            focus_caret: None,
            selection: ReaderTextSelection {
                anchor: address(3, 4, ReaderCaretAffinity::Downstream),
                focus: address(3, 20, ReaderCaretAffinity::Upstream),
                start: address(3, 4, ReaderCaretAffinity::Downstream),
                end: address(3, 20, ReaderCaretAffinity::Upstream),
                selected_text: "the quoted words".to_owned(),
                source_start_href: "OEBPS/chapter-2.xhtml".to_owned(),
                source_start: point(12),
                source_end_href: "OEBPS/chapter-2.xhtml".to_owned(),
                source_end: point(28),
                rects: vec![ReaderExactSourceRect {
                    page_index: 3,
                    bounds: ReaderRect {
                        x: 12.5,
                        y: 40.0,
                        width: 88.25,
                        height: 18.0,
                    },
                    block_index: 2,
                    line_index: 1,
                    run_index: 0,
                    start_char_index: 4,
                    end_char_index: 20,
                }],
            },
            preferred_inline_position: Some(120.5),
            preferred_block_position: Some(300.25),
        })),
    }
}

pub(super) const CANONICAL_TARGET_FIXTURE: &str = r#"{"version":1,"href":"OEBPS/chapter-2.xhtml","sourceRange":{"start":{"nodePath":[1,0,4],"textOffset":12},"end":{"nodePath":[1,0,4],"textOffset":28}},"quote":{"exact":"the quoted words","prefix":"Before ","suffix":" after"},"position":{"start":12,"end":28,"chapterLength":34}}"#;

pub(super) fn create_annotation_fixture() -> ReaderAnnotationRequest {
    ReaderAnnotationRequest {
        session_id: 7,
        query: ReaderAnnotationQuery::Create {
            href: "OEBPS/chapter-2.xhtml".to_owned(),
            range: ReaderSourceRange {
                start: ReaderSourcePoint {
                    node_path: vec![1, 0, 4],
                    text_offset: 12,
                },
                end: ReaderSourcePoint {
                    node_path: vec![1, 0, 4],
                    text_offset: 28,
                },
            },
        },
    }
}

pub(super) fn quote_annotation_fixture() -> ReaderAnnotationResponse {
    ReaderAnnotationResponse {
        level: ReaderAnnotationLevel::Quote,
        target: Some(ReaderAnnotationTarget {
            json: CANONICAL_TARGET_FIXTURE.to_owned(),
            href: "OEBPS/chapter-2.xhtml".to_owned(),
            range: ReaderSourceRange {
                start: ReaderSourcePoint {
                    node_path: vec![1, 0, 4],
                    text_offset: 12,
                },
                end: ReaderSourcePoint {
                    node_path: vec![1, 0, 4],
                    text_offset: 28,
                },
            },
            exact: "the quoted words".to_owned(),
            prefix: "Before ".to_owned(),
            suffix: " after".to_owned(),
            start: 12,
            end: 28,
            chapter_length: 34,
        }),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Produced by the encoder; `rito_flutter`'s interaction wire test decodes the same bytes.
pub(super) const MOVEMENT_HEX: &str = concat!(
    "5249544f54495131010000006a00000000000000070000000000000009000000",
    "0000000004150000000000000003000000020000000100000000000000040000",
    "0001150000000000000004000000000000000000000001000000060000000006",
    "010000000000205e4000",
);

/// Produced by the encoder; `rito_flutter`'s interaction wire test decodes the same bytes.
pub(super) const POINTS_HEX: &str = concat!(
    "5249544f54495131010000005e00000000000000070000000000000009000000",
    "0000000003140000000000000003000000000000000000294000000000000044",
    "401400000000000000030000000000000000003440000000000080444001",
);

/// Produced by the encoder; `rito_flutter`'s interaction wire test decodes the same bytes.
pub(super) const SELECTION_HEX: &str = concat!(
    "5249544f5449523101000000ee01000000000000090000000000000001016f00",
    "0000000000001500000000000000030000000200000001000000000000000400",
    "0000010100000000000029400000000000004440000000000000324015000000",
    "4f454250532f636861707465722d322e7868746d6c1800000000000000030000",
    "000100000000000000040000000c00000000000000003e010000000000001500",
    "0000000000000300000002000000010000000000000004000000011500000000",
    "0000000300000002000000010000000000000014000000001500000000000000",
    "0300000002000000010000000000000004000000011500000000000000030000",
    "000200000001000000000000001400000000100000007468652071756f746564",
    "20776f726473150000004f454250532f636861707465722d322e7868746d6c18",
    "00000000000000030000000100000000000000040000000c0000000000000015",
    "0000004f454250532f636861707465722d322e7868746d6c1800000000000000",
    "030000000100000000000000040000001c000000000000000100000038000000",
    "0000000003000000000000000000294000000000000044400000000000105640",
    "0000000000003240020000000100000000000000040000001400000001000000",
    "0000205e40010000000000c47240",
);

/// Produced by the encoder; `rito_flutter`'s interaction wire test decodes the same bytes.
pub(super) const CREATE_HEX: &str = concat!(
    "5249544f414e5131010000007e00000000000000070000000000000000150000",
    "004f454250532f636861707465722d322e7868746d6c40000000000000001800",
    "000000000000030000000100000000000000040000000c000000000000001800",
    "000000000000030000000100000000000000040000001c00000000000000",
);

/// Produced by the encoder; `rito_flutter`'s interaction wire test decodes the same bytes.
pub(super) const QUOTE_HEX: &str = concat!(
    "5249544f414e523101000000d6010000000000000201b8010000000000001201",
    "00007b2276657273696f6e223a312c2268726566223a224f454250532f636861",
    "707465722d322e7868746d6c222c22736f7572636552616e6765223a7b227374",
    "617274223a7b226e6f646550617468223a5b312c302c345d2c22746578744f66",
    "66736574223a31327d2c22656e64223a7b226e6f646550617468223a5b312c30",
    "2c345d2c22746578744f6666736574223a32387d7d2c2271756f7465223a7b22",
    "6578616374223a227468652071756f74656420776f726473222c227072656669",
    "78223a224265666f726520222c22737566666978223a22206166746572227d2c",
    "22706f736974696f6e223a7b227374617274223a31322c22656e64223a32382c",
    "22636861707465724c656e677468223a33347d7d150000004f454250532f6368",
    "61707465722d322e7868746d6c40000000000000001800000000000000030000",
    "000100000000000000040000000c000000000000001800000000000000030000",
    "000100000000000000040000001c00000000000000100000007468652071756f",
    "74656420776f726473070000004265666f726520060000002061667465720c00",
    "0000000000001c000000000000002200000000000000",
);

fn bytes(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).expect("hex"))
        .collect()
}

#[test]
fn interaction_wire_fixtures_are_pinned_byte_for_byte() {
    let movement = movement_request_fixture();
    let points = points_request_fixture();
    let selection = selection_response_fixture();
    let create = create_annotation_fixture();
    let quote = quote_annotation_fixture();
    assert_eq!(
        hex(&encode_reader_text_interaction_request(&movement).unwrap()),
        MOVEMENT_HEX
    );
    assert_eq!(
        hex(&encode_reader_text_interaction_request(&points).unwrap()),
        POINTS_HEX
    );
    assert_eq!(
        hex(&encode_reader_text_interaction_response(&selection).unwrap()),
        SELECTION_HEX
    );
    assert_eq!(
        hex(&encode_reader_annotation_request(&create).unwrap()),
        CREATE_HEX
    );
    assert_eq!(
        hex(&encode_reader_annotation_response(&quote).unwrap()),
        QUOTE_HEX
    );
    assert_eq!(
        decode_reader_text_interaction_request(&bytes(MOVEMENT_HEX)),
        Ok(movement)
    );
    assert_eq!(
        decode_reader_text_interaction_request(&bytes(POINTS_HEX)),
        Ok(points)
    );
    assert_eq!(
        decode_reader_text_interaction_response(&bytes(SELECTION_HEX)),
        Ok(selection)
    );
    assert_eq!(
        decode_reader_annotation_request(&bytes(CREATE_HEX)),
        Ok(create)
    );
    assert_eq!(
        decode_reader_annotation_response(&bytes(QUOTE_HEX)),
        Ok(quote)
    );
}
