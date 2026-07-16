use crate::{
    epub::{EpubError, EpubResult},
    interaction::{
        resolve_text_range_from_points, LayoutTextPageRange, LayoutTextPoint,
        LayoutTextRangeFromPointsResolution, LayoutTextSelectionGranularity,
    },
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
        let resolution = resolve_text_range_from_points(
            &revision.layout.pages,
            layout_point(request.anchor),
            layout_point(request.focus),
            layout_granularity(request.granularity),
            Some(&self.document.package.metadata.language),
            page_range,
        );
        let resolution = match resolution {
            LayoutTextRangeFromPointsResolution::Resolved(selection) => {
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
            LayoutTextRangeFromPointsResolution::Unavailable(reason) => {
                RuntimeTextRangeFromPointsResolution::Unavailable { reason }
            }
            LayoutTextRangeFromPointsResolution::Miss => RuntimeTextRangeFromPointsResolution::Miss,
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
) -> LayoutTextPageRange {
    let last_page = revision.layout.pages.len().saturating_sub(1);
    let full = LayoutTextPageRange {
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
        .layout
        .summary
        .pagination_flow
        .chapter_map
        .get(&anchor.idref)
        .map_or(full, |range| LayoutTextPageRange {
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
        if point.page_index >= revision.layout.pages.len() {
            return Err(EpubError::new(format!(
                "unknown page index: {}",
                point.page_index
            )));
        }
    }
    Ok(())
}

fn layout_point(point: super::RuntimeTextPointRequest) -> LayoutTextPoint {
    LayoutTextPoint {
        page_index: point.page_index,
        x: point.x,
        y: point.y,
    }
}

fn layout_granularity(
    granularity: RuntimeTextSelectionGranularity,
) -> LayoutTextSelectionGranularity {
    match granularity {
        RuntimeTextSelectionGranularity::Word => LayoutTextSelectionGranularity::Word,
        RuntimeTextSelectionGranularity::Paragraph => LayoutTextSelectionGranularity::Paragraph,
    }
}
