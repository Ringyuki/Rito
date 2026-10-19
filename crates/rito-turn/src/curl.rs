//! A page curled over on itself, as one page of a spread is turned: flat as
//! far as a line across it, round half a cylinder lying along that line,
//! then flat again on top, face down, going back the way it came. Paper
//! bends without stretching, and this is a shape it can take: every distance
//! along the sheet stays what it was flat.
//!
//! The line it leaves the page at is all there is to the shape. It runs from
//! the top edge of the page to the bottom, the paper bound at the spine lying
//! flat on its left and the paper on its right lifted. It comes in from the
//! outer edge as the turn goes on and stands the more upright the nearer the
//! spine it is, so that it never crosses the spine, and lies along it when
//! the turn is done.
//!
//! Lengths are in the units a frame is drawn in: x across the page, y down
//! it, z rising toward the reader.

use crate::leaf::LeafShape;
use crate::math::{clamp, cos, hypot, max, min, sin, PI};

/// Where the line a page leaves the pages at meets the page's top edge and its bottom, as x.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CurlLine {
    pub top: f64,
    pub bottom: f64,
}

/// The curl as it is laid out: the direction across the page it is rolled
/// back from (a unit vector, from the paper lying flat to the paper lifted),
/// where the line it leaves the page at lies along that direction, and the
/// radius it rolls over at.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Curl {
    pub dx: f64,
    pub dy: f64,
    pub at: f64,
    pub radius: f64,
}

/// The radius the paper rolls over at, as a share of the page's width: a
/// soft roll, its light and shade spread across it.
const ROLL: f64 = 0.13;
/// How far the line may lean, as the tangent of its angle from upright, for
/// each page height its leading end is from the spine.
const LEANS_AT_MOST: f64 = 1.5;
/// A roll tighter than this, in the frame's units, is a crease.
const A_CREASE: f64 = 1e-3;

/// The line a page `shown` of the way through its turn (0 lying flat, 1
/// turned) leaves the pages at, leaning by `lean`: the tangent of its angle
/// from upright, above zero when its lower end leads. The leading end comes
/// in evenly from the outer edge to the spine; at 0 the line only touches a
/// corner, and at 1 it lies along the spine.
pub fn line_at(shape: LeafShape, shown: f64, lean: f64) -> CurlLine {
    let out = shape.width * (1.0 - clamp(shown, 0.0, 1.0));
    let most = (LEANS_AT_MOST * out) / shape.height;
    let leans = min(most, max(-most, lean));
    let lead = shape.spine + out;
    CurlLine {
        top: lead + shape.height * max(leans, 0.0),
        bottom: lead + shape.height * max(-leans, 0.0),
    }
}

/// The line of a page that lies behind another in the book: its own, but
/// nowhere nearer the spine than the line of the page in front, which lies
/// on it there.
pub fn behind(own: CurlLine, front: CurlLine) -> CurlLine {
    CurlLine {
        top: max(own.top, front.top),
        bottom: max(own.bottom, front.bottom),
    }
}

/// The curl that leaves the page at `line`. It rolls over at a radius that
/// the paper between the line and the spine has room for: near the spine the
/// roll tightens, and along it there is none.
pub fn curl_through(shape: LeafShape, line: CurlLine) -> Curl {
    let across = line.top - line.bottom;
    let length = hypot(shape.height, across);
    let dx = shape.height / length;
    let dy = across / length;
    let lead = min(line.top, line.bottom) - shape.spine;
    Curl {
        dx,
        dy,
        at: line.top * dx,
        radius: max(0.0, min(ROLL * shape.width, (2.0 * lead * dx) / PI)),
    }
}

/// How far past the line it leaves the page at the point (x, y) of the flat sheet is.
fn past_of(curl: Curl, x: f64, y: f64) -> f64 {
    x * curl.dx + y * curl.dy - curl.at
}

/// How far back toward the spine paper is laid that lay `past` beyond the
/// line when flat, round a roll of `radius`: round the roll it comes back by
/// what the roll takes up, and on top of it by twice what is left.
pub fn laid_back(past: f64, radius: f64) -> f64 {
    if past <= 0.0 {
        return 0.0;
    }
    let half_turn = PI * radius;
    if past < half_turn && radius > A_CREASE {
        past - radius * sin(past / radius)
    } else {
        2.0 * past - half_turn
    }
}

/// How high above the pages that paper stands.
pub fn stands_at(past: f64, radius: f64) -> f64 {
    if past <= 0.0 {
        return 0.0;
    }
    if past < PI * radius && radius > A_CREASE {
        radius * (1.0 - cos(past / radius))
    } else {
        2.0 * radius
    }
}

/// Lays the sheet out through a curl: the position of every point of a grid
/// of `columns` by `rows` over it, row by row from the spine outward, and
/// the direction the paper faces there (its front, the side up when it lies
/// flat).
pub fn lay_curl(
    shape: LeafShape,
    curl: Curl,
    columns: usize,
    rows: usize,
    positions: &mut [f32],
    normals: &mut [f32],
) {
    let Curl { dx, dy, radius, .. } = curl;
    let half_turn = PI * radius;
    for row in 0..rows {
        let flat_y = (row as f64 / (rows - 1) as f64) * shape.height;
        for column in 0..columns {
            let flat_x = shape.spine + (column as f64 / (columns - 1) as f64) * shape.width;
            let p = (row * columns + column) * 3;
            let past = past_of(curl, flat_x, flat_y);
            let back = laid_back(past, radius);
            set(
                positions,
                p,
                flat_x - dx * back,
                flat_y - dy * back,
                stands_at(past, radius),
            );
            if past <= 0.0 {
                set(normals, p, 0.0, 0.0, 1.0);
            } else if past < half_turn && radius > A_CREASE {
                // Round the roll: this far of the way from lying flat to lying on top.
                let angle = past / radius;
                set(normals, p, -dx * sin(angle), -dy * sin(angle), cos(angle));
            } else {
                set(normals, p, 0.0, 0.0, -1.0);
            }
        }
    }
}

fn set(into: &mut [f32], at: usize, x: f64, y: f64, z: f64) {
    into[at] = x as f32;
    into[at + 1] = y as f32;
    into[at + 2] = z as f32;
}
