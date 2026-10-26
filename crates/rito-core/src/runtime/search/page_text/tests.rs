use super::{
    search_page, search_prebuilt_runtime_pages, SearchPageText, SearchPrebuiltRun,
    SearchPrebuiltRunSource, SearchQuerySpec, SearchTextPosition,
};
use crate::runtime::page_artifact::PageTextSoftWrap;

fn soft_wrap(offset: usize, replacement: &str) -> PageTextSoftWrap {
    PageTextSoftWrap {
        offset,
        replacement: replacement.to_owned(),
    }
}

#[test]
fn soft_wrap_search_preserves_utf16_positions_and_the_full_source_range() {
    let mut second = run(4, 6, 0, Some((vec![1], 3, 2)));
    second.line_index = 1;
    let page = SearchPageText::from_parts(
        0,
        "甲😀\n乙丁".to_owned(),
        vec![run(0, 3, 0, Some((vec![1], 0, 3))), second],
    )
    .with_soft_wraps(vec![soft_wrap(3, "")]);
    let matches =
        search_prebuilt_runtime_pages(std::slice::from_ref(&page), "😀乙", true, false, None);
    let matched = matches.first().expect("a query crosses the visual wrap");
    assert_eq!(matched.selected_text, "😀乙");
    assert_eq!(matched.result.start.char_index, 1);
    assert_eq!(matched.result.end.line_index, 1);
    assert_eq!(matched.result.end.char_index, 1);
    let source = matched
        .source_range
        .as_ref()
        .expect("the full source anchors");
    assert_eq!(source.start.text_offset, 1);
    assert_eq!(source.end.text_offset, 4);
    assert_eq!((source.covered_start, source.covered_end), (1, 5));

    let next_line = search_prebuilt_runtime_pages(&[page], "乙丁", true, false, None);
    assert_eq!(
        next_line.len(),
        1,
        "a start just after a removed separator maps rightward"
    );
    assert_eq!(next_line[0].result.start.line_index, 1);
    assert_eq!(next_line[0].result.start.char_index, 0);
}

#[test]
fn soft_wrap_search_restores_trimmed_spaces_and_keeps_explicit_line_queries() {
    let mut second = run(6, 9, 0, Some((vec![1], 6, 3)));
    second.line_index = 1;
    let page = SearchPageText::from_parts(
        0,
        "quick\nfox".to_owned(),
        vec![run(0, 5, 0, Some((vec![1], 0, 5))), second],
    )
    .with_soft_wraps(vec![soft_wrap(5, " ")]);
    for query in ["quick fox", "quick\nfox"] {
        let matched =
            search_prebuilt_runtime_pages(std::slice::from_ref(&page), query, true, false, None);
        assert_eq!(matched.len(), 1, "query: {query:?}");
        assert_eq!(matched[0].selected_text, "quick fox");
        let source = matched[0]
            .source_range
            .as_ref()
            .expect("complete source range");
        assert_eq!(source.start.text_offset, 0);
        assert_eq!(source.end.text_offset, 9);
        assert_eq!(source.covered_end, 9);
    }
    assert!(search_prebuilt_runtime_pages(&[page], "quickfox", true, false, None).is_empty());
}

#[test]
fn structural_breaks_are_not_joined_and_soft_wraps_do_not_create_word_boundaries() {
    let page = SearchPageText::from_parts(
        0,
        "pre\nfix\nhard".to_owned(),
        vec![run(0, 3, 0, None), run(4, 7, 1, None), run(8, 12, 2, None)],
    )
    .with_soft_wraps(vec![soft_wrap(3, "")]);
    assert_eq!(
        search_prebuilt_runtime_pages(std::slice::from_ref(&page), "prefix", true, true, None)
            .len(),
        1
    );
    for query in ["pre", "fix", "prefixhard", "prefix hard"] {
        assert!(
            search_prebuilt_runtime_pages(std::slice::from_ref(&page), query, true, true, None)
                .is_empty(),
            "{query}"
        );
    }
    assert_eq!(
        search_prebuilt_runtime_pages(&[page], "fix\nhard", true, false, None).len(),
        1
    );
}

#[test]
fn case_fold_expansion_still_maps_across_soft_wraps() {
    let page = SearchPageText::from_parts(
        0,
        "İ\nxY".to_owned(),
        vec![
            run(0, 1, 0, Some((vec![1], 0, 1))),
            run(2, 4, 1, Some((vec![1], 1, 2))),
        ],
    )
    .with_soft_wraps(vec![soft_wrap(1, "")]);
    let matches = search_prebuilt_runtime_pages(&[page], "i\u{307}xy", false, false, None);
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].selected_text, "İxY");
    let source = matches[0]
        .source_range
        .as_ref()
        .expect("source survives case folding");
    assert_eq!((source.start.text_offset, source.end.text_offset), (0, 3));
}

