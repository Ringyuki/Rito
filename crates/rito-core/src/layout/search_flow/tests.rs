use std::sync::Arc;

use super::{
    search_page, search_prebuilt_runtime_pages, summarize_search_flow, SearchFlowQuerySpec,
    SearchPageText, SearchPrebuiltRun, SearchPrebuiltRunSource, SearchRunOffset, SearchRunSource,
    SearchSourcePoint, SearchTextPosition,
};
use crate::layout::{
    content::{RuntimeBlock, RuntimeChild},
    line::{LineBox, LineRun, TextRunBox},
    page::RuntimePage,
    text_mapping::fixture_logical_text_flow,
    RunPaint,
};

#[test]
fn fixed_flow_queries_search_typed_page_text() {
    let page = page_with_text("温水 and EbookReader");

    let summary = summarize_search_flow(&[page]);

    assert_eq!(summary.query_count, 4);
    assert_eq!(
        summary
            .queries
            .iter()
            .find(|query| query.id == "protagonist-name")
            .map(|query| query.result_count),
        Some(1)
    );
    assert_eq!(
        summary
            .queries
            .iter()
            .find(|query| query.id == "reader-name")
            .map(|query| query.result_count),
        Some(1)
    );
}

#[test]
fn case_insensitive_search_maps_folded_offsets_to_original_text() {
    let page = SearchPageText {
        page_index: 0,
        text: "\u{130}xY".to_owned(),
        offsets: vec![SearchRunOffset {
            start: 0,
            end: 4,
            block_index: 2,
            line_index: 3,
            run_index: 4,
            source: None,
            direct: None,
        }],
    };
    let spec = SearchFlowQuerySpec {
        id: "folding",
        query: "xy",
        case_sensitive: false,
        whole_word: false,
    };

    let results = search_page(&page, &spec);

    assert_eq!(results.len(), 1);
    assert_eq!(
        results[0].start,
        SearchTextPosition {
            block_index: 2,
            line_index: 3,
            run_index: 4,
            char_index: 1,
        }
    );
    assert_eq!(
        results[0].end,
        SearchTextPosition {
            block_index: 2,
            line_index: 3,
            run_index: 4,
            char_index: 3,
        }
    );
}

#[test]
fn case_insensitive_search_expansion_uses_outward_source_boundaries() {
    let page = SearchPageText {
        page_index: 0,
        text: "\u{130}".to_owned(),
        offsets: vec![SearchRunOffset {
            start: 0,
            end: 1,
            block_index: 2,
            line_index: 3,
            run_index: 4,
            source: None,
            direct: None,
        }],
    };

    let results = search_page(
        &page,
        &SearchFlowQuerySpec {
            id: "folding-expansion",
            query: "i",
            case_sensitive: false,
            whole_word: false,
        },
    );

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].start.char_index, 0);
    assert_eq!(results[0].end.char_index, 1);
    assert_eq!(results[0].context, "\u{130}");
}

#[test]
fn search_match_retains_exact_durable_source_boundaries() {
    let flow = fixture_logical_text_flow(
        "prefix needle suffix",
        vec![
            (0, 10, Some((vec![4, 5], 10))),
            (10, 20, Some((vec![4, 6], 30))),
        ],
    );
    let page = SearchPageText {
        page_index: 7,
        text: "prefix needle suffix".to_owned(),
        offsets: vec![
            SearchRunOffset {
                start: 0,
                end: 10,
                block_index: 1,
                line_index: 2,
                run_index: 3,
                source: Some(SearchRunSource {
                    flow: Arc::clone(&flow),
                    logical_start: 0,
                    logical_end: 10,
                    node_path: vec![4, 5],
                    source_start: 10,
                    source_length: 10,
                }),
                direct: None,
            },
            SearchRunOffset {
                start: 10,
                end: 20,
                block_index: 1,
                line_index: 2,
                run_index: 4,
                source: Some(SearchRunSource {
                    flow,
                    logical_start: 10,
                    logical_end: 20,
                    node_path: vec![4, 6],
                    source_start: 30,
                    source_length: 10,
                }),
                direct: None,
            },
        ],
    };
    let results = search_page(
        &page,
        &SearchFlowQuerySpec {
            id: "source",
            query: "needle",
            case_sensitive: true,
            whole_word: false,
        },
    );

    let range = results[0]
        .source_range
        .clone()
        .expect("a sourced match anchors");
    assert_eq!(
        range.start,
        SearchSourcePoint {
            node_path: vec![4, 5],
            text_offset: 17,
        }
    );
    assert_eq!(
        range.end,
        SearchSourcePoint {
            node_path: vec![4, 6],
            text_offset: 33,
        }
    );
    // Nothing forced a shrink here, so the anchor spans the whole match.
    assert_eq!(
        range.covered_end - range.covered_start,
        "needle".chars().count(),
        "a fully sourced match covers all of itself"
    );
}

