//! The final pass of the lowering: every primitive resolved in CSS pixels
//! becomes device pixels by one uniform scale. Lengths, positions, stroke
//! widths, dash cadences, blur sigmas and tile steps all scale; colours,
//! styles, angles, scale factors and an image's source rect (image pixels)
//! stay.
//!
//! Text runs are the one primitive that stays in CSS pixels. Glyph
//! rasterization is a function of the CSS font size under the device
//! scale, not of the device size: the synthetic-bold outset grows with
//! the size the font was asked for (a 26px bold run at 2× rasters the
//! DOM's ink only when drawn as 26px under a 2× transform — 3 pixels off
//! at Δ1; drawn as 52px on the device grid it misses 6327 pixels at Δ133,
//! and no device size between 51.6 and 52.6 reproduces it), and the
//! glyph placement grid is 1/64 of a CSS pixel. A renderer draws a run
//! under `scale(ratio)` with the numbers as they arrive.

use super::{
    DevicePath, DevicePoint, DeviceRect, DeviceTransform, Ground, PathOp, Primitive, TilePlan,
};

pub(super) fn primitive(primitive: &mut Primitive, ratio: f64) {
    match primitive {
        Primitive::PushState
        | Primitive::PopState
        | Primitive::Opacity { .. }
        | Primitive::Text(_)
        | Primitive::Ruby(_) => {}
        Primitive::Translate { dx, dy } => {
            *dx *= ratio;
            *dy *= ratio;
        }
        Primitive::Transform { origin, transforms } => {
            origin.scale(ratio);
            for transform in transforms {
                if let DeviceTransform::Translate { dx, dy } = transform {
                    *dx *= ratio;
                    *dy *= ratio;
                }
            }
        }
        Primitive::ClipPath { path } => path.scale(ratio),
        Primitive::FillRect { rect, ground, .. } => {
            rect.scale(ratio);
            ground.scale(ratio);
        }
        Primitive::FillPath { path, ground, .. } => {
            path.scale(ratio);
            ground.scale(ratio);
        }
        Primitive::StrokePath {
            path, width, dash, ..
        } => {
            path.scale(ratio);
            *width *= ratio;
            if let Some(dash) = dash {
                dash.on *= ratio;
                dash.off *= ratio;
            }
        }
        Primitive::Shadow {
            shape,
            sigma,
            offset,
            clip_out,
            ..
        } => {
            shape.scale(ratio);
            *sigma *= ratio;
            offset.scale(ratio);
            if let Some(clip_out) = clip_out {
                clip_out.scale(ratio);
            }
        }
        Primitive::DrawImage { dest, tiles, .. } => {
            dest.scale(ratio);
            if let Some(tiles) = tiles {
                tiles.scale(ratio);
            }
        }
    }
}

impl DevicePoint {
    fn scale(&mut self, ratio: f64) {
        self.x *= ratio;
        self.y *= ratio;
    }
}

impl DeviceRect {
    fn scale(&mut self, ratio: f64) {
        self.x *= ratio;
        self.y *= ratio;
        self.width *= ratio;
        self.height *= ratio;
    }
}

impl DevicePath {
    fn scale(&mut self, ratio: f64) {
        for op in &mut self.ops {
            match op {
                PathOp::MoveTo(point) | PathOp::LineTo(point) => point.scale(ratio),
                PathOp::Arc { center, rx, ry, .. } | PathOp::Ellipse { center, rx, ry } => {
                    center.scale(ratio);
                    *rx *= ratio;
                    *ry *= ratio;
                }
                PathOp::Rect(rect) => rect.scale(ratio),
                PathOp::Close => {}
            }
        }
    }
}

impl Ground {
    fn scale(&mut self, ratio: f64) {
        if let Self::Block(rect) = self {
            rect.scale(ratio);
        }
    }
}

impl TilePlan {
    fn scale(&mut self, ratio: f64) {
        self.origin.scale(ratio);
        self.step_x *= ratio;
        self.step_y *= ratio;
    }
}
