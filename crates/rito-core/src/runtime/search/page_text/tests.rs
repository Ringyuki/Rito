use super::{
    search_page, search_prebuilt_runtime_pages, SearchPageText, SearchPrebuiltRun,
    SearchPrebuiltRunSource, SearchQuerySpec, SearchTextPosition,
};

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
fn direct_runs_of_different_nodes_keep_the_longest_segment() {
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
    assert_eq!(range.start.node_path, vec![2]);
    assert_eq!(matched.selected_text, "bcd");
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
