use crate::runtime::{
    frame::{into_chapter_window_layout_config, RuntimeRevision},
    metadata::layout_key,
    RuntimeBoundedChapterLocalRevisionRequest, RuntimeChapterLocalCoordinate,
    RuntimeChapterLocalRevisionError, RuntimeChapterLocalRevisionHandle, RuntimeDocument,
    RuntimeRevisionErrorKind, RuntimeSourceLocator,
};

use super::model::{
    chapter_local_coordinate, local_engine_error, local_error, local_error_from_source,
};

struct ChapterLocalPreflight {
    revision_id: String,
    layout_key: String,
    required_font_face_catalog: Option<Vec<crate::runtime::RuntimeRequiredFontFace>>,
    footnotes: std::collections::BTreeMap<String, crate::interaction::FootnoteEntry>,
}

pub(super) struct InitializedChapterLocalFragment {
    pub(super) revision_id: String,
    pub(super) layout_key: String,
    pub(super) coordinate: RuntimeChapterLocalCoordinate,
    pub(super) target_locator: RuntimeSourceLocator,
}

/// Validation, preflight, and warming-revision insertion for a
/// chapter-local revision. The fragment engine paginates the whole chapter
/// in one pass right after this.
pub(super) fn initialize_chapter_local_fragment(
    document: &mut RuntimeDocument,
    request: RuntimeBoundedChapterLocalRevisionRequest,
) -> Result<InitializedChapterLocalFragment, RuntimeChapterLocalRevisionError> {
    let RuntimeBoundedChapterLocalRevisionRequest {
        layout_config,
        target_chapter_index,
        target_locator,
    } = request;
    let (coordinate, target_locator) =
        document.validate_chapter_local_target(target_chapter_index, target_locator)?;
    let layout_config = into_chapter_window_layout_config(layout_config);
    let preflight = document.preflight_chapter_local_revision(&layout_config)?;
    let ChapterLocalPreflight {
        revision_id,
        layout_key,
        required_font_face_catalog,
        footnotes,
    } = preflight;
    insert_chapter_local_revision(
        document,
        &layout_config,
        &coordinate,
        &revision_id,
        required_font_face_catalog,
        footnotes,
    );
    Ok(InitializedChapterLocalFragment {
        revision_id,
        layout_key,
        coordinate,
        target_locator,
    })
}

fn insert_chapter_local_revision(
    document: &mut RuntimeDocument,
    layout_config: &crate::layout::LayoutConfig,
    coordinate: &RuntimeChapterLocalCoordinate,
    revision_id: &str,
    required_font_face_catalog: Option<Vec<crate::runtime::RuntimeRequiredFontFace>>,
    footnotes: std::collections::BTreeMap<String, crate::interaction::FootnoteEntry>,
) {
    let revision = RuntimeRevision::warming_chapter_local(
        layout_config.clone(),
        required_font_face_catalog,
        initial_revision_interactions(footnotes),
        coordinate.chapter_index,
    );
    document.insert_new_chapter_local_revision(revision_id.to_owned(), revision);
}

impl RuntimeDocument {
    pub(super) fn validate_chapter_local_target(
        &mut self,
        target_chapter_index: usize,
        target_locator: RuntimeSourceLocator,
    ) -> Result<
        (RuntimeChapterLocalCoordinate, RuntimeSourceLocator),
        RuntimeChapterLocalRevisionError,
    > {
        let (chapter_index, locator) = self
            .validate_source_locator_for_chapter_local(target_locator)
            .map_err(local_error_from_source)?;
        if chapter_index != target_chapter_index {
            return Err(local_error(
                RuntimeRevisionErrorKind::InvalidChapterLocalTarget,
                format!(
                    "targetChapterIndex {target_chapter_index} does not match locator chapter {chapter_index}"
                ),
            ));
        }
        let href = self.document.chapters[chapter_index].href.clone();
        Ok((chapter_local_coordinate(chapter_index, href), locator))
    }

    pub(super) fn validate_chapter_local_owner_target(
        &mut self,
        owner: &RuntimeChapterLocalRevisionHandle,
        target_locator: RuntimeSourceLocator,
    ) -> Result<RuntimeSourceLocator, RuntimeChapterLocalRevisionError> {
        let (coordinate, locator) =
            self.validate_chapter_local_target(owner.coordinate.chapter_index, target_locator)?;
        if coordinate != owner.coordinate {
            return Err(local_error(
                RuntimeRevisionErrorKind::ChapterLocalOwnerMismatch,
                "chapter-local locator does not belong to the revision coordinate",
            ));
        }
        Ok(locator)
    }

    fn preflight_chapter_local_revision(
        &mut self,
        layout_config: &crate::layout::LayoutConfig,
    ) -> Result<ChapterLocalPreflight, RuntimeChapterLocalRevisionError> {
        let revision_id = self.create_revision_id();
        let layout_key =
            layout_key(layout_config, &self.pinned_font_policy).map_err(local_engine_error)?;
        self.ensure_layout_font_resources()
            .map_err(local_engine_error)?;
        let required_font_face_catalog = self.required_font_face_catalog();
        Ok(ChapterLocalPreflight {
            revision_id,
            layout_key,
            required_font_face_catalog,
            footnotes: std::collections::BTreeMap::new(),
        })
    }
}

/// The interaction state a chapter-local revision starts with: its own
/// footnote overlay, no publication index yet, materialized (empty)
/// chapter text indices.
fn initial_revision_interactions(
    footnotes: std::collections::BTreeMap<String, crate::interaction::FootnoteEntry>,
) -> crate::runtime::frame::RuntimeRevisionInteractions {
    crate::runtime::frame::RuntimeRevisionInteractions {
        publication_footnotes: None,
        footnotes,
        pending_footnote_keys: crate::interaction::FootnoteTargetSet::default(),
        footnote_index_complete: false,
        chapter_text_indices: crate::runtime::frame::RuntimeChapterTextIndexSource::Materialized(
            std::collections::BTreeMap::new(),
        ),
        completed_chapter_idrefs: std::collections::BTreeSet::new(),
    }
}
