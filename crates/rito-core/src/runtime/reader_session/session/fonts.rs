//! The session's fonts: the catalog a host builds its font choices from,
//! host faces added and removed while the session is open, and the names
//! a `font-family` choice would skip.

use crate::runtime::{
    RuntimeFontCatalog, RuntimePinnedFontFaceInput, RuntimePinnedFontPolicySummary,
};

use super::{ReaderError, ReaderErrorKind, ReaderSession};

impl ReaderSession {
    /// Every family a `font-family` list can name in this publication.
    pub fn font_catalog(&self) -> RuntimeFontCatalog {
        self.document.font_catalog()
    }

    /// The names in a `font-family` list nothing in the catalog answers to.
    pub fn unresolved_font_families(&self, family_list: &str) -> Vec<String> {
        self.document.unresolved_font_families(family_list)
    }

    /// Adds host faces. Artifacts already published keep their layout; the
    /// next request lays out again with the new faces nameable.
    pub fn add_host_font_faces(
        &mut self,
        faces: Vec<RuntimePinnedFontFaceInput>,
    ) -> Result<RuntimePinnedFontPolicySummary, ReaderError> {
        let summary = self
            .document
            .add_host_font_faces(faces)
            .map_err(invalid_font_request)?;
        self.fonts_changed()?;
        Ok(summary)
    }

    /// Removes host faces by SHA-256; at least one must remain.
    pub fn remove_host_font_faces(
        &mut self,
        sha256s: &[String],
    ) -> Result<RuntimePinnedFontPolicySummary, ReaderError> {
        let summary = self
            .document
            .remove_host_font_faces(sha256s)
            .map_err(invalid_font_request)?;
        self.fonts_changed()?;
        Ok(summary)
    }

    /// Marks publication faces the host cannot paint — its font decoder
    /// refused them — by the family an artifact lists them under, or the
    /// family they declare. A run is measured with the face it is shaped
    /// with, so a face that will be painted with another must not shape:
    /// artifacts already published keep their layout, and the next
    /// request lays out without the faces. A mark lasts for the session.
    pub fn mark_font_families_unavailable(
        &mut self,
        families: &[String],
    ) -> Result<(), ReaderError> {
        self.document.set_unavailable_font_faces(families);
        self.fonts_changed()
    }

    /// No revision laid out before the change serves a later request: the
    /// active publication revision is let go (retired when nothing shows
    /// it) and every revision keeps the generation it was laid out under.
    fn fonts_changed(&mut self) -> Result<(), ReaderError> {
        self.font_generation += 1;
        if let Some(revision_id) = self.active_publication_revision_id.take() {
            let unreferenced = self
                .publication_revisions
                .get(&revision_id)
                .is_some_and(|revision| revision.artifact_ref_count == 0);
            if unreferenced {
                self.retire_publication_revision(revision_id)?;
            }
        }
        Ok(())
    }
}

fn invalid_font_request(error: crate::epub::EpubError) -> ReaderError {
    ReaderError::new(ReaderErrorKind::InvalidRequest, error.message().to_owned())
}
