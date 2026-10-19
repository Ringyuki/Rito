//! Ranges across ruby and other elements: the line holds a ruby's base
//! text, the source holds its annotation text after it, and a range or a
//! search match may run across several text nodes.

use super::pinned_font_policy_fixtures::{content_epub, layout};
use super::revisions::{exact_source_range, search};
use crate::runtime::{
    RuntimeDocument, RuntimeExactSourceRangeRequest, RuntimeExactSourceRangeResolution,
    RuntimeRevisionHandle, RuntimeSearchRequest, RuntimeSearchSource, RuntimeSourcePoint,
    RuntimeSourceRange,
};

const RUBY: &str = "<p>那个混杂在普通的<ruby><rb>白羊</rb><rt>军团</rt></ruby>之中，难以对付。</p>";

fn open(body: &str) -> (RuntimeDocument, String) {
    let bytes = content_epub("zh-CN", body, "", None);
    let mut document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("document opens");
    let revision = document.create_revision(&layout()).expect("revision");
    let handle = RuntimeRevisionHandle::from(&revision);
    (document, handle.revision_id)
}

fn point(node_path: &[usize], text_offset: usize) -> RuntimeSourcePoint {
    RuntimeSourcePoint {
        node_path: node_path.to_vec(),
        text_offset,
    }
}

/// The text a source range reads as on the page, or why it does not.
fn project(
    document: &mut RuntimeDocument,
    revision_id: &str,
    start: RuntimeSourcePoint,
    end: RuntimeSourcePoint,
) -> String {
    let projected = exact_source_range(
        document,
        revision_id,
        RuntimeExactSourceRangeRequest {
            href: "chapter.xhtml".to_owned(),
            source_range: RuntimeSourceRange { start, end },
        },
    )
    .expect("the range is a valid selector");
    match projected {
        RuntimeExactSourceRangeResolution::Resolved { range } => range.selected_text,
        other => panic!("the range projects onto the page: {other:?}"),
    }
}

fn search_source(document: &RuntimeDocument, revision_id: &str, query: &str) -> RuntimeSourceRange {
    let found = search(
        document,
        revision_id,
        RuntimeSearchRequest {
            query: query.to_owned(),
            case_sensitive: true,
            whole_word: false,
            limit: Some(1),
        },
    );
    let result = found.results.first().expect("the query is found");
    match &result.source {
        RuntimeSearchSource::Resolved { source_range, .. } => source_range.clone(),
        other => panic!("the match is anchored: {other:?}"),
    }
}

#[test]
fn a_range_across_a_ruby_reads_as_its_line_without_the_annotation() {
    let (mut document, revision_id) = open(RUBY);
    // From before the ruby to after it: the source holds 军团, the line not.
    let text = project(
        &mut document,
        &revision_id,
        point(&[0, 0], 5),
        point(&[0, 2], 2),
    );
    assert_eq!(text, "普通的白羊之中");
}

#[test]
fn a_range_in_a_ruby_base_lands_on_the_base_text() {
    let (mut document, revision_id) = open(RUBY);
    let text = project(
        &mut document,
        &revision_id,
        point(&[0, 1, 0, 0], 0),
        point(&[0, 1, 0, 0], 2),
    );
    assert_eq!(text, "白羊");
}

#[test]
fn a_search_match_across_a_ruby_anchors_the_whole_match() {
    let (mut document, revision_id) = open(RUBY);
    let range = search_source(&document, &revision_id, "普通的白羊之中");
    assert_eq!(range.start, point(&[0, 0], 5));
    assert_eq!(range.end, point(&[0, 2], 2));
    let text = project(&mut document, &revision_id, range.start, range.end);
    assert_eq!(text, "普通的白羊之中");

    let range = search_source(&document, &revision_id, "白羊之中");
    assert_eq!(range.start, point(&[0, 1, 0, 0], 0));
}

#[test]
fn a_search_match_across_hidden_text_falls_back_to_one_node() {
    // The line reads "ab"; the source reads "aXb" between the two nodes,
    // so the whole match cannot be anchored and the longer node's stretch
    // is.
    let (document, revision_id) = open(r#"<p>xxa<span style="display: none">X</span>b</p>"#);
    let range = search_source(&document, &revision_id, "xxab");
    assert_eq!(range.start, point(&[0, 0], 0));
    assert_eq!(range.end, point(&[0, 0], 3));
}
