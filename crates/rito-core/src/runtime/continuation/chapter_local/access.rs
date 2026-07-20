use crate::runtime::{
    frame::RuntimeRevision, metadata::layout_key, RuntimeChapterLocalFrame,
    RuntimeChapterLocalRevisionCursor, RuntimeChapterLocalRevisionError,
    RuntimeChapterLocalRevisionExtent, RuntimeChapterLocalRevisionHandle,
    RuntimeChapterLocalRevisionSummary, RuntimeChapterLocalSourceLocatorResolution,
    RuntimeContinuationErrorKind, RuntimeDocument, RuntimeFrameCommandBufferMetadata,
    RuntimeResource, RuntimeResourceKind, RuntimeRevisionStatus, RuntimeSourceLocator,
};

use super::model::{
    chapter_local_owner, chapter_local_summary, local_engine_error, local_error,
    local_error_from_source, local_extent, local_locator_resolution, local_unknown_revision,
};

impl RuntimeDocument {
    pub fn get_chapter_local_revision_summary(
        &self,
        owner: &RuntimeChapterLocalRevisionHandle,
    ) -> Result<RuntimeChapterLocalRevisionSummary, RuntimeChapterLocalRevisionError> {
        let revision = self.require_chapter_local_owner(owner)?;
        let key = layout_key(&revision.layout_config, &self.pinned_font_policy)
            .map_err(local_engine_error)?;
        Ok(chapter_local_summary(owner, &key, revision))
    }

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

    pub fn get_chapter_local_frame(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
        local_spread_index: usize,
    ) -> Result<RuntimeChapterLocalFrame, RuntimeChapterLocalRevisionError> {
        self.require_chapter_local_owner(owner)?;
        let frame = self
            .get_chapter_local_frame_inner(&owner.revision_id, local_spread_index)
            .map_err(local_engine_error)?;
        Ok(RuntimeChapterLocalFrame {
            owner: owner.clone(),
            local_spread_index: frame.spread_index,
            local_page_indexes: frame.page_indexes,
            width: frame.width,
            height: frame.height,
            commands: frame.commands,
            command_count: frame.command_count,
            command_counts: frame.command_counts,
            command_hash: frame.command_hash,
            resource_refs: frame.resource_refs,
            font_families: frame.font_families,
            image_dominated: frame.image_dominated,
        })
    }

    pub fn release_chapter_local_revision(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
    ) -> Result<bool, RuntimeChapterLocalRevisionError> {
        self.require_chapter_local_owner(owner)?;
        Ok(self.remove_chapter_local_revision(&owner.revision_id))
    }

    /// Retires a window without placing its owners on the cooperative queue.
    /// Reader v1 uses this for unpublished locator-scan windows and for an
    /// unreferenced retained neighbor, preventing a rollover chain from being
    /// replaced by an equally unbounded cleanup backlog.
    pub(in crate::runtime) fn release_chapter_local_revision_immediately(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
    ) -> Result<bool, RuntimeChapterLocalRevisionError> {
        self.require_chapter_local_owner(owner)?;
        let revision = self
            .chapter_local_revisions
            .remove(&owner.revision_id)
            .expect("validated provisional revision exists");
        if let Some(continuation) = self.continuations.remove_revision(&owner.revision_id) {
            super::super::PendingRuntimeContinuationRecordCleanup::new(continuation).drain();
        }
        crate::runtime::cleanup::PendingRuntimeRevisionCleanup::new(revision).drain();
        Ok(true)
    }

    pub fn get_chapter_local_frame_command_buffer_metadata(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
        local_spread_index: usize,
    ) -> Result<RuntimeFrameCommandBufferMetadata, RuntimeChapterLocalRevisionError> {
        self.require_chapter_local_owner(owner)?;
        self.get_chapter_local_frame_command_buffer_metadata_inner(
            &owner.revision_id,
            local_spread_index,
        )
        .map_err(local_engine_error)
    }

