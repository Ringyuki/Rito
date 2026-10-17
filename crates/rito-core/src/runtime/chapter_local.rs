mod access;
mod model;
mod preflight;
mod publish;

use crate::runtime::{
    source_locator::PaginationTarget, RuntimeChapterLocalRevisionError,
    RuntimeChapterLocalRevisionRequest, RuntimeCreatedChapterLocalRevision, RuntimeDocument,
    RuntimeRevisionErrorKind,
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
        self.create_paginated_chapter_local_revision(request, false)
    }

    /// [`Self::create_chapter_local_revision`], paginating the chapter only
    /// as far as its target needs: through the spread the target lands on
    /// and the page after it, so the revision knows whether a spread
    /// follows. Its pages are the first pages of the whole chapter's, and
    /// the target lands where it would among all of them; the rest
    /// paginates when the revision is extended
    /// ([`Self::extend_chapter_local_revision`]).
    pub(in crate::runtime) fn create_settled_chapter_local_revision(
        &mut self,
        request: RuntimeChapterLocalRevisionRequest,
    ) -> Result<RuntimeCreatedChapterLocalRevision, RuntimeChapterLocalRevisionError> {
        self.create_paginated_chapter_local_revision(request, true)
    }

    fn create_paginated_chapter_local_revision(
        &mut self,
        request: RuntimeChapterLocalRevisionRequest,
        settled: bool,
    ) -> Result<RuntimeCreatedChapterLocalRevision, RuntimeChapterLocalRevisionError> {
        let prepared = prepare_chapter_local_revision(self, request)?;
        let target = if settled {
            self.pagination_target(&prepared.target_locator)
        } else {
            PaginationTarget::Whole
        };
        let built = self
            .build_chapter_local_fragment_layout(
                &prepared.layout_config,
                prepared.coordinate.chapter_index,
                &target,
            )
            .map_err(engine_failure)?;
        self.publish_chapter_local_revision(prepared, built)
    }

    /// Paginates more of a chapter-local revision's chapter: until it holds
    /// `pages` pages, or with `None` to the chapter's end. A revision whose
    /// chapter is paginated through is left as it is.
    pub(in crate::runtime) fn extend_chapter_local_revision(
        &mut self,
        revision_id: &str,
        pages: Option<usize>,
    ) -> Result<(), RuntimeChapterLocalRevisionError> {
        let revision = self
            .chapter_local_revisions
            .get_mut(revision_id)
            .ok_or_else(|| RuntimeChapterLocalRevisionError {
                kind: RuntimeRevisionErrorKind::UnknownRevision,
                message: format!("unknown chapter-local revision {revision_id}"),
                pending_shards: Vec::new(),
            })?;
        if revision.fragment_layout.is_complete() {
            return Ok(());
        }
        revision
            .fragment_layout
            .extend_chapter(pages)
            .map_err(|error| engine_failure(error.message().to_owned()))?;
        revision.refresh_extent();
        Ok(())
    }

    /// Paginates a chapter-local revision's chapter through the spread at
    /// `spread` and the page after it: the spread holds all its pages, and
    /// whether a spread follows it is known.
    pub(in crate::runtime) fn paginate_chapter_local_through_spread(
        &mut self,
        revision_id: &str,
        spread: usize,
    ) -> Result<(), RuntimeChapterLocalRevisionError> {
        let Some(revision) = self.chapter_local_revisions.get(revision_id) else {
            return self.extend_chapter_local_revision(revision_id, None);
        };
        let last = crate::runtime::spread::spread_last_page(&revision.layout_config, spread);
        self.extend_chapter_local_revision(revision_id, Some(last.saturating_add(2)))
    }

    /// The spreads a chapter-local revision's pages so far make.
    pub(in crate::runtime) fn chapter_local_spread_count(
        &self,
        revision_id: &str,
    ) -> Option<usize> {
        self.chapter_local_revisions
            .get(revision_id)
            .map(|revision| revision.extent.spread_count)
    }

    /// Paginates a chapter-local revision's chapter until `locator` lands
    /// on the page it would among all of the chapter's pages. A locator in
    /// another chapter, or one placed only against the whole chapter, is
    /// left to its resolution.
    pub(in crate::runtime) fn settle_chapter_local_revision(
        &mut self,
        revision_id: &str,
        locator: &crate::runtime::RuntimeSourceLocator,
    ) -> Result<(), RuntimeChapterLocalRevisionError> {
        if self.chapter_local_revision_is_complete(revision_id) {
            return Ok(());
        }
        let Some(spine_idref) = self.locator_spine_idref(locator) else {
            return Ok(());
        };
        let target = self.pagination_target(locator);
        if target == PaginationTarget::Whole {
            return self.extend_chapter_local_revision(revision_id, None);
        }
        let Some(revision) = self.chapter_local_revisions.get_mut(revision_id) else {
            return Ok(());
        };
        if revision
            .fragment_layout
            .chapters()
            .all(|(chapter, _)| chapter.idref != spine_idref)
        {
            return Ok(());
        }
        let index = self.source_chapter_indices.get(&spine_idref);
        revision
            .fragment_layout
            .settle_chapter(|starts, resumes_at| target.settled_after(starts, resumes_at, index))
            .map_err(|error| engine_failure(error.message().to_owned()))?;
        revision.refresh_extent();
        Ok(())
    }

    /// Whether a chapter-local revision's whole chapter is paginated.
    pub(in crate::runtime) fn chapter_local_revision_is_complete(&self, revision_id: &str) -> bool {
        self.chapter_local_revisions
            .get(revision_id)
            .is_none_or(|revision| revision.fragment_layout.is_complete())
    }
}

fn engine_failure(message: String) -> RuntimeChapterLocalRevisionError {
    RuntimeChapterLocalRevisionError {
        kind: RuntimeRevisionErrorKind::EngineFailure,
        message,
        pending_shards: Vec::new(),
    }
}
