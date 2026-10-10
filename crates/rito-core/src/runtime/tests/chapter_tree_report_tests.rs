use super::fixture::{fixture_epub, layout, multi_chapter_fixture_epub};
use crate::runtime::{RuntimeDocument, RUNTIME_CHAPTER_TREE_REPORT_SCHEMA_VERSION};

#[test]
fn fixture_chapters_are_representable_and_fingerprints_are_stable() {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
    let revision = document.create_revision(&layout()).expect("revision");

    let first = document
        .chapter_tree_report(&revision.revision_id)
        .expect("first report");
    let second = document
        .chapter_tree_report(&revision.revision_id)
        .expect("second report");
    assert_eq!(first, second);

    let report = first;
    assert_eq!(
        report.schema_version,
        RUNTIME_CHAPTER_TREE_REPORT_SCHEMA_VERSION
    );
    assert!(report.chapter_count > 0);
    // Every fixture chapter — including the one with an embedded image —
    // builds a fragment tree: image dimensions load with the revision.
    assert_eq!(
        report.representable_chapter_count,
        report.chapter_count,
        "unrepresentable: {:?}",
        report
            .chapters
            .iter()
            .filter(|chapter| !chapter.representable)
            .collect::<Vec<_>>()
    );
    for chapter in &report.chapters {
        assert!(chapter.formatting_node_count > 0, "{chapter:?}");
        let fingerprint = chapter
            .tree_fingerprint
            .as_deref()
            .expect("representable chapters carry a fingerprint");
        assert_eq!(fingerprint.len(), 16);
        assert!(chapter.reason.is_none());
    }
}

#[test]
fn multi_chapter_fixture_measures_every_chapter() {
    let mut document = RuntimeDocument::open_pinned_for_tests(&multi_chapter_fixture_epub())
        .expect("document opens");
    let revision = document.create_revision(&layout()).expect("revision");
    let report = document
        .chapter_tree_report(&revision.revision_id)
        .expect("report");
    assert!(report.chapter_count > 1);
    assert_eq!(report.representable_chapter_count, report.chapter_count);
}

#[test]
fn a_revision_of_another_document_is_unknown() {
    let mut seeded =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
    let revision = seeded.create_revision(&layout()).expect("revision");

    let fresh =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("fresh document opens");
    let error = fresh
        .chapter_tree_report(&revision.revision_id)
        .expect_err("a revision another document created is rejected");
    assert_eq!(
        error.to_string(),
        format!("unknown revision: {}", revision.revision_id)
    );
}
