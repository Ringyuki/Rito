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
    initialize_chapter_local_revision, initialize_chapter_local_rollover,
    prepare_chapter_local_continuation,
};

impl RuntimeDocument {
    /// Starts a bounded revision whose coordinates are local to exactly one
    /// spine chapter. The publication-absolute prefix revision is untouched.
    pub fn create_bounded_chapter_local_revision(
        &mut self,
        request: RuntimeBoundedChapterLocalRevisionRequest,
    ) -> Result<RuntimeChapterLocalRevisionAdvance, RuntimeChapterLocalRevisionError> {
        let initialized = initialize_chapter_local_revision(self, request)?;
        self.advance_initial_chapter_local(
            initialized.record,
            initialized.budget,
            initialized.coordinate,
            initialized.target_locator,
        )
    }

    pub fn continue_chapter_local_revision(
        &mut self,
        request: RuntimeContinueChapterLocalRevisionRequest,
    ) -> Result<RuntimeChapterLocalRevisionAdvance, RuntimeChapterLocalRevisionError> {
        let mut prepared = prepare_chapter_local_continuation(self, request)?;
        let next_version = prepared.record.revision_version;
        let layout_key = prepared.record.layout_key.clone();
        let work = match self.advance_record(&mut prepared.record, prepared.budget) {
            Ok(work) => work,
            Err(error) => {
                self.cleanup_queue.enqueue_continuation(prepared.record);
                return Err(self.fail_chapter_local_revision(
                    &prepared.revision_id,
                    next_version,
                    &layout_key,
                    error,
                ));
            }
        };
        let page_cap_reached =
            prepared.record.reached_local_page_cap() && !prepared.record.is_complete();
        self.apply_chapter_local_work(
            prepared.record,
            work,
            prepared.previous_extent,
            next_version,
            page_cap_reached,
            prepared.target_locator,
        )
    }

    /// Moves a sealed chapter-local window's break token into a fresh bounded
    /// revision. The source revision and all of its frames remain readable.
    pub fn rollover_chapter_local_revision(
        &mut self,
        request: RuntimeRolloverChapterLocalRevisionRequest,
    ) -> Result<RuntimeChapterLocalRevisionAdvance, RuntimeChapterLocalRevisionError> {
        let initialized = initialize_chapter_local_rollover(self, request)?;
        self.advance_initial_chapter_local(
            initialized.record,
            initialized.budget,
            initialized.coordinate,
            initialized.target_locator,
        )
    }
}
