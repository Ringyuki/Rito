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

fn anchored_chapter_epub() -> Vec<u8> {
    let paragraphs = (0..40)
        .map(|index| {
            let marker = if index == 30 { r#"<a id="late"/>"# } else { "" };
            format!("<p>{marker}Anchored paragraph {index} carries enough words to wrap in a narrow viewport.</p>")
        })
        .collect::<String>();
    let chapter = format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>{paragraphs}<div id="tail"></div></body></html>"#
    );
    crate::runtime::tests::fixture::fixture_epub_with_chapter_and_stylesheet(
        chapter.as_bytes(),
        crate::runtime::tests::fixture::fixture_stylesheet(),
    )
}

/// An empty `<a id>` marker and an id after the last text both land where
/// a browser scrolls to them, identically in a session and in a browser
/// revision.
#[test]
fn empty_anchors_resolve_to_the_same_page_on_every_host() {
    let config = layout_config(layout()).expect("layout converts");
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&anchored_chapter_epub()).expect("opens");
    let revision = document.create_revision(&config).expect("revision");
    let mut session = open_test_session(SESSION, anchored_chapter_epub()).expect("opens");
    for (anchor, request_id) in [("late", 1), ("tail", 2)] {
        let locator = crate::runtime::RuntimeSourceLocator {
            href: CHAPTER.to_owned(),
            anchor_id: Some(anchor.to_owned()),
            source_point: None,
            source_range: None,
            progression: None,
        };
        let crate::runtime::RuntimeSourceLocatorResolution::Resolved { page_index, .. } = document
            .resolve_source_locator(&revision.revision_id, locator)
            .expect("browser path resolves")
        else {
            panic!("{anchor} must resolve in a browser revision");
        };
        let artifact = session
            .request_artifact(ReaderArtifactRequest {
                session_id: SESSION,
                request_id,
                layout: layout(),
                locator: ReaderLocator {
                    href: CHAPTER.to_owned(),
                    anchor_id: Some(anchor.to_owned()),
                    source_point: None,
                    source_range: None,
                    progression: None,
                },
                text_profile: ReaderTextRenderingProfile::PlatformStringRuns,
            })
            .unwrap_or_else(|error| panic!("{anchor} must open a session artifact: {error:?}"));
        assert!(
            artifact.local_page_indexes.contains(&(page_index as u32)),
            "{anchor}: session draws {:?}, browser resolved page {page_index}",
            artifact.local_page_indexes
        );
    }
}

fn navigate(session: &mut ReaderSession, query: ReaderNavigationQuery) -> ReaderNavigationResult {
    session
        .resolve_navigation(ReaderNavigationRequest {
            session_id: SESSION,
            query,
        })
        .expect("navigation resolves")
}

fn open_toc_fixture() -> (
    ReaderSession,
    ReaderArtifact,
    RuntimeDocument,
    Vec<Option<usize>>,
) {
    let bytes = crate::runtime::tests::fixture::toc_anchor_fixture_epub();
    let mut session = open_test_session(SESSION, bytes.clone()).expect("opens");
    let artifact = session
        .request_artifact(ReaderArtifactRequest {
            session_id: SESSION,
            request_id: 1,
            layout: layout(),
            locator: ReaderLocator {
                href: "chapter-1.xhtml".to_owned(),
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: None,
            },
            text_profile: ReaderTextRenderingProfile::PlatformStringRuns,
        })
        .expect("artifact resolves");
    let mut document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("opens");
    let revision = document
        .create_revision(&layout_config(layout()).expect("layout"))
        .expect("revision");
    let targets = document
        .revision_bundle(&revision.revision_id, true)
        .expect("bundle")
        .toc_targets;
    // Every entry is placed, the repeated id in the chapter that holds it.
    assert_eq!(
        targets
            .targets
            .iter()
            .map(|target| target.toc_index)
            .collect::<Vec<_>>(),
        vec![0, 1, 2, 3]
    );
    (session, artifact, document, targets.active_entry_by_page)
}

