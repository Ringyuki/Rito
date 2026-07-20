use std::num::NonZeroUsize;

use crate::{
    layout::create_empty_runtime_layout,
    runtime::{
        frame::{into_chapter_window_layout_config, RuntimeRevision},
        metadata::layout_key,
        RuntimeBoundedChapterLocalRevisionRequest, RuntimeChapterLocalCoordinate,
        RuntimeChapterLocalRevisionError, RuntimeChapterLocalRevisionExtent,
        RuntimeChapterLocalRevisionHandle, RuntimeContinuationErrorKind,
        RuntimeContinueChapterLocalRevisionRequest, RuntimeContinueRevisionRequest,
        RuntimeDocument, RuntimeRevisionWorkBudget, RuntimeRolloverChapterLocalRevisionRequest,
        RuntimeSourceLocator,
    },
};

use super::{
    super::{publish::initial_revision_interactions, RuntimeContinuationRecord},
    model::{
        chapter_local_coordinate, checked_local_budget, local_engine_error, local_error,
        local_error_from_continuation, local_error_from_source, validate_local_page_cap,
    },
};

pub(super) struct InitializedChapterLocalRevision {
    pub(super) record: RuntimeContinuationRecord,
    pub(super) budget: NonZeroUsize,
    pub(super) coordinate: RuntimeChapterLocalCoordinate,
    pub(super) target_locator: RuntimeSourceLocator,
}

pub(super) struct PreparedChapterLocalContinuation {
    pub(super) record: RuntimeContinuationRecord,
    pub(super) budget: NonZeroUsize,
    pub(super) previous_extent: RuntimeChapterLocalRevisionExtent,
    pub(super) revision_id: String,
    pub(super) target_locator: RuntimeSourceLocator,
}

pub(super) struct InitializedChapterLocalRollover {
    pub(super) record: RuntimeContinuationRecord,
    pub(super) budget: NonZeroUsize,
    pub(super) coordinate: RuntimeChapterLocalCoordinate,
    pub(super) target_locator: RuntimeSourceLocator,
}

pub(super) fn prepare_chapter_local_continuation(
    document: &mut RuntimeDocument,
    request: RuntimeContinueChapterLocalRevisionRequest,
) -> Result<PreparedChapterLocalContinuation, RuntimeChapterLocalRevisionError> {
    let budget = checked_local_budget(request.budget)?;
    let continuation = request.continuation;
    let previous_extent = document.require_chapter_local_appendable(&continuation.owner)?;
    document.require_chapter_local_cursor(&continuation)?;
    let target_locator = document
        .validate_chapter_local_owner_target(&continuation.owner, continuation.target_locator)?;
    let revision_id = continuation.owner.revision_id.clone();
    let generic_request = RuntimeContinueRevisionRequest {
        revision_id: revision_id.clone(),
        revision_version: continuation.owner.revision_version,
        cursor: continuation.cursor,
        budget: RuntimeRevisionWorkBudget {
            max_top_level_nodes: budget.get(),
        },
    };
    let record = document
        .take_continuation(&generic_request)
        .map_err(local_error_from_continuation)?;
    Ok(PreparedChapterLocalContinuation {
        record,
        budget,
        previous_extent,
        revision_id,
        target_locator,
    })
}

