//! Ranges across ruby and other elements: the line holds a ruby's base
//! text, the source holds its annotation text after it, and a range or a
//! search match may run across several text nodes.

use super::pinned_font_policy_fixtures::{content_epub, layout};
use super::revisions::{exact_source_range, revision_by_id, search};
use crate::runtime::{
    RuntimeDocument, RuntimeExactSourceRangeRequest, RuntimeExactSourceRangeResolution,
    RuntimeRevisionHandle, RuntimeSearchRequest, RuntimeSearchSource, RuntimeSourcePoint,
    RuntimeSourceRange, RuntimeTextPointRequest, RuntimeTextRangeFromPointsRequest,
    RuntimeTextRangeFromPointsResolution, RuntimeTextSelectionGranularity,
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

#[test]
fn a_selection_from_a_ruby_base_builds_an_annotation_that_resolves() {
    let (mut document, revision_id) = open(RUBY);
    // Where 普通的 sits on the line, and the em its glyphs are: the ruby
    // base 白羊 follows it, then 之中.
    let before = exact_source_range(
        &mut document,
        &revision_id,
        RuntimeExactSourceRangeRequest {
            href: "chapter.xhtml".to_owned(),
            source_range: RuntimeSourceRange {
                start: point(&[0, 0], 5),
                end: point(&[0, 0], 8),
            },
        },
    )
    .expect("the range is a valid selector");
    let RuntimeExactSourceRangeResolution::Resolved { range } = before else {
        panic!("plain text projects onto the page");
    };
    let rect = &range.rects[0];
    let em = rect.width / 3.0;
    let base = rect.x + rect.width;
    let at = |x: f64| RuntimeTextPointRequest {
        page_index: 0,
        x,
        y: rect.y + rect.height / 2.0,
    };
    // From inside the ruby base to inside 之中, word by word.
    let response = document
        .resolve_text_range_from_points_in(
            &revision_id,
            revision_by_id(&document, &revision_id),
            RuntimeTextRangeFromPointsRequest {
                anchor: at(base + 0.5 * em),
                focus: at(base + 3.5 * em),
                granularity: RuntimeTextSelectionGranularity::Word,
            },
        )
        .expect("the selection request is valid");
    let RuntimeTextRangeFromPointsResolution::Resolved { range, .. } = response.resolution else {
        panic!("the selection resolves: {:?}", response.resolution);
    };
    let locator = range
        .source_locator
        .expect("the selection has one resource");
    let source_range = locator
        .source_range
        .expect("the selection has a source range");
    assert_eq!(source_range.start.node_path, vec![0, 1, 0, 0]);

    // The host builds the annotation from the selection's own source range.
    let target = document
        .create_annotation_target(&locator.href, &source_range)
        .expect("a selection from a ruby base builds an annotation target");
    let text = project(
        &mut document,
        &revision_id,
        source_range.start,
        source_range.end,
    );
    assert!(text.starts_with("白羊"), "{text}");
    assert!(
        target.quote.exact.starts_with("白羊军团"),
        "{:?}",
        target.quote
    );
}
