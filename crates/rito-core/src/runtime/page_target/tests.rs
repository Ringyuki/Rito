use super::{RuntimePageTargetContext, RuntimeSourceLocator};
use crate::runtime::{
    tests::fixture::{interaction_target_fixture_epub, layout, multi_chapter_fixture_epub},
    RuntimeDocument,
};

#[test]
fn resolves_destination_labels_without_a_paginated_target_chapter() {
    let runtime = RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let context = RuntimePageTargetContext::new(&runtime.document);
    let labels = &context.toc_labels;

    let chapter_target = canonical_locator(&runtime, "chapter-2.xhtml#target");
    assert_eq!(labels.label(&chapter_target), Some("Two"));

    let section_target = canonical_locator(&runtime, "chapter-2.xhtml#missing");
    assert_eq!(labels.label(&section_target), Some("Missing"));

    let no_toc = RuntimeDocument::open(&interaction_target_fixture_epub())
        .expect("document without TOC opens");
    let no_toc_target = canonical_locator(&no_toc, "chapter.xhtml#intro");
    let no_toc_context = RuntimePageTargetContext::new(&no_toc.document);
    assert_eq!(no_toc_context.toc_labels.label(&no_toc_target), None);
}

#[test]
fn page_targets_carry_core_resolved_toc_destination_labels() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    assert!(document.page_target_context.get().is_none());

    let target = (0..revision.page_count)
        .flat_map(|page_index| {
            document
                .get_page_targets(&revision.revision_id, page_index)
                .expect("page targets are available")
                .entries
        })
        .find(|target| target.label == "chapter one")
        .expect("cross-chapter link target");

    assert_eq!(target.destination_label.as_deref(), Some("Two"));
    let context = document
        .page_target_context
        .get()
        .expect("page target context is cached")
        as *const RuntimePageTargetContext;
    document
        .get_page_targets(&revision.revision_id, 0)
        .expect("cached page targets remain available");
    assert_eq!(
        document
            .page_target_context
            .get()
            .expect("page target context remains cached")
            as *const RuntimePageTargetContext,
        context
    );
}

fn canonical_locator(runtime: &RuntimeDocument, href: &str) -> RuntimeSourceLocator {
    RuntimePageTargetContext::new(&runtime.document)
        .canonicalizer
        .canonicalize_locator(
            &runtime.document,
            RuntimeSourceLocator {
                href: href.to_owned(),
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: None,
            },
        )
        .expect("TOC destination canonicalizes")
}
