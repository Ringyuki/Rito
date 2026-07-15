use super::{bounded_request, budget, continue_request};
use crate::runtime::tests::fixture::{layout, multi_chapter_fixture_epub};
use crate::runtime::{
    RuntimeCancelRevisionRequest, RuntimeContinuationErrorKind, RuntimeContinueRevisionRequest,
    RuntimeDocument, RuntimeRevisionAccessErrorKind, RuntimeRevisionHandle, RuntimeRevisionStatus,
};

#[test]
fn continuation_cursor_is_one_shot_versioned_cancelled_and_released() {
    let bytes = multi_chapter_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let initial = document
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("bounded revision starts");
    let cursor = initial.continuation.clone().expect("continuation exists");

    let stale = document
        .continue_revision(RuntimeContinueRevisionRequest {
            revision_id: cursor.revision_id.clone(),
            revision_version: cursor.revision_version + 1,
            cursor: cursor.cursor.clone(),
            budget: budget(1),
        })
        .expect_err("wrong version fails");
    assert_eq!(
        stale.kind,
        RuntimeContinuationErrorKind::StaleRevisionVersion
    );

    let unknown_cursor = document
        .continue_revision(RuntimeContinueRevisionRequest {
            revision_id: cursor.revision_id.clone(),
            revision_version: cursor.revision_version,
            cursor: "missing-cursor".to_owned(),
            budget: budget(1),
        })
        .expect_err("unknown cursor fails");
    assert_eq!(
        unknown_cursor.kind,
        RuntimeContinuationErrorKind::UnknownCursor
    );

    let next = document
        .continue_revision(continue_request(&cursor, 1))
        .expect("valid cursor advances");
    assert_eq!(next.revision.revision_version, cursor.revision_version + 1);
    let replay = document
        .continue_revision(continue_request(&cursor, 1))
        .expect_err("consumed cursor cannot replay");
    assert_eq!(
        replay.kind,
        RuntimeContinuationErrorKind::StaleRevisionVersion
    );

    let next_cursor = next.continuation.expect("next continuation exists");
    document
        .get_frame(&next_cursor.revision_id, 0)
        .expect("known frame is cached before cancellation");
    assert_eq!(
        document.cached_frame_count(&next_cursor.revision_id),
        Some(1)
    );
    let cancelled = document
        .cancel_revision(RuntimeCancelRevisionRequest {
            revision_id: next_cursor.revision_id.clone(),
            revision_version: next_cursor.revision_version,
        })
        .expect("revision cancels");
    assert_eq!(cancelled.status, RuntimeRevisionStatus::Cancelled);
    assert_eq!(cancelled.revision_version, next_cursor.revision_version + 1);
    assert_eq!(
        document.cached_frame_count(&cancelled.revision_id),
        Some(0),
        "cancellation invalidates generated frames"
    );
    let after_cancel = document
        .continue_revision(RuntimeContinueRevisionRequest {
            revision_id: cancelled.revision_id.clone(),
            revision_version: cancelled.revision_version,
            cursor: next_cursor.cursor,
            budget: budget(1),
        })
        .expect_err("cancelled revision cannot continue");
    assert_eq!(
        after_cancel.kind,
        RuntimeContinuationErrorKind::RevisionNotContinuable
    );

    assert!(document.release_revision(&cancelled.revision_id));
    let after_release = document
        .get_revision_summary(&cancelled.revision_id)
        .expect_err("released revision is gone");
    assert_eq!(
        after_release.kind,
        RuntimeContinuationErrorKind::UnknownRevision
    );
}

#[test]
fn initial_engine_failure_retires_the_unpublished_revision() {
    let bytes = multi_chapter_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    document
        .publication_footnote_index()
        .expect("publication index is cached before the deferred load fails");
    make_chapter_unavailable(&mut document, 0);

    let error = document
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect_err("missing first chapter fails after revision initialization");

    assert_eq!(error.kind, RuntimeContinuationErrorKind::EngineFailure);
    assert!(error.revision.is_none());
    assert_eq!(document.revision_count(), 0);
    assert!(document.continuations.is_empty());
}

