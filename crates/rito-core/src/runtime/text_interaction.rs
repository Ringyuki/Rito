use crate::{
    epub::{EpubError, EpubResult, LoadedEpubDocument},
    interaction::{
        resolve_exact_source_range, resolve_text_caret, resolve_text_range, ExactTextRangeRect,
        LayoutExactTextRange, LayoutExactTextRangeResolution, LayoutSourcePoint, LayoutTextCaret,
        LayoutTextCaretResolution, TextInteractionUnavailableReason,
    },
};

mod granularity;
mod movement;
mod range_to_point;
mod source_match;
mod source_span;
mod types;

pub use types::*;

use source_match::source_segments_match;
use source_span::{compatible_source_locator, runtime_source_point, runtime_text_source_endpoint};

use super::source_locator::{ExactSourceRangePageWindow, PreparedExactSourceRange};
use super::{
    navigation::spread_index_for_page, page_target::chapter_for_page, RuntimeDocument,
    RuntimeRevision, RuntimeSourceLocator, RuntimeSourcePoint,
};

impl RuntimeDocument {
    pub(super) fn resolve_exact_source_range_for_revision(
        &mut self,
        revision_id: &str,
        request: RuntimeExactSourceRangeRequest,
    ) -> Result<RuntimeExactSourceRangeResponse, super::RuntimeSourceLocatorError> {
        let prepared = self.prepare_exact_source_range(request)?;
        let window = self.exact_source_range_page_window(revision_id, &prepared)?;
        let resolution = match window {
            ExactSourceRangePageWindow::Pending(reason) => {
                RuntimeExactSourceRangeResolution::Pending { reason }
            }
            ExactSourceRangePageWindow::Ready {
                first_page,
                last_page,
            } => self.resolve_prepared_exact_source_range(
                revision_id,
                prepared,
                first_page,
                last_page,
            ),
        };
        Ok(RuntimeExactSourceRangeResponse {
            revision_id: revision_id.to_owned(),
            resolution,
        })
    }

    fn resolve_prepared_exact_source_range(
        &self,
        revision_id: &str,
        prepared: PreparedExactSourceRange,
        first_page: usize,
        last_page: usize,
    ) -> RuntimeExactSourceRangeResolution {
        let revision = self
            .revisions
            .get(revision_id)
            .expect("exact source range page window validated the revision");
        let start = layout_source_point(&prepared.source_range.start);
        let end = layout_source_point(&prepared.source_range.end);
        let resolution =
            resolve_exact_source_range(&revision.layout.pages, first_page, last_page, &start, &end);
        match resolution {
            LayoutExactTextRangeResolution::Resolved(range)
                if source_segments_match(
                    &prepared.normalized_source_text,
                    &range.exact_source_segments,
                ) =>
            {
                RuntimeExactSourceRangeResolution::Resolved {
                    range: Box::new(RuntimeExactSourceRange {
                        selected_text: range.selected_text,
                        source_locator: prepared.locator,
                        rects: range
                            .rects
                            .into_iter()
                            .map(|rect| runtime_range_rect(revision, rect))
                            .collect(),
                    }),
                }
            }
            LayoutExactTextRangeResolution::Resolved(_) => {
                RuntimeExactSourceRangeResolution::Unavailable {
                    reason: TextInteractionUnavailableReason::SourceUnavailable,
                }
            }
            LayoutExactTextRangeResolution::Unavailable(reason) => {
                RuntimeExactSourceRangeResolution::Unavailable { reason }
            }
        }
    }

    pub(super) fn resolve_text_caret_for_revision(
        &self,
        revision_id: &str,
        request: RuntimeTextPointRequest,
    ) -> EpubResult<RuntimeTextCaretResponse> {
        require_finite_point(request)?;
        let revision = self.require_text_interaction_revision(revision_id)?;
        let page = revision
            .layout
            .pages
            .get(request.page_index)
            .ok_or_else(|| EpubError::new(format!("unknown page index: {}", request.page_index)))?;
        let resolution = match resolve_text_caret(request.page_index, page, request.x, request.y) {
            LayoutTextCaretResolution::Resolved(caret) => RuntimeTextCaretResolution::Resolved {
                caret: Box::new(runtime_text_caret(&self.document, revision, caret)?),
            },
            LayoutTextCaretResolution::Unavailable(reason) => {
                RuntimeTextCaretResolution::Unavailable { reason }
            }
            LayoutTextCaretResolution::Miss => RuntimeTextCaretResolution::Miss,
        };
        Ok(RuntimeTextCaretResponse {
            revision_id: revision_id.to_owned(),
            page_index: request.page_index,
            spread_index: spread_index_for_page(revision, request.page_index),
            resolution,
        })
    }

