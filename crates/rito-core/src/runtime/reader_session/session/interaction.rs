//! Text selection and annotation targets for a session's artifacts.
//!
//! Both run the resolvers the web reader runs: a text interaction goes
//! through the artifact's revision exactly as a browser revision does, and
//! an annotation target is built and located by the same source cascade.
//! The only work here is moving points and geometry between an artifact's
//! display-list space and its pages, and keeping rectangles to the pages
//! the artifact draws.

use crate::{
    interaction::{
        TextCaretAddress, TextCaretAffinity, TextInteractionUnavailableReason,
        TextSelectionBoundary, TextSelectionMovement,
    },
    runtime::{
        annotation_target_from_json, annotation_target_to_json, AnnotationOrphanReason,
        AnnotationTargetResolution, RuntimeExactTextRangeRect, RuntimeRevision,
        RuntimeSourceLocatorErrorKind, RuntimeTextCaret, RuntimeTextCaretResolution,
        RuntimeTextPointRequest, RuntimeTextRange, RuntimeTextRangeFromPointsRequest,
        RuntimeTextRangeFromPointsResolution, RuntimeTextRangeRequest, RuntimeTextRangeResolution,
        RuntimeTextRangeToPointRequest, RuntimeTextSelectionGranularity,
        RuntimeTextSelectionMovementRequest, RuntimeTextSelectionMovementResolution,
    },
};

use super::super::{
    artifact::page_origin,
    convert::{reader_source_point, runtime_source_range},
    ReaderAnnotationLevel, ReaderAnnotationQuery, ReaderAnnotationRequest,
    ReaderAnnotationResponse, ReaderCaret, ReaderCaretAddress, ReaderCaretAffinity,
    ReaderCaretGeometry, ReaderSelectionBoundary, ReaderSelectionGranularity,
    ReaderSelectionMovement, ReaderSelectionResult, ReaderTextInteractionQuery,
    ReaderTextInteractionRequest, ReaderTextInteractionResponse, ReaderTextInteractionResult,
    ReaderTextInteractionUnavailableReason, ReaderTextPoint, ReaderTextSelection,
};
use super::{
    content::page_display_origin,
    errors::{
        engine_error, missing_artifact_revision, unknown_artifact, validate_external_request_id,
    },
    u32_from_usize, usize_from_u32, ReaderError, ReaderErrorKind, ReaderExactSourceRect,
    ReaderRect, ReaderRevisionBacking, ReaderSession, ReaderTextPosition,
};

/// The revision behind an artifact and the spread of it the artifact draws.
struct ArtifactView<'a> {
    revision_id: String,
    revision: &'a RuntimeRevision,
    spread_index: usize,
}

