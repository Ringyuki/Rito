//! Between a container's flow-relative coordinates and physical ones.
//!
//! Layout places a box's children in the box's own writing mode: a
//! child's [`FragmentRect`] is `x` along the lines from the inline-start
//! edge, `y` across them from the block-start edge, `width` its inline
//! extent and `height` its block extent. What paints or hit-tests needs
//! physical rectangles, relative to the container's top-left corner;
//! [`WritingModeConverter`] turns one into the other for a container of a
//! known physical size, as Blink's `WritingModeConverter` does.

use rito_style_contract::{WritingDirection, WritingMode};

use crate::FragmentRect;

/// Converts rectangles between a container's flow-relative coordinates
/// and physical coordinates relative to its top-left corner.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WritingModeConverter {
    writing: WritingDirection,
    outer_width: f64,
    outer_height: f64,
}

impl WritingModeConverter {
    /// For a container laid out in `writing` whose physical size is
    /// `outer_width` × `outer_height`.
    pub fn new(writing: WritingDirection, outer_width: f64, outer_height: f64) -> Self {
        Self {
            writing,
            outer_width,
            outer_height,
        }
    }

    /// For a container laid out in `writing` whose flow-relative size is
    /// `inline_size` × `block_size`.
    pub fn from_logical_size(writing: WritingDirection, inline_size: f64, block_size: f64) -> Self {
        let (outer_width, outer_height) = if writing.is_horizontal() {
            (inline_size, block_size)
        } else {
            (block_size, inline_size)
        };
        Self::new(writing, outer_width, outer_height)
    }

    /// The writing mode and direction converted from.
    pub fn writing(&self) -> WritingDirection {
        self.writing
    }

    /// The container's physical width and height.
    pub fn outer_size(&self) -> (f64, f64) {
        (self.outer_width, self.outer_height)
    }

    /// A child's flow-relative rectangle as a physical one.
    pub fn to_physical(&self, rect: FragmentRect) -> FragmentRect {
        if self.writing == WritingDirection::HORIZONTAL_LTR {
            return rect;
        }
        let rtl = self.writing.is_rtl();
        match self.writing.mode {
            WritingMode::HorizontalTopToBottom => FragmentRect {
                x: self.outer_width - rect.x - rect.width,
                ..rect
            },
            WritingMode::VerticalRightToLeft | WritingMode::VerticalLeftToRight => {
                let x = if self.writing.is_flipped_blocks() {
                    self.outer_width - rect.y - rect.height
                } else {
                    rect.y
                };
                let y = if rtl {
                    self.outer_height - rect.x - rect.width
                } else {
                    rect.x
                };
                FragmentRect {
                    x,
                    y,
                    width: rect.height,
                    height: rect.width,
                }
            }
        }
    }

    /// A physical rectangle as a child's flow-relative one: the inverse of
    /// [`Self::to_physical`].
    pub fn to_logical(&self, rect: FragmentRect) -> FragmentRect {
        if self.writing == WritingDirection::HORIZONTAL_LTR {
            return rect;
        }
        let rtl = self.writing.is_rtl();
        match self.writing.mode {
            WritingMode::HorizontalTopToBottom => FragmentRect {
                x: self.outer_width - rect.x - rect.width,
                ..rect
            },
            WritingMode::VerticalRightToLeft | WritingMode::VerticalLeftToRight => {
                let block = if self.writing.is_flipped_blocks() {
                    self.outer_width - rect.x - rect.width
                } else {
                    rect.x
                };
                let inline = if rtl {
                    self.outer_height - rect.y - rect.height
                } else {
                    rect.y
                };
                FragmentRect {
                    x: inline,
                    y: block,
                    width: rect.height,
                    height: rect.width,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use rito_style_contract::Direction;

    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> FragmentRect {
        FragmentRect {
            x,
            y,
            width,
            height,
        }
    }

    fn writing(mode: WritingMode, direction: Direction) -> WritingDirection {
        WritingDirection { mode, direction }
    }

    #[test]
    fn a_vertical_rl_child_sits_in_from_the_right_edge() {
        // A 600 wide, 800 tall vertical-rl container: a child 30 into the
        // block axis and 40 down the inline axis, 20 thick and 100 long.
        let converter = WritingModeConverter::new(
            writing(WritingMode::VerticalRightToLeft, Direction::LeftToRight),
            600.0,
            800.0,
        );
        let child = rect(40.0, 30.0, 100.0, 20.0);
        let physical = converter.to_physical(child);
        assert_eq!(physical, rect(550.0, 40.0, 20.0, 100.0));
        assert_eq!(converter.to_logical(physical), child);
    }

    #[test]
    fn each_writing_direction_converts_back_to_where_it_started() {
        let child = rect(40.0, 30.0, 100.0, 20.0);
        let cases = [
            (
                WritingMode::HorizontalTopToBottom,
                Direction::LeftToRight,
                rect(40.0, 30.0, 100.0, 20.0),
            ),
            (
                WritingMode::HorizontalTopToBottom,
                Direction::RightToLeft,
                rect(460.0, 30.0, 100.0, 20.0),
            ),
            (
                WritingMode::VerticalRightToLeft,
                Direction::RightToLeft,
                rect(550.0, 660.0, 20.0, 100.0),
            ),
            (
                WritingMode::VerticalLeftToRight,
                Direction::LeftToRight,
                rect(30.0, 40.0, 20.0, 100.0),
            ),
            (
                WritingMode::VerticalLeftToRight,
                Direction::RightToLeft,
                rect(30.0, 660.0, 20.0, 100.0),
            ),
        ];
        for (mode, direction, expected) in cases {
            let converter = WritingModeConverter::new(writing(mode, direction), 600.0, 800.0);
            assert_eq!(
                converter.to_physical(child),
                expected,
                "{mode:?} {direction:?}"
            );
            assert_eq!(
                converter.to_logical(expected),
                child,
                "{mode:?} {direction:?}"
            );
        }
    }

    #[test]
    fn a_logical_size_names_the_physical_axes_its_mode_puts_it_on() {
        let vertical = WritingModeConverter::from_logical_size(
            writing(WritingMode::VerticalRightToLeft, Direction::LeftToRight),
            800.0,
            600.0,
        );
        assert_eq!(vertical.outer_size(), (600.0, 800.0));
    }
}