pub(super) fn initialize_chapter_local_rollover(
    document: &mut RuntimeDocument,
    request: RuntimeRolloverChapterLocalRevisionRequest,
) -> Result<InitializedChapterLocalRollover, RuntimeChapterLocalRevisionError> {
    let budget = checked_local_budget(request.budget)?;
    let continuation = request.continuation;
    document.require_chapter_local_continuable(&continuation.owner)?;
    document.require_chapter_local_cursor(&continuation)?;
    let target_locator = document.validate_chapter_local_owner_target(
        &continuation.owner,
        continuation.target_locator.clone(),
    )?;
    let (layout_config, required_font_face_catalog, interactions, local_page_cap, coordinate) = {
        let revision = document.require_chapter_local_owner(&continuation.owner)?;
        let crate::runtime::frame::RuntimeRevisionCoordinateSpace::ChapterLocal {
            local_page_cap,
            page_cap_reached,
            ..
        } = revision.coordinate_space
        else {
            unreachable!("chapter-local store contains chapter-local revisions");
        };
        if !page_cap_reached || revision.final_extent.is_some() {
            return Err(local_error(
                RuntimeContinuationErrorKind::RevisionNotContinuable,
                "chapter-local rollover requires a non-terminal sealed page-cap window",
            ));
        }
        (
            revision.layout_config.clone(),
            revision.required_font_face_catalog.clone(),
            revision.interactions.clone(),
            local_page_cap,
            continuation.owner.coordinate.clone(),
        )
    };
    let generic_request = RuntimeContinueRevisionRequest {
        revision_id: continuation.owner.revision_id,
        revision_version: continuation.owner.revision_version,
        cursor: continuation.cursor,
        budget: RuntimeRevisionWorkBudget {
            max_top_level_nodes: budget.get(),
        },
    };
    let mut record = document
        .take_continuation(&generic_request)
        .map_err(local_error_from_continuation)?;
    debug_assert!(record.reached_local_page_cap());
    let revision_id = document.create_revision_id();
    record.rollover_chapter_local_window(revision_id.clone());
    let layout = create_empty_runtime_layout(1, &layout_config);
    let revision = RuntimeRevision::warming_chapter_local(
        layout,
        layout_config,
        required_font_face_catalog,
        interactions,
        coordinate.chapter_index,
        local_page_cap,
    );
    document.insert_new_chapter_local_revision(revision_id, revision);
    Ok(InitializedChapterLocalRollover {
        record,
        budget,
        coordinate,
        target_locator,
    })
}

struct ChapterLocalPreflight {
    revision_id: String,
    layout_key: String,
    required_font_face_catalog: Option<Vec<crate::runtime::RuntimeRequiredFontFace>>,
    footnotes: std::collections::BTreeMap<String, crate::interaction::FootnoteEntry>,
}

pub(super) fn initialize_chapter_local_revision(
    document: &mut RuntimeDocument,
    request: RuntimeBoundedChapterLocalRevisionRequest,
) -> Result<InitializedChapterLocalRevision, RuntimeChapterLocalRevisionError> {
    let RuntimeBoundedChapterLocalRevisionRequest {
        layout_config,
        line_breaking,
        target_chapter_index,
        target_locator,
        local_page_cap,
        budget,
    } = request;
    let budget = checked_local_budget(budget)?;
    validate_local_page_cap(&layout_config, local_page_cap)?;
    let (coordinate, target_locator) =
        document.validate_chapter_local_target(target_chapter_index, target_locator)?;
    let layout_config = into_chapter_window_layout_config(layout_config);
    let (layout_config, preflight) = document.run_with_owned_layout_config(
        layout_config,
        RuntimeDocument::preflight_chapter_local_revision,
    )?;
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
        local_page_cap,
        &revision_id,
        required_font_face_catalog,
        footnotes,
    );
    let record = RuntimeContinuationRecord::new_chapter_local(
        revision_id,
        layout_key,
        layout_config,
        line_breaking,
        coordinate.chapter_index,
        local_page_cap,
        target_locator.clone(),
    );
    Ok(InitializedChapterLocalRevision {
        record,
        budget,
        coordinate,
        target_locator,
    })
}

fn insert_chapter_local_revision(
    document: &mut RuntimeDocument,
    layout_config: &crate::layout::LayoutConfig,
    coordinate: &RuntimeChapterLocalCoordinate,
    local_page_cap: usize,
    revision_id: &str,
    required_font_face_catalog: Option<Vec<crate::runtime::RuntimeRequiredFontFace>>,
    footnotes: std::collections::BTreeMap<String, crate::interaction::FootnoteEntry>,
) {
    let layout = create_empty_runtime_layout(1, layout_config);
    let revision = RuntimeRevision::warming_chapter_local(
        layout,
        layout_config.clone(),
        required_font_face_catalog,
        initial_revision_interactions(footnotes),
        coordinate.chapter_index,
        local_page_cap,
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
                RuntimeContinuationErrorKind::InvalidChapterLocalTarget,
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
                RuntimeContinuationErrorKind::ChapterLocalOwnerMismatch,
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
        self.ensure_layout_font_resources(layout_config)
            .map_err(local_engine_error)?;
        let required_font_face_catalog = self.required_font_face_catalog_for_layout(layout_config);
        Ok(ChapterLocalPreflight {
            revision_id,
            layout_key,
            required_font_face_catalog,
            footnotes: std::collections::BTreeMap::new(),
        })
    }
}
