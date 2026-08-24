use crate::epub::{EpubError, EpubResult};

use super::super::page_artifact::{
    PageArtifactTextPageRange, PageArtifactTextPoint, PageArtifactTextRangeFromPointsQuery,
    PageArtifactTextRangeFromPointsResolution, PageArtifactTextSelectionGranularity,
};
use super::{runtime_text_caret, runtime_text_range, RuntimeDocument, RuntimeRevision};
use super::{
    RuntimeTextRangeFromPointsRequest, RuntimeTextRangeFromPointsResolution,
    RuntimeTextRangeFromPointsResponse, RuntimeTextSelectionGranularity,
};

impl RuntimeDocument {
    pub(in crate::runtime) fn resolve_text_range_from_points_for_revision(
        &self,
        revision_id: &str,
        request: RuntimeTextRangeFromPointsRequest,
    ) -> EpubResult<RuntimeTextRangeFromPointsResponse> {
        require_valid_points(self, revision_id, request)?;
        let revision = self.require_text_interaction_revision(revision_id)?;
        let page_range = interaction_page_range(self, revision, request);
        let resolution = revision
            .chapter_engine_session()
            .resolve_text_range_from_points(PageArtifactTextRangeFromPointsQuery {
                anchor: artifact_point(request.anchor),
                focus: artifact_point(request.focus),
                granularity: artifact_granularity(request.granularity),
                language: Some(&self.document.package.metadata.language),
                scope: page_range,
            });
        let resolution = match resolution {
            PageArtifactTextRangeFromPointsResolution::Resolved(selection) => {
                let range = match runtime_text_range(&self.document, revision, *selection.range)? {
                    super::RuntimeTextRangeResolution::Resolved { range } => range,
                    super::RuntimeTextRangeResolution::Unavailable { reason } => {
                        return Ok(RuntimeTextRangeFromPointsResponse {
                            revision_id: revision_id.to_owned(),
                            resolution: RuntimeTextRangeFromPointsResolution::Unavailable {
                                reason,
                            },
                        });
                    }
                };
                RuntimeTextRangeFromPointsResolution::Resolved {
                    anchor_caret: Box::new(runtime_text_caret(
                        &self.document,
                        revision,
                        selection.anchor_caret,
                    )?),
                    focus_caret: Box::new(runtime_text_caret(
                        &self.document,
                        revision,
                        selection.focus_caret,
                    )?),
                    range,
                }
            }
            PageArtifactTextRangeFromPointsResolution::Unavailable(reason) => {
                RuntimeTextRangeFromPointsResolution::Unavailable { reason }
            }
            PageArtifactTextRangeFromPointsResolution::Miss => {
                RuntimeTextRangeFromPointsResolution::Miss
            }
        };
        Ok(RuntimeTextRangeFromPointsResponse {
            revision_id: revision_id.to_owned(),
            resolution,
        })
    }
}

fn interaction_page_range(
    document: &RuntimeDocument,
    revision: &RuntimeRevision,
    request: RuntimeTextRangeFromPointsRequest,
) -> PageArtifactTextPageRange {
    let last_page = revision
        .chapter_engine_session()
        .metadata()
        .page_count
        .saturating_sub(1);
    let full = PageArtifactTextPageRange {
        first_page: 0,
        last_page,
    };
    let anchor = super::chapter_for_page(&document.document, revision, request.anchor.page_index);
    let focus = super::chapter_for_page(&document.document, revision, request.focus.page_index);
    let (Some(anchor), Some(focus)) = (anchor, focus) else {
        return full;
    };
    if anchor.idref != focus.idref {
        return full;
    }
    revision
        .chapter_engine_session()
        .known_chapter(&anchor.idref)
        .map_or(full, |range| PageArtifactTextPageRange {
            first_page: range.start_page,
            last_page: range.end_page.min(last_page),
        })
}

fn require_valid_points(
    document: &RuntimeDocument,
    revision_id: &str,
    request: RuntimeTextRangeFromPointsRequest,
) -> EpubResult<()> {
    let revision = document.require_text_interaction_revision(revision_id)?;
    for point in [request.anchor, request.focus] {
        if !point.x.is_finite() || !point.y.is_finite() {
            return Err(EpubError::new("text range point must be finite"));
        }
        if point.page_index >= revision.chapter_engine_session().metadata().page_count {
            return Err(EpubError::new(format!(
                "unknown page index: {}",
                point.page_index
            )));
        }
    }
    Ok(())
}

fn artifact_point(point: super::RuntimeTextPointRequest) -> PageArtifactTextPoint {
    PageArtifactTextPoint {
        page_index: point.page_index,
        x: point.x,
        y: point.y,
    }
}

fn artifact_granularity(
    granularity: RuntimeTextSelectionGranularity,
) -> PageArtifactTextSelectionGranularity {
    match granularity {
        RuntimeTextSelectionGranularity::Word => PageArtifactTextSelectionGranularity::Word,
        RuntimeTextSelectionGranularity::Paragraph => {
            PageArtifactTextSelectionGranularity::Paragraph
        }
    }
}