#[test]
fn invalid_budget_and_swapped_cursor_do_not_consume_valid_progress() {
    let bytes = multi_chapter_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let invalid_create = document
        .create_bounded_revision(bounded_request(layout(), 0))
        .expect_err("zero create budget fails");
    assert_eq!(
        invalid_create.kind,
        RuntimeContinuationErrorKind::InvalidBudget
    );
    assert!(
        serde_json::to_value(&invalid_create)
            .expect("error serializes")
            .get("revision")
            .is_none(),
        "pre-revision failures omit recovery metadata"
    );
    assert_eq!(document.revision_count(), 0);

    let first = document
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("first revision starts");
    let second = document
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("second revision starts");
    let first_cursor = first.continuation.expect("first cursor exists");
    let second_cursor = second.continuation.expect("second cursor exists");

    let before = document
        .get_revision_summary(&first_cursor.revision_id)
        .expect("first summary exists");
    let invalid_continue = document
        .continue_revision(RuntimeContinueRevisionRequest {
            revision_id: first_cursor.revision_id.clone(),
            revision_version: first_cursor.revision_version,
            cursor: first_cursor.cursor.clone(),
            budget: budget(0),
        })
        .expect_err("zero continuation budget fails");
    assert_eq!(
        invalid_continue.kind,
        RuntimeContinuationErrorKind::InvalidBudget
    );
    assert_eq!(
        document
            .get_revision_summary(&first_cursor.revision_id)
            .expect("first summary is unchanged"),
        before
    );

    let swapped = document
        .continue_revision(RuntimeContinueRevisionRequest {
            revision_id: second_cursor.revision_id.clone(),
            revision_version: second_cursor.revision_version,
            cursor: first_cursor.cursor.clone(),
            budget: budget(1),
        })
        .expect_err("another revision cannot consume the cursor");
    assert_eq!(
        swapped.kind,
        RuntimeContinuationErrorKind::CursorOwnerMismatch
    );

    document
        .continue_revision(continue_request(&first_cursor, 1))
        .expect("first cursor remains valid");
    document
        .continue_revision(continue_request(&second_cursor, 1))
        .expect("second cursor remains valid");
}

#[test]
fn releasing_an_active_revision_drops_its_continuation() {
    let bytes = multi_chapter_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let initial = document
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("bounded revision starts");
    let cursor = initial.continuation.expect("active cursor exists");

    assert!(document.release_revision(&cursor.revision_id));
    assert_eq!(document.revision_count(), 0);
    assert!(document.continuations.is_empty());
    let released = document
        .continue_revision(continue_request(&cursor, 1))
        .expect_err("released continuation is unavailable");
    assert_eq!(released.kind, RuntimeContinuationErrorKind::UnknownRevision);
}

#[test]
fn failed_continuation_returns_the_new_handle_for_version_safe_cleanup() {
    let bytes = multi_chapter_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let initial = document
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("first chapter advances");
    let cursor = initial.continuation.expect("later chapters remain");
    let stale_handle = RuntimeRevisionHandle::new(&cursor.revision_id, cursor.revision_version);
    document
        .get_frame(&cursor.revision_id, 0)
        .expect("known frame is cached before continuation failure");
    assert_eq!(document.cached_frame_count(&cursor.revision_id), Some(1));

    make_chapter_unavailable(&mut document, 1);

    let error = document
        .continue_revision(continue_request(&cursor, 1))
        .expect_err("missing deferred chapter fails after consuming the cursor");
    assert_eq!(error.kind, RuntimeContinuationErrorKind::EngineFailure);
    let error_json = serde_json::to_value(&error).expect("failure serializes");
    assert_eq!(error_json["kind"], "engineFailure");
    assert_eq!(
        error_json["revision"]["revisionVersion"],
        cursor.revision_version + 1
    );
    assert_eq!(error_json["revision"]["status"], "failed");
    let failed = *error
        .revision
        .expect("failure carries the new revision handle");
    assert_eq!(failed.revision_version, cursor.revision_version + 1);
    assert_eq!(failed.status, RuntimeRevisionStatus::Failed);
    assert_eq!(
        document.cached_frame_count(&failed.revision_id),
        Some(0),
        "failed continuation invalidates generated frames"
    );

    let stale_release = document
        .release_revision_at(&stale_handle)
        .expect_err("the consumed handle remains stale");
    assert_eq!(
        stale_release.kind,
        RuntimeRevisionAccessErrorKind::StaleRevisionVersion
    );
    let failed_handle = RuntimeRevisionHandle::from(&failed);
    assert_eq!(
        document
            .get_revision_summary_at(&failed_handle)
            .expect("failed revision remains inspectable")
            .value,
        failed
    );
    assert!(document
        .release_revision_at(&failed_handle)
        .expect("the returned handle releases the failed revision"));
}

fn make_chapter_unavailable(document: &mut RuntimeDocument, chapter_index: usize) {
    let chapter = &mut document.document.chapters[chapter_index];
    chapter.href = format!("missing-chapter-{chapter_index}.xhtml");
    chapter.xhtml_source.clear();
    chapter.source_loaded = false;
    chapter.image_refs = None;
}
