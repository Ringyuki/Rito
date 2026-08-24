use std::sync::Arc;

use super::{bounded_request, complete_revision, continue_request};
use crate::layout::LineBreaking;
use crate::runtime::tests::fixture::{
    cross_chapter_footnote_fixture_epub, layout, missing_future_chapter_fixture_epub,
    multi_chapter_fixture_epub,
};
use crate::runtime::{
    revision::runtime_chapter_revision_interactions, RuntimeContinuationErrorKind, RuntimeDocument,
    RuntimePageTargetKind, RuntimeRevisionStatus,
};

const BACK_KEY: &str = "chapter-1.xhtml#back";
const FORWARD_KEY: &str = "chapter-2.xhtml#forward";

#[test]
fn publication_footnote_scan_is_state_neutral() {
    let bytes = cross_chapter_footnote_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let before = document.document.clone();

    let index = document
        .publication_footnote_index()
        .expect("publication footnotes scan");
    let indexed_keys = index.footnotes.keys().cloned().collect::<Vec<_>>();

    assert_eq!(indexed_keys, vec![BACK_KEY, FORWARD_KEY]);
    assert_eq!(index.source_scan_count, 3);
    assert_eq!(index.definition_parse_count, 2);
    assert_eq!(document.publication_footnote_scan_count(), 1);
    assert_eq!(document.document, before);
    assert!(document.parsed_chapters.is_empty());
    assert!(document.prepared.is_none());
    assert!(document.prepared_base.is_none());
    assert!(document.full_chapter_text_indices.get().is_none());
    assert!(document.source_chapter_indices.is_empty());
}

#[test]
fn publication_without_footnote_definitions_never_builds_semantic_scan_trees() {
    let bytes = multi_chapter_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");

    let index = document
        .publication_footnote_index()
        .expect("publication footnotes scan");

    assert_eq!(index.source_scan_count, 3);
    assert_eq!(index.definition_parse_count, 0);
    assert!(index.footnotes.is_empty());
}

#[test]
fn bounded_chapter_interactions_do_not_copy_publication_footnotes() {
    let bytes = cross_chapter_footnote_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let targets = document
        .publication_footnote_index()
        .expect("publication footnotes scan")
        .targets
        .clone();
    document
        .document
        .ensure_chapter_loaded(0)
        .expect("first chapter loads");
    let prepared = document
        .prepare_cached_document_window(0, 1, &targets)
        .expect("first chapter prepares");

    let interactions = runtime_chapter_revision_interactions(&prepared);

    assert!(interactions.footnotes.is_empty());
    assert_eq!(
        interactions
            .completed_chapter_idrefs
            .into_iter()
            .collect::<Vec<_>>(),
        vec!["chapter-1"]
    );
}

#[test]
fn bounded_publication_revision_shares_the_completed_footnote_index() {
    let bytes = cross_chapter_footnote_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let publication_footnotes = Arc::clone(
        &document
            .publication_footnote_index()
            .expect("publication footnotes scan")
            .footnotes,
    );

    let initial = document
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("bounded revision starts");
    let interactions = &document
        .revisions
        .get(&initial.revision.revision_id)
        .expect("revision remains available")
        .interactions;
    let revision_footnotes = interactions
        .publication_footnotes
        .as_ref()
        .expect("completed publication index is shared");

    assert!(Arc::ptr_eq(&publication_footnotes, revision_footnotes));
    assert!(interactions.footnotes.is_empty());
}

#[test]
fn bounded_foreground_is_chapter_local_until_cooperative_index_completion() {
    let bytes = cross_chapter_footnote_fixture_epub();
    let mut eager = RuntimeDocument::open(&bytes).expect("eager document opens");
    let eager_revision = eager.create_revision(&layout()).expect("eager completes");
    let eager_footnotes = eager
        .get_footnotes(&eager_revision.revision_id)
        .expect("eager footnotes")
        .entries;

    let mut bounded = RuntimeDocument::open(&bytes).expect("bounded document opens");
    let initial = bounded
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("bounded starts");

    assert_eq!(bounded.publication_footnote_scan_count(), 0);
    assert_eq!(bounded.publication_footnote_source_scan_count(), 1);
    assert_lazy_state_after_first_chapter(&bounded);
    let initial_footnotes = bounded
        .get_footnotes(&initial.revision.revision_id)
        .expect("initial footnotes");
    assert!(!initial_footnotes.complete);
    assert_eq!(initial_footnotes.pending_keys, vec![FORWARD_KEY.to_owned()]);
    assert!(initial_footnotes.entries.is_empty());

    let page_targets = bounded
        .get_page_targets(&initial.revision.revision_id, 0)
        .expect("initial page targets");
    let forward = page_targets
        .entries
        .iter()
        .find(|target| target.label == "forward marker")
        .expect("forward noteref target");
    assert_eq!(forward.kind, RuntimePageTargetKind::FootnotePending);
    assert_eq!(forward.footnote_key.as_deref(), Some(FORWARD_KEY));
    let initial_text = revision_text(&bounded, &initial.revision.revision_id);
    assert!(initial_text.contains("Unreferenced note stays visible"));
    assert!(initial_text.contains("Backward note body"));

    while !bounded
        .advance_publication_footnote_index_once()
        .expect("background footnote quantum advances")
    {}
    assert_eq!(bounded.publication_footnote_scan_count(), 1);
    assert_eq!(bounded.publication_footnote_source_scan_count(), 3);
    assert_eq!(bounded.publication_footnote_definition_parse_count(), 2);

    let indexed = bounded
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("indexed bounded revision starts");
    assert_eq!(bounded.publication_footnote_scan_count(), 1);
    assert_eq!(
        bounded
            .get_footnotes(&indexed.revision.revision_id)
            .expect("indexed initial footnotes")
            .entries,
        eager_footnotes
    );
    assert_lazy_state_after_first_chapter(&bounded);
    assert_footnote_target(
        &bounded,
        &indexed.revision.revision_id,
        "forward marker",
        FORWARD_KEY,
    );

    let completed = complete_revision(&mut bounded, indexed);
    assert_eq!(
        bounded.revisions[&completed.revision.revision_id]
            .layout
            .pages,
        eager.revisions[&eager_revision.revision_id].layout.pages
    );
    assert_eq!(
        bounded
            .get_footnotes(&completed.revision.revision_id)
            .expect("completed bounded footnotes")
            .entries,
        eager_footnotes
    );
    assert_eq!(
        bounded
            .get_chapter_text_indices(&completed.revision.revision_id)
            .expect("bounded chapter text")
            .entries,
        eager
            .get_chapter_text_indices(&eager_revision.revision_id)
            .expect("eager chapter text")
            .entries
    );
}

