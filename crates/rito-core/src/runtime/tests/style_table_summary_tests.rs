use super::fixture::{fixture_epub, layout};
use crate::runtime::{
    RuntimeDocument, RuntimeRevisionAccessErrorKind, RuntimeRevisionHandle,
    RUNTIME_STYLE_TABLE_SUMMARY_SCHEMA_VERSION,
};

#[test]
fn eager_revision_retains_a_typed_table_per_chapter() {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
    let revision = document.create_revision(&layout()).expect("revision");
    let handle = RuntimeRevisionHandle::from(&revision);

    let first = document
        .style_table_summary_at(&handle)
        .expect("first summary");
    let second = document
        .style_table_summary_at(&handle)
        .expect("second summary");
    assert_eq!(first.value, second.value);

    let summary = first.value;
    assert_eq!(
        summary.schema_version,
        RUNTIME_STYLE_TABLE_SUMMARY_SCHEMA_VERSION
    );
    assert!(summary.chapter_count > 0);
    assert_eq!(summary.chapters.len(), summary.chapter_count);
    for chapter in &summary.chapters {
        assert!(!chapter.idref.is_empty());
        assert!(chapter.interned_style_count > 0, "{:?}", chapter);
        assert!(chapter.inline_interned_style_count > 0, "{:?}", chapter);
        assert!(chapter.assigned_node_count > 0, "{:?}", chapter);
        assert!(chapter.inline_assigned_node_count > 0, "{:?}", chapter);
        assert!(chapter.assigned_node_count <= chapter.node_count);
        assert!(chapter.inline_assigned_node_count <= chapter.node_count);
    }
    assert_eq!(summary.table_digest.len(), 16);
}

#[test]
fn identical_configurations_project_identical_digests() {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
    let first = document.create_revision(&layout()).expect("first revision");
    let second = document
        .create_revision(&layout())
        .expect("second revision");

    let first_summary = document
        .style_table_summary_at(&RuntimeRevisionHandle::from(&first))
        .expect("first summary");
    let second_summary = document
        .style_table_summary_at(&RuntimeRevisionHandle::from(&second))
        .expect("second summary");
    assert_eq!(
        first_summary.value.table_digest,
        second_summary.value.table_digest
    );
    assert_eq!(first_summary.value.chapters, second_summary.value.chapters);
}

#[test]
fn forged_revision_handle_is_rejected() {
    let mut seeded =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
    let revision = seeded.create_revision(&layout()).expect("revision");
    let handle = RuntimeRevisionHandle::from(&revision);

    let fresh =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("fresh document opens");
    let error = fresh
        .style_table_summary_at(&handle)
        .expect_err("handle from another document is rejected");
    assert_eq!(error.kind, RuntimeRevisionAccessErrorKind::UnknownRevision);
}
