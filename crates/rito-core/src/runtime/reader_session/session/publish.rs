//! Minting a reader artifact from a spread on a live revision: the
//! publication path reads the spread's durable reading anchor back off the
//! page, the chapter-local paths take an already-resolved target. Each
//! increments the revision's artifact reference count and records the
//! artifact's ownership.

use crate::runtime::RuntimePageReadingAnchor;

use super::{
    build_reader_artifact,
    errors::{
        engine_error, missing_artifact_revision, numeric_overflow, take_identity,
        target_not_published,
    },
    project::{artifact_owner, locator_precision, publication_navigation, reader_navigation},
    published_spread_target, ArtifactIdentity, ReaderArtifact, ReaderError, ReaderErrorKind,
    ReaderRevisionBacking, ReaderSession, ResolvedArtifactOwner, ResolvedArtifactTarget,
};

impl ReaderSession {
    pub(super) fn publish_publication_artifact(
        &mut self,
        revision_id: u64,
        spread_index: usize,
        request_id: u64,
    ) -> Result<ReaderArtifact, ReaderError> {
        let (owner, navigation) = {
            let revision = self
                .publication_revisions
                .get(&revision_id)
                .ok_or_else(|| missing_artifact_revision(ReaderRevisionBacking::Publication))?;
            (
                revision.owner.clone(),
                publication_navigation(revision, spread_index),
            )
        };
        let page_indexes = self
            .document
            .spread_page_indexes_at(&owner, spread_index)
            .map_err(engine_error)?
            .value;
        let page_index = page_indexes.first().copied().ok_or_else(|| {
            target_not_published("published publication spread contains no pages")
        })?;
        let anchor = self
            .document
            .get_page_reading_anchor_at(&owner, page_index)
            .map_err(engine_error)?
            .value;
        let RuntimePageReadingAnchor::Resolved {
            locator,
            page_index,
            spread_index: resolved_spread_index,
            ..
        } = anchor
        else {
            return Err(target_not_published(
                "published publication spread has no durable reading anchor",
            ));
        };
        if resolved_spread_index != spread_index {
            return Err(ReaderError::new(
                ReaderErrorKind::EngineFailure,
                "publication reading anchor resolved to a different spread",
            ));
        }
        let target = ResolvedArtifactTarget {
            owner: ResolvedArtifactOwner::Publication(owner),
            matched_by: locator_precision(&locator),
            locator,
            local_page_index: page_index,
            local_spread_index: spread_index,
        };
        let artifact_id = take_identity(&mut self.next_artifact_id, "artifactId")?;
        let artifact = build_reader_artifact(
            &mut self.document,
            ArtifactIdentity {
                session_id: self.session_id,
                request_id,
                revision_id,
                artifact_id,
            },
            &target,
            navigation,
            self.render_ratio,
        )?;
        let artifact_owner = artifact_owner(
            revision_id,
            ReaderRevisionBacking::Publication,
            spread_index,
            &artifact,
        );
        let revision = self
            .publication_revisions
            .get_mut(&revision_id)
            .ok_or_else(|| missing_artifact_revision(ReaderRevisionBacking::Publication))?;
        revision.artifact_ref_count = revision
            .artifact_ref_count
            .checked_add(1)
            .ok_or_else(|| numeric_overflow("artifact reference count"))?;
        self.artifacts.insert(artifact_id, artifact_owner);
        Ok(artifact)
    }

    pub(super) fn publish_revision_artifact(
        &mut self,
        revision_id: u64,
        local_spread_index: usize,
        request_id: u64,
    ) -> Result<ReaderArtifact, ReaderError> {
        let revision = self.revisions.get(&revision_id).ok_or_else(|| {
            ReaderError::new(
                ReaderErrorKind::EngineFailure,
                "artifact revision ownership is missing",
            )
        })?;
        let target = published_spread_target(&self.document, &revision.owner, local_spread_index)?;
        self.publish_resolved_revision_artifact(revision_id, target, request_id)
    }

    pub(super) fn publish_resolved_revision_artifact(
        &mut self,
        revision_id: u64,
        target: ResolvedArtifactTarget,
        request_id: u64,
    ) -> Result<ReaderArtifact, ReaderError> {
        let revision = self.revisions.get(&revision_id).ok_or_else(|| {
            ReaderError::new(
                ReaderErrorKind::EngineFailure,
                "artifact revision ownership is missing",
            )
        })?;
        let local_spread_index = target.local_spread_index;
        let navigation = reader_navigation(&self.document, revision, local_spread_index);
        let artifact_id = take_identity(&mut self.next_artifact_id, "artifactId")?;
        let artifact = build_reader_artifact(
            &mut self.document,
            ArtifactIdentity {
                session_id: self.session_id,
                request_id,
                revision_id,
                artifact_id,
            },
            &target,
            navigation,
            self.render_ratio,
        )?;
        let artifact_owner = artifact_owner(
            revision_id,
            ReaderRevisionBacking::ChapterLocal,
            local_spread_index,
            &artifact,
        );
        let revision = self.revisions.get_mut(&revision_id).ok_or_else(|| {
            ReaderError::new(
                ReaderErrorKind::EngineFailure,
                "artifact revision ownership is missing",
            )
        })?;
        revision.artifact_ref_count = revision
            .artifact_ref_count
            .checked_add(1)
            .ok_or_else(|| numeric_overflow("artifact reference count"))?;
        self.artifacts.insert(artifact_id, artifact_owner);
        Ok(artifact)
    }
}