#[test]
fn partial_previews_share_publication_footnote_targets_and_definitions() {
    let bytes = cross_chapter_footnote_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let prefix = document
        .create_revision_prefix_with_line_breaking(&layout(), LineBreaking::Greedy, Some(1))
        .expect("prefix preview");
    assert_revision_has_exact_footnotes(&mut document, &prefix.revision_id);
    let prefix_text = revision_text(&document, &prefix.revision_id);
    assert!(prefix_text.contains("Unreferenced note stays visible"));
    assert!(!prefix_text.contains("Backward note body"));
    assert_footnote_target(
        &document,
        &prefix.revision_id,
        "forward marker",
        FORWARD_KEY,
    );
    assert_eq!(document.publication_footnote_scan_count(), 1);
    assert!(!document.document.chapters[1].source_loaded);
    assert!(!document.document.chapters[2].source_loaded);

    let notes_window = document
        .create_revision_window_with_line_breaking(&layout(), LineBreaking::Greedy, 1, 1)
        .expect("notes window");
    assert_revision_has_exact_footnotes(&mut document, &notes_window.revision_id);
    assert!(!revision_text(&document, &notes_window.revision_id).contains("Forward note body"));

    let backward_window = document
        .create_revision_window_with_line_breaking(&layout(), LineBreaking::Greedy, 2, 1)
        .expect("backward-reference window");
    assert_revision_has_exact_footnotes(&mut document, &backward_window.revision_id);
    assert_footnote_target(
        &document,
        &backward_window.revision_id,
        "backward marker",
        BACK_KEY,
    );
    assert_eq!(document.publication_footnote_scan_count(), 1);
}

#[test]
fn unreadable_future_chapter_failure_remains_deferred_until_continuation() {
    let bytes = missing_future_chapter_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens lazily");
    let initial = document
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("available first chapter starts");
    let cursor = initial
        .continuation
        .expect("missing future chapter remains");

    // The cooperative index defers completion to background quanta; the
    // bounded foreground scans only its target chapter.
    assert_eq!(document.publication_footnote_scan_count(), 0);
    assert!(!document.document.chapters[1].source_loaded);
    assert_eq!(initial.revision.status, RuntimeRevisionStatus::Ready);

    let error = document
        .continue_revision(continue_request(&cursor, 1))
        .expect_err("missing future chapter fails only when reached");
    assert_eq!(error.kind, RuntimeContinuationErrorKind::EngineFailure);
    assert_eq!(
        error.revision.expect("failed revision summary").status,
        RuntimeRevisionStatus::Failed
    );
}

fn assert_lazy_state_after_first_chapter(document: &RuntimeDocument) {
    assert_eq!(
        document
            .document
            .chapters
            .iter()
            .map(|chapter| chapter.source_loaded)
            .collect::<Vec<_>>(),
        vec![true, false, false]
    );
    for chapter in &document.document.chapters[1..] {
        assert!(chapter.xhtml_source.is_empty());
        assert!(chapter.image_refs.is_none());
    }
    assert_eq!(
        document.parsed_chapters.keys().copied().collect::<Vec<_>>(),
        vec![0]
    );
    assert!(document.prepared.is_none());
    assert!(document.full_chapter_text_indices.get().is_none());
    assert!(document.source_chapter_indices.is_empty());
    assert!(document
        .document
        .fonts
        .iter()
        .all(|font| font.bytes.is_empty()));
    assert!(document.document.images.iter().all(|image| {
        image.bytes.is_empty()
            && image.width.is_none()
            && image.height.is_none()
            && !image.dimensions_loaded
    }));
}

fn assert_revision_has_exact_footnotes(document: &mut RuntimeDocument, revision_id: &str) {
    let footnotes = document
        .get_footnotes(revision_id)
        .expect("revision footnotes")
        .entries;
    assert_eq!(footnotes.len(), 2);
    assert!(footnotes.contains_key(BACK_KEY));
    assert!(footnotes.contains_key(FORWARD_KEY));
}

fn assert_footnote_target(document: &RuntimeDocument, revision_id: &str, label: &str, key: &str) {
    let target = document
        .get_page_targets(revision_id, 0)
        .expect("page targets")
        .entries
        .into_iter()
        .find(|target| target.label == label)
        .expect("footnote target");
    assert_eq!(target.kind, RuntimePageTargetKind::Footnote);
    assert_eq!(target.footnote_key.as_deref(), Some(key));
}

fn revision_text(document: &RuntimeDocument, revision_id: &str) -> String {
    let page_count = document.revisions[revision_id].known_extent.page_count;
    (0..page_count)
        .map(|page_index| {
            document
                .get_page_text_positions(revision_id, page_index)
                .expect("page text")
                .text
        })
        .collect()
}
