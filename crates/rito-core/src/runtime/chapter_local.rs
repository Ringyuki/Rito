mod access;
mod model;
mod preflight;
mod publish;

use crate::runtime::{
    RuntimeChapterLocalRevisionError, RuntimeChapterLocalRevisionRequest,
    RuntimeCreatedChapterLocalRevision, RuntimeDocument, RuntimeRevisionErrorKind,
};

use self::preflight::prepare_chapter_local_revision;

impl RuntimeDocument {
    /// Creates a revision whose coordinates are local to exactly one spine
    /// chapter. The publication-absolute revisions are untouched.
    ///
    /// The fragment engine paginates the whole chapter in one pass before
    /// the revision exists: the returned summary describes the complete
    /// chapter and the target is resolved against its page table.
    pub fn create_chapter_local_revision(
        &mut self,
        request: RuntimeChapterLocalRevisionRequest,
    ) -> Result<RuntimeCreatedChapterLocalRevision, RuntimeChapterLocalRevisionError> {
        let prepared = prepare_chapter_local_revision(self, request)?;
        let built = self
            .build_chapter_local_fragment_layout(
                &prepared.layout_config,
                prepared.coordinate.chapter_index,
            )
            .map_err(|message| RuntimeChapterLocalRevisionError {
                kind: RuntimeRevisionErrorKind::EngineFailure,
                message,
            })?;
        self.publish_chapter_local_revision(prepared, built)
    }
}
