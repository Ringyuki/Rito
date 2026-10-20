//! The point of a leaf a finger holds, and how far over the leaf must be
//! for that point to show where the finger has it.

use crate::leaf::{leaf_point, pose_at, LeafGrab, LeafShape};

/// A point on the screen: device px from the frame's top-left corner.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// The point of a leaf a finger holds (`u` from the spine outward, `v` from
/// the top down) and how far left of the finger it shows: a finger that
/// takes a leaf in the air beside it keeps that distance.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Hold {
    pub u: f64,
    pub v: f64,
    pub offset: f64,
}

/// The frame a leaf is seen in: its size and how high the eye is over it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct View {
    pub width: f64,
    pub height: f64,
    pub eye: f64,
}

/// A hand takes the leaf no nearer the spine than this share of its width.
pub const NEAREST_HOLD: f64 = 0.35;

/// Where a point in the air shows across the frame, as the eye sees it.
pub(crate) fn seen_across(view: View, x: f64, z: f64) -> f64 {
    view.width / 2.0 + ((x - view.width / 2.0) * view.eye) / (view.eye - z)
}

fn seen_down(view: View, y: f64, z: f64) -> f64 {
    view.height / 2.0 + ((y - view.height / 2.0) * view.eye) / (view.eye - z)
}

/// The hold a finger takes of a leaf lying as `positions` say (a grid of
/// `columns` by `rows` points, as last stored): the point of it that shows
/// nearest the finger, no nearer the spine than a hand turns a leaf by.
pub fn hold_of(positions: &[f32], columns: usize, rows: usize, view: View, finger: Point) -> Hold {
    let first = libm::ceil(NEAREST_HOLD * (columns - 1) as f64) as usize;
    let (mut column_at, mut row_at, mut across_at, mut nearest) =
        (columns - 1, 0usize, finger.x, f64::INFINITY);
    for row in 0..rows {
        for column in first..columns {
            let at = (row * columns + column) * 3;
            let z = f64::from(positions[at + 2]);
            let across = seen_across(view, f64::from(positions[at]), z);
            let down = seen_down(view, f64::from(positions[at + 1]), z);
            let away =
                (across - finger.x) * (across - finger.x) + (down - finger.y) * (down - finger.y);
            if away < nearest {
                column_at = column;
                row_at = row;
                across_at = across;
                nearest = away;
            }
        }
    }
    Hold {
        u: column_at as f64 / (columns - 1) as f64,
        v: row_at as f64 / (rows - 1) as f64,
        offset: finger.x - across_at,
    }
}

/// How far over the leaf must be for the point a finger holds to show where
/// the finger has it, no farther than `farthest`. The point shows farther
/// left the farther over the leaf is, until it is out of sight.
pub fn swung_to(
    shape: LeafShape,
    grab: LeafGrab,
    hold: Hold,
    view: View,
    finger_x: f64,
    farthest: f64,
) -> f64 {
    let out = hold.u * shape.width;
    let down = hold.v * shape.height;
    let wanted = finger_x - hold.offset;
    let shows_at = |shown: f64| {
        let [x, _, z] = leaf_point(shape, pose_at(shape, grab, shown), out, down);
        seen_across(view, x, z)
    };
    let mut low = 0.0;
    let mut high = farthest;
    for _ in 0..22 {
        let middle = (low + high) / 2.0;
        if shows_at(middle) > wanted {
            low = middle;
        } else {
            high = middle;
        }
    }
    (low + high) / 2.0
}
