//! Search follows source text across visual wraps, without joining real breaks.

use super::pinned_font_policy_fixtures::{content_epub, layout};
use super::revisions::{exact_source_range, page_text, search};
use crate::runtime::{
    RuntimeDocument, RuntimeExactSourceRangeRequest, RuntimeExactSourceRangeResolution,
    RuntimeRevisionHandle, RuntimeSearchRequest, RuntimeSearchSource,
};

fn open(body: &str) -> (RuntimeDocument, String) {
    let bytes = content_epub("zh-CN", body, "p { margin: 0; }", None);
    let mut document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("document opens");
    let mut config = layout();
    config.page_width = 180.0;
    config.viewport_width = 180.0;
    let revision = document.create_revision(&config).expect("revision");
    let handle = RuntimeRevisionHandle::from(&revision);
    (document, handle.revision_id)
}

fn assert_wrapped_match(body: &str, query: &str) {
    let (mut document, revision_id) = open(body);
    let text = page_text(&document, &revision_id, 0);
    assert!(text.contains('\n'), "fixture must wrap: {text:?}");
    assert!(!text.contains(query), "query must cross a visual wrap");
    let found = search(
        &document,
        &revision_id,
        RuntimeSearchRequest {
            query: query.to_owned(),
            case_sensitive: true,
            whole_word: false,
            limit: None,
        },
    );
    assert_eq!(found.results.len(), 1, "page text: {text:?}");
    let result = &found.results[0];
    assert_ne!(
        result.match_range.start.line_index,
        result.match_range.end.line_index
    );
    let RuntimeSearchSource::Resolved { href, source_range } = &result.source else {
        panic!("whole match must have a durable source: {result:?}");
    };
    assert_eq!(source_range.start.node_path, vec![0, 0]);
    assert_eq!(source_range.start.text_offset, 0);
    // Both plain-text fixtures own one source node; do not silently fall
    // back to anchoring only the longest line of a found phrase.
    if !body.contains("<em>") {
        assert_eq!(source_range.end.node_path, vec![0, 0]);
        assert_eq!(source_range.end.text_offset, query.encode_utf16().count());
    }
    let projected = exact_source_range(
        &mut document,
        &revision_id,
        RuntimeExactSourceRangeRequest {
            href: href.clone(),
            source_range: source_range.clone(),
        },
    )
    .expect("source range projects");
    let RuntimeExactSourceRangeResolution::Resolved { range } = projected else {
        panic!("whole match must project: {projected:?}");
    };
    assert_eq!(range.selected_text, query);
    assert!(
        range.rects.len() >= 2,
        "highlights must cover multiple lines"
    );
}

#[test]
fn soft_wrap_search_joins_cjk_and_projects_the_whole_range() {
    assert_wrapped_match(
        "<p>春风穿过安静的树林我们继续向着远方前行。</p>",
        "春风穿过安静的树林我们继续向着远方前行。",
    );
}

#[test]
fn soft_wrap_search_restores_english_word_spaces() {
    assert_wrapped_match(
        "<p>The quick brown fox jumps over the lazy dog.</p>",
        "The quick brown fox jumps over the lazy dog.",
    );
}

#[test]
fn soft_wrap_search_retains_source_across_inline_elements() {
    assert_wrapped_match(
        "<p>春风穿过安静的<em>树林我们继续</em>向着远方前行。</p>",
        "春风穿过安静的树林我们继续向着远方前行。",
    );
}

#[test]
fn soft_wrap_search_does_not_join_br_or_paragraph_boundaries() {
    for body in ["<p>alpha<br/>beta</p>", "<p>alpha</p><p>beta</p>"] {
        let (document, revision_id) = open(body);
        for query in ["alphabeta", "alpha beta"] {
            let found = search(
                &document,
                &revision_id,
                RuntimeSearchRequest {
                    query: query.to_owned(),
                    case_sensitive: true,
                    whole_word: false,
                    limit: None,
                },
            );
            assert!(found.results.is_empty(), "must keep {body:?}: {query:?}");
        }
    }
}
