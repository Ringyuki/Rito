use super::{bounded_request, budget, continue_request};
use crate::runtime::tests::fixture::{layout, multi_chapter_fixture_epub};
use crate::runtime::{
    RuntimeCancelRevisionRequest, RuntimeContinuationErrorKind, RuntimeContinueRevisionRequest,
    RuntimeDocument, RuntimeRevisionAccessErrorKind, RuntimeRevisionCursor, RuntimeRevisionHandle,
    RuntimeRevisionStatus,
};

fn start_revision_pair(
    document: &mut RuntimeDocument,
) -> (RuntimeRevisionCursor, RuntimeRevisionCursor) {
    let first = document
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("first bounded revision starts")
        .continuation
        .expect("first continuation exists");
    let second = document
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("second bounded revision starts")
        .continuation
        .expect("second continuation exists");
    (first, second)
}

fn assert_cursor_index(document: &RuntimeDocument, expected: &[&RuntimeRevisionCursor]) {
    document.continuations.assert_consistent();
    assert_eq!(document.continuations.len(), expected.len());
    for cursor in expected {
        assert!(document.continuations.contains_cursor(&cursor.cursor));
        assert_eq!(
            document
                .continuations
                .cursor_for_revision(&cursor.revision_id),
            Some(cursor.cursor.as_str())
        );
        assert_eq!(
            document
                .get_revision_summary(&cursor.revision_id)
                .expect("indexed revision exists")
                .revision_version,
            cursor.revision_version
        );
    }
}

fn assert_rejected_without_consuming(
    document: &mut RuntimeDocument,
    request: RuntimeContinueRevisionRequest,
    expected_kind: RuntimeContinuationErrorKind,
    expected: &[&RuntimeRevisionCursor],
) {
    let error = document
        .continue_revision(request)
        .expect_err("continuation request is rejected");
    assert_eq!(error.kind, expected_kind);
    assert_cursor_index(document, expected);
}

fn complete_from_cursor(document: &mut RuntimeDocument, mut cursor: RuntimeRevisionCursor) {
    loop {
        let advance = document
            .continue_revision(continue_request(&cursor, 1))
            .expect("continuation advances toward completion");
        let Some(next) = advance.continuation else {
            return;
        };
        cursor = next;
    }
}

fn assert_original_cursors_work(
    document: &mut RuntimeDocument,
    first: &RuntimeRevisionCursor,
    second: &RuntimeRevisionCursor,
) {
    document
        .continue_revision(continue_request(first, 1))
        .expect("first original cursor remains usable");
    document
        .continue_revision(continue_request(second, 1))
        .expect("second original cursor remains usable");
}

#[test]
fn partial_swap_and_completion_change_only_the_target_cursor() {
    let bytes = multi_chapter_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let (first, second) = start_revision_pair(&mut document);
    assert_cursor_index(&document, &[&first, &second]);

    let replacement = document
        .continue_revision(continue_request(&first, 1))
        .expect("first revision advances")
        .continuation
        .expect("first revision remains partial");
    assert!(!document.continuations.contains_cursor(&first.cursor));
    assert_cursor_index(&document, &[&replacement, &second]);

    complete_from_cursor(&mut document, replacement);
    assert!(document
        .continuations
        .cursor_for_revision(&first.revision_id)
        .is_none());
    assert_cursor_index(&document, &[&second]);
    document
        .continue_revision(continue_request(&second, 1))
        .expect("second cursor remains usable");
}

#[test]
fn invalid_and_stale_requests_preserve_both_cursor_index_pairs() {
    let bytes = multi_chapter_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let (first, second) = start_revision_pair(&mut document);
    let expected = [&first, &second];

    let mut invalid = continue_request(&first, 0);
    assert_rejected_without_consuming(
        &mut document,
        invalid.clone(),
        RuntimeContinuationErrorKind::InvalidBudget,
        &expected,
    );
    invalid.budget = budget(1);
    invalid.revision_version += 1;
    assert_rejected_without_consuming(
        &mut document,
        invalid,
        RuntimeContinuationErrorKind::StaleRevisionVersion,
        &expected,
    );

    assert_original_cursors_work(&mut document, &first, &second);
}

