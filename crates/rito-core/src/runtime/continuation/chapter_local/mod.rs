mod access;
mod advance;
mod model;
mod preflight;

use crate::runtime::{
    RuntimeBoundedChapterLocalRevisionRequest, RuntimeChapterLocalRevisionAdvance,
    RuntimeChapterLocalRevisionError, RuntimeContinueChapterLocalRevisionRequest, RuntimeDocument,
    RuntimeRolloverChapterLocalRevisionRequest,
};

use self::preflight::{
    initialize_chapter_local_fragment, initialize_chapter_local_rollover,
    prepare_chapter_local_continuation,
};

impl RuntimeDocument {
    /// Starts a bounded revision whose coordinates are local to exactly one
    /// spine chapter. The publication-absolute prefix revision is untouched.
    ///
    /// The fragment engine paginates the whole chapter in one pass: the
    /// returned advance is already complete, its extent is the entire
    /// chapter, and there is no continuation cursor and no page-cap
    /// window to roll over.
    pub fn create_bounded_chapter_local_revision(
        &mut self,
        request: RuntimeBoundedChapterLocalRevisionRequest,
    ) -> Result<RuntimeChapterLocalRevisionAdvance, RuntimeChapterLocalRevisionError> {
        let initialized = initialize_chapter_local_fragment(self, request)?;
        match self.build_chapter_local_fragment_layout(
            &initialized.revision_id,
            initialized.coordinate.chapter_index,
        ) {
            Ok(layout) => self.publish_chapter_local_fragment(
                &initialized.revision_id,
                &initialized.layout_key,
                layout,
                initialized.target_locator,
            ),
            Err(message) => {
                self.retire_failed_fragment_local_revision(&initialized.revision_id);
                Err(crate::runtime::RuntimeChapterLocalRevisionError {
                    kind: crate::runtime::RuntimeContinuationErrorKind::EngineFailure,
                    message,
                    revision: None,
                })
            }
        }
    }

    /// Fragment chapter-local revisions publish complete in one pass:
    /// there is never a continuation to resume. Validation still answers
    /// the caller's cursor with the precise contract error.
    pub fn continue_chapter_local_revision(
        &mut self,
        request: RuntimeContinueChapterLocalRevisionRequest,
    ) -> Result<RuntimeChapterLocalRevisionAdvance, RuntimeChapterLocalRevisionError> {
        let prepared = prepare_chapter_local_continuation(self, request)?;
        self.cleanup_queue.enqueue_continuation(prepared.record);
        Err(crate::runtime::RuntimeChapterLocalRevisionError {
            kind: crate::runtime::RuntimeContinuationErrorKind::RevisionNotContinuable,
            message: "chapter-local revisions publish complete; there is nothing to continue"
                .to_owned(),
            revision: None,
        })
    }

    /// Page-cap windows no longer exist (a chapter-local revision spans
    /// its whole chapter), so there is never a sealed window to roll
    /// over. Validation still answers with the precise contract error.
    pub fn rollover_chapter_local_revision(
        &mut self,
        request: RuntimeRolloverChapterLocalRevisionRequest,
    ) -> Result<RuntimeChapterLocalRevisionAdvance, RuntimeChapterLocalRevisionError> {
        let initialized = initialize_chapter_local_rollover(self, request)?;
        self.cleanup_queue.enqueue_continuation(initialized.record);
        Err(crate::runtime::RuntimeChapterLocalRevisionError {
            kind: crate::runtime::RuntimeContinuationErrorKind::RevisionNotContinuable,
            message: "chapter-local revisions have no page-cap window to roll over".to_owned(),
            revision: None,
        })
    }
}
