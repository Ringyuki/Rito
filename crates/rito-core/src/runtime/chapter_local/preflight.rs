use crate::{
    layout::LayoutConfig,
    runtime::{
        frame::into_chapter_window_layout_config, metadata::layout_key,
        RuntimeChapterLocalCoordinate, RuntimeChapterLocalRevisionError,
        RuntimeChapterLocalRevisionHandle, RuntimeChapterLocalRevisionRequest, RuntimeDocument,
        RuntimeRequiredFontFace, RuntimeRevisionErrorKind, RuntimeSourceLocator,
    },
};

use super::model::{
    chapter_local_coordinate, local_engine_error, local_error, local_error_from_source,
};

/// Everything a chapter-local revision needs besides its page table:
/// gathered before the chapter is paginated, consumed when the revision
/// is inserted.
pub(super) struct PreparedChapterLocalRevision {
    pub(super) revision_id: String,
    pub(super) layout_key: String,
    pub(super) layout_config: LayoutConfig,
    pub(super) coordinate: RuntimeChapterLocalCoordinate,
    pub(super) target_locator: RuntimeSourceLocator,
    pub(super) required_font_face_catalog: Option<Vec<RuntimeRequiredFontFace>>,
}

/// Validates the request and gathers the revision's identity, layout key,
/// layout configuration and font catalog. Nothing is inserted here.
pub(super) fn prepare_chapter_local_revision(
    document: &mut RuntimeDocument,
    request: RuntimeChapterLocalRevisionRequest,
) -> Result<PreparedChapterLocalRevision, RuntimeChapterLocalRevisionError> {
    let RuntimeChapterLocalRevisionRequest {
        layout_config,
        target_chapter_index,
        target_locator,
    } = request;
    let (coordinate, target_locator) =
        document.validate_chapter_local_target(target_chapter_index, target_locator)?;
    let layout_config = into_chapter_window_layout_config(layout_config);
    let revision_id = document.create_revision_id();
    let layout_key =
        layout_key(&layout_config, &document.pinned_font_policy).map_err(local_engine_error)?;
    document
        .ensure_layout_font_resources()
        .map_err(local_engine_error)?;
    let required_font_face_catalog = document.required_font_face_catalog();
    Ok(PreparedChapterLocalRevision {
        revision_id,
        layout_key,
        layout_config,
        coordinate,
        target_locator,
        required_font_face_catalog,
    })
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
}