#[test]
fn missing_and_swapped_requests_preserve_both_cursor_index_pairs() {
    let bytes = multi_chapter_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let (first, second) = start_revision_pair(&mut document);
    let expected = [&first, &second];
    let mut missing = continue_request(&first, 1);
    missing.cursor = "missing-cursor".to_owned();
    assert_rejected_without_consuming(
        &mut document,
        missing,
        RuntimeContinuationErrorKind::UnknownCursor,
        &expected,
    );
    let mut swapped = continue_request(&second, 1);
    swapped.cursor = first.cursor.clone();
    assert_rejected_without_consuming(
        &mut document,
        swapped,
        RuntimeContinuationErrorKind::CursorOwnerMismatch,
        &expected,
    );

    assert_original_cursors_work(&mut document, &first, &second);
}

#[test]
fn cancel_removes_only_the_target_cursor_pair() {
    let bytes = multi_chapter_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let (first, second) = start_revision_pair(&mut document);
    let stale = document
        .cancel_revision(RuntimeCancelRevisionRequest {
            revision_id: first.revision_id.clone(),
            revision_version: first.revision_version + 1,
        })
        .expect_err("stale cancellation fails");
    assert_eq!(
        stale.kind,
        RuntimeContinuationErrorKind::StaleRevisionVersion
    );
    assert_cursor_index(&document, &[&first, &second]);

    let cancelled = document
        .cancel_revision(RuntimeCancelRevisionRequest {
            revision_id: first.revision_id.clone(),
            revision_version: first.revision_version,
        })
        .expect("first revision cancels");
    assert_eq!(cancelled.status, RuntimeRevisionStatus::Cancelled);
    assert!(!document.continuations.contains_cursor(&first.cursor));
    assert_cursor_index(&document, &[&second]);
    document
        .continue_revision(continue_request(&second, 1))
        .expect("second cursor survives cancellation");
}

#[test]
fn release_removes_only_the_target_cursor_pair() {
    let bytes = multi_chapter_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let (first, second) = start_revision_pair(&mut document);
    let stale = RuntimeRevisionHandle::new(first.revision_id.clone(), first.revision_version + 1);
    let error = document
        .release_revision_at(&stale)
        .expect_err("stale release fails");
    assert_eq!(
        error.kind,
        RuntimeRevisionAccessErrorKind::StaleRevisionVersion
    );
    assert!(!document.release_revision("missing-revision"));
    assert_cursor_index(&document, &[&first, &second]);

    let current = RuntimeRevisionHandle::new(first.revision_id.clone(), first.revision_version);
    assert!(document
        .release_revision_at(&current)
        .expect("current release succeeds"));
    assert!(!document.continuations.contains_cursor(&first.cursor));
    assert_cursor_index(&document, &[&second]);
    document
        .continue_revision(continue_request(&second, 1))
        .expect("second cursor survives release");
}

#[test]
fn follow_up_failure_removes_only_the_failed_cursor_pair() {
    let bytes = multi_chapter_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let (first, second) = start_revision_pair(&mut document);
    let next_chapter = &mut document.document.chapters[1];
    next_chapter.href = "missing-chapter.xhtml".to_owned();
    next_chapter.xhtml_source.clear();
    next_chapter.source_loaded = false;
    next_chapter.image_refs = None;

    let error = document
        .continue_revision(continue_request(&first, 1))
        .expect_err("deferred chapter failure is surfaced");
    assert_eq!(error.kind, RuntimeContinuationErrorKind::EngineFailure);
    let failed = error.revision.expect("failure returns its new handle");
    assert_eq!(failed.status, RuntimeRevisionStatus::Failed);
    assert_eq!(failed.revision_version, first.revision_version + 1);
    assert!(!document.continuations.contains_cursor(&first.cursor));
    assert_cursor_index(&document, &[&second]);

    let failed_handle = RuntimeRevisionHandle::from(failed.as_ref());
    assert!(document
        .release_revision_at(&failed_handle)
        .expect("failed revision releases at its current version"));
    assert_cursor_index(&document, &[&second]);
}
