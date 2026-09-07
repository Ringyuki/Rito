//! Block decoration: a plain background over a straight-edged border box.

use super::super::commands::contract::{
    ReaderBlockBorderV1, ReaderBlockPaintV1, ReaderBlockRadiusV1, ReaderBorderBoxV1,
    ReaderBorderEdgePaintV1, ReaderRectV1,
};
use super::{
    border::{stroke_edge, Edge},
    scale, DevicePoint, DeviceRect, Ground, Primitive,
};

pub(super) fn lower_block(
    rect: &ReaderRectV1,
    paint: &ReaderBlockPaintV1,
    border_box: Option<&ReaderBorderBoxV1>,
    ratio: f64,
    out: &mut Vec<Primitive>,
) {
    let device = DeviceRect::scaled(rect, ratio);
    if !lowers_fully(paint) {
        out.push(Primitive::Block {
            rect: device,
            paint: scale::block_paint(paint, ratio),
            border_box: border_box.map(|widths| scale::border_box(widths, ratio)),
        });
        return;
    }
    // The browser paints a block's background, then its borders top,
    // bottom, left, right; where bands meet at a corner the later edge wins.
    let snapped = device.snapped();
    if let Some(color) = paint
        .background
        .as_ref()
        .and_then(|background| background.color)
    {
        // A plain background rasters on whole device pixels, each edge
        // rounding independently: the same binary band the border law uses.
        // A float fill at x 57.65625 bled 34% white over a frame's binary
        // 1px border column and greyed it to 88/255; the browser keeps the
        // border column untouched.
        if !snapped.is_empty() {
            let ground = if color.alpha >= 1.0 {
                Ground::Block
            } else {
                Ground::None
            };
            out.push(Primitive::FillRect {
                rect: snapped,
                color,
                ground,
            });
        }
    }
    if let (Some(border), Some(widths)) = (paint.border.as_ref(), border_box) {
        straight_borders(snapped, border, widths, ratio, out);
    }
}

/// Whether every rule the block needs is lowered here: straight edges over
/// a plain background. Rounded corners, box shadows and background images
/// still belong to the renderer.
fn lowers_fully(paint: &ReaderBlockPaintV1) -> bool {
    let rounded = match paint.radius {
        None => false,
        Some(ReaderBlockRadiusV1::Px(value) | ReaderBlockRadiusV1::Percent(value)) => value > 0.0,
        Some(ReaderBlockRadiusV1::Corners(corners)) => corners.iter().any(|value| *value > 0.0),
    };
    let shadowed = !paint.box_shadows.is_empty();
    let imaged = paint
        .background
        .as_ref()
        .is_some_and(|background| background.image.is_some());
    !(rounded || shadowed || imaged)
}

fn straight_borders(
    snapped: DeviceRect,
    border: &ReaderBlockBorderV1,
    widths: &ReaderBorderBoxV1,
    ratio: f64,
    out: &mut Vec<Primitive>,
) {
    let (left, top, right, bottom) = (snapped.x, snapped.y, snapped.right(), snapped.bottom());
    let edge = |paint: Option<ReaderBorderEdgePaintV1>, width: f64| {
        paint.map(|paint| Edge {
            width: width * ratio,
            color: paint.color,
            style: paint.style,
        })
    };
    if let Some(edge) = edge(border.top, widths.top_width) {
        let center = top + edge.width / 2.0;
        stroke_edge(
            edge,
            DevicePoint::new(left, center),
            DevicePoint::new(right, center),
            out,
        );
    }
    if let Some(edge) = edge(border.bottom, widths.bottom_width) {
        let center = bottom - edge.width / 2.0;
        stroke_edge(
            edge,
            DevicePoint::new(left, center),
            DevicePoint::new(right, center),
            out,
        );
    }
    if let Some(edge) = edge(border.left, widths.left_width) {
        let center = left + edge.width / 2.0;
        stroke_edge(
            edge,
            DevicePoint::new(center, top),
            DevicePoint::new(center, bottom),
            out,
        );
    }
    if let Some(edge) = edge(border.right, widths.right_width) {
        let center = right - edge.width / 2.0;
        stroke_edge(
            edge,
            DevicePoint::new(center, top),
            DevicePoint::new(center, bottom),
            out,
        );
    }
}
