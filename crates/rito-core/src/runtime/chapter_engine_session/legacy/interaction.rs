//! Legacy text-interaction adapter. Old retained pages do not escape here.

use crate::interaction::{
    resolve_exact_source_range as legacy_resolve_exact_source_range,
    resolve_text_caret as legacy_resolve_text_caret,
    resolve_text_range as legacy_resolve_text_range,
    resolve_text_range_from_points as legacy_resolve_text_range_from_points,
    resolve_text_range_to_point as legacy_resolve_text_range_to_point,
    resolve_text_selection_movement as legacy_resolve_text_selection_movement, ExactTextRangeRect,
    LayoutExactTextRange, LayoutExactTextRangeResolution, LayoutSourcePoint, LayoutTextCaret,
    LayoutTextCaretResolution, LayoutTextPageRange, LayoutTextPageTarget, LayoutTextPoint,
    LayoutTextRangeFromPoints, LayoutTextRangeFromPointsResolution, LayoutTextSelectionGranularity,
    LayoutTextSelectionMovement, LayoutTextSelectionMovementInput,
    LayoutTextSelectionMovementResolution, LayoutTextSelectionMovementTarget,
};

use super::LegacyChapterEngineSession;
use crate::runtime::page_artifact::{
    PageArtifactExactSourceRangeQuery, PageArtifactExactTextRange, PageArtifactExactTextRangeRect,
    PageArtifactExactTextRangeResolution, PageArtifactSourcePoint, PageArtifactTextCaret,
    PageArtifactTextCaretQuery, PageArtifactTextCaretResolution, PageArtifactTextPageRange,
    PageArtifactTextPoint, PageArtifactTextRangeFromPoints, PageArtifactTextRangeFromPointsQuery,
    PageArtifactTextRangeFromPointsResolution, PageArtifactTextRangeQuery,
    PageArtifactTextRangeToPointQuery, PageArtifactTextSelectionGranularity,
    PageArtifactTextSelectionMovement, PageArtifactTextSelectionMovementQuery,
    PageArtifactTextSelectionMovementResolution, PageArtifactTextSelectionMovementTarget,
};

impl LegacyChapterEngineSession<'_> {
    pub(in crate::runtime) fn resolve_exact_source_range(
        &self,
        query: PageArtifactExactSourceRangeQuery,
    ) -> PageArtifactExactTextRangeResolution {
        exact_range_resolution(legacy_resolve_exact_source_range(
            &self.revision.layout.pages,
            query.first_page,
            query.last_page,
            &layout_source_point(query.start),
            &layout_source_point(query.end),
        ))
    }

    pub(in crate::runtime) fn resolve_text_caret(
        &self,
        query: PageArtifactTextCaretQuery,
    ) -> Option<PageArtifactTextCaretResolution> {
        let page = self.revision.layout.pages.get(query.page_index)?;
        Some(text_caret_resolution(legacy_resolve_text_caret(
            query.page_index,
            page,
            query.x,
            query.y,
        )))
    }

    pub(in crate::runtime) fn resolve_text_range(
        &self,
        query: PageArtifactTextRangeQuery,
    ) -> PageArtifactExactTextRangeResolution {
        exact_range_resolution(legacy_resolve_text_range(
            &self.revision.layout.pages,
            query.anchor,
            query.focus,
        ))
    }

    pub(in crate::runtime) fn resolve_text_range_to_point(
        &self,
        query: PageArtifactTextRangeToPointQuery,
    ) -> PageArtifactTextRangeFromPointsResolution {
        range_from_points_resolution(legacy_resolve_text_range_to_point(
            &self.revision.layout.pages,
            query.anchor,
            layout_text_point(query.focus),
        ))
    }

    pub(in crate::runtime) fn resolve_text_range_from_points(
        &self,
        query: PageArtifactTextRangeFromPointsQuery<'_>,
    ) -> PageArtifactTextRangeFromPointsResolution {
        range_from_points_resolution(legacy_resolve_text_range_from_points(
            &self.revision.layout.pages,
            layout_text_point(query.anchor),
            layout_text_point(query.focus),
            match query.granularity {
                PageArtifactTextSelectionGranularity::Word => LayoutTextSelectionGranularity::Word,
                PageArtifactTextSelectionGranularity::Paragraph => {
                    LayoutTextSelectionGranularity::Paragraph
                }
            },
            query.language,
            layout_page_range(query.scope),
        ))
    }

    pub(in crate::runtime) fn resolve_text_selection_movement(
        &self,
        query: PageArtifactTextSelectionMovementQuery<'_>,
    ) -> PageArtifactTextSelectionMovementResolution {
        movement_resolution(legacy_resolve_text_selection_movement(
            &self.revision.layout.pages,
            LayoutTextSelectionMovementInput {
                scope: layout_page_range(query.scope),
                anchor_address: query.anchor_address,
                focus_address: query.focus_address,
                movement: query.movement,
                language: query.language,
                preferred_inline_position: query.preferred_inline_position,
                preferred_block_position: query.preferred_block_position,
                target: layout_movement_target(query.target),
            },
        ))
    }
}

fn layout_source_point(point: PageArtifactSourcePoint) -> LayoutSourcePoint {
    LayoutSourcePoint {
        node_path: point.node_path,
        text_offset: point.text_offset,
    }
}

