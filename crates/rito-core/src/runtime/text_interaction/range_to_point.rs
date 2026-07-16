use crate::{
    epub::{EpubError, EpubResult},
    interaction::{
        resolve_text_range_to_point, LayoutTextPoint, LayoutTextRangeFromPointsResolution,
    },
};

use super::{
    runtime_text_caret, runtime_text_range, RuntimeDocument, RuntimeTextRangeFromPointsResolution,
    RuntimeTextRangeToPointRequest, RuntimeTextRangeToPointResponse,
};

impl RuntimeDocument {
    pub(in crate::runtime) fn resolve_text_range_to_point_for_revision(
        &self,
        revision_id: &str,
        request: RuntimeTextRangeToPointRequest,
    ) -> EpubResult<RuntimeTextRangeToPointResponse> {
        require_valid_request(self, revision_id, request)?;
        let revision = self.require_text_interaction_revision(revision_id)?;
        let resolution = resolve_text_range_to_point(
            &revision.layout.pages,
            request.anchor,
            LayoutTextPoint {
                page_index: request.focus.page_index,
                x: request.focus.x,
                y: request.focus.y,
            },
        );
        let resolution = match resolution {
            LayoutTextRangeFromPointsResolution::Resolved(selection) => {
                let range = match runtime_text_range(&self.document, revision, *selection.range)? {
                    super::RuntimeTextRangeResolution::Resolved { range } => range,
                    super::RuntimeTextRangeResolution::Unavailable { reason } => {
                        return Ok(RuntimeTextRangeToPointResponse {
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
        Ok(RuntimeTextRangeToPointResponse {
            revision_id: revision_id.to_owned(),
            resolution,
        })
    }
}

fn require_valid_request(
    document: &RuntimeDocument,
    revision_id: &str,
    request: RuntimeTextRangeToPointRequest,
) -> EpubResult<()> {
    if !request.focus.x.is_finite() || !request.focus.y.is_finite() {
        return Err(EpubError::new("text range point must be finite"));
    }
    let revision = document.require_text_interaction_revision(revision_id)?;
    for page_index in [request.anchor.page_index, request.focus.page_index] {
        if page_index >= revision.layout.pages.len() {
            return Err(EpubError::new(format!("unknown page index: {page_index}")));
        }
    }
    Ok(())
}
