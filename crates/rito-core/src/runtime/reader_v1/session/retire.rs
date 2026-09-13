//! Releasing revision ownership when the last artifact on a revision goes:
//! the reference-count decrements for chapter-local and publication
//! artifacts, and the retirement of a revision from the runtime document.

use super::{
    errors::{engine_error, invalid_artifact_reference_count, missing_artifact_revision},
    ReaderArtifactOwnerV1, ReaderErrorKindV1, ReaderErrorV1, ReaderRevisionBackingV1,
    ReaderSessionV1,
};

impl ReaderSessionV1 {
    pub(super) fn release_chapter_local_artifact_owner(
        &mut self,
        artifact: &ReaderArtifactOwnerV1,
    ) -> Result<(), ReaderErrorV1> {
        let revision = self
            .revisions
            .get(&artifact.revision_id)
            .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::ChapterLocal))?;
        if revision.artifact_ref_count == 0 {
            return Err(invalid_artifact_reference_count());
        }
        let retire_revision = revision.artifact_ref_count == 1;
        self.revisions
            .get_mut(&artifact.revision_id)
            .expect("chapter-local revision existence was checked")
            .artifact_ref_count -= 1;
        if retire_revision {
            if let Err(error) = self.retire_reader_revision(artifact.revision_id) {
                self.revisions
                    .get_mut(&artifact.revision_id)
                    .expect("failed retirement keeps the chapter-local revision")
                    .artifact_ref_count = 1;
                return Err(error);
            }
        }
        Ok(())
    }

    pub(super) fn release_publication_artifact_owner(
        &mut self,
        artifact: &ReaderArtifactOwnerV1,
    ) -> Result<(), ReaderErrorV1> {
        let revision = self
            .publication_revisions
            .get(&artifact.revision_id)
            .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::Publication))?;
        if revision.artifact_ref_count == 0 {
            return Err(invalid_artifact_reference_count());
        }
        let retire_revision = revision.artifact_ref_count == 1
            && self.active_publication_revision_id != Some(artifact.revision_id);
        self.publication_revisions
            .get_mut(&artifact.revision_id)
            .expect("publication revision existence was checked")
            .artifact_ref_count -= 1;
        if retire_revision {
            if let Err(error) = self.retire_publication_revision(artifact.revision_id) {
                self.publication_revisions
                    .get_mut(&artifact.revision_id)
                    .expect("failed retirement keeps the publication revision")
                    .artifact_ref_count = 1;
                return Err(error);
            }
        }
        Ok(())
    }

    pub(super) fn retire_reader_revision(&mut self, revision_id: u64) -> Result<(), ReaderErrorV1> {
        let revision = self.revisions.get(&revision_id).ok_or_else(|| {
            ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
                "reader revision ownership is missing during retirement",
            )
        })?;
        if revision.artifact_ref_count != 0 {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
                "cannot retire a reader revision with live artifacts",
            ));
        }
        let owner = revision.owner.clone();
        self.document
            .release_chapter_local_revision(&owner)
            .map_err(engine_error)?;
        self.revisions.remove(&revision_id);
        Ok(())
    }

    pub(super) fn retire_publication_revision(
        &mut self,
        revision_id: u64,
    ) -> Result<(), ReaderErrorV1> {
        let revision = self
            .publication_revisions
            .get(&revision_id)
            .ok_or_else(|| missing_artifact_revision(ReaderRevisionBackingV1::Publication))?;
        if revision.artifact_ref_count != 0 {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
                "cannot retire a publication revision with live artifacts",
            ));
        }
        let owner = revision.owner.clone();
        let released = self
            .document
            .release_revision_at(&owner)
            .map_err(engine_error)?;
        if !released {
            return Err(ReaderErrorV1::new(
                ReaderErrorKindV1::EngineFailure,
                "publication revision owner was already released",
            ));
        }
        self.publication_revisions.remove(&revision_id);
        if self.active_publication_revision_id == Some(revision_id) {
            self.active_publication_revision_id = None;
        }
        Ok(())
    }
}
