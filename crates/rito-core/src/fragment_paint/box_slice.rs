//! A box fragment a fragmentainer break cut: the cut edges belong to the
//! box's neighbouring fragments, so this one strokes no border there
//! (`box-decoration-break: slice`, Blink's `SetSidesToInclude`). Its
//! background still fills to the cut, where the box runs on.

use rito_fragment::BlockCuts;

use crate::render::contract::{ReaderBlockPaint, ReaderBorderBox};

use super::VerticalFrame;

/// Drops the border on each of `paint`'s cut edges: the block-start and
/// block-end edges are the top and bottom of a horizontal page, the right
/// and left of a vertical-rl one, the left and right of a vertical-lr one.
pub(super) fn slice_cut_edges(
    paint: &mut ReaderBlockPaint,
    border_box: &mut Option<ReaderBorderBox>,
    cuts: BlockCuts,
    frame: Option<&VerticalFrame>,
) {
    if !cuts.start && !cuts.end {
        return;
    }
    let (start, end) = match frame {
        None => (Side::Top, Side::Bottom),
        Some(frame) if frame.converter.writing().is_flipped_blocks() => (Side::Right, Side::Left),
        Some(_) => (Side::Left, Side::Right),
    };
    for (cut, side) in [(cuts.start, start), (cuts.end, end)] {
        if !cut {
            continue;
        }
        if let Some(border) = paint.border.as_mut() {
            *match side {
                Side::Top => &mut border.top,
                Side::Right => &mut border.right,
                Side::Bottom => &mut border.bottom,
                Side::Left => &mut border.left,
            } = None;
        }
        if let Some(widths) = border_box.as_mut() {
            *match side {
                Side::Top => &mut widths.top_width,
                Side::Right => &mut widths.right_width,
                Side::Bottom => &mut widths.bottom_width,
                Side::Left => &mut widths.left_width,
            } = 0.0;
        }
    }
}

#[derive(Clone, Copy)]
enum Side {
    Top,
    Right,
    Bottom,
    Left,
}