    pub(super) fn resolve_text_range_for_revision(
        &self,
        revision_id: &str,
        request: RuntimeTextRangeRequest,
    ) -> EpubResult<RuntimeTextRangeResponse> {
        let revision = self.require_text_interaction_revision(revision_id)?;
        require_endpoint_pages(revision, request)?;
        let resolution =
            match resolve_text_range(&revision.layout.pages, request.anchor, request.focus) {
                LayoutExactTextRangeResolution::Resolved(range) => {
                    runtime_text_range(&self.document, revision, *range)?
                }
                LayoutExactTextRangeResolution::Unavailable(reason) => {
                    RuntimeTextRangeResolution::Unavailable { reason }
                }
            };
        Ok(RuntimeTextRangeResponse {
            revision_id: revision_id.to_owned(),
            resolution,
        })
    }

    fn require_text_interaction_revision(&self, revision_id: &str) -> EpubResult<&RuntimeRevision> {
        self.revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))
    }
}

fn layout_source_point(point: &RuntimeSourcePoint) -> LayoutSourcePoint {
    LayoutSourcePoint {
        node_path: point.node_path.clone(),
        text_offset: point.text_offset,
    }
}

fn runtime_text_caret(
    document: &LoadedEpubDocument,
    revision: &RuntimeRevision,
    caret: LayoutTextCaret,
) -> EpubResult<RuntimeTextCaret> {
    let source_locator = point_locator(
        document,
        revision,
        caret.address.page_index,
        caret.source_point,
    )?;
    Ok(RuntimeTextCaret {
        address: caret.address,
        geometry: caret.geometry,
        source_locator,
    })
}

fn runtime_text_range(
    document: &LoadedEpubDocument,
    revision: &RuntimeRevision,
    range: LayoutExactTextRange,
) -> EpubResult<RuntimeTextRangeResolution> {
    let start_chapter = require_chapter(document, revision, range.start.page_index)?;
    let end_chapter = require_chapter(document, revision, range.end.page_index)?;
    let source_span = RuntimeTextSourceSpan {
        start: runtime_text_source_endpoint(start_chapter, range.source_start),
        end: runtime_text_source_endpoint(end_chapter, range.source_end),
    };
    let source_locator = compatible_source_locator(&source_span);
    Ok(RuntimeTextRangeResolution::Resolved {
        range: Box::new(RuntimeTextRange {
            anchor: range.anchor,
            focus: range.focus,
            start: range.start,
            end: range.end,
            selected_text: range.selected_text,
            source_span,
            source_locator,
            rects: range
                .rects
                .into_iter()
                .map(|rect| runtime_range_rect(revision, rect))
                .collect(),
        }),
    })
}

fn point_locator(
    document: &LoadedEpubDocument,
    revision: &RuntimeRevision,
    page_index: usize,
    source_point: LayoutSourcePoint,
) -> EpubResult<RuntimeSourceLocator> {
    let chapter = require_chapter(document, revision, page_index)?;
    Ok(RuntimeSourceLocator {
        href: chapter.href.clone(),
        anchor_id: None,
        source_point: Some(runtime_source_point(source_point)),
        source_range: None,
        progression: None,
    })
}

fn require_chapter<'a>(
    document: &'a LoadedEpubDocument,
    revision: &RuntimeRevision,
    page_index: usize,
) -> EpubResult<&'a crate::epub::LoadedChapter> {
    chapter_for_page(document, revision, page_index)
        .ok_or_else(|| EpubError::new(format!("chapter unavailable for page: {page_index}")))
}

fn runtime_range_rect(
    revision: &RuntimeRevision,
    rect: ExactTextRangeRect,
) -> RuntimeExactTextRangeRect {
    RuntimeExactTextRangeRect {
        page_index: rect.page_index,
        spread_index: spread_index_for_page(revision, rect.page_index),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        block_index: rect.block_index,
        line_index: rect.line_index,
        run_index: rect.run_index,
        start_char_index: rect.start_char_index,
        end_char_index: rect.end_char_index,
    }
}

fn require_finite_point(request: RuntimeTextPointRequest) -> EpubResult<()> {
    (request.x.is_finite() && request.y.is_finite())
        .then_some(())
        .ok_or_else(|| EpubError::new("text caret point must be finite"))
}

fn require_endpoint_pages(
    revision: &RuntimeRevision,
    request: RuntimeTextRangeRequest,
) -> EpubResult<()> {
    for page_index in [request.anchor.page_index, request.focus.page_index] {
        if page_index >= revision.layout.pages.len() {
            return Err(EpubError::new(format!("unknown page index: {page_index}")));
        }
    }
    Ok(())
}
