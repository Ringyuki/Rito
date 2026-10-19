//! A curled page under a finger.
//!
//! Until the finger has plainly set off, the page is drawn for the finger's
//! own way: the edge of its paper turned over goes as far as the finger has,
//! from where it was when it was taken. Once the finger has set off the way
//! the turn goes, that edge comes to the finger, at the height the finger is
//! at, and stays under it.

use crate::curl::line_at;
use crate::curl_hold::{eased_in, got_to, leant_by, shown_for, still_short};
use crate::curled::{Curled, Pace};
use crate::frame::{Frame, Phase, Scene, Touch};
use crate::hold::{Point, View};
use crate::leaves::{in_the_air, Leaf};
use crate::math::{clamp, max, or_one, round, sign};
use crate::physics::LEAST_PULL;
use crate::swing::LeafTurn;

/// A page lying flat taken by a corner leans by this much, as a tangent.
const BY_A_CORNER: f64 = 0.55;
/// A finger moved up or down by this many page heights leans the line by a tangent of 1.
const LEANS_OVER: f64 = 0.8;
/// A page whose edge is this near its finger, CSS px, is with it.
const WITH_IT: f64 = 0.5;

/// A page on its way to the finger that has set off with it: what it was
/// short of the finger by then, in how far its edge had gone and in how it
/// leant, and how long it has been coming.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Coming {
    edge: f64,
    lean: f64,
    seconds: f64,
}

/// What a finger that took the page holds of it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Held {
    /// Where the finger came down: what tells one hold from the next.
    from: Point,
    /// How the page leant when it was taken, and the height its lean is told from.
    leant: f64,
    from_y: f64,
    /// The lean it was drawn with when taken in the air, which it may keep.
    kept: f64,
    /// The height the finger holds it at.
    pub(crate) y: f64,
    /// The lean the finger asks for.
    wanted: f64,
    /// That the finger has gone far enough the way the turn goes to mean it.
    set_off: bool,
    /// The page's way to the finger since then.
    coming: Option<Coming>,
    /// That the finger has let go: whatever takes the page next takes it anew.
    pub(crate) released: bool,
}

/// Whether the finger of `frame` is the one that already holds the page.
pub(crate) fn still_held(curled: Option<&Curled>, frame: &Frame) -> bool {
    let Some(held) = curled.and_then(|curled| curled.held) else {
        return false;
    };
    let Some(touch) = frame.touch else {
        return false;
    };
    if held.released || frame.phase != Phase::Held {
        return false;
    }
    held.from.x == touch.origin.x && held.from.y == touch.origin.y
}

/// Whether a pace is the finger's own: one is kept only while it is.
fn under_a_finger(pace: Option<Pace>) -> bool {
    matches!(pace, Some(pace) if pace.toward.is_none())
}

/// How far over a curled page under a finger should be drawn.
pub(crate) fn under_finger(
    leaf: &mut Leaf,
    scene: Scene,
    frame: &Frame,
    read: &LeafTurn,
    view: View,
    seconds: f64,
) -> f64 {
    let touch = frame.touch;
    let held = touch.map(|touch| hold(leaf, frame, &touch, read));
    // Sent on its own way with no finger to take it, it is left to that.
    if held.is_none() && leaf.flight.is_some() {
        return leaf.shown;
    }
    let curled = leaf.curled.as_ref().expect("a curled page");
    let y = curled.held.map_or(leaf.shape.height / 2.0, |held| held.y);
    let pace = match curled.pace {
        Some(pace) if pace.toward.is_none() => pace,
        _ => {
            let pace = taken_at(leaf, scene, touch.as_ref(), read, y, view);
            leaf.curled.as_mut().expect("a curled page").pace = Some(pace);
            pace
        }
    };
    let reached = pace.at + 2.0 * scene.width * (read.turned - pace.turned);
    let own = if pace.eased {
        eased_in(leaf.shape, reached)
    } else {
        reached
    };
    let lean = leaf.curled.as_ref().expect("a curled page").lean;
    let (Some(_), Some(touch)) = (held, touch) else {
        return shown_for(leaf.shape, own, lean, y, view);
    };
    let (edge, lean) = brought_to(leaf, scene, frame, &touch, read, own, seconds);
    leaf.curled.as_mut().expect("a curled page").lean = lean;
    shown_for(leaf.shape, edge, lean, y, view)
}

