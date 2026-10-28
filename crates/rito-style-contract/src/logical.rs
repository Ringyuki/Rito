//! Flow-relative geometry (CSS Writing Modes 3 §6): which physical side
//! a box's inline and block edges fall on under its writing mode and
//! direction, and which physical axis carries each of its sizes. Layout
//! reads box styles through this mapping and stays in flow-relative
//! terms; what paints or hit-tests converts back.

use crate::{Direction, PhysicalSides, WritingMode};

/// A box's writing mode together with its inline base direction: what
/// decides the physical side of each flow-relative edge.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct WritingDirection {
    /// Block/inline axis orientation.
    pub mode: WritingMode,
    /// Whether the inline axis runs against its physical direction.
    pub direction: Direction,
}

impl WritingDirection {
    /// Horizontal lines stacking downwards, left to right: the initial
    /// writing mode and direction.
    pub const HORIZONTAL_LTR: Self = Self {
        mode: WritingMode::HorizontalTopToBottom,
        direction: Direction::LeftToRight,
    };

    /// Whether lines run horizontally.
    pub fn is_horizontal(self) -> bool {
        self.mode == WritingMode::HorizontalTopToBottom
    }

    /// Whether the block axis progresses from right to left (vertical-rl),
    /// so a block-start edge is the physical right.
    pub fn is_flipped_blocks(self) -> bool {
        self.mode == WritingMode::VerticalRightToLeft
    }

    /// Whether the inline axis runs from the physical right (or bottom)
    /// towards the left (or top).
    pub fn is_rtl(self) -> bool {
        self.direction == Direction::RightToLeft
    }

    /// Whether `other`'s lines run along the same physical axis as these:
    /// a box whose writing mode is not parallel to its container's is an
    /// orthogonal flow root.
    pub fn is_parallel_to(self, other: Self) -> bool {
        self.is_horizontal() == other.is_horizontal()
    }

    /// A physical width and height as this writing mode's inline and block
    /// sizes.
    pub fn axes<T>(self, width: T, height: T) -> LogicalAxes<T> {
        if self.is_horizontal() {
            LogicalAxes {
                inline: width,
                block: height,
            }
        } else {
            LogicalAxes {
                inline: height,
                block: width,
            }
        }
    }

    /// Inline and block sizes as the physical width and height.
    pub fn physical_axes<T>(self, axes: LogicalAxes<T>) -> (T, T) {
        if self.is_horizontal() {
            (axes.inline, axes.block)
        } else {
            (axes.block, axes.inline)
        }
    }
}

/// A value per flow-relative axis.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct LogicalAxes<T> {
    /// Along the lines.
    pub inline: T,
    /// Across the lines, in the direction blocks stack.
    pub block: T,
}

/// A value per flow-relative edge.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct LogicalSides<T> {
    /// Where lines start.
    pub inline_start: T,
    /// Where lines end.
    pub inline_end: T,
    /// Where the first line sits.
    pub block_start: T,
    /// Where the last line sits.
    pub block_end: T,
}

impl<T: Copy> PhysicalSides<T> {
    /// These sides as the edges of a box laid out in `writing`.
    pub fn to_logical(self, writing: WritingDirection) -> LogicalSides<T> {
        let (block_start, block_end, inline_low, inline_high) = match writing.mode {
            WritingMode::HorizontalTopToBottom => (self.top, self.bottom, self.left, self.right),
            WritingMode::VerticalRightToLeft => (self.right, self.left, self.top, self.bottom),
            WritingMode::VerticalLeftToRight => (self.left, self.right, self.top, self.bottom),
        };
        let (inline_start, inline_end) = if writing.is_rtl() {
            (inline_high, inline_low)
        } else {
            (inline_low, inline_high)
        };
        LogicalSides {
            inline_start,
            inline_end,
            block_start,
            block_end,
        }
    }
}

impl<T: Copy> LogicalSides<T> {
    /// These edges as the physical sides of a box laid out in `writing`.
    pub fn to_physical(self, writing: WritingDirection) -> PhysicalSides<T> {
        let (inline_low, inline_high) = if writing.is_rtl() {
            (self.inline_end, self.inline_start)
        } else {
            (self.inline_start, self.inline_end)
        };
        match writing.mode {
            WritingMode::HorizontalTopToBottom => PhysicalSides {
                top: self.block_start,
                right: inline_high,
                bottom: self.block_end,
                left: inline_low,
            },
            WritingMode::VerticalRightToLeft => PhysicalSides {
                top: inline_low,
                right: self.block_start,
                bottom: inline_high,
                left: self.block_end,
            },
            WritingMode::VerticalLeftToRight => PhysicalSides {
                top: inline_low,
                right: self.block_end,
                bottom: inline_high,
                left: self.block_start,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIDES: PhysicalSides<char> = PhysicalSides {
        top: 't',
        right: 'r',
        bottom: 'b',
        left: 'l',
    };

    fn writing(mode: WritingMode, direction: Direction) -> WritingDirection {
        WritingDirection { mode, direction }
    }

    #[test]
    fn each_writing_mode_puts_the_flow_edges_on_its_physical_sides() {
        // (inline-start, inline-end, block-start, block-end), per
        // css-writing-modes-3 §6.4's table.
        let cases = [
            (
                WritingMode::HorizontalTopToBottom,
                Direction::LeftToRight,
                "lrtb",
            ),
            (
                WritingMode::HorizontalTopToBottom,
                Direction::RightToLeft,
                "rltb",
            ),
            (
                WritingMode::VerticalRightToLeft,
                Direction::LeftToRight,
                "tbrl",
            ),
            (
                WritingMode::VerticalRightToLeft,
                Direction::RightToLeft,
                "btrl",
            ),
            (
                WritingMode::VerticalLeftToRight,
                Direction::LeftToRight,
                "tblr",
            ),
            (
                WritingMode::VerticalLeftToRight,
                Direction::RightToLeft,
                "btlr",
            ),
        ];
        for (mode, direction, expected) in cases {
            let logical = SIDES.to_logical(writing(mode, direction));
            let got: String = [
                logical.inline_start,
                logical.inline_end,
                logical.block_start,
                logical.block_end,
            ]
            .iter()
            .collect();
            assert_eq!(got, expected, "{mode:?} {direction:?}");
            assert_eq!(
                logical.to_physical(writing(mode, direction)),
                SIDES,
                "{mode:?} {direction:?} round trip"
            );
        }
    }

    #[test]
    fn a_vertical_box_reads_its_height_as_its_inline_size() {
        let vertical = writing(WritingMode::VerticalRightToLeft, Direction::LeftToRight);
        let axes = vertical.axes("width", "height");
        assert_eq!((axes.inline, axes.block), ("height", "width"));
        assert_eq!(vertical.physical_axes(axes), ("width", "height"));
        let horizontal = WritingDirection::HORIZONTAL_LTR.axes("width", "height");
        assert_eq!((horizontal.inline, horizontal.block), ("width", "height"));
        assert!(!vertical.is_parallel_to(WritingDirection::HORIZONTAL_LTR));
    }
}
