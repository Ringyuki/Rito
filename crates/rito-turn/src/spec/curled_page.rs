//! The one page of a spread the curl is tried on, and what is read off it.

use crate::curl::{curl_through, lay_curl, line_at};
use crate::curled::Curled;
use crate::frame::{Frame, Incoming, Phase, Scene, Touch};
use crate::hold::Point;
use crate::leaf::{LeafGrab, LeafShape};
use crate::leaves::{Leaf, LeafId};
use crate::math::{max, min, or_one};
use crate::swing::LeafTurn;

/// The one page of a spread the curl is tried on, and the grid it is laid out by.
pub(super) const PAGE: LeafShape = LeafShape {
    spine: 0.0,
    width: 400.0,
    height: 600.0,
};
pub(super) const COLUMNS: usize = 201;
pub(super) const ROWS: usize = 151;
pub(super) const SCENE: Scene = Scene {
    width: 400.0,
    height: 600.0,
    spine: 0.0,
    css_pixel: 1.0,
};
/// The radius the page rolls over at, away from the spine.
pub(super) const ROLL_RADIUS: f64 = 0.13 * 400.0;

/// The page laid out `shown` of the way over, leaning by `lean`.
pub(super) fn laid(shown: f64, lean: f64) -> Vec<f32> {
    let mut positions = vec![0.0; COLUMNS * ROWS * 3];
    let mut normals = vec![0.0; COLUMNS * ROWS * 3];
    let curl = curl_through(PAGE, line_at(PAGE, shown, lean));
    lay_curl(PAGE, curl, COLUMNS, ROWS, &mut positions, &mut normals);
    positions
}

pub(super) fn at(positions: &[f32], column: usize, row: usize) -> [f64; 3] {
    let p = (row * COLUMNS + column) * 3;
    [
        f64::from(positions[p]),
        f64::from(positions[p + 1]),
        f64::from(positions[p + 2]),
    ]
}

/// A curled page `shown` of the way over, as the effect keeps it.
pub(super) fn sheet(shown: f64, curled: Curled, spread: i64) -> Leaf {
    Leaf {
        id: LeafId(0),
        spread,
        printed: None,
        shape: PAGE,
        curled: Some(curled),
        grab: LeafGrab { u: 1.0, v: 0.5 },
        hold: None,
        held_from: None,
        shown,
        speed: 0.0,
        let_go: None,
        flight: None,
        positions: vec![0.0; COLUMNS * ROWS * 3],
        normals: vec![0.0; COLUMNS * ROWS * 3],
    }
}

/// The page's turn `turned` of its way, turning on.
pub(super) fn forward(turned: f64) -> LeafTurn {
    LeafTurn {
        spread: 5,
        forward: true,
        turned,
        front: None,
        after: None,
        front_is_current: true,
    }
}

/// A frame of a turn with a page to turn to; `finger` is where it came down (at x 380) and where it is.
pub(super) fn frame(phase: Phase, finger: Option<[f64; 3]>) -> Frame {
    Frame {
        dx: 0.0,
        incoming: Some(Incoming::Next),
        phase,
        touch: finger.map(|finger| Touch {
            origin: Point {
                x: 380.0,
                y: finger[0],
            },
            position: Point {
                x: finger[1],
                y: finger[2],
            },
            farthest: None,
        }),
    }
}

/// Where a point in the air shows, as the eye over the middle of the frame sees it.
const EYE: f64 = 2.4 * 600.0;

fn seen([x, y, z]: [f64; 3]) -> [f64; 2] {
    [
        200.0 + ((x - 200.0) * EYE) / (EYE - z),
        300.0 + ((y - 300.0) * EYE) / (EYE - z),
    ]
}

fn lean_of(leaf: &Leaf) -> f64 {
    leaf.curled.as_ref().map_or(0.0, |curled| curled.lean)
}

/// How far the page's free edge shows from where it lies flat, at the height `y`: read off the page as it is laid out.
pub(super) fn edge_gone_at(leaf: &Leaf, y: f64) -> f64 {
    let positions = laid(leaf.shown, lean_of(leaf));
    let mut before = seen(at(&positions, COLUMNS - 1, 0));
    for row in 1..ROWS {
        let here = seen(at(&positions, COLUMNS - 1, row));
        if here[1] >= y {
            let share = (y - before[1]) / or_one(here[1] - before[1]);
            return 400.0 - (before[0] + (here[0] - before[0]) * min(1.0, max(0.0, share)));
        }
        before = here;
    }
    400.0 - before[0]
}

/// What the finger holding the page holds of it, as the hold prints itself:
/// what a hold keeps is its own module's to read.
fn held(leaf: &Leaf) -> crate::curl_held::Held {
    leaf.curled
        .as_ref()
        .and_then(|curled| curled.held)
        .expect("a finger holds the page")
}

/// Whether the finger holding the page has set off with it.
pub(super) fn has_set_off(leaf: &Leaf) -> bool {
    held(leaf).set_off
}

/// Whether the page held is on no way to its finger.
pub(super) fn coming_to_nothing(leaf: &Leaf) -> bool {
    held(leaf).coming.is_none()
}

/// Where the page's line crosses the height `y`, as it is drawn.
pub(super) fn line_at_height(leaf: &Leaf, y: f64) -> f64 {
    let line = line_at(PAGE, leaf.shown, lean_of(leaf));
    line.top + ((line.bottom - line.top) * y) / 600.0
}
