use super::super::super::tests::fixture::{
    fixture_epub_with_chapter_and_stylesheet, fixture_stylesheet,
};
use super::*;

fn document(body: &str) -> RuntimeDocument {
    let chapter = format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>{body}</body></html>"#
    );
    RuntimeDocument::open_pinned_for_tests(&fixture_epub_with_chapter_and_stylesheet(
        chapter.as_bytes(),
        fixture_stylesheet(),
    ))
    .expect("document opens")
}

/// The canonical source range covering `start..end` of the chapter text.
fn range(document: &mut RuntimeDocument, start: usize, end: usize) -> RuntimeSourceRange {
    let chapter_index = document
        .annotation_chapter("chapter.xhtml")
        .expect("chapter resolves");
    let chapter = document.canonical_chapter(chapter_index);
    RuntimeSourceRange {
        start: start_point(&chapter.index.text.spans, start).expect("start maps"),
        end: end_point(&chapter.index.text.spans, end).expect("end maps"),
    }
}

fn create(document: &mut RuntimeDocument, start: usize, end: usize) -> AnnotationTarget {
    let range = range(document, start, end);
    document
        .create_annotation_target("chapter.xhtml", &range)
        .expect("target is created")
}

#[test]
fn a_target_serializes_to_the_canonical_bytes() {
    let mut document = document("<p>Alpha <em>beta</em> gamma</p>");
    let target = create(&mut document, 6, 10);

    assert_eq!(
        annotation_target_to_json(&target),
        r#"{"version":1,"href":"chapter.xhtml","sourceRange":{"start":{"nodePath":[0,1,0],"textOffset":0},"end":{"nodePath":[0,1,0],"textOffset":4}},"quote":{"exact":"beta","prefix":"Alpha ","suffix":" gamma"},"position":{"start":6,"end":10,"chapterLength":16}}"#
    );
    assert_eq!(
        annotation_target_from_json(&annotation_target_to_json(&target)),
        Ok(target)
    );
}

#[test]
fn a_backward_range_builds_the_same_target_as_a_forward_one() {
    let mut document = document("<p>Alpha <em>beta</em> gamma</p>");
    let forward = range(&mut document, 3, 12);
    let backward = RuntimeSourceRange {
        start: forward.end.clone(),
        end: forward.start.clone(),
    };

    assert_eq!(
        document.create_annotation_target("chapter.xhtml", &backward),
        document.create_annotation_target("chapter.xhtml", &forward)
    );
}

#[test]
fn range_ends_at_a_node_seam_name_the_text_they_cover() {
    let mut document = document("<p>Alpha <em>beta</em> gamma</p>");
    // "Alpha " ends where "beta" starts: offset 6 is both nodes' seam.
    let seam_end = RuntimeSourceRange {
        start: range(&mut document, 0, 1).start,
        end: RuntimeSourcePoint {
            node_path: vec![0, 1, 0],
            text_offset: 0,
        },
    };
    let target = document
        .create_annotation_target("chapter.xhtml", &seam_end)
        .expect("target is created");

    assert_eq!(target.quote.exact, "Alpha ");
    assert_eq!(target.source_range.end.node_path, vec![0, 0]);
    assert_eq!(target.source_range.end.text_offset, 6);
}

#[test]
fn an_empty_range_is_rejected() {
    let mut document = document("<p>Alpha</p>");
    let empty = range(&mut document, 2, 2);

    let error = document
        .create_annotation_target(
            "chapter.xhtml",
            &RuntimeSourceRange {
                start: empty.start.clone(),
                end: empty.start,
            },
        )
        .expect_err("empty range is rejected");
    assert_eq!(error.kind, RuntimeSourceLocatorErrorKind::InvalidSelector);
}

#[test]
fn quote_context_never_splits_a_surrogate_pair() {
    let emoji = "😀".repeat(20);
    let mut document = document(&format!("<p>{emoji}x{emoji}</p>"));
    let target = create(&mut document, 40, 41);

    assert_eq!(target.quote.exact, "x");
    // 32 units would start halfway into a pair: the context gives one back.
    assert_eq!(target.quote.prefix, "😀".repeat(16));
    assert_eq!(target.quote.suffix, "😀".repeat(16));
}

#[test]
fn an_unchanged_chapter_resolves_exactly_to_the_same_target() {
    let mut document = document("<p>Alpha <em>beta</em> gamma</p>");
    let target = create(&mut document, 6, 10);

    assert_eq!(
        document.resolve_annotation_target(&target),
        Ok(AnnotationTargetResolution::Exact {
            target: target.clone()
        })
    );
}

#[test]
fn moved_text_falls_back_to_the_quote_with_the_best_context() {
    let mut before = document("<p>one beta two</p><p>three beta four</p>");
    let target = create(&mut before, 18, 22);
    assert_eq!(target.quote.exact, "beta");
    let mut after = document("<p>zero</p><p>one beta two</p><p>three beta four</p>");

    let Ok(AnnotationTargetResolution::Quote { target: moved }) =
        after.resolve_annotation_target(&target)
    else {
        panic!("quote fallback expected");
    };
    assert_eq!(moved.quote.prefix, "zeroone beta twothree ");
    assert_eq!(moved.position.start, 22);
}

#[test]
fn reworded_text_falls_back_to_the_stored_position() {
    let mut before = document("<p>Alpha beta gamma</p>");
    let target = create(&mut before, 6, 10);
    let mut after = document("<p>Alpha BETA gamma</p>");

    let Ok(AnnotationTargetResolution::Position { target: placed }) =
        after.resolve_annotation_target(&target)
    else {
        panic!("position fallback expected");
    };
    assert_eq!(placed.quote.exact, "BETA");
}

#[test]
fn a_shrunken_chapter_falls_back_to_the_scaled_position() {
    let mut before = document("<p>abcdefghijklmnopqrst</p>");
    let target = create(&mut before, 10, 20);
    let mut after = document("<p>ABCDEFGHIJ</p>");

    let Ok(AnnotationTargetResolution::Progression { target: placed }) =
        after.resolve_annotation_target(&target)
    else {
        panic!("progression fallback expected");
    };
    // 10 of 20 units scales to 5 of 10.
    assert_eq!(placed.quote.exact, "F");
    assert_eq!((placed.position.start, placed.position.end), (5, 6));
}

#[test]
fn a_missing_chapter_orphans_the_target() {
    let mut document = document("<p>Alpha</p>");
    let mut target = create(&mut document, 0, 5);
    target.href = "missing.xhtml".to_owned();

    assert_eq!(
        document.resolve_annotation_target(&target),
        Ok(AnnotationTargetResolution::Orphaned {
            reason: AnnotationOrphanReason::HrefNotFound
        })
    );
}

#[test]
fn other_versions_and_unknown_fields_are_rejected() {
    let mut document = document("<p>Alpha</p>");
    let json = annotation_target_to_json(&create(&mut document, 0, 5));

    assert!(annotation_target_from_json(&json.replace("\"version\":1", "\"version\":2")).is_err());
    assert!(annotation_target_from_json(&json.replacen('{', "{\"extra\":0,", 1)).is_err());
}

#[test]
fn a_resolution_serializes_with_its_level_tag() {
    let mut document = document("<p>Alpha</p>");
    let target = create(&mut document, 0, 5);
    let resolution = document
        .resolve_annotation_target(&target)
        .expect("target resolves");

    let json = serde_json::to_string(&resolution).expect("resolution serializes");
    assert!(json.starts_with(r#"{"level":"exact","target":{"version":1,"#));
}
