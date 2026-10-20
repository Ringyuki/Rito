//! A frame read as a leaf's turn, and how far over a leaf swung about the
//! spine should be drawn.

use crate::frame::{Frame, Incoming, PageRef, Phase, Scene};
use crate::hold::{hold_of, swung_to, Hold, View};
use crate::leaf::LeafGrab;
use crate::leaves::{in_the_air, send_off, Leaf, LetGo};
use crate::math::{clamp, or_one};
use crate::mesh::{COLUMNS, ROWS};
use crate::physics::grab_of;

/// A turn this near its end, in turns of the leaf, has nowhere left to take its leaf.
const NO_WAY_LEFT: f64 = 0.02;
/// How high the eye is over the frame, in the frame's larger side.
const EYE_HEIGHT: f64 = 2.4;

/// How high the eye is over a frame of this size.
pub fn eye_height(width: f64, height: f64) -> f64 {
    EYE_HEIGHT * crate::math::max(width, height)
}

/// The view a frame of a scene is seen in.
pub(crate) fn view_of(scene: Scene) -> View {
    View {
        width: scene.width,
        height: scene.height,
        eye: eye_height(scene.width, scene.height),
    }
}

/// A frame read as a leaf's turn: which leaf, which way, how far over, and the pages about it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LeafTurn {
    /// The spread printed on the leaf's front.
    pub spread: i64,
    pub forward: bool,
    /// How far the turn has gone toward lying left of the spine, 0–1.
    pub turned: f64,
    /// The page the leaf is lifted from, printed on its front; none for bare paper.
    pub front: Option<PageRef>,
    /// The page after it: what lies under the leaf.
    pub after: Option<PageRef>,
    /// Whether the front is the page shown (`curr`) rather than the one coming in.
    pub front_is_current: bool,
}

/// The leaf a frame turns, or none when there is no such leaf to show.
/// `incoming` is the page in the slot the frame brings in.
pub fn leaf_turn(
    scene: Scene,
    frame: &Frame,
    current: Option<PageRef>,
    incoming: Option<PageRef>,
) -> Option<LeafTurn> {
    let forward = match frame.incoming {
        Some(which) => which == Incoming::Next,
        None => frame.dx < 0.0,
    };
    if !forward && frame.incoming.is_none() && scene.spine == 0.0 {
        return None;
    }
    let toward = if forward { -frame.dx } else { frame.dx };
    let along = clamp(toward / or_one(scene.width), 0.0, 1.0);
    let coming = frame.incoming.and(incoming);
    let (front, after) = if forward {
        (current, coming)
    } else {
        (coming, current)
    };
    Some(LeafTurn {
        // A bare leaf before the first spread comes before it.
        spread: match (front, after) {
            (Some(page), _) => page.spread,
            (None, Some(page)) => page.spread - 1,
            (None, None) => -1,
        },
        forward,
        turned: if forward { along } else { 1.0 - along },
        front,
        after,
        front_is_current: forward,
    })
}

/// The CSS px a leaf left alone moves by: a turn's motion is told in CSS px,
/// so the leaf's is too, whatever its frame is drawn at.
pub(crate) fn alone_width(scene: Scene) -> f64 {
    scene.width / or_one(scene.css_pixel)
}

/// How far over the leaf should be drawn. Under a finger, as far as puts the
/// point it holds where the finger has it. Let go, on from there in step
/// with the turn. Turned by no finger, as far as the turn has gone.
pub(crate) fn wanted_of(leaf: &mut Leaf, scene: Scene, frame: &Frame, read: &LeafTurn) -> f64 {
    let Some(touch) = frame.touch else {
        leaf.hold = None;
        leaf.held_from = None;
        leaf.flight = None;
        return read.turned;
    };
    if frame.phase == Phase::Held {
        leaf.let_go = None;
        leaf.flight = None;
        let view = view_of(scene);
        let held = held_by(leaf, scene, frame, view);
        return swung_to(leaf.shape, leaf.grab, held, view, touch.position.x, 1.0);
    }
    let end = if (frame.phase == Phase::Landing) == read.forward {
        1.0
    } else {
        0.0
    };
    if leaf.let_go.is_none() {
        // A finger that took the leaf in the air may let it go with its turn already at its end
        // and the leaf not: nothing is left to carry it there, and it goes by itself.
        let stranded =
            (end - read.turned).abs() < NO_WAY_LEFT && (end - leaf.shown).abs() > NO_WAY_LEFT;
        if stranded {
            send_off(leaf, end, alone_width(scene));
        }
        leaf.let_go = Some(LetGo {
            through: leaf.shown,
            turned: read.turned,
        });
    }
    let let_go = leaf.let_go.expect("set above");
    let left = end - let_go.turned;
    let done = if left.abs() < 1e-6 {
        1.0
    } else {
        (read.turned - let_go.turned) / left
    };
    let_go.through + (end - let_go.through) * clamp(done, 0.0, 1.0)
}

/// The hold the finger has of the leaf. A leaf lying flat is taken by the
/// point the finger came down on, which also shapes its bend; a leaf in the
/// air is taken by the point of it showing nearest the finger, as it is.
fn held_by(leaf: &mut Leaf, scene: Scene, frame: &Frame, view: View) -> Hold {
    let Some(touch) = frame.touch else {
        return leaf.hold.unwrap_or(Hold {
            u: leaf.grab.u,
            v: leaf.grab.v,
            offset: 0.0,
        });
    };
    if let (Some(hold), Some(from)) = (leaf.hold, leaf.held_from) {
        if from.x == touch.origin.x && from.y == touch.origin.y {
            return hold;
        }
    }
    leaf.held_from = Some(touch.origin);
    if in_the_air(leaf) {
        let hold = hold_of(&leaf.positions, COLUMNS, ROWS, view, touch.position);
        leaf.hold = Some(hold);
        return hold;
    }
    leaf.grab = grab_of(Some(&touch), scene.width, scene.spine, scene.height);
    let out = leaf.grab.u * leaf.shape.width;
    let lies = if leaf.shown < 0.5 {
        leaf.shape.spine + out
    } else {
        leaf.shape.spine - out
    };
    let hold = Hold {
        u: leaf.grab.u,
        v: leaf.grab.v,
        offset: touch.origin.x - lies,
    };
    leaf.hold = Some(hold);
    hold
}

/// The grab of a leaf first seen this frame.
pub(crate) fn grab_for(frame: &Frame, scene: Scene) -> LeafGrab {
    grab_of(frame.touch.as_ref(), scene.width, scene.spine, scene.height)
}