impl ArtifactView<'_> {
    fn page_point(&self, point: ReaderTextPoint) -> Result<RuntimeTextPointRequest, ReaderError> {
        let page_index = usize_from_u32(point.page_index, "text point page index")?;
        let origin = page_display_origin(self.revision, self.spread_index, page_index)?;
        Ok(RuntimeTextPointRequest {
            page_index,
            x: point.x - origin.0,
            y: point.y - origin.1,
        })
    }

    /// The display-list origin of a page, when this artifact draws it.
    fn drawn_origin(&self, page_index: usize) -> Option<(f64, f64)> {
        let pages = self
            .revision
            .chapter_engine_session()
            .spread_pages(self.spread_index)?;
        let slot = pages.iter().position(|index| *index == page_index)?;
        Some(page_origin(&self.revision.layout_config, slot))
    }

    fn caret(&self, caret: RuntimeTextCaret) -> Result<ReaderCaret, ReaderError> {
        let source_point = caret
            .source_locator
            .source_point
            .ok_or_else(|| engine_error("a resolved caret carries no source point"))?;
        Ok(ReaderCaret {
            address: reader_address(caret.address)?,
            geometry: self.drawn_origin(caret.address.page_index).map(|origin| {
                ReaderCaretGeometry {
                    x: caret.geometry.x + origin.0,
                    y: caret.geometry.y + origin.1,
                    height: caret.geometry.height,
                }
            }),
            href: caret.source_locator.href,
            source_point: reader_source_point(source_point)?,
        })
    }

    fn selection(&self, range: RuntimeTextRange) -> Result<ReaderTextSelection, ReaderError> {
        let mut rects = Vec::new();
        for rect in &range.rects {
            if let Some(origin) = self.drawn_origin(rect.page_index) {
                rects.push(reader_rect(rect, origin)?);
            }
        }
        Ok(ReaderTextSelection {
            anchor: reader_address(range.anchor)?,
            focus: reader_address(range.focus)?,
            start: reader_address(range.start)?,
            end: reader_address(range.end)?,
            selected_text: range.selected_text,
            source_start_href: range.source_span.start.href,
            source_start: reader_source_point(range.source_span.start.source_point)?,
            source_end_href: range.source_span.end.href,
            source_end: reader_source_point(range.source_span.end.source_point)?,
            rects,
        })
    }

    fn selection_result(
        &self,
        resolution: RuntimeTextRangeFromPointsResolution,
    ) -> Result<ReaderTextInteractionResult, ReaderError> {
        Ok(match resolution {
            RuntimeTextRangeFromPointsResolution::Resolved {
                anchor_caret,
                focus_caret,
                range,
            } => ReaderTextInteractionResult::Selection(Box::new(ReaderSelectionResult {
                anchor_caret: Some(self.caret(*anchor_caret)?),
                focus_caret: Some(self.caret(*focus_caret)?),
                selection: self.selection(*range)?,
                preferred_inline_position: None,
                preferred_block_position: None,
            })),
            RuntimeTextRangeFromPointsResolution::Unavailable { reason } => {
                ReaderTextInteractionResult::Unavailable(reader_reason(reason))
            }
            RuntimeTextRangeFromPointsResolution::Miss => ReaderTextInteractionResult::Miss,
        })
    }
}

impl ReaderSession {
    /// Resolves one caret, range or caret movement against an artifact.
    pub fn resolve_text_interaction(
        &mut self,
        request: ReaderTextInteractionRequest,
    ) -> Result<ReaderTextInteractionResponse, ReaderError> {
        if request.session_id != self.session_id {
            return Err(ReaderError::new(
                ReaderErrorKind::InvalidSession,
                "text interaction request belongs to a different session",
            ));
        }
        validate_external_request_id(request.artifact_id, "artifactId")?;
        let view = self.artifact_view(request.artifact_id)?;
        let result = self.text_interaction_result(&view, request.query)?;
        Ok(ReaderTextInteractionResponse {
            artifact_id: request.artifact_id,
            result,
        })
    }

    /// Builds an annotation target for a source range, or locates a
    /// stored one in the publication as it is now.
    pub fn resolve_annotation(
        &mut self,
        request: ReaderAnnotationRequest,
    ) -> Result<ReaderAnnotationResponse, ReaderError> {
        if request.session_id != self.session_id {
            return Err(ReaderError::new(
                ReaderErrorKind::InvalidSession,
                "annotation request belongs to a different session",
            ));
        }
        match request.query {
            ReaderAnnotationQuery::Create { href, range } => {
                let range = runtime_source_range(range)?;
                let target = self
                    .document
                    .create_annotation_target(&href, &range)
                    .map_err(annotation_error)?;
                Ok(ReaderAnnotationResponse {
                    level: ReaderAnnotationLevel::Created,
                    target_json: annotation_target_to_json(&target),
                })
            }
            ReaderAnnotationQuery::Resolve { target_json } => {
                let target = annotation_target_from_json(&target_json).map_err(annotation_error)?;
                let resolution = self
                    .document
                    .resolve_annotation_target(&target)
                    .map_err(annotation_error)?;
                Ok(reader_annotation(resolution))
            }
        }
    }

