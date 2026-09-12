mod access;
mod advance;
mod model;
mod preflight;

use crate::runtime::{
    RuntimeBoundedChapterLocalRevisionRequest, RuntimeChapterLocalRevisionAdvance,
    RuntimeChapterLocalRevisionError, RuntimeDocument,
};

use self::preflight::initialize_chapter_local_fragment;

impl RuntimeDocument {
    /// Creates a revision whose coordinates are local to exactly one spine
    /// chapter. The publication-absolute revisions are untouched.
    ///
    /// The fragment engine paginates the whole chapter in one pass: the
    /// returned advance is already complete and its extent is the entire
    /// chapter.
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
                    kind: crate::runtime::RuntimeRevisionErrorKind::EngineFailure,
                    message,
                })
            }
        }
    }
}