/// A session and a browser revision name the same TOC entry for every
/// page of chapter one, including the pages an inline id and an empty
/// anchor start.
#[test]
fn toc_entries_by_page_match_the_whole_book_revision() {
    let (mut session, artifact, _, by_page) = open_toc_fixture();
    let chapter_pages = match navigate(
        &mut session,
        ReaderNavigationQuery::Locate {
            artifact_id: artifact.artifact_id,
            locator: ReaderLocator {
                href: "chapter-1.xhtml".to_owned(),
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: Some(1.0),
            },
        },
    ) {
        ReaderNavigationResult::Location(ReaderLocation::Page { page_index, .. }) => page_index,
        other => panic!("chapter one's last page locates: {other:?}"),
    };
    assert!(chapter_pages >= 2, "the fixture spans several pages");
    let mut seen = std::collections::BTreeSet::new();
    for page in 0..=chapter_pages {
        let ReaderNavigationResult::TocEntry(entry) = navigate(
            &mut session,
            ReaderNavigationQuery::TocEntryAtPage {
                artifact_id: artifact.artifact_id,
                page_index: page,
            },
        ) else {
            panic!("a toc entry answer");
        };
        assert_eq!(
            entry.map(|entry| entry as usize),
            by_page[page as usize],
            "page {page}"
        );
        seen.extend(entry);
    }
    assert_eq!(
        seen,
        [0, 1, 2].into_iter().collect(),
        "One, Inline and Empty all show up"
    );
}

#[test]
fn a_source_position_reads_under_its_last_preceding_entry() {
    let (mut session, _, _, _) = open_toc_fixture();
    let entry_at = |session: &mut ReaderSession, href: &str, node: u32| match navigate(
        session,
        ReaderNavigationQuery::TocEntryAtPosition {
            href: href.to_owned(),
            point: ReaderSourcePoint {
                node_path: vec![node, 0],
                text_offset: 0,
            },
        },
    ) {
        ReaderNavigationResult::TocEntry(entry) => entry,
        other => panic!("{other:?}"),
    };
    assert_eq!(entry_at(&mut session, "chapter-1.xhtml", 5), Some(0));
    assert_eq!(entry_at(&mut session, "chapter-1.xhtml", 20), Some(1));
    assert_eq!(entry_at(&mut session, "chapter-1.xhtml", 35), Some(2));
    // Chapter two's lead-in sits before its #intro target.
    assert_eq!(entry_at(&mut session, "chapter-2.xhtml", 0), Some(2));
    assert_eq!(entry_at(&mut session, "chapter-2.xhtml", 1), Some(3));
}

#[test]
fn positions_compare_in_reading_order_and_locators_place_or_decline() {
    let (mut session, artifact, _, _) = open_toc_fixture();
    let point = |node: u32, offset: u64| ReaderSourcePoint {
        node_path: vec![node, 0],
        text_offset: offset,
    };
    let order = |session: &mut ReaderSession,
                 a: (&str, ReaderSourcePoint),
                 b: (&str, ReaderSourcePoint)| {
        match navigate(
            session,
            ReaderNavigationQuery::Compare {
                first_href: a.0.to_owned(),
                first: a.1,
                second_href: b.0.to_owned(),
                second: b.1,
            },
        ) {
            ReaderNavigationResult::Order(order) => order,
            other => panic!("{other:?}"),
        }
    };
    use std::cmp::Ordering;
    assert_eq!(
        order(
            &mut session,
            ("chapter-1.xhtml", point(30, 0)),
            ("chapter-2.xhtml", point(0, 0))
        ),
        Ordering::Less
    );
    assert_eq!(
        order(
            &mut session,
            ("chapter-1.xhtml", point(3, 5)),
            ("chapter-1.xhtml", point(3, 2))
        ),
        Ordering::Greater
    );
    assert_eq!(
        order(
            &mut session,
            ("chapter-1.xhtml", point(3, 5)),
            ("chapter-1.xhtml", point(3, 5))
        ),
        Ordering::Equal
    );

    let locate = |session: &mut ReaderSession, href: &str, anchor: Option<&str>| {
        navigate(
            session,
            ReaderNavigationQuery::Locate {
                artifact_id: artifact.artifact_id,
                locator: ReaderLocator {
                    href: href.to_owned(),
                    anchor_id: anchor.map(str::to_owned),
                    source_point: None,
                    source_range: None,
                    progression: None,
                },
            },
        )
    };
    assert!(matches!(
        locate(&mut session, "chapter-1.xhtml", Some("intro")),
        ReaderNavigationResult::Location(ReaderLocation::Page {
            page_index: 0,
            drawn: true,
            ..
        })
    ));
    assert!(matches!(
        locate(&mut session, "chapter-1.xhtml", Some("empty")),
        ReaderNavigationResult::Location(ReaderLocation::Page { drawn: false, .. })
    ));
    assert_eq!(
        locate(&mut session, "chapter-2.xhtml", Some("intro")),
        ReaderNavigationResult::Location(ReaderLocation::NotLaidOut)
    );
    assert_eq!(
        locate(&mut session, "missing.xhtml", None),
        ReaderNavigationResult::Location(ReaderLocation::Unavailable)
    );
}

