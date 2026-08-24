use super::fixture::{fixture_epub, layout, multi_chapter_fixture_epub};
use crate::runtime::{
    RuntimeDocument, RuntimeRevisionAccessErrorKind, RuntimeRevisionHandle,
    RUNTIME_CHAPTER_TREE_REPORT_SCHEMA_VERSION,
};

#[test]
fn fixture_chapters_are_representable_and_fingerprints_are_stable() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document.create_revision(&layout()).expect("revision");
    let handle = RuntimeRevisionHandle::from(&revision);

    let first = document
        .chapter_tree_report_at(&handle)
        .expect("first report");
    let second = document
        .chapter_tree_report_at(&handle)
        .expect("second report");
    assert_eq!(first.value, second.value);

    let report = first.value;
    assert_eq!(
        report.schema_version,
        RUNTIME_CHAPTER_TREE_REPORT_SCHEMA_VERSION
    );
    assert!(report.is_complete);
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
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let revision = document.create_revision(&layout()).expect("revision");
    let report = document
        .chapter_tree_report_at(&RuntimeRevisionHandle::from(&revision))
        .expect("report");
    assert!(report.value.chapter_count > 1);
    assert_eq!(
        report.value.representable_chapter_count,
        report.value.chapter_count
    );
}

#[test]
fn forged_revision_handle_is_rejected() {
    let mut seeded = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = seeded.create_revision(&layout()).expect("revision");
    let handle = RuntimeRevisionHandle::from(&revision);

    let fresh = RuntimeDocument::open(&fixture_epub()).expect("fresh document opens");
    let error = fresh
        .chapter_tree_report_at(&handle)
        .expect_err("handle from another document is rejected");
    assert_eq!(error.kind, RuntimeRevisionAccessErrorKind::UnknownRevision);
}
