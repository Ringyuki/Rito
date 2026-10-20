//! The leaves of a book that are, or lately were, in the air.

use crate::curled::Curled;
use crate::hold::{Hold, Point};
use crate::leaf::{LeafGrab, LeafShape};
use crate::math::{clamp, max, min};
use crate::motion::Alone;

/// A leaf's stable name, by which the host keeps the pages it shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct LeafId(pub u32);

/// A leaf nothing leads any more, on its own way to rest.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Flight {
    /// How far through its motion it is (0 lying right, 1 lying left), stepped by the seconds since it was left alone.
    pub(crate) motion: Alone,
    pub(crate) elapsed: f64,
    pub(crate) to: f64,
    /// Where it was left alone.
    pub(crate) from: f64,
}

/// How far through its motion a leaf was, and its turn had got to, when the finger let go.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct LetGo {
    pub(crate) through: f64,
    pub(crate) turned: f64,
}

/// A page curled over is where it is going while still on the move: by this
/// share of the way it had left to go.
pub const GONE_BY: f64 = 0.85;

/// A leaf of the book that is, or lately was, in the air. It is told from
/// every other by the spread printed on its front.
#[derive(Debug, Clone, PartialEq)]
pub struct Leaf {
    pub(crate) id: LeafId,
    /// The spread printed on its front; the leaves of a book come in this order.
    pub(crate) spread: i64,
    /// The page buffer of that spread it was first seen with: a leaf found again is of the same one.
    pub(crate) printed: Option<u64>,
    pub(crate) shape: LeafShape,
    /// How it is curled over, with one page a spread; none for a leaf swung about the spine.
    pub(crate) curled: Option<Curled>,
    /// The point its bend is shaped by.
    pub(crate) grab: LeafGrab,
    /// What a finger holds of it, and where that finger took hold.
    pub(crate) hold: Option<Hold>,
    pub(crate) held_from: Option<Point>,
    /// How far over it is drawn: 0 lying right of the spine, 1 lying left of it.
    pub(crate) shown: f64,
    /// How fast that is changing, a second.
    pub(crate) speed: f64,
    pub(crate) let_go: Option<LetGo>,
    pub(crate) flight: Option<Flight>,
    pub(crate) positions: Vec<f32>,
    pub(crate) normals: Vec<f32>,
}

/// As near as makes no difference to lying flat.
const AT_REST: f64 = 1e-4;
/// A leaf coming down by itself has landed once it is this near flat, in
/// turns of the leaf, and slower than this a second.
const LANDED_WITHIN: f64 = 0.001;
const LANDED_BELOW: f64 = 0.05;

pub(crate) fn in_the_air(leaf: &Leaf) -> bool {
    leaf.shown > AT_REST && leaf.shown < 1.0 - AT_REST
}

/// Puts a leaf among the others where it comes in the book; answers where.
pub(crate) fn place_in_book(book: &mut Vec<Leaf>, leaf: Leaf) -> usize {
    let at = book
        .iter()
        .position(|other| other.spread > leaf.spread)
        .unwrap_or(book.len());
    book.insert(at, leaf);
    at
}

/// Keeps the leaves from passing through each other: a leaf nearer the
/// front of the book is always at least as far over as the one behind it.
pub(crate) fn keep_in_order(book: &mut [Leaf], led: usize) {
    for index in (0..led).rev() {
        let behind = book[index + 1].shown;
        book[index].shown = max(book[index].shown, behind);
    }
    for index in led + 1..book.len() {
        let before = book[index - 1].shown;
        book[index].shown = min(book[index].shown, before);
    }
}

/// Whether a leaf on its own way has got where it was going.
pub(crate) fn has_landed(leaf: &Leaf) -> bool {
    leaf.flight
        .is_some_and(|flight| (leaf.shown - flight.to).abs() < AT_REST)
}

/// Leaves every leaf but the led one to finish by itself: a leaf before it
/// has been turned and comes down on the left, one after it goes back to the
/// right. `width` is the CSS px a leaf left alone moves by.
pub(crate) fn leave_alone(book: &mut [Leaf], led: usize, width: f64) {
    for (index, leaf) in book.iter_mut().enumerate() {
        if index == led {
            continue;
        }
        let to = if index < led { 1.0 } else { 0.0 };
        if leaf.flight.map(|flight| flight.to) != Some(to) {
            send_off(leaf, to, width);
        }
    }
}

/// Moves a leaf on its own way on by `seconds`. True once it has come to rest.
pub(crate) fn fly(leaf: &mut Leaf, seconds: f64) -> bool {
    let curled = leaf.curled.is_some();
    let Some(flight) = leaf.flight.as_mut() else {
        return false;
    };
    flight.elapsed += seconds;
    let at = flight.motion.step(flight.elapsed);
    // A page curled over is where it is going on the move, ahead of its own motion.
    let hurried = curled && flight.from != flight.to;
    let reached = if hurried {
        flight.from + (at.x - flight.from) / GONE_BY
    } else {
        at.x
    };
    let landed = at.done
        || (hurried
            && if flight.to == 1.0 {
                reached >= 1.0
            } else {
                reached <= 0.0
            })
        || ((flight.to - at.x).abs() < LANDED_WITHIN && at.velocity.abs() < LANDED_BELOW);
    let to = flight.to;
    leaf.shown = if landed { to } else { clamp(reached, 0.0, 1.0) };
    leaf.speed = if landed { 0.0 } else { at.velocity };
    landed
}

/// Sends a leaf on its own way to lying right (0) or left (1), from where it
/// is and as fast, moving by `width` CSS px a turn.
pub(crate) fn send_off(leaf: &mut Leaf, to: f64, width: f64) {
    leaf.hold = None;
    leaf.held_from = None;
    leaf.let_go = None;
    let from = leaf.shown;
    leaf.flight = Some(Flight {
        motion: Alone::new(width, from, leaf.speed, to),
        elapsed: 0.0,
        to,
        from,
    });
}
