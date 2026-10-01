//! Reading-position questions for a session: the TOC entry a page or a
//! source position reads under, where a stored locator lands, and the
//! reading order of two positions. Each answer comes from the engine
//! functions a browser revision uses, so no host derives them itself.

use crate::runtime::{
    source_locator::{active_toc_entry, TocTargetPosition},
    RuntimeSourceLocatorError, RuntimeSourceLocatorErrorKind, RuntimeSourceLocatorResolution,
    RuntimeSourcePoint,
};

use super::super::{
    convert::{locator_match, runtime_locator},
    ReaderLocation, ReaderNavigationQuery, ReaderNavigationRequest, ReaderNavigationResult,
    ReaderSourcePoint,
};
use super::{
    errors::{engine_error, validate_external_request_id},
    u32_from_usize, usize_from_u32, ReaderError, ReaderErrorKind, ReaderSession,
};

impl ReaderSession {
    pub fn resolve_navigation(
        &mut self,
        request: ReaderNavigationRequest,
    ) -> Result<ReaderNavigationResult, ReaderError> {
        if request.session_id != self.session_id {
            return Err(ReaderError::new(
                ReaderErrorKind::InvalidSession,
                "navigation request belongs to a different session",
            ));
        }
        match request.query {
            ReaderNavigationQuery::TocEntryAtPage {
                artifact_id,
                page_index,
            } => self.toc_entry_at_page(artifact_id, page_index),
            ReaderNavigationQuery::TocEntryAtPosition { href, point } => {
                let entry = self
                    .document
                    .toc_entry_at_source_position(&href, &runtime_point(point)?)
                    .map_err(position_error)?;
                Ok(ReaderNavigationResult::TocEntry(
                    entry
                        .map(|index| u32_from_usize(index, "toc entry"))
                        .transpose()?,
                ))
            }
            ReaderNavigationQuery::Locate {
                artifact_id,
                locator,
            } => self.locate(artifact_id, locator),
            ReaderNavigationQuery::Compare {
                first_href,
                first,
                second_href,
                second,
            } => {
                let order = self
                    .document
                    .compare_source_positions(
                        (&first_href, &runtime_point(first)?),
                        (&second_href, &runtime_point(second)?),
                    )
                    .map_err(position_error)?;
                Ok(ReaderNavigationResult::Order(order))
            }
        }
    }

    fn toc_entry_at_page(
        &mut self,
        artifact_id: u64,
        page_index: u32,
    ) -> Result<ReaderNavigationResult, ReaderError> {
        validate_external_request_id(artifact_id, "artifactId")?;
        let page_index = usize_from_u32(page_index, "page index")?;
        let laid_out = {
            let view = self.artifact_view(artifact_id)?;
            if page_index >= view.revision.chapter_engine_session().metadata().page_count {
                return Err(ReaderError::new(
                    ReaderErrorKind::InvalidRequest,
                    format!("page {page_index} is not in this artifact's revision"),
                ));
            }
            self.document.laid_out_chapters(view.revision)
        };
        let prepared = self
            .document
            .prepare_toc_targets(|chapter| laid_out.contains(&chapter));
        let view = self.artifact_view(artifact_id)?;
        let positions: Vec<TocTargetPosition> =
            self.document
                .toc_target_positions_in(&view.revision_id, view.revision, &prepared);
        Ok(ReaderNavigationResult::TocEntry(
            active_toc_entry(&positions, page_index)
                .map(|index| u32_from_usize(index, "toc entry"))
                .transpose()?,
        ))
    }

    fn locate(
        &mut self,
        artifact_id: u64,
        locator: super::super::ReaderLocator,
    ) -> Result<ReaderNavigationResult, ReaderError> {
        validate_external_request_id(artifact_id, "artifactId")?;
        let prepared = match self
            .document
            .prepare_source_locator(runtime_locator(locator)?)
        {
            Ok(prepared) => prepared,
            Err(error) if error.kind == RuntimeSourceLocatorErrorKind::SourceUnavailable => {
                return Err(engine_error(error.message));
            }
            Err(_) => {
                return Ok(ReaderNavigationResult::Location(
                    ReaderLocation::Unavailable,
                ))
            }
        };
        let view = self.artifact_view(artifact_id)?;
        let location = match self.document.resolve_prepared_source_locator_in(
            &view.revision_id,
            view.revision,
            &prepared,
        ) {
            RuntimeSourceLocatorResolution::Resolved {
                page_index,
                matched_by,
                ..
            } => ReaderLocation::Page {
                page_index: u32_from_usize(page_index, "located page")?,
                drawn: view.drawn_origin(page_index).is_some(),
                matched_by: locator_match(matched_by),
            },
            RuntimeSourceLocatorResolution::Pending { .. } => ReaderLocation::NotLaidOut,
        };
        Ok(ReaderNavigationResult::Location(location))
    }
}

fn runtime_point(point: ReaderSourcePoint) -> Result<RuntimeSourcePoint, ReaderError> {
    Ok(RuntimeSourcePoint {
        node_path: point
            .node_path
            .into_iter()
            .map(|part| usize_from_u32(part, "source point path"))
            .collect::<Result<_, _>>()?,
        text_offset: usize::try_from(point.text_offset).map_err(|_| {
            ReaderError::new(ReaderErrorKind::NumericOverflow, "source point text offset")
        })?,
    })
}

fn position_error(error: RuntimeSourceLocatorError) -> ReaderError {
    match error.kind {
        RuntimeSourceLocatorErrorKind::SourceUnavailable => engine_error(error.message),
        _ => ReaderError::new(ReaderErrorKind::InvalidRequest, error.message),
    }
}
