use super::fixture::{fixture_epub, layout, multi_chapter_fixture_epub};
use crate::runtime::{
    RuntimeDocument, RuntimeResourceKind, RuntimeRevisionAccessErrorKind, RuntimeRevisionHandle,
    RuntimeSourceLocator,
};

fn handle_for(summary: &crate::runtime::RuntimeRevisionSummary) -> RuntimeRevisionHandle {
    RuntimeRevisionHandle::from(summary)
}

fn source_locator(href: &str) -> RuntimeSourceLocator {
    RuntimeSourceLocator {
        href: href.to_owned(),
        anchor_id: None,
        source_point: None,
        source_range: None,
        progression: None,
    }
}

#[test]
fn a_versioned_read_reports_why_it_was_refused() {
    let handle = RuntimeRevisionHandle::new("rev-7", 3);
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
    let unknown = document
        .validate_revision_handle(&handle)
        .expect_err("unknown revision is rejected");
    assert_eq!(
        unknown.kind,
        RuntimeRevisionAccessErrorKind::UnknownRevision
    );
    assert_eq!(unknown.to_string(), "unknown revision: rev-7");
    assert_eq!(
        document
            .get_footnote_at(&handle, "chapter.xhtml#fn1")
            .expect_err("a handle the document never issued is rejected")
            .kind,
        RuntimeRevisionAccessErrorKind::UnknownRevision
    );

    let revision = document
        .create_revision(&layout())
        .expect("revision exists");
    let current = handle_for(&revision);
    let stale = RuntimeRevisionHandle::new(&revision.revision_id, revision.revision_version + 1);
    assert_eq!(
        document
            .spread_page_indexes_at(&stale, 0)
            .expect_err("a handle of another version is rejected")
            .kind,
        RuntimeRevisionAccessErrorKind::StaleRevisionVersion
    );
    let failed = document
        .spread_page_indexes_at(&current, revision.spread_count)
        .expect_err("operation failure is typed");
    assert_eq!(failed.kind, RuntimeRevisionAccessErrorKind::OperationFailed);
    assert!(failed.message.contains("unknown spread index"));
}

#[test]
fn every_versioned_read_answers_under_the_handle_it_was_asked_with() {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision exists");
    let handle = handle_for(&revision);
    assert_eq!(handle.revision_version, 0);

    let pages = document
        .spread_page_indexes_at(&handle, 0)
        .expect("spread pages");
    assert_eq!(pages.revision, handle);
    assert!(!pages.value.is_empty());
    let resource = document
        .get_resource_at(&handle, RuntimeResourceKind::Image, "Images/cover.png")
        .expect("resource");
    assert_eq!(resource.revision, handle);
    let located = document
        .resolve_source_locator_at(&handle, source_locator("chapter.xhtml"))
        .expect("source locator");
    assert_eq!(located.revision, handle);
    let anchor = document
        .get_page_reading_anchor_at(&handle, 0)
        .expect("reading anchor");
    assert_eq!(anchor.revision, handle);
    let footnote = document
        .get_footnote_at(&handle, "chapter.xhtml#fn1")
        .expect("footnote");
    assert_eq!(footnote.revision, handle);

    assert!(document
        .release_revision_at(&handle)
        .expect("the handle names the revision it releases"));
    assert_eq!(
        document
            .spread_page_indexes_at(&handle, 0)
            .expect_err("a released revision is gone")
            .kind,
        RuntimeRevisionAccessErrorKind::UnknownRevision
    );
}

#[test]
fn revision_presentation_is_exact_and_omits_heavy_aggregates() {
    let mut document = RuntimeDocument::open_pinned_for_tests(&multi_chapter_fixture_epub())
        .expect("document opens");
    let initial = document
        .create_revision(&layout())
        .expect("revision is created");

    let presentation = document
        .revision_presentation(&initial.revision_id)
        .expect("current presentation resolves");
    let bundle = document
        .revision_bundle(&initial.revision_id, true)
        .expect("current bundle resolves");

    assert_eq!(presentation.revision, initial);
    assert_eq!(presentation.navigation, bundle.navigation);
    assert_eq!(presentation.toc_targets, bundle.toc_targets);
    assert_eq!(presentation.font_families, bundle.font_families);
    assert_eq!(presentation.required_font_faces, bundle.required_font_faces);

    let serialized = serde_json::to_value(&presentation)
        .expect("revision presentation serializes")
        .as_object()
        .expect("revision presentation is an object")
        .clone();
    for field in ["revision", "navigation", "tocTargets", "fontFamilies"] {
        assert!(serialized.contains_key(field), "missing {field}");
    }
    assert!(!serialized.contains_key("footnotes"));
    assert!(!serialized.contains_key("chapterTextIndices"));
    assert!(!serialized.contains_key("fontVerticalMetricDemands"));
    assert!(!serde_json::to_value(&bundle)
        .expect("revision bundle serializes")
        .as_object()
        .expect("revision bundle is an object")
        .contains_key("fontVerticalMetricDemands"));
}