    fn artifact_view(&self, artifact_id: u64) -> Result<ArtifactView<'_>, ReaderError> {
        let artifact = self
            .artifacts
            .get(&artifact_id)
            .ok_or_else(|| unknown_artifact(artifact_id))?;
        let (revision_id, revision) = match artifact.backing {
            ReaderRevisionBacking::ChapterLocal => {
                let owner = self
                    .revisions
                    .get(&artifact.revision_id)
                    .map(|revision| &revision.owner)
                    .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
                let revision = self
                    .document
                    .require_chapter_local_owner(owner)
                    .map_err(engine_error)?;
                (owner.revision_id.clone(), revision)
            }
            ReaderRevisionBacking::Publication => {
                let owner = self
                    .publication_revisions
                    .get(&artifact.revision_id)
                    .map(|revision| &revision.owner)
                    .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
                let revision = self
                    .document
                    .revisions
                    .get(&owner.revision_id)
                    .ok_or_else(|| missing_artifact_revision(artifact.backing))?;
                (owner.revision_id.clone(), revision)
            }
        };
        Ok(ArtifactView {
            revision_id,
            revision,
            spread_index: artifact.local_spread_index,
        })
    }

    fn text_interaction_result(
        &self,
        view: &ArtifactView<'_>,
        query: ReaderTextInteractionQuery,
    ) -> Result<ReaderTextInteractionResult, ReaderError> {
        let document = &self.document;
        let (id, revision) = (view.revision_id.as_str(), view.revision);
        match query {
            ReaderTextInteractionQuery::Caret { point } => {
                let response = document
                    .resolve_text_caret_in(id, revision, view.page_point(point)?)
                    .map_err(engine_error)?;
                Ok(match response.resolution {
                    RuntimeTextCaretResolution::Resolved { caret } => {
                        ReaderTextInteractionResult::Caret(view.caret(*caret)?)
                    }
                    RuntimeTextCaretResolution::Unavailable { reason } => {
                        ReaderTextInteractionResult::Unavailable(reader_reason(reason))
                    }
                    RuntimeTextCaretResolution::Miss => ReaderTextInteractionResult::Miss,
                })
            }
            ReaderTextInteractionQuery::Range { anchor, focus } => {
                let request = RuntimeTextRangeRequest {
                    anchor: runtime_address(anchor)?,
                    focus: runtime_address(focus)?,
                };
                let response = document
                    .resolve_text_range_in(id, revision, request)
                    .map_err(engine_error)?;
                Ok(match response.resolution {
                    RuntimeTextRangeResolution::Resolved { range } => {
                        ReaderTextInteractionResult::Selection(Box::new(ReaderSelectionResult {
                            anchor_caret: None,
                            focus_caret: None,
                            selection: view.selection(*range)?,
                            preferred_inline_position: None,
                            preferred_block_position: None,
                        }))
                    }
                    RuntimeTextRangeResolution::Unavailable { reason } => {
                        ReaderTextInteractionResult::Unavailable(reader_reason(reason))
                    }
                })
            }
            ReaderTextInteractionQuery::RangeToPoint { anchor, focus } => {
                let request = RuntimeTextRangeToPointRequest {
                    anchor: runtime_address(anchor)?,
                    focus: view.page_point(focus)?,
                };
                let response = document
                    .resolve_text_range_to_point_in(id, revision, request)
                    .map_err(engine_error)?;
                view.selection_result(response.resolution)
            }
            ReaderTextInteractionQuery::RangeFromPoints {
                anchor,
                focus,
                granularity,
            } => {
                let request = RuntimeTextRangeFromPointsRequest {
                    anchor: view.page_point(anchor)?,
                    focus: view.page_point(focus)?,
                    granularity: runtime_granularity(granularity),
                };
                let response = document
                    .resolve_text_range_from_points_in(id, revision, request)
                    .map_err(engine_error)?;
                view.selection_result(response.resolution)
            }
            ReaderTextInteractionQuery::Movement {
                anchor,
                focus,
                movement,
                preferred_inline_position,
                preferred_block_position,
            } => {
                let request = RuntimeTextSelectionMovementRequest {
                    anchor: runtime_address(anchor)?,
                    focus: runtime_address(focus)?,
                    movement: runtime_movement(movement),
                    preferred_inline_position,
                    preferred_block_position,
                };
                let response = document
                    .resolve_text_selection_movement_in(id, revision, request)
                    .map_err(engine_error)?;
                movement_result(view, response.resolution)
            }
        }
    }
}

