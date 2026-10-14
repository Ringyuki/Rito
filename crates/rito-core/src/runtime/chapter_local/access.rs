use crate::runtime::{
    frame::RuntimeRevision, RuntimeChapterLocalRevisionError, RuntimeChapterLocalRevisionHandle,
    RuntimeChapterLocalSourceLocatorResolution, RuntimeDocument, RuntimeResource,
    RuntimeResourceKind, RuntimeRevisionErrorKind, RuntimeSourceLocator,
};

use super::model::{
    chapter_local_owner, local_engine_error, local_error, local_error_from_source,
    local_locator_resolution, local_unknown_revision,
};

impl RuntimeDocument {
    pub fn resolve_chapter_local_source_locator(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
        locator: RuntimeSourceLocator,
    ) -> Result<RuntimeChapterLocalSourceLocatorResolution, RuntimeChapterLocalRevisionError> {
        self.require_chapter_local_owner(owner)?;
        let locator = self.validate_chapter_local_owner_target(owner, locator)?;
        let resolution = self
            .resolve_chapter_local_source_locator_inner(&owner.revision_id, locator)
            .map_err(local_error_from_source)?;
        Ok(local_locator_resolution(owner.clone(), resolution))
    }

    pub fn release_chapter_local_revision(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
    ) -> Result<bool, RuntimeChapterLocalRevisionError> {
        self.require_chapter_local_owner(owner)?;
        Ok(self.remove_chapter_local_revision(&owner.revision_id))
    }

    /// Retires a chapter-local revision without placing its owners on the
    /// cooperative cleanup queue. reader session uses this for unpublished
    /// locator-scan revisions so a burst of seeks cannot pile up a cleanup
    /// backlog.
    pub(in crate::runtime) fn release_chapter_local_revision_immediately(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
    ) -> Result<bool, RuntimeChapterLocalRevisionError> {
        self.require_chapter_local_owner(owner)?;
        let revision = self
            .chapter_local_revisions
            .remove(&owner.revision_id)
            .expect("validated provisional revision exists");
        crate::runtime::cleanup::PendingRuntimeRevisionCleanup::new(revision).drain();
        Ok(true)
    }

    pub fn get_chapter_local_resource(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
        kind: RuntimeResourceKind,
        href: &str,
    ) -> Result<RuntimeResource, RuntimeChapterLocalRevisionError> {
        self.require_chapter_local_owner(owner)?;
        self.get_chapter_local_resource_inner(&owner.revision_id, kind, href)
            .map_err(local_engine_error)
    }

    /// The footnote definition a chapter-local artifact referenced, or
    /// `None` while the publication footnote index has not reached it.
    /// Chapter-local revisions inherit the publication's shared index,
    /// so a definition living in another chapter still resolves.
    pub fn get_chapter_local_footnote(
        &self,
        owner: &RuntimeChapterLocalRevisionHandle,
        key: &str,
    ) -> Result<Option<crate::interaction::FootnoteEntry>, RuntimeChapterLocalRevisionError> {
        let revision = self.require_chapter_local_owner(owner)?;
        Ok(revision.interactions.footnote(key).cloned())
    }

    pub(in crate::runtime) fn require_chapter_local_owner(
        &self,
        owner: &RuntimeChapterLocalRevisionHandle,
    ) -> Result<&RuntimeRevision, RuntimeChapterLocalRevisionError> {
        let revision = self
            .chapter_local_revisions
            .get(&owner.revision_id)
            .ok_or_else(|| local_unknown_revision(&owner.revision_id))?;
        if revision.revision_version != owner.revision_version {
            return Err(stale_local_revision(revision, owner));
        }
        let expected = chapter_local_owner(
            &self.document,
            &owner.revision_id,
            owner.revision_version,
            revision,
        );
        if expected != *owner {
            return Err(local_error(
                RuntimeRevisionErrorKind::ChapterLocalOwnerMismatch,
                "chapter-local handle coordinate does not own the revision",
            ));
        }
        Ok(revision)
    }
}

fn stale_local_revision(
    revision: &RuntimeRevision,
    owner: &RuntimeChapterLocalRevisionHandle,
) -> RuntimeChapterLocalRevisionError {
    local_error(
        RuntimeRevisionErrorKind::StaleRevisionVersion,
        format!(
            "stale chapter-local revision version: expected {}, got {}",
            revision.revision_version, owner.revision_version
        ),
    )
}
