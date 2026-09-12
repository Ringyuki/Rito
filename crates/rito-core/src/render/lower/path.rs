//! Device-space outlines the lowering fills, strokes and clips with.

use std::f64::consts::{FRAC_PI_2, PI};

use super::{DevicePath, DevicePoint, DeviceRect, PathOp};

/// CSS Backgrounds §5.5 overlap scaling for one radius pair: when either
/// axis would make adjacent corners cross on a short edge, both axes shrink
/// by the same factor. Clamping each axis on its own keeps the long axis at
/// its authored radius and turns a wide `border-radius: 30px` badge into an
/// ellipse where the browser draws a stadium with straight segments.
pub(super) fn overlap_scale(width: f64, height: f64, rx: f64, ry: f64) -> f64 {
    let along_x = if rx > 0.0 { width / (2.0 * rx) } else { 1.0 };
    let along_y = if ry > 0.0 { height / (2.0 * ry) } else { 1.0 };
    along_x.min(along_y).min(1.0)
}

/// The clockwise outline of `rect` with elliptical corners of `rx` by `ry`
/// (overlap-scaled), or the plain rectangle when both radii are zero.
pub(super) fn rounded_rect(rect: DeviceRect, rx: f64, ry: f64) -> DevicePath {
    let rx = rx.max(0.0);
    let ry = ry.max(0.0);
    if rx <= 0.0 && ry <= 0.0 {
        return DevicePath {
            ops: vec![PathOp::Rect(rect)],
        };
    }
    let scale = overlap_scale(rect.width, rect.height, rx, ry);
    corner_outline(rect, [(rx * scale, ry * scale); 4])
}

/// The clockwise outline of `rect` with circular corner radii in CSS order
/// (top-left, top-right, bottom-right, bottom-left), shrunk by one factor
/// so adjacent corners never cross on a short edge.
pub(super) fn corner_rounded_rect(rect: DeviceRect, corners: [f64; 4]) -> DevicePath {
    let [tl, tr, br, bl] = corners.map(|corner| corner.max(0.0));
    let ratio = |extent: f64, sum: f64| extent / sum.max(1e-6);
    let factor = ratio(rect.width, tl + tr)
        .min(ratio(rect.width, bl + br))
        .min(ratio(rect.height, tl + bl))
        .min(ratio(rect.height, tr + br))
        .min(1.0);
    corner_outline(
        rect,
        [
            (tl * factor, tl * factor),
            (tr * factor, tr * factor),
            (br * factor, br * factor),
            (bl * factor, bl * factor),
        ],
    )
}

/// The padding-box outline of an unequal-width rounded border: each corner
/// is an elliptical arc whose x radius insets by that corner's vertical edge
/// and whose y radius insets by its horizontal edge, each axis capped at
/// half the box (a uniform inner radius bulged the thin sides of a badge
/// ring and starved the thick one). Corners in CSS order.
pub(super) fn inner_elliptical_rect(rect: DeviceRect, corners: [(f64, f64); 4]) -> DevicePath {
    let cap = |value: f64, limit: f64| value.max(0.0).min(limit / 2.0);
    corner_outline(
        rect,
        corners.map(|(rx, ry)| (cap(rx, rect.width), cap(ry, rect.height))),
    )
}

/// A closed polygon through `points`, in order.
pub(super) fn polygon(points: &[DevicePoint]) -> DevicePath {
    let mut ops = Vec::with_capacity(points.len() + 1);
    for (index, point) in points.iter().enumerate() {
        ops.push(if index == 0 {
            PathOp::MoveTo(*point)
        } else {
            PathOp::LineTo(*point)
        });
    }
    ops.push(PathOp::Close);
    DevicePath { ops }
}

/// The wedge a border side owns on a rounded box: the box centre and the
/// side's two corners.
pub(super) fn triangle(a: DevicePoint, b: DevicePoint, c: DevicePoint) -> DevicePath {
    DevicePath {
        ops: vec![
            PathOp::MoveTo(a),
            PathOp::LineTo(b),
            PathOp::LineTo(c),
            PathOp::Close,
        ],
    }
}

/// Clockwise from the top-left corner's end; a corner with no radius is a
/// plain vertex.
fn corner_outline(rect: DeviceRect, corners: [(f64, f64); 4]) -> DevicePath {
    let [(tlx, tly), (trx, try_), (brx, bry), (blx, bly)] = corners;
    let (left, top, right, bottom) = (rect.x, rect.y, rect.right(), rect.bottom());
    let mut ops = vec![PathOp::MoveTo(DevicePoint::new(left + tlx, top))];
    let mut corner = |to: DevicePoint, center: DevicePoint, rx: f64, ry: f64, start: f64| {
        ops.push(PathOp::LineTo(to));
        if rx > 0.0 || ry > 0.0 {
            ops.push(PathOp::Arc {
                center,
                rx,
                ry,
                start,
                sweep: FRAC_PI_2,
            });
        }
    };
    corner(
        DevicePoint::new(right - trx, top),
        DevicePoint::new(right - trx, top + try_),
        trx,
        try_,
        -FRAC_PI_2,
    );
    corner(
        DevicePoint::new(right, bottom - bry),
        DevicePoint::new(right - brx, bottom - bry),
        brx,
        bry,
        0.0,
    );
    corner(
        DevicePoint::new(left + blx, bottom),
        DevicePoint::new(left + blx, bottom - bly),
        blx,
        bly,
        FRAC_PI_2,
    );
    corner(
        DevicePoint::new(left, top + tly),
        DevicePoint::new(left + tlx, top + tly),
        tlx,
        tly,
        PI,
    );
    ops.push(PathOp::Close);
    DevicePath { ops }
}
