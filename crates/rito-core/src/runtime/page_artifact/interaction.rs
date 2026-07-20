//! Engine-neutral text-interaction queries over retained page artifacts.

use crate::interaction::{
    TextCaretAddress, TextCaretGeometry, TextInteractionUnavailableReason, TextSelectionBoundary,
    TextSelectionMovement,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::runtime) struct PageArtifactSourcePoint {
    pub(in crate::runtime) node_path: Vec<usize>,
    pub(in crate::runtime) text_offset: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub(in crate::runtime) struct PageArtifactTextCaret {
    pub(in crate::runtime) address: TextCaretAddress,
    pub(in crate::runtime) geometry: TextCaretGeometry,
    pub(in crate::runtime) source_point: PageArtifactSourcePoint,
}

#[derive(Debug, Clone, PartialEq)]
pub(in crate::runtime) enum PageArtifactTextCaretResolution {
    Resolved(PageArtifactTextCaret),
    Unavailable(TextInteractionUnavailableReason),
    Miss,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::runtime) struct PageArtifactExactTextRangeRect {
    pub(in crate::runtime) page_index: usize,
    pub(in crate::runtime) x: f64,
    pub(in crate::runtime) y: f64,
    pub(in crate::runtime) width: f64,
    pub(in crate::runtime) height: f64,
    pub(in crate::runtime) block_index: usize,
    pub(in crate::runtime) line_index: usize,
    pub(in crate::runtime) run_index: usize,
    pub(in crate::runtime) start_char_index: usize,
    pub(in crate::runtime) end_char_index: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub(in crate::runtime) struct PageArtifactExactTextRange {
    pub(in crate::runtime) anchor: TextCaretAddress,
    pub(in crate::runtime) focus: TextCaretAddress,
    pub(in crate::runtime) start: TextCaretAddress,
    pub(in crate::runtime) end: TextCaretAddress,
    pub(in crate::runtime) selected_text: String,
    pub(in crate::runtime) exact_source_segments: Vec<String>,
    pub(in crate::runtime) source_start: PageArtifactSourcePoint,
    pub(in crate::runtime) source_end: PageArtifactSourcePoint,
    pub(in crate::runtime) rects: Vec<PageArtifactExactTextRangeRect>,
}

#[derive(Debug, Clone, PartialEq)]
pub(in crate::runtime) enum PageArtifactExactTextRangeResolution {
    Resolved(Box<PageArtifactExactTextRange>),
    Unavailable(TextInteractionUnavailableReason),
}

#[derive(Debug, Clone, PartialEq)]
pub(in crate::runtime) struct PageArtifactTextRangeFromPoints {
    pub(in crate::runtime) anchor_caret: PageArtifactTextCaret,
    pub(in crate::runtime) focus_caret: PageArtifactTextCaret,
    pub(in crate::runtime) range: Box<PageArtifactExactTextRange>,
}

#[derive(Debug, Clone, PartialEq)]
pub(in crate::runtime) enum PageArtifactTextRangeFromPointsResolution {
    Resolved(Box<PageArtifactTextRangeFromPoints>),
    Unavailable(TextInteractionUnavailableReason),
    Miss,
}

#[derive(Debug, Clone, PartialEq)]
pub(in crate::runtime) struct PageArtifactTextSelectionMovement {
    pub(in crate::runtime) anchor_caret: PageArtifactTextCaret,
    pub(in crate::runtime) focus_caret: PageArtifactTextCaret,
    pub(in crate::runtime) range: Box<PageArtifactExactTextRange>,
    pub(in crate::runtime) preferred_inline_position: Option<f64>,
    pub(in crate::runtime) preferred_block_position: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub(in crate::runtime) enum PageArtifactTextSelectionMovementResolution {
    Resolved(Box<PageArtifactTextSelectionMovement>),
    Boundary(TextSelectionBoundary),
    Unavailable(TextInteractionUnavailableReason),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::runtime) struct PageArtifactTextPoint {
    pub(in crate::runtime) page_index: usize,
    pub(in crate::runtime) x: f64,
    pub(in crate::runtime) y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::runtime) struct PageArtifactTextPageRange {
    pub(in crate::runtime) first_page: usize,
    pub(in crate::runtime) last_page: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::runtime) struct PageArtifactTextPageTarget {
    pub(in crate::runtime) page_index: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::runtime) enum PageArtifactTextSelectionMovementTarget {
    Scope(PageArtifactTextPageRange),
    Page(PageArtifactTextPageTarget),
    Boundary {
        boundary: TextSelectionBoundary,
        scope: PageArtifactTextPageRange,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::runtime) enum PageArtifactTextSelectionGranularity {
    Word,
    Paragraph,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::runtime) struct PageArtifactExactSourceRangeQuery {
    pub(in crate::runtime) first_page: usize,
    pub(in crate::runtime) last_page: usize,
    pub(in crate::runtime) start: PageArtifactSourcePoint,
    pub(in crate::runtime) end: PageArtifactSourcePoint,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::runtime) struct PageArtifactTextCaretQuery {
    pub(in crate::runtime) page_index: usize,
    pub(in crate::runtime) x: f64,
    pub(in crate::runtime) y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::runtime) struct PageArtifactTextRangeQuery {
    pub(in crate::runtime) anchor: TextCaretAddress,
    pub(in crate::runtime) focus: TextCaretAddress,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::runtime) struct PageArtifactTextRangeToPointQuery {
    pub(in crate::runtime) anchor: TextCaretAddress,
    pub(in crate::runtime) focus: PageArtifactTextPoint,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::runtime) struct PageArtifactTextRangeFromPointsQuery<'a> {
    pub(in crate::runtime) anchor: PageArtifactTextPoint,
    pub(in crate::runtime) focus: PageArtifactTextPoint,
    pub(in crate::runtime) granularity: PageArtifactTextSelectionGranularity,
    pub(in crate::runtime) language: Option<&'a str>,
    pub(in crate::runtime) scope: PageArtifactTextPageRange,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::runtime) struct PageArtifactTextSelectionMovementQuery<'a> {
    pub(in crate::runtime) scope: PageArtifactTextPageRange,
    pub(in crate::runtime) anchor_address: TextCaretAddress,
    pub(in crate::runtime) focus_address: TextCaretAddress,
    pub(in crate::runtime) movement: TextSelectionMovement,
    pub(in crate::runtime) language: Option<&'a str>,
    pub(in crate::runtime) preferred_inline_position: Option<f64>,
    pub(in crate::runtime) preferred_block_position: Option<f64>,
    pub(in crate::runtime) target: PageArtifactTextSelectionMovementTarget,
}
