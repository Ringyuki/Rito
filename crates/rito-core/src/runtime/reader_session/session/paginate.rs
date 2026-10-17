//! A chapter-local revision paginates its chapter only as far as the
//! session has needed it: through the spread it was opened on and the page
//! after it. A turn past them paginates further, and a query that reads the
//! whole chapter — a search, a text interaction, a page table — paginates
//! it to its end first, so it answers as it would have over every page.

use super::{errors::engine_error, ReaderError, ReaderRevisionBacking, ReaderSession};

impl ReaderSession {
    /// Paginates the chapter of the revision `revision_id` through the
    /// spread at `spread` and the page after it.
    pub(super) fn paginate_through_spread(
        &mut self,
        revision_id: u64,
        spread: usize,
    ) -> Result<(), ReaderError> {
        let Some(owner) = self
            .revisions
            .get(&revision_id)
            .map(|revision| revision.owner.clone())
        else {
            return Ok(());
        };
        self.document
            .paginate_chapter_local_through_spread(&owner.revision_id, spread)
            .map_err(engine_error)?;
        self.recount_spreads(revision_id);
        Ok(())
    }

    /// Paginates the chapter of the revision `revision_id` to its end.
    pub(super) fn complete_revision(&mut self, revision_id: u64) -> Result<(), ReaderError> {
        let Some(owner) = self
            .revisions
            .get(&revision_id)
            .map(|revision| revision.owner.clone())
        else {
            return Ok(());
        };
        self.document
            .extend_chapter_local_revision(&owner.revision_id, None)
            .map_err(engine_error)?;
        self.recount_spreads(revision_id);
        Ok(())
    }

    /// Paginates the chapter behind a chapter-local artifact to its end; an
    /// unknown artifact is left for the caller to report.
    pub(super) fn complete_artifact_revision(
        &mut self,
        artifact_id: u64,
    ) -> Result<(), ReaderError> {
        match self.artifacts.get(&artifact_id) {
            Some(artifact) if artifact.backing == ReaderRevisionBacking::ChapterLocal => {
                self.complete_revision(artifact.revision_id)
            }
            _ => Ok(()),
        }
    }

    /// Whether the chapter of the revision `revision_id` is paginated to
    /// its end.
    pub(super) fn revision_is_complete(&self, revision_id: u64) -> bool {
        self.revisions.get(&revision_id).is_none_or(|revision| {
            self.document
                .chapter_local_revision_is_complete(&revision.owner.revision_id)
        })
    }

    fn recount_spreads(&mut self, revision_id: u64) {
        let Some(revision) = self.revisions.get(&revision_id) else {
            return;
        };
        if let Some(spreads) = self
            .document
            .chapter_local_spread_count(&revision.owner.revision_id)
        {
            if let Some(revision) = self.revisions.get_mut(&revision_id) {
                revision.local_spread_count = spreads;
            }
        }
    }
}
