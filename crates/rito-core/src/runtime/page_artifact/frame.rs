//! Where a page's records land on the page as it is drawn.
//!
//! Records are logical: x runs along a line (the inline axis) and y across
//! lines (the block axis), from the content box's start, the way the page
//! was laid out. A horizontal page draws them as laid out; a vertical-rl
//! page was laid out in the swapped frame and paints each line as a column
//! in from the content box's right edge, so its records turn the same way
//! where they leave the engine.

use super::PageArtifactRect;

/// The writing mode a page's lines were laid out in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::runtime) enum PageWritingMode {
    HorizontalTb,
    VerticalRl,
}

/// Where the content box a page's records are laid out in sits on the page
/// as drawn.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::runtime) enum PageRecordFrame {
    /// Lines run rightwards from `left` and stack downwards from `top`.
    HorizontalTb { left: f64, top: f64 },
    /// Lines run downwards from `top` and stack leftwards from `right`.
    VerticalRl { right: f64, top: f64 },
}

impl PageRecordFrame {
    pub(in crate::runtime) fn writing_mode(self) -> PageWritingMode {
        match self {
            Self::HorizontalTb { .. } => PageWritingMode::HorizontalTb,
            Self::VerticalRl { .. } => PageWritingMode::VerticalRl,
        }
    }

    /// The frame moved by `dx` across the drawing: a page in a spread's
    /// second slot.
    pub(in crate::runtime) fn moved_right(self, dx: f64) -> Self {
        match self {
            Self::HorizontalTb { left, top } => Self::HorizontalTb {
                left: left + dx,
                top,
            },
            Self::VerticalRl { right, top } => Self::VerticalRl {
                right: right + dx,
                top,
            },
        }
    }

    /// A record's rect as drawn.
    pub(in crate::runtime) fn rect(self, rect: PageArtifactRect) -> PageArtifactRect {
        match self {
            Self::HorizontalTb { left, top } => PageArtifactRect {
                x: left + rect.x,
                y: top + rect.y,
                ..rect
            },
            Self::VerticalRl { right, top } => PageArtifactRect {
                x: right - rect.y - rect.height,
                y: top + rect.x,
                width: rect.height,
                height: rect.width,
            },
        }
    }

    /// A drawn point in record coordinates.
    pub(in crate::runtime) fn point(self, x: f64, y: f64) -> (f64, f64) {
        match self {
            Self::HorizontalTb { left, top } => (x - left, y - top),
            Self::VerticalRl { right, top } => (y - top, right - x),
        }
    }

    /// A caret as drawn: the segment across the line at record inline
    /// position `x`, from block position `y` for `height`, as a rect with no
    /// extent along the line.
    pub(in crate::runtime) fn caret(self, x: f64, y: f64, height: f64) -> PageArtifactRect {
        self.rect(PageArtifactRect {
            x,
            y,
            width: 0.0,
            height,
        })
    }

    /// Where record block position `y` sits from the block-start edge of a
    /// drawing `extent` long along the block axis: its top, or its right
    /// edge for vertical lines.
    pub(in crate::runtime) fn block_offset(self, y: f64, extent: f64) -> f64 {
        match self {
            Self::HorizontalTb { top, .. } => top + y,
            Self::VerticalRl { right, .. } => extent - right + y,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RECT: PageArtifactRect = PageArtifactRect {
        x: 10.0,
        y: 30.0,
        width: 48.0,
        height: 20.0,
    };

    #[test]
    fn a_horizontal_frame_moves_records_onto_the_content_box() {
        let frame = PageRecordFrame::HorizontalTb {
            left: 24.0,
            top: 32.0,
        };
        assert_eq!(
            frame.rect(RECT),
            PageArtifactRect {
                x: 34.0,
                y: 62.0,
                ..RECT
            }
        );
        assert_eq!(frame.point(34.0, 62.0), (10.0, 30.0));
        assert_eq!(frame.block_offset(30.0, 640.0), 62.0);
    }

    #[test]
    fn a_vertical_frame_turns_lines_into_columns_in_from_its_right_edge() {
        let frame = PageRecordFrame::VerticalRl {
            right: 396.0,
            top: 24.0,
        };
        // Block 30..50 in from the right edge, inline 10..58 down from the
        // top: a column 20 wide whose right edge is 30 left of 396.
        let drawn = frame.rect(RECT);
        assert_eq!(
            drawn,
            PageArtifactRect {
                x: 346.0,
                y: 34.0,
                width: 20.0,
                height: 48.0,
            }
        );
        // The point a record's corner draws at reads back to that corner.
        assert_eq!(frame.point(drawn.x + drawn.width, drawn.y), (10.0, 30.0));
        // A caret runs across its column, with no height along it.
        assert_eq!(
            frame.caret(10.0, 30.0, 20.0),
            PageArtifactRect {
                x: 346.0,
                y: 34.0,
                width: 20.0,
                height: 0.0,
            }
        );
        // From the right edge of a 420 wide drawing: its 24 margin, then
        // the 30 in from the content box.
        assert_eq!(frame.block_offset(30.0, 420.0), 54.0);
        assert_eq!(frame.moved_right(440.0).rect(RECT).x, 786.0);
    }
}