    pub fn read_chapter_local_frame_command_buffer(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
        local_spread_index: usize,
    ) -> Result<Vec<u8>, RuntimeChapterLocalRevisionError> {
        self.require_chapter_local_owner(owner)?;
        self.read_chapter_local_frame_command_buffer_inner(&owner.revision_id, local_spread_index)
            .map_err(local_engine_error)
    }

    pub fn get_chapter_local_frame_image_resource_hrefs(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
        local_spread_index: usize,
    ) -> Result<Vec<String>, RuntimeChapterLocalRevisionError> {
        self.require_chapter_local_owner(owner)?;
        self.get_chapter_local_frame_image_resource_hrefs_inner(
            &owner.revision_id,
            local_spread_index,
        )
        .map_err(local_engine_error)
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
                RuntimeContinuationErrorKind::ChapterLocalOwnerMismatch,
                "chapter-local handle coordinate does not own the revision",
            ));
        }
        Ok(revision)
    }

    pub(super) fn require_chapter_local_continuable(
        &self,
        owner: &RuntimeChapterLocalRevisionHandle,
    ) -> Result<RuntimeChapterLocalRevisionExtent, RuntimeChapterLocalRevisionError> {
        let revision = self.require_chapter_local_owner(owner)?;
        if !matches!(
            revision.status,
            RuntimeRevisionStatus::Warming | RuntimeRevisionStatus::Ready
        ) {
            return Err(local_error(
                RuntimeContinuationErrorKind::RevisionNotContinuable,
                format!(
                    "chapter-local revision is not continuable: {:?}",
                    revision.status
                ),
            ));
        }
        Ok(local_extent(revision.known_extent))
    }

    pub(super) fn require_chapter_local_appendable(
        &self,
        owner: &RuntimeChapterLocalRevisionHandle,
    ) -> Result<RuntimeChapterLocalRevisionExtent, RuntimeChapterLocalRevisionError> {
        let extent = self.require_chapter_local_continuable(owner)?;
        let revision = self.require_chapter_local_owner(owner)?;
        let crate::runtime::frame::RuntimeRevisionCoordinateSpace::ChapterLocal {
            page_cap_reached,
            ..
        } = revision.coordinate_space
        else {
            unreachable!("chapter-local store contains chapter-local revisions");
        };
        if page_cap_reached {
            return Err(local_error(
                RuntimeContinuationErrorKind::RevisionNotContinuable,
                "sealed chapter-local page-cap window requires rollover",
            ));
        }
        Ok(extent)
    }

    pub(super) fn require_chapter_local_cursor(
        &self,
        cursor: &RuntimeChapterLocalRevisionCursor,
    ) -> Result<(), RuntimeChapterLocalRevisionError> {
        let record = self.continuations.get(&cursor.cursor).ok_or_else(|| {
            local_error(
                RuntimeContinuationErrorKind::UnknownCursor,
                format!("unknown or consumed continuation cursor: {}", cursor.cursor),
            )
        })?;
        if record.revision_id != cursor.owner.revision_id
            || record.revision_version != cursor.owner.revision_version
        {
            return Err(local_error(
                RuntimeContinuationErrorKind::CursorOwnerMismatch,
                "chapter-local cursor does not belong to the requested revision version",
            ));
        }
        if record.chapter_local_target.as_ref() != Some(&cursor.target_locator) {
            return Err(local_error(
                RuntimeContinuationErrorKind::ChapterLocalTargetMismatch,
                "chapter-local continuation target does not match its original locator",
            ));
        }
        Ok(())
    }
}

fn stale_local_revision(
    revision: &RuntimeRevision,
    owner: &RuntimeChapterLocalRevisionHandle,
) -> RuntimeChapterLocalRevisionError {
    local_error(
        RuntimeContinuationErrorKind::StaleRevisionVersion,
        format!(
            "stale chapter-local revision version: expected {}, got {}",
            revision.revision_version, owner.revision_version
        ),
    )
}
