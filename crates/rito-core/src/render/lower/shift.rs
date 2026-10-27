//! Moves a finished list by whole device pixels, the last step before it is
//! encoded: a scrolled window paints and lowers in its chapter's
//! coordinates, where every edge and baseline rounds exactly as it does for
//! the whole chapter, and is then moved onto its own origin. Moving by whole
//! device pixels keeps every rounding where it fell, and doing it in f64
//! before the f32 encoding keeps the window's coordinates small, so a
//! window far down a long chapter rasters as precisely as the first.
//!
//! Every position moves: points, rects, path vertices, a transform's
//! origin, a tile grid's origin. Displacements do not: a translate, a
//! shadow's offset, an icon piece's nudge and every size stay as they are.
//! Text runs, in CSS pixels, move by the same distance in CSS pixels.

use std::sync::Arc;

use super::super::commands::contract::{ReaderCluster, ReaderRect};
use super::{DevicePath, DevicePoint, DeviceRect, Ground, PathOp, Primitive, PrimitiveList};

/// Moves every primitive of `list` by `dx`, `dy` device pixels.
pub(crate) fn shift(list: &mut PrimitiveList, dx: f64, dy: f64) {
    let ratio = list.ratio;
    for primitive in &mut list.commands {
        shift_primitive(primitive, dx, dy, ratio);
    }
}

fn shift_primitive(primitive: &mut Primitive, dx: f64, dy: f64, ratio: f64) {
    match primitive {
        Primitive::PushState
        | Primitive::PopState
        | Primitive::Translate { .. }
        | Primitive::Opacity { .. } => {}
        Primitive::Transform { origin, .. } => origin.shift(dx, dy),
        Primitive::ClipPath { path } => path.shift(dx, dy),
        Primitive::FillRect { rect, ground, .. } => {
            rect.shift(dx, dy);
            ground.shift(dx, dy);
        }
        Primitive::FillPath { path, ground, .. } => {
            path.shift(dx, dy);
            ground.shift(dx, dy);
        }
        Primitive::StrokePath { path, .. } => path.shift(dx, dy),
        Primitive::Shadow {
            shape, clip_out, ..
        } => {
            shape.shift(dx, dy);
            if let Some(clip_out) = clip_out {
                clip_out.shift(dx, dy);
            }
        }
        Primitive::DrawImage { dest, tiles, .. } => {
            dest.shift(dx, dy);
            if let Some(tiles) = tiles {
                tiles.origin.shift(dx, dy);
            }
        }
        Primitive::ImageFallback { block, pieces, .. } => {
            block.shift(dx, dy);
            for piece in pieces {
                if let Some(clip) = &mut piece.clip {
                    clip.shift(dx, dy);
                }
                piece.path.shift(dx, dy);
            }
        }
        Primitive::Text(run) | Primitive::Ruby(run) => {
            let (dx, dy) = (dx / ratio, dy / ratio);
            shift_css_rect(&mut run.rect, dx, dy);
            run.clusters = run
                .clusters
                .iter()
                .map(|cluster| ReaderCluster {
                    x: cluster.x + dx,
                    y: cluster.y + dy,
                    ..*cluster
                })
                .collect::<Arc<[_]>>();
        }
    }
}

fn shift_css_rect(rect: &mut ReaderRect, dx: f64, dy: f64) {
    rect.x += dx;
    rect.y += dy;
}

impl DevicePoint {
    fn shift(&mut self, dx: f64, dy: f64) {
        self.x += dx;
        self.y += dy;
    }
}

impl DeviceRect {
    fn shift(&mut self, dx: f64, dy: f64) {
        self.x += dx;
        self.y += dy;
    }
}

impl DevicePath {
    fn shift(&mut self, dx: f64, dy: f64) {
        for op in &mut self.ops {
            match op {
                PathOp::MoveTo(point) | PathOp::LineTo(point) => point.shift(dx, dy),
                PathOp::Arc { center, .. } | PathOp::Ellipse { center, .. } => {
                    center.shift(dx, dy);
                }
                PathOp::Rect(rect) => rect.shift(dx, dy),
                PathOp::Close => {}
            }
        }
    }
}

impl Ground {
    fn shift(&mut self, dx: f64, dy: f64) {
        if let Self::Block(rect) = self {
            rect.shift(dx, dy);
        }
    }
}