/// The finger's hold of the page, taken anew when another finger has come
/// down, when this one had let go, and when the page has been left to
/// itself since.
fn hold(leaf: &mut Leaf, frame: &Frame, touch: &Touch, read: &LeafTurn) -> Held {
    leaf.flight = None;
    let curled = leaf.curled.as_ref().expect("a curled page");
    let fresh =
        curled.held.is_none() || !still_held(Some(curled), frame) || !under_a_finger(curled.pace);
    if fresh {
        let at_rest = !in_the_air(leaf);
        let drawn = lean_of(leaf, curled);
        let down = touch.origin.y / or_one(leaf.shape.height);
        let held = Held {
            from: touch.origin,
            leant: if at_rest && read.forward {
                by_a_corner(down)
            } else {
                drawn
            },
            // A finger has moved before it takes a page in the air: its lean is told from where it took it.
            from_y: if at_rest {
                touch.origin.y
            } else {
                touch.position.y
            },
            kept: if at_rest { 0.0 } else { drawn },
            y: touch.position.y,
            wanted: 0.0,
            set_off: false,
            coming: None,
            released: false,
        };
        let curled = leaf.curled.as_mut().expect("a curled page");
        curled.held = Some(held);
        // A new hold: the page goes on from where it is.
        curled.pace = None;
    }
    let height = leaf.shape.height;
    let curled = leaf.curled.as_mut().expect("a curled page");
    let held = curled.held.as_mut().expect("held above");
    held.y = touch.position.y;
    held.wanted = held.leant + (held.from_y - touch.position.y) / or_one(height) / LEANS_OVER;
    *held
}

/// Where the finger's own way begins from: how far the turn has gone and the page's edge has got.
fn taken_at(
    leaf: &Leaf,
    scene: Scene,
    touch: Option<&Touch>,
    read: &LeafTurn,
    y: f64,
    view: View,
) -> Pace {
    let rest = round(leaf.shown);
    // How much of a turn the finger itself has carried: half its own way across.
    let carried =
        touch.map(|touch| (touch.position.x - touch.origin.x).abs() / (2.0 * scene.width));
    let fresh = !in_the_air(leaf)
        && carried.is_some_and(|carried| ((read.turned - rest).abs() - carried).abs() < 1e-3);
    let lean = leaf.curled.as_ref().expect("a curled page").lean;
    Pace {
        toward: None,
        turned: if fresh { rest } else { read.turned },
        at: got_to(leaf.shape, leaf.shown, lean, y, view),
        eased: fresh && read.forward,
    }
}

/// How far the page's edge has gone and how the page leans, when the
/// finger's own way would have its edge `own` gone.
fn brought_to(
    leaf: &mut Leaf,
    scene: Scene,
    frame: &Frame,
    touch: &Touch,
    read: &LeafTurn,
    own: f64,
    seconds: f64,
) -> (f64, f64) {
    let shape = leaf.shape;
    let held = leaf
        .curled
        .as_mut()
        .and_then(|curled| curled.held.as_mut())
        .expect("held");
    let (y, kept) = (held.y, held.kept);
    let lean = |asked: f64, gone: f64| leant_by(shape, asked, gone, y, kept);
    let own_lean = lean(held.wanted, own);
    let meets = max(0.0, shape.spine + shape.width - touch.position.x);
    let way = if read.forward { 1.0 } else { -1.0 };
    let gone = way * (touch.origin.x - touch.position.x);
    if !held.set_off && frame.incoming.is_some() && gone >= LEAST_PULL * scene.css_pixel {
        held.set_off = true;
        if way * (meets - own) > 0.0 {
            held.coming = Some(Coming {
                edge: meets - own,
                lean: lean(held.wanted, meets) - own_lean,
                seconds: 0.0,
            });
        }
    } else if let Some(coming) = held.coming.as_mut() {
        coming.seconds += seconds;
    }
    let Some(coming) = held.coming else {
        return (own, own_lean);
    };
    let share = still_short(coming.seconds);
    let left = if coming.edge.abs() * share < WITH_IT * scene.css_pixel {
        0.0
    } else {
        share
    };
    let edge = meets - coming.edge * left;
    (
        edge,
        lean(lean(held.wanted, meets) - coming.lean * left, edge),
    )
}

/// How the page's line leans as it is drawn: no more than the spine lets it.
fn lean_of(leaf: &Leaf, curled: &Curled) -> f64 {
    let line = line_at(leaf.shape, leaf.shown, curled.lean);
    (line.top - line.bottom) / leaf.shape.height
}

fn by_a_corner(down: f64) -> f64 {
    let off = clamp(2.0 * down - 1.0, -1.0, 1.0);
    let t = clamp((off.abs() - 0.2) / 0.7, 0.0, 1.0);
    sign(off) * BY_A_CORNER * t * t * (3.0 - 2.0 * t)
}