fn movement_result(
    view: &ArtifactView<'_>,
    resolution: RuntimeTextSelectionMovementResolution,
) -> Result<ReaderTextInteractionResult, ReaderError> {
    Ok(match resolution {
        RuntimeTextSelectionMovementResolution::Resolved {
            anchor_caret,
            focus_caret,
            range,
            preferred_inline_position,
            preferred_block_position,
        } => ReaderTextInteractionResult::Selection(Box::new(ReaderSelectionResult {
            anchor_caret: Some(view.caret(*anchor_caret)?),
            focus_caret: Some(view.caret(*focus_caret)?),
            selection: view.selection(*range)?,
            preferred_inline_position,
            preferred_block_position,
        })),
        RuntimeTextSelectionMovementResolution::Boundary { boundary } => {
            ReaderTextInteractionResult::Boundary(reader_boundary(boundary))
        }
        RuntimeTextSelectionMovementResolution::Pending { boundary } => {
            ReaderTextInteractionResult::Pending(reader_boundary(boundary))
        }
        RuntimeTextSelectionMovementResolution::Unavailable { reason } => {
            ReaderTextInteractionResult::Unavailable(reader_reason(reason))
        }
    })
}

fn reader_annotation(resolution: AnnotationTargetResolution) -> ReaderAnnotationResponse {
    let (level, target) = match resolution {
        AnnotationTargetResolution::Exact { target } => {
            (ReaderAnnotationLevel::Exact, Some(target))
        }
        AnnotationTargetResolution::Quote { target } => {
            (ReaderAnnotationLevel::Quote, Some(target))
        }
        AnnotationTargetResolution::Position { target } => {
            (ReaderAnnotationLevel::Position, Some(target))
        }
        AnnotationTargetResolution::Progression { target } => {
            (ReaderAnnotationLevel::Progression, Some(target))
        }
        AnnotationTargetResolution::Orphaned { reason } => (
            match reason {
                AnnotationOrphanReason::HrefNotFound => ReaderAnnotationLevel::OrphanedHrefNotFound,
                AnnotationOrphanReason::EmptyChapter => ReaderAnnotationLevel::OrphanedEmptyChapter,
            },
            None,
        ),
    };
    ReaderAnnotationResponse {
        level,
        target_json: target
            .as_ref()
            .map(annotation_target_to_json)
            .unwrap_or_default(),
    }
}

/// A target the caller handed over is the caller's problem to fix; a
/// source the engine cannot read is the engine's.
fn annotation_error(error: crate::runtime::RuntimeSourceLocatorError) -> ReaderError {
    match error.kind {
        RuntimeSourceLocatorErrorKind::SourceUnavailable => engine_error(error.message),
        _ => ReaderError::new(ReaderErrorKind::InvalidRequest, error.message),
    }
}

fn reader_rect(
    rect: &RuntimeExactTextRangeRect,
    origin: (f64, f64),
) -> Result<ReaderExactSourceRect, ReaderError> {
    Ok(ReaderExactSourceRect {
        page_index: u32_from_usize(rect.page_index, "selection rect page index")?,
        bounds: ReaderRect {
            x: rect.x + origin.0,
            y: rect.y + origin.1,
            width: rect.width,
            height: rect.height,
        },
        block_index: u32_from_usize(rect.block_index, "selection rect block index")?,
        line_index: u32_from_usize(rect.line_index, "selection rect line index")?,
        run_index: u32_from_usize(rect.run_index, "selection rect run index")?,
        start_char_index: u32_from_usize(rect.start_char_index, "selection rect start")?,
        end_char_index: u32_from_usize(rect.end_char_index, "selection rect end")?,
    })
}