fn layout_text_point(point: PageArtifactTextPoint) -> LayoutTextPoint {
    LayoutTextPoint {
        page_index: point.page_index,
        x: point.x,
        y: point.y,
    }
}

fn layout_page_range(range: PageArtifactTextPageRange) -> LayoutTextPageRange {
    LayoutTextPageRange {
        first_page: range.first_page,
        last_page: range.last_page,
    }
}

fn layout_movement_target(
    target: PageArtifactTextSelectionMovementTarget,
) -> LayoutTextSelectionMovementTarget {
    match target {
        PageArtifactTextSelectionMovementTarget::Scope(scope) => {
            LayoutTextSelectionMovementTarget::Scope(layout_page_range(scope))
        }
        PageArtifactTextSelectionMovementTarget::Page(page) => {
            LayoutTextSelectionMovementTarget::Page(LayoutTextPageTarget {
                page_index: page.page_index,
            })
        }
        PageArtifactTextSelectionMovementTarget::Boundary { boundary, scope } => {
            LayoutTextSelectionMovementTarget::Boundary {
                boundary,
                scope: layout_page_range(scope),
            }
        }
    }
}

fn source_point(point: LayoutSourcePoint) -> PageArtifactSourcePoint {
    PageArtifactSourcePoint {
        node_path: point.node_path,
        text_offset: point.text_offset,
    }
}

fn text_caret(caret: LayoutTextCaret) -> PageArtifactTextCaret {
    PageArtifactTextCaret {
        address: caret.address,
        geometry: caret.geometry,
        source_point: source_point(caret.source_point),
    }
}

fn text_caret_resolution(resolution: LayoutTextCaretResolution) -> PageArtifactTextCaretResolution {
    match resolution {
        LayoutTextCaretResolution::Resolved(caret) => {
            PageArtifactTextCaretResolution::Resolved(text_caret(caret))
        }
        LayoutTextCaretResolution::Unavailable(reason) => {
            PageArtifactTextCaretResolution::Unavailable(reason)
        }
        LayoutTextCaretResolution::Miss => PageArtifactTextCaretResolution::Miss,
    }
}

fn exact_range_resolution(
    resolution: LayoutExactTextRangeResolution,
) -> PageArtifactExactTextRangeResolution {
    match resolution {
        LayoutExactTextRangeResolution::Resolved(range) => {
            PageArtifactExactTextRangeResolution::Resolved(Box::new(exact_text_range(*range)))
        }
        LayoutExactTextRangeResolution::Unavailable(reason) => {
            PageArtifactExactTextRangeResolution::Unavailable(reason)
        }
    }
}

fn exact_text_range(range: LayoutExactTextRange) -> PageArtifactExactTextRange {
    PageArtifactExactTextRange {
        anchor: range.anchor,
        focus: range.focus,
        start: range.start,
        end: range.end,
        selected_text: range.selected_text,
        exact_source_segments: range.exact_source_segments,
        source_start: source_point(range.source_start),
        source_end: source_point(range.source_end),
        rects: range.rects.into_iter().map(exact_range_rect).collect(),
    }
}

fn exact_range_rect(rect: ExactTextRangeRect) -> PageArtifactExactTextRangeRect {
    PageArtifactExactTextRangeRect {
        page_index: rect.page_index,
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

fn range_from_points_resolution(
    resolution: LayoutTextRangeFromPointsResolution,
) -> PageArtifactTextRangeFromPointsResolution {
    match resolution {
        LayoutTextRangeFromPointsResolution::Resolved(selection) => {
            PageArtifactTextRangeFromPointsResolution::Resolved(Box::new(range_from_points(
                *selection,
            )))
        }
        LayoutTextRangeFromPointsResolution::Unavailable(reason) => {
            PageArtifactTextRangeFromPointsResolution::Unavailable(reason)
        }
        LayoutTextRangeFromPointsResolution::Miss => {
            PageArtifactTextRangeFromPointsResolution::Miss
        }
    }
}

fn range_from_points(selection: LayoutTextRangeFromPoints) -> PageArtifactTextRangeFromPoints {
    PageArtifactTextRangeFromPoints {
        anchor_caret: text_caret(selection.anchor_caret),
        focus_caret: text_caret(selection.focus_caret),
        range: Box::new(exact_text_range(*selection.range)),
    }
}

fn movement_resolution(
    resolution: LayoutTextSelectionMovementResolution,
) -> PageArtifactTextSelectionMovementResolution {
    match resolution {
        LayoutTextSelectionMovementResolution::Resolved(selection) => {
            PageArtifactTextSelectionMovementResolution::Resolved(Box::new(movement(*selection)))
        }
        LayoutTextSelectionMovementResolution::Boundary(boundary) => {
            PageArtifactTextSelectionMovementResolution::Boundary(boundary)
        }
        LayoutTextSelectionMovementResolution::Unavailable(reason) => {
            PageArtifactTextSelectionMovementResolution::Unavailable(reason)
        }
    }
}

fn movement(selection: LayoutTextSelectionMovement) -> PageArtifactTextSelectionMovement {
    PageArtifactTextSelectionMovement {
        anchor_caret: text_caret(selection.anchor_caret),
        focus_caret: text_caret(selection.focus_caret),
        range: Box::new(exact_text_range(*selection.range)),
        preferred_inline_position: selection.preferred_inline_position,
        preferred_block_position: selection.preferred_block_position,
    }
}
