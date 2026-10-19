//! A leaf of a book as it is turned: bound along the spine, bent round a
//! cone that touches the page along the spine, and swung about the spine
//! from one side of the book to the other. Paper bends without stretching,
//! and a cone is a shape it can take: every distance along the leaf stays
//! what it was flat. The leaf arches as much however it is taken: a cone
//! with its point far off bends the whole edge alike, one with its point
//! near lets the corner nearest it lead.
//!
//! Lengths are in the units a frame is drawn in: x across the spread, y down
//! it, z rising toward the reader. The leaf lies to the right of the spine
//! when flat and to its left once turned.

use crate::math::{asin, atan2, clamp, cos, hypot, max, sin, smoothstep, sqrt, tan, PI};

/// Where the leaf is bound and how large it is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LeafShape {
    pub spine: f64,
    pub width: f64,
    pub height: f64,
}

/// The point of the leaf a hand holds: `u` from the spine outward, `v` from the top down.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LeafGrab {
    pub u: f64,
    pub v: f64,
}

/// How the leaf is bent and where it has swung to: how far round the spine
/// (`swing`, 0 lying right, π lying left), the half-angle of the cone it is
/// bent round (`cone`; a right angle is flat), and where on the spine's
/// line the cone's point is (`apex`, a y above the leaf's top or below its
/// bottom).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LeafPose {
    pub swing: f64,
    pub cone: f64,
    pub apex: f64,
}

const FLAT: f64 = PI / 2.0;
/// How far round its cone the middle of the leaf's outer edge wraps once bent, in radians.
const BEND: f64 = 0.95;
/// How far past the leaf's end the cone's point is, in leaf widths: by a corner, by the edge.
const APEX_BY_CORNER: f64 = 1.5;
const APEX_BY_EDGE: f64 = 9.0;
/// The leaf has taken its bend by this share of the turn.
const BENT_BY: f64 = 0.2;

/// The pose of a leaf `turned` of the way over (0–1), held at `grab`. It
/// bends as it lifts, swings evenly, and comes down edge first: on the far
/// side the bend opens no faster than keeps the paper above the page it
/// lands on, so the last of the arch settles as the swing ends.
pub fn pose_at(shape: LeafShape, grab: LeafGrab, turned: f64) -> LeafPose {
    let t = clamp(turned, 0.0, 1.0);
    // A leaf taken near a corner bends round a nearer point, more tightly.
    let corner = smoothstep(0.0, 1.0, (2.0 * grab.v - 1.0).abs());
    let away = (APEX_BY_EDGE + (APEX_BY_CORNER - APEX_BY_EDGE) * corner) * shape.width;
    let apex = if grab.v >= 0.5 {
        shape.height + away
    } else {
        -away
    };
    let swing = PI * t;
    // The cone that wraps the middle of the outer edge that far: tighter the farther off its point.
    let spread = atan2(shape.width, away + shape.height / 2.0);
    let bend = BEND * smoothstep(0.0, BENT_BY, t);
    let wanted = if bend <= spread {
        FLAT
    } else {
        asin(spread / bend)
    };
    LeafPose {
        swing,
        cone: max(wanted, open_enough(shape, swing, away)),
        apex,
    }
}

/// The tightest cone that keeps the whole leaf above the page it is coming
/// down on, once it has swung past upright: its lowest paper is the corner
/// nearest the cone's point, which wraps farthest.
fn open_enough(shape: LeafShape, swing: f64, away: f64) -> f64 {
    if swing <= FLAT {
        return 0.0;
    }
    let room = tan(PI - swing);
    let spread = atan2(shape.width, away);
    let sinks = |cone: f64| cos(cone) * tan(crate::math::min(spread / sin(cone), 3.0) / 2.0) > room;
    let mut low = 0.05;
    let mut high = FLAT;
    for _ in 0..24 {
        let middle = (low + high) / 2.0;
        if sinks(middle) {
            low = middle;
        } else {
            high = middle;
        }
    }
    high
}

/// Where the point of the flat leaf `out` from the spine and `down` from its top is, in `pose`.
pub fn leaf_point(shape: LeafShape, pose: LeafPose, out: f64, down: f64) -> [f64; 3] {
    let below = pose.apex > shape.height;
    let along = if below {
        pose.apex - down
    } else {
        down - pose.apex
    };
    let slant = hypot(out, along);
    let sine = sin(pose.cone);
    // How far round the cone the point has wrapped from the spine.
    let round = atan2(out, along) / sine;
    let radius = slant * sine;
    let lifted = radius * (1.0 - cos(round));
    let across = radius * sin(round);
    let up = lifted * cos(pose.cone);
    let kept = slant - lifted * sine;
    [
        shape.spine + across * cos(pose.swing) - up * sin(pose.swing),
        if below {
            pose.apex - kept
        } else {
            pose.apex + kept
        },
        across * sin(pose.swing) + up * cos(pose.swing),
    ]
}

/// Lays the leaf out in a pose: the position of every point of a grid of
/// `columns` by `rows` over it, row by row from the spine outward, and the
/// direction the paper faces there (its front, the side up when it lies
/// flat on the right).
pub fn lay_leaf(
    shape: LeafShape,
    pose: LeafPose,
    columns: usize,
    rows: usize,
    positions: &mut [f32],
    normals: &mut [f32],
) {
    for row in 0..rows {
        let down = (row as f64 / (rows - 1) as f64) * shape.height;
        for column in 0..columns {
            let out = (column as f64 / (columns - 1) as f64) * shape.width;
            let point = leaf_point(shape, pose, out, down);
            let at = (row * columns + column) * 3;
            positions[at] = point[0] as f32;
            positions[at + 1] = point[1] as f32;
            positions[at + 2] = point[2] as f32;
        }
    }
    facings(positions, columns, rows, normals);
}

/// The direction each point's patch of paper faces: across its neighbours
/// either way, from the positions as stored.
fn facings(positions: &[f32], columns: usize, rows: usize, out: &mut [f32]) {
    let at = |column: usize, row: usize, axis: usize| {
        f64::from(positions[(row * columns + column) * 3 + axis])
    };
    for row in 0..rows {
        let up = row.saturating_sub(1);
        let down = (row + 1).min(rows - 1);
        for column in 0..columns {
            let left = column.saturating_sub(1);
            let right = (column + 1).min(columns - 1);
            let ax = at(right, row, 0) - at(left, row, 0);
            let ay = at(right, row, 1) - at(left, row, 1);
            let az = at(right, row, 2) - at(left, row, 2);
            let bx = at(column, down, 0) - at(column, up, 0);
            let by = at(column, down, 1) - at(column, up, 1);
            let bz = at(column, down, 2) - at(column, up, 2);
            let nx = ay * bz - az * by;
            let ny = az * bx - ax * bz;
            let nz = ax * by - ay * bx;
            let length = crate::math::or_one(sqrt(nx * nx + ny * ny + nz * nz));
            let p = (row * columns + column) * 3;
            out[p] = (nx / length) as f32;
            out[p + 1] = (ny / length) as f32;
            out[p + 2] = (nz / length) as f32;
        }
    }
}