fn reader_address(value: TextCaretAddress) -> Result<ReaderCaretAddress, ReaderError> {
    Ok(ReaderCaretAddress {
        page_index: u32_from_usize(value.page_index, "caret page index")?,
        position: ReaderTextPosition {
            block_index: u32_from_usize(value.block_index, "caret block index")?,
            line_index: u32_from_usize(value.line_index, "caret line index")?,
            run_index: u32_from_usize(value.run_index, "caret run index")?,
            char_index: u32_from_usize(value.char_index, "caret char index")?,
        },
        affinity: match value.affinity {
            TextCaretAffinity::Upstream => ReaderCaretAffinity::Upstream,
            TextCaretAffinity::Downstream => ReaderCaretAffinity::Downstream,
        },
    })
}

fn runtime_address(value: ReaderCaretAddress) -> Result<TextCaretAddress, ReaderError> {
    Ok(TextCaretAddress {
        page_index: usize_from_u32(value.page_index, "caret page index")?,
        block_index: usize_from_u32(value.position.block_index, "caret block index")?,
        line_index: usize_from_u32(value.position.line_index, "caret line index")?,
        run_index: usize_from_u32(value.position.run_index, "caret run index")?,
        char_index: usize_from_u32(value.position.char_index, "caret char index")?,
        affinity: match value.affinity {
            ReaderCaretAffinity::Upstream => TextCaretAffinity::Upstream,
            ReaderCaretAffinity::Downstream => TextCaretAffinity::Downstream,
        },
    })
}

const fn runtime_granularity(value: ReaderSelectionGranularity) -> RuntimeTextSelectionGranularity {
    match value {
        ReaderSelectionGranularity::Word => RuntimeTextSelectionGranularity::Word,
        ReaderSelectionGranularity::Paragraph => RuntimeTextSelectionGranularity::Paragraph,
    }
}

const fn reader_boundary(value: TextSelectionBoundary) -> ReaderSelectionBoundary {
    match value {
        TextSelectionBoundary::Start => ReaderSelectionBoundary::Start,
        TextSelectionBoundary::End => ReaderSelectionBoundary::End,
    }
}

const fn reader_reason(
    value: TextInteractionUnavailableReason,
) -> ReaderTextInteractionUnavailableReason {
    use ReaderTextInteractionUnavailableReason as Reader;
    match value {
        TextInteractionUnavailableReason::ShapeUnavailable => Reader::ShapeUnavailable,
        TextInteractionUnavailableReason::SourceUnavailable => Reader::SourceUnavailable,
        TextInteractionUnavailableReason::UnsupportedTransform => Reader::UnsupportedTransform,
        TextInteractionUnavailableReason::VisualGeometryUnavailable => {
            Reader::VisualGeometryUnavailable
        }
        TextInteractionUnavailableReason::InvalidCaret => Reader::InvalidCaret,
        TextInteractionUnavailableReason::DifferentChapter => Reader::DifferentChapter,
    }
}

const fn runtime_movement(value: ReaderSelectionMovement) -> TextSelectionMovement {
    use ReaderSelectionMovement as Reader;
    use TextSelectionMovement as Runtime;
    match value {
        Reader::CharacterLeft => Runtime::CharacterLeft,
        Reader::CharacterRight => Runtime::CharacterRight,
        Reader::WordLeft => Runtime::WordLeft,
        Reader::WordRight => Runtime::WordRight,
        Reader::WordStartRight => Runtime::WordStartRight,
        Reader::LineUp => Runtime::LineUp,
        Reader::LineDown => Runtime::LineDown,
        Reader::LineStart => Runtime::LineStart,
        Reader::LineEnd => Runtime::LineEnd,
        Reader::PageUp => Runtime::PageUp,
        Reader::PageDown => Runtime::PageDown,
        Reader::ParagraphBackward => Runtime::ParagraphBackward,
        Reader::ParagraphForward => Runtime::ParagraphForward,
        Reader::ParagraphPreviousStart => Runtime::ParagraphPreviousStart,
        Reader::ParagraphNextStart => Runtime::ParagraphNextStart,
        Reader::ChapterStart => Runtime::ChapterStart,
        Reader::ChapterEnd => Runtime::ChapterEnd,
        Reader::DocumentStart => Runtime::DocumentStart,
        Reader::DocumentEnd => Runtime::DocumentEnd,
    }
}
