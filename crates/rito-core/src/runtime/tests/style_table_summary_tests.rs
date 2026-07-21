use super::fixture::{fixture_epub, layout, multi_chapter_fixture_epub};
use crate::{
    layout::LineBreaking,
    runtime::{
        RuntimeBoundedRevisionRequest, RuntimeContinueRevisionRequest, RuntimeDocument,
        RuntimeRevisionAccessErrorKind, RuntimeRevisionHandle, RuntimeRevisionWorkBudget,
        RUNTIME_STYLE_TABLE_SUMMARY_SCHEMA_VERSION,
    },
};

#[test]
fn eager_revision_retains_a_typed_table_per_chapter() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
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
    assert!(summary.is_complete);
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
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
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
fn bounded_revision_tables_appear_as_chapters_publish() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let initial = document
        .create_bounded_revision(RuntimeBoundedRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Greedy,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .expect("bounded revision starts");
    let handle = RuntimeRevisionHandle::from(&initial.revision);
    let warming = document
        .style_table_summary_at(&handle)
        .expect("warming summary");
    assert!(!warming.value.is_complete);

    let mut advance = initial;
    while let Some(continuation) = advance.continuation.clone() {
        advance = document
            .continue_revision(RuntimeContinueRevisionRequest {
                revision_id: continuation.revision_id,
                revision_version: continuation.revision_version,
                cursor: continuation.cursor,
                budget: RuntimeRevisionWorkBudget {
                    max_top_level_nodes: 1,
                },
            })
            .expect("revision advances");
    }
    let complete = document
        .style_table_summary_at(&RuntimeRevisionHandle::from(&advance.revision))
        .expect("complete summary");
    assert!(complete.value.is_complete);
    assert!(complete.value.chapter_count >= warming.value.chapter_count);
    assert!(complete.value.chapter_count > 1);
    for chapter in &complete.value.chapters {
        assert!(chapter.assigned_node_count > 0, "{:?}", chapter);
        assert!(chapter.inline_assigned_node_count > 0, "{:?}", chapter);
    }
}

#[test]
fn forged_revision_handle_is_rejected() {
    let mut seeded = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = seeded.create_revision(&layout()).expect("revision");
    let handle = RuntimeRevisionHandle::from(&revision);

    let fresh = RuntimeDocument::open(&fixture_epub()).expect("fresh document opens");
    let error = fresh
        .style_table_summary_at(&handle)
        .expect_err("handle from another document is rejected");
    assert_eq!(error.kind, RuntimeRevisionAccessErrorKind::UnknownRevision);
}
