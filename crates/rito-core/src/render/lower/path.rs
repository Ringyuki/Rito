//! Device-space outlines the lowering fills, strokes and clips with.

use std::f64::consts::{FRAC_PI_2, PI};

use super::{DevicePath, DevicePoint, DeviceRect, PathOp};

/// CSS Backgrounds §5.5 overlap scaling for one radius pair: when either
/// axis would make adjacent corners cross on a short edge, both axes shrink
/// by the same factor. Clamping each axis on its own keeps the long axis at
/// its authored radius and turns a wide `border-radius: 30px` badge into an
/// ellipse where the browser draws a stadium with straight segments.
fn overlap_scale(width: f64, height: f64, rx: f64, ry: f64) -> f64 {
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
    let (rx, ry) = (rx * scale, ry * scale);
    let (left, top, right, bottom) = (rect.x, rect.y, rect.right(), rect.bottom());
    let corner = |center: DevicePoint, start: f64| PathOp::Arc {
        center,
        rx,
        ry,
        start,
        sweep: FRAC_PI_2,
    };
    DevicePath {
        ops: vec![
            PathOp::MoveTo(DevicePoint::new(left + rx, top)),
            PathOp::LineTo(DevicePoint::new(right - rx, top)),
            corner(DevicePoint::new(right - rx, top + ry), -FRAC_PI_2),
            PathOp::LineTo(DevicePoint::new(right, bottom - ry)),
            corner(DevicePoint::new(right - rx, bottom - ry), 0.0),
            PathOp::LineTo(DevicePoint::new(left + rx, bottom)),
            corner(DevicePoint::new(left + rx, bottom - ry), FRAC_PI_2),
            PathOp::LineTo(DevicePoint::new(left, top + ry)),
            corner(DevicePoint::new(left + rx, top + ry), PI),
            PathOp::Close,
        ],
    }
}
