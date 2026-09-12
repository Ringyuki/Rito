use crate::epub::{EpubError, EpubResult};

use super::revision_fonts::required_font_faces_for_revision;
use super::{
    frame::revision_summary,
    metadata::layout_key,
    navigation::{runtime_revision_navigation, runtime_toc_targets},
    RuntimeChapterTextIndices, RuntimeDocument, RuntimeFootnotes, RuntimeRevisionBundle,
    RuntimeRevisionPresentation, RuntimeTocTargets,
};

impl RuntimeDocument {
    pub fn revision_bundle(
        &self,
        revision_id: &str,
        include_toc_targets: bool,
    ) -> EpubResult<RuntimeRevisionBundle> {
        let presentation = self.revision_presentation_with_toc(revision_id, include_toc_targets)?;
        let revision_record = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        Ok(RuntimeRevisionBundle {
            revision: presentation.revision,
            navigation: presentation.navigation,
            toc_targets: presentation.toc_targets,
            footnotes: RuntimeFootnotes {
                revision_id: revision_id.to_owned(),
                complete: revision_record.interactions.footnote_index_complete,
                pending_keys: revision_record
                    .interactions
                    .pending_footnote_keys
                    .iter()
                    .filter(|key| !revision_record.interactions.contains_footnote(key.as_str()))
                    .cloned()
                    .collect(),
                entries: revision_record.interactions.owned_footnotes(),
            },
            chapter_text_indices: RuntimeChapterTextIndices {
                revision_id: revision_id.to_owned(),
                entries: self.chapter_text_indices_for_revision(revision_id)?.clone(),
            },
            font_families: presentation.font_families,
            required_font_faces: presentation.required_font_faces,
        })
    }

    pub fn revision_presentation(
        &self,
        revision_id: &str,
    ) -> EpubResult<RuntimeRevisionPresentation> {
        self.revision_presentation_with_toc(revision_id, true)
    }

    fn revision_presentation_with_toc(
        &self,
        revision_id: &str,
        include_toc_targets: bool,
    ) -> EpubResult<RuntimeRevisionPresentation> {
        let (revision, navigation, toc_targets) =
            self.revision_bundle_navigation(revision_id, include_toc_targets)?;
        let revision_record = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        // Fragment pagination keeps every registered publication face in
        // its paint stacks, so the canvas must load them all.
        let font_families = revision_record
            .required_font_face_catalog
            .as_deref()
            .map(|catalog| {
                let mut families: Vec<String> =
                    catalog.iter().map(|face| face.family.clone()).collect();
                families.sort();
                families.dedup();
                families
            })
            .unwrap_or_default();
        // The fragment engine shapes with its own faces and never asks the
        // host for vertical-metric samples.
        let required_font_faces = revision_record
            .required_font_face_catalog
            .as_deref()
            .map(|catalog| required_font_faces_for_revision(revision_id, catalog, &font_families));
        Ok(RuntimeRevisionPresentation {
            revision,
            navigation,
            toc_targets,
            font_families,
            required_font_faces,
        })
    }

    pub(super) fn revision_bundle_navigation(
        &self,
        revision_id: &str,
        include_toc_targets: bool,
    ) -> EpubResult<(
        super::RuntimeRevisionSummary,
        super::RuntimeRevisionNavigation,
        RuntimeTocTargets,
    )> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        let key = layout_key(&revision.layout_config, &self.pinned_font_policy)?;
        let summary = revision_summary(revision_id, &key, revision);
        let navigation = runtime_revision_navigation(revision_id, &self.document, revision);
        let toc_targets = if include_toc_targets {
            runtime_toc_targets(revision_id, &self.document, revision)
        } else {
            RuntimeTocTargets {
                revision_id: revision_id.to_owned(),
                targets: Vec::new(),
            }
        };
        Ok((summary, navigation, toc_targets))
    }
}