pub(super) fn locate_request_fixture() -> ReaderNavigationRequest {
    ReaderNavigationRequest {
        session_id: 7,
        query: ReaderNavigationQuery::Locate {
            artifact_id: 9,
            locator: ReaderLocator {
                href: "OEBPS/chapter-2.xhtml".to_owned(),
                anchor_id: Some("note-4".to_owned()),
                source_point: None,
                source_range: None,
                progression: Some(0.25),
            },
        },
    }
}

pub(super) fn compare_request_fixture() -> ReaderNavigationRequest {
    ReaderNavigationRequest {
        session_id: 7,
        query: ReaderNavigationQuery::Compare {
            first_href: "OEBPS/chapter-2.xhtml".to_owned(),
            first: ReaderSourcePoint {
                node_path: vec![1, 0, 4],
                text_offset: 12,
            },
            second_href: "OEBPS/chapter-3.xhtml".to_owned(),
            second: ReaderSourcePoint {
                node_path: vec![0],
                text_offset: 0,
            },
        },
    }
}

pub(super) fn location_result_fixture() -> ReaderNavigationResult {
    ReaderNavigationResult::Location(ReaderLocation::Page {
        page_index: 5,
        drawn: true,
        matched_by: ReaderLocatorMatch::Anchor,
    })
}

/// Produced by the encoder; `rito_flutter`'s navigation wire test decodes the same bytes.
pub(super) const LOCATE_HEX: &str = concat!(
    "5249544f4e565131010000005c00000000000000070000000000000002090000",
    "00000000002f00000000000000150000004f454250532f636861707465722d32",
    "2e7868746d6c01060000006e6f74652d34000001000000000000d03f",
);

/// Produced by the encoder; `rito_flutter`'s navigation wire test decodes the same bytes.
pub(super) const COMPARE_HEX: &str = concat!(
    "5249544f4e565131010000008700000000000000070000000000000003150000",
    "004f454250532f636861707465722d322e7868746d6c18000000000000000300",
    "00000100000000000000040000000c00000000000000150000004f454250532f",
    "636861707465722d332e7868746d6c1000000000000000010000000000000000",
    "00000000000000",
);

/// Produced by the encoder; `rito_flutter`'s navigation wire test decodes the same bytes.
pub(super) const LOCATION_HEX: &str = "5249544f4e565231010000001c000000000000000100050000000102";

/// Produced by the encoder; `rito_flutter`'s navigation wire test decodes the same bytes.
pub(super) const TOC_HEX: &str = "5249544f4e565231010000001a00000000000000000103000000";

#[test]
fn navigation_wire_fixtures_are_pinned_byte_for_byte() {
    let toc = ReaderNavigationResult::TocEntry(Some(3));
    assert_eq!(
        hex(&encode_reader_navigation_request(&locate_request_fixture()).unwrap()),
        LOCATE_HEX
    );
    assert_eq!(
        hex(&encode_reader_navigation_request(&compare_request_fixture()).unwrap()),
        COMPARE_HEX
    );
    assert_eq!(
        hex(&encode_reader_navigation_result(&location_result_fixture()).unwrap()),
        LOCATION_HEX
    );
    assert_eq!(
        hex(&encode_reader_navigation_result(&toc).unwrap()),
        TOC_HEX
    );
    assert_eq!(
        decode_reader_navigation_request(&bytes(LOCATE_HEX)),
        Ok(locate_request_fixture())
    );
    assert_eq!(
        decode_reader_navigation_request(&bytes(COMPARE_HEX)),
        Ok(compare_request_fixture())
    );
    assert_eq!(
        decode_reader_navigation_result(&bytes(LOCATION_HEX)),
        Ok(location_result_fixture())
    );
    assert_eq!(decode_reader_navigation_result(&bytes(TOC_HEX)), Ok(toc));
    for message in [LOCATE_HEX, COMPARE_HEX] {
        let message = bytes(message);
        for length in 0..message.len() {
            assert!(decode_reader_navigation_request(&message[..length]).is_err());
        }
    }
    for message in [LOCATION_HEX, TOC_HEX] {
        let message = bytes(message);
        for length in 0..message.len() {
            assert!(decode_reader_navigation_result(&message[..length]).is_err());
        }
    }
}