#[test]
fn search_match_shrinks_to_the_sourced_side_of_generated_content() {
    let flow = fixture_logical_text_flow("abc", vec![(0, 3, Some((vec![1], 0)))]);
    let page = SearchPageText {
        page_index: 0,
        text: "abc".to_owned(),
        offsets: vec![
            SearchRunOffset {
                start: 0,
                end: 1,
                block_index: 0,
                line_index: 0,
                run_index: 0,
                source: Some(SearchRunSource {
                    flow: Arc::clone(&flow),
                    logical_start: 0,
                    logical_end: 1,
                    node_path: vec![1],
                    source_start: 0,
                    source_length: 1,
                }),
                direct: None,
            },
            SearchRunOffset {
                start: 1,
                end: 2,
                block_index: 0,
                line_index: 0,
                run_index: 1,
                source: None,
                direct: None,
            },
            SearchRunOffset {
                start: 2,
                end: 3,
                block_index: 0,
                line_index: 0,
                run_index: 2,
                source: Some(SearchRunSource {
                    flow,
                    logical_start: 2,
                    logical_end: 3,
                    node_path: vec![1],
                    source_start: 2,
                    source_length: 1,
                }),
                direct: None,
            },
        ],
    };
    let results = search_page(
        &page,
        &SearchFlowQuerySpec {
            id: "unavailable-middle",
            query: "abc",
            case_sensitive: true,
            whole_word: false,
        },
    );

    // Generated content inside the match used to void the anchor
    // entirely. It now shrinks to the longest sourced stretch, so a hit
    // that straddles generated and real text still points somewhere
    // durable — here the tail character, whose source survives.
    assert_eq!(results.len(), 1);
    let range = results[0]
        .source_range
        .clone()
        .expect("the sourced side still anchors");
    assert_eq!(range.start.node_path, vec![1]);
    assert_eq!(range.covered_end - range.covered_start, 1);
    assert!(
        range.covered_start >= 2,
        "the anchor must land on the sourced tail, not the generated gap: {range:?}"
    );
}

fn page_with_text(text: &str) -> RuntimePage<RuntimeBlock<LineBox>> {
    RuntimePage {
        index: 0,
        width: 400.0,
        height: 600.0,
        paint: None,
        content: vec![RuntimeBlock {
            x: 0.0,
            y: 0.0,
            width: 300.0,
            height: 20.0,
            semantic_tag: None,
            anchor_id: None,
            paint: None,
            border_box: None,
            page_break_before: false,
            page_break_after: false,
            orphans: None,
            widows: None,
            children: vec![RuntimeChild::Line(LineBox {
                x: 0.0,
                y: 0.0,
                width: 300.0,
                height: 20.0,
                runs: vec![LineRun::Text(TextRunBox {
                    text: text.to_owned(),
                    text_mapping: crate::layout::text_mapping::RunTextMapping::synthetic(),
                    x: 0.0,
                    y: 0.0,
                    width: 160.0,
                    height: 12.0,
                    font_size: 12.0,
                    interaction_geometry: None,
                    paint: RunPaint::default(),
                    line_height_px: None,
                    href: None,
                    source_path: None,
                    source_text: None,
                    source_text_offset: None,
                    inline_margin_right: None,
                    ruby_annotation: None,
                    shape: crate::layout::text_shape::fixture_run_shape(160.0),
                })],
            })],
        }],
    }
}

#[test]
fn a_direct_match_split_across_contiguous_runs_keeps_its_full_anchor() {
    // Font fallback splits one source text node across shaping runs; a
    // match spanning the split must anchor the WHOLE match, not shrink
    // to the longest run's slice.
    let direct = |source_start: u32, len: u32| {
        Some(SearchPrebuiltRunSource {
            node_path: vec![3, 1],
            segments: vec![(0, source_start, len)],
        })
    };
    let page = SearchPageText::from_parts(
        0,
        "柊丁".to_owned(),
        vec![
            SearchPrebuiltRun {
                start: 0,
                end: 1,
                block_index: 0,
                line_index: 0,
                run_index: 0,
                source: direct(5, 1),
            },
            SearchPrebuiltRun {
                start: 1,
                end: 2,
                block_index: 0,
                line_index: 0,
                run_index: 1,
                source: direct(6, 1),
            },
        ],
    );
    let matches = search_prebuilt_runtime_pages(&[page], "柊丁", false, false, None);
    let matched = matches.first().expect("the split match is found");
    assert_eq!(matched.selected_text, "柊丁");
    let range = matched.source_range.as_ref().expect("a source range");
    assert_eq!(range.start.node_path, vec![3, 1]);
    assert_eq!(range.start.text_offset, 5);
    assert_eq!(range.end.text_offset, 7);
}

#[test]
fn direct_runs_of_different_nodes_keep_the_longest_segment() {
    let page = SearchPageText::from_parts(
        0,
        "abcd".to_owned(),
        vec![
            SearchPrebuiltRun {
                start: 0,
                end: 1,
                block_index: 0,
                line_index: 0,
                run_index: 0,
                source: Some(SearchPrebuiltRunSource {
                    node_path: vec![1],
                    segments: vec![(0, 0, 1)],
                }),
            },
            SearchPrebuiltRun {
                start: 1,
                end: 4,
                block_index: 0,
                line_index: 0,
                run_index: 1,
                source: Some(SearchPrebuiltRunSource {
                    node_path: vec![2],
                    segments: vec![(0, 0, 3)],
                }),
            },
        ],
    );
    let matches = search_prebuilt_runtime_pages(&[page], "abcd", false, false, None);
    let matched = matches.first().expect("the match is found");
    let range = matched.source_range.as_ref().expect("a source range");
    assert_eq!(range.start.node_path, vec![2]);
    assert_eq!(matched.selected_text, "bcd");
}