fn run(
    start: usize,
    end: usize,
    run_index: usize,
    source: Option<(Vec<usize>, u32, u32)>,
) -> SearchPrebuiltRun {
    SearchPrebuiltRun {
        start,
        end,
        block_index: 0,
        line_index: 0,
        run_index,
        source: source.map(|(node_path, source_start, len)| SearchPrebuiltRunSource {
            node_path,
            segments: vec![(0, source_start, len)],
        }),
    }
}

#[test]
fn case_insensitive_search_maps_folded_offsets_to_original_text() {
    let page = SearchPageText::from_parts(
        0,
        "\u{130}xY".to_owned(),
        vec![SearchPrebuiltRun {
            start: 0,
            end: 4,
            block_index: 2,
            line_index: 3,
            run_index: 4,
            source: None,
        }],
    );
    let spec = SearchQuerySpec {
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
    let page = SearchPageText::from_parts(
        0,
        "\u{130}".to_owned(),
        vec![SearchPrebuiltRun {
            start: 0,
            end: 1,
            block_index: 2,
            line_index: 3,
            run_index: 4,
            source: None,
        }],
    );

    let results = search_page(
        &page,
        &SearchQuerySpec {
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
fn whole_word_search_skips_matches_inside_words() {
    let page = SearchPageText::from_parts(
        3,
        "reader EbookReader reader_x".to_owned(),
        vec![run(0, 27, 0, None)],
    );

    let matches = search_prebuilt_runtime_pages(&[page], "reader", true, true, None);

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].result.page_index, 3);
    assert_eq!(matches[0].result.start.char_index, 0);
    assert_eq!(matches[0].result.end.char_index, 6);
}

#[test]
fn search_match_shrinks_to_the_sourced_side_of_generated_content() {
    let page = SearchPageText::from_parts(
        0,
        "abc".to_owned(),
        vec![
            run(0, 1, 0, Some((vec![1], 0, 1))),
            run(1, 2, 1, None),
            run(2, 3, 2, Some((vec![1], 2, 1))),
        ],
    );

    let matches = search_prebuilt_runtime_pages(&[page], "abc", true, false, None);

    // Generated content inside the match used to void the anchor
    // entirely. It shrinks to the longest sourced stretch, so a hit that
    // straddles generated and real text still points somewhere durable —
    // here the tail character, whose source survives.
    assert_eq!(matches.len(), 1);
    let range = matches[0]
        .source_range
        .as_ref()
        .expect("the sourced side still anchors");
    assert_eq!(range.start.node_path, vec![1]);
    assert_eq!(range.covered_end - range.covered_start, 1);
    assert!(
        range.covered_start >= 2,
        "the anchor must land on the sourced tail, not the generated gap: {range:?}"
    );
    assert_eq!(matches[0].selected_text, "c");
}

#[test]
fn a_direct_match_split_across_contiguous_runs_keeps_its_full_anchor() {
    // Font fallback splits one source text node across shaping runs; a
    // match spanning the split must anchor the WHOLE match, not shrink
    // to the longest run's slice.
    let page = SearchPageText::from_parts(
        0,
        "柊丁".to_owned(),
        vec![
            run(0, 1, 0, Some((vec![3, 1], 5, 1))),
            run(1, 2, 1, Some((vec![3, 1], 6, 1))),
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
fn direct_runs_of_different_nodes_anchor_the_whole_match_across_them() {
    // A match across elements (a word in <em>, a ruby base) is one range
    // across their text nodes, as a browser's is; the longest stretch of
    // one node stays as the anchor to fall back on.
    let page = SearchPageText::from_parts(
        0,
        "abcd".to_owned(),
        vec![
            run(0, 1, 0, Some((vec![1], 0, 1))),
            run(1, 4, 1, Some((vec![2], 0, 3))),
        ],
    );
    let matches = search_prebuilt_runtime_pages(&[page], "abcd", false, false, None);
    let matched = matches.first().expect("the match is found");
    let range = matched.source_range.as_ref().expect("a source range");
    assert_eq!(range.start.node_path, vec![1]);
    assert_eq!(range.start.text_offset, 0);
    assert_eq!(range.end.node_path, vec![2]);
    assert_eq!(range.end.text_offset, 3);
    assert_eq!(matched.selected_text, "abcd");
    let fallback = matched.fallback_source.as_ref().expect("a fallback anchor");
    assert_eq!(fallback.range.start.node_path, vec![2]);
    assert_eq!(fallback.selected_text, "bcd");
}

#[test]
fn a_result_limit_caps_the_matches_in_page_order() {
    let pages = (0..3)
        .map(|index| {
            SearchPageText::from_parts(index, "needle".to_owned(), vec![run(0, 6, 0, None)])
        })
        .collect::<Vec<_>>();

    let matches = search_prebuilt_runtime_pages(&pages, "needle", true, false, Some(2));

    assert_eq!(
        matches
            .iter()
            .map(|matched| matched.result.page_index)
            .collect::<Vec<_>>(),
        vec![0, 1]
    );
}
