//! Byte-for-byte fixtures for the query messages a browser host decodes in
//! JavaScript: search, text range geometry, footnotes and exact source
//! ranges. Each constant is
//! the encoder's output; `@ritojs/core-wasm`'s reader-session query test
//! decodes and re-encodes the same bytes.

use super::*;
use crate::runtime::reader_session::{
    ReaderFootnote, ReaderFootnoteKind, ReaderLocator, ReaderRect, ReaderSearchRequest,
    ReaderSearchResponse, ReaderSearchResult, ReaderSourcePoint, ReaderTextPosition,
    ReaderTextRangeGeometry, ReaderTextRangeRequest, ReaderTextRect,
};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn position(char_index: u32) -> ReaderTextPosition {
    ReaderTextPosition {
        block_index: 3,
        line_index: 2,
        run_index: 1,
        char_index,
    }
}

pub(super) fn search_request_fixture() -> ReaderSearchRequest {
    ReaderSearchRequest {
        session_id: 7,
        artifact_id: 9,
        query: "雪".to_owned(),
        case_sensitive: true,
        whole_word: false,
        limit: 5,
    }
}

pub(super) fn search_response_fixture() -> ReaderSearchResponse {
    ReaderSearchResponse {
        artifact_id: 9,
        query: "雪".to_owned(),
        truncated: true,
        searched_page_count: 42,
        results: vec![ReaderSearchResult {
            page_index: 4,
            spread_index: 2,
            start: position(6),
            end: position(7),
            context: "…初雪が…".to_owned(),
            locator: Some(ReaderLocator {
                href: "OEBPS/chapter-2.xhtml".to_owned(),
                anchor_id: None,
                source_point: Some(ReaderSourcePoint {
                    node_path: vec![1, 0, 4],
                    text_offset: 12,
                }),
                source_range: None,
                progression: None,
            }),
        }],
    }
}

pub(super) fn text_range_request_fixture() -> ReaderTextRangeRequest {
    ReaderTextRangeRequest {
        session_id: 7,
        artifact_id: 9,
        page_index: 4,
        start: position(6),
        end: position(20),
    }
}

pub(super) fn text_range_geometry_fixture() -> ReaderTextRangeGeometry {
    ReaderTextRangeGeometry {
        artifact_id: 9,
        page_index: 4,
        rects: vec![ReaderTextRect {
            bounds: ReaderRect {
                x: 12.5,
                y: 40.0,
                width: 96.25,
                height: 18.0,
            },
            block_index: 3,
            line_index: 2,
            run_index: 1,
            start_char_index: 6,
            end_char_index: 20,
        }],
    }
}

pub(super) fn footnote_fixture() -> ReaderFootnote {
    ReaderFootnote {
        artifact_id: 9,
        key: "OEBPS/notes.xhtml#n1".to_owned(),
        kind: ReaderFootnoteKind::Endnote,
        text: "A note.".to_owned(),
        html: "<p>A note.</p>".to_owned(),
    }
}

pub(super) const SEARCH_REQUEST_HEX: &str = concat!(
    "5249544f53525131010000003100000000000000070000000000000009000000",
    "0000000003000000e99baa010005000000",
);
pub(super) const SEARCH_RESPONSE_HEX: &str = concat!(
    "5249544f5352533101000000b500000000000000090000000000000003000000",
    "e99baa012a000000010000008100000000000000040000000200000003000000",
    "020000000100000006000000030000000200000001000000070000000f000000",
    "e280a6e5889de99baae3818ce280a6013d00000000000000150000004f454250",
    "532f636861707465722d322e7868746d6c000118000000000000000300000001",
    "00000000000000040000000c000000000000000000",
);
pub(super) const TEXT_RANGE_REQUEST_HEX: &str = concat!(
    "5249544f54525131010000004800000000000000070000000000000009000000",
    "0000000004000000030000000200000001000000060000000300000002000000",
    "0100000014000000",
);
pub(super) const TEXT_RANGE_GEOMETRY_HEX: &str = concat!(
    "5249544f54524731010000006000000000000000090000000000000004000000",
    "0100000034000000000000000000000000002940000000000000444000000000",
    "0010584000000000000032400300000002000000010000000600000014000000",
);
pub(super) const EXACT_SOURCE_RANGE_REQUEST_HEX: &str = concat!(
    "5249544f45535131010000008500000000000000070000000000000009000000",
    "00000000150000004f454250532f636861707465722d322e7868746d6c400000",
    "00000000001800000000000000030000000100000000000000040000000c0000",
    "00000000001800000000000000030000000100000000000000040000001f0000",
    "0000000000",
);
pub(super) const EXACT_SOURCE_RANGE_RESOLUTION_HEX: &str = concat!(
    "5249544f4553523101000000bd00000000000000090000000000000000000000",
    "0103000000100000007468652071756f74656420776f72647302000000380000",
    "0000000000030000000000000000002940000000000000444000000000001056",
    "4000000000000032400200000001000000000000000400000014000000380000",
    "000000000004000000000000000000000000000000000028400000000000003e",
    "4000000000000032400300000000000000000000000000000006000000",
);
pub(super) const FOOTNOTE_HEX: &str = concat!(
    "5249544f46544e31010000005500000000000000090000000000000014000000",
    "4f454250532f6e6f7465732e7868746d6c236e31010000000700000041206e6f",
    "74652e0e0000003c703e41206e6f74652e3c2f703e",
);

#[test]
fn query_wire_fixtures_are_pinned_byte_for_byte() {
    let encoded = [
        (
            hex(&encode_reader_search_request(&search_request_fixture()).unwrap()),
            SEARCH_REQUEST_HEX,
        ),
        (
            hex(&encode_reader_search_response(&search_response_fixture()).unwrap()),
            SEARCH_RESPONSE_HEX,
        ),
        (
            hex(&encode_reader_text_range_request(&text_range_request_fixture()).unwrap()),
            TEXT_RANGE_REQUEST_HEX,
        ),
        (
            hex(&encode_reader_text_range_geometry(&text_range_geometry_fixture()).unwrap()),
            TEXT_RANGE_GEOMETRY_HEX,
        ),
        (
            hex(&encode_reader_footnote(&footnote_fixture()).unwrap()),
            FOOTNOTE_HEX,
        ),
        (
            hex(&encode_reader_exact_source_range_request(
                &super::tests::exact_source_range_request_fixture(),
            )
            .unwrap()),
            EXACT_SOURCE_RANGE_REQUEST_HEX,
        ),
        (
            hex(&encode_reader_exact_source_range_resolution(
                &super::tests::exact_source_range_resolution_fixture(),
            )
            .unwrap()),
            EXACT_SOURCE_RANGE_RESOLUTION_HEX,
        ),
    ];
    for (actual, expected) in &encoded {
        assert_eq!(actual, expected);
    }
}
