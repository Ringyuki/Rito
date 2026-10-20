//! What a page curled over keeps from frame to frame, and how far over it
//! should be drawn.

use crate::curl::{behind, curl_through, lay_curl, line_at, Curl, CurlLine};
use crate::curl_held::{under_finger, Held};
use crate::frame::{Frame, Phase, Scene};
use crate::leaves::{send_off, Leaf, GONE_BY};
use crate::math::clamp;
use crate::swing::{alone_width, view_of, LeafTurn};

/// How a curled page keeps step with its turn's own way: what moves the turn
/// (a finger, `None`; or its own way on to turned, 1, or back to flat, 0),
/// and how far the turn had gone and the page had got when this began.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Pace {
    pub(crate) toward: Option<f64>,
    pub(crate) turned: f64,
    pub(crate) at: f64,
    /// That a finger took the page lying at rest to turn it on, and the first of its way is eased into.
    pub(crate) eased: bool,
}

/// What a page curled over keeps from frame to frame beside how far over it is.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Curled {
    /// The tangent of the angle its line leans from upright by, above zero when its lower end leads.
    pub(crate) lean: f64,
    /// Where the turn takes it as last drawn: turned, 1, or flat, 0; none under a finger.
    pub(crate) toward: Option<f64>,
    pub(crate) pace: Option<Pace>,
    pub(crate) held: Option<Held>,
    /// The curl it was last laid out through.
    pub(crate) curl: Option<Curl>,
}

/// A turn this near its end, in turns of the page, has nowhere left to take its page.
const NO_WAY_LEFT: f64 = 0.02;

/// A page curled over that has yet to be turned, held or laid out.
pub(crate) fn curled_flat() -> Curled {
    Curled {
        lean: 0.0,
        toward: None,
        pace: None,
        held: None,
        curl: None,
    }
}

/// Whether a curled page is where its turn takes it; under a finger its turn takes it nowhere.
pub(crate) fn is_there(leaf: &Leaf) -> bool {
    match leaf.curled.as_ref().and_then(|curled| curled.toward) {
        Some(toward) => leaf.shown == toward,
        None => false,
    }
}

/// How far over a curled page should be drawn, `seconds` after its last frame.
pub(crate) fn wanted_curled(
    leaf: &mut Leaf,
    scene: Scene,
    frame: &Frame,
    read: &LeafTurn,
    seconds: f64,
) -> f64 {
    let toward = if frame.phase == Phase::Held {
        None
    } else if (frame.phase == Phase::Landing) == read.forward {
        Some(1.0)
    } else {
        Some(0.0)
    };
    let curled = leaf.curled.as_mut().expect("a curled page");
    curled.toward = toward;
    let Some(toward) = toward else {
        return under_finger(leaf, scene, frame, read, view_of(scene), seconds);
    };
    if let Some(held) = curled.held.as_mut() {
        held.released = true;
    }
    // Sent on its own way, it is not the turn's to place until it has got there: unless the
    // turn now takes it the other way.
    if leaf.flight.map(|flight| flight.to) == Some(toward) {
        return leaf.shown;
    }
    leaf.flight = None;
    if frame.touch.is_some() && frame.incoming.is_some() {
        return let_go(leaf, toward, scene);
    }
    in_step(leaf, toward, read.turned, scene)
}

/// A page a finger has let go, sent on its way to where its turn takes it:
/// from where it is, and as fast as it was going if that was the way it is
/// sent; a page still coming to its finger when it is sent back starts from rest.
fn let_go(leaf: &mut Leaf, toward: f64, scene: Scene) -> f64 {
    if leaf.shown == toward {
        return toward;
    }
    if leaf.speed * (toward - leaf.shown) < 0.0 {
        leaf.speed = 0.0;
    }
    send_off(leaf, toward, alone_width(scene));
    leaf.shown
}

/// How far over a page no finger moves is, its turn `turned` of its way: it
/// goes on from where it was when its turn began to carry it, and gets there
/// with the turn; on its way to turned sooner, by `GONE_BY` of what the turn
/// had left.
fn in_step(leaf: &mut Leaf, toward: f64, turned: f64, scene: Scene) -> f64 {
    let shown = leaf.shown;
    let pace = {
        let curled = leaf.curled.as_mut().expect("a curled page");
        match curled.pace {
            Some(pace) if pace.toward == Some(toward) => Some(pace),
            _ => {
                let left = if toward == 1.0 { 1.0 - turned } else { turned };
                if left < NO_WAY_LEFT && (toward - shown).abs() > NO_WAY_LEFT {
                    None
                } else {
                    let pace = Pace {
                        toward: Some(toward),
                        turned,
                        at: shown,
                        eased: false,
                    };
                    curled.pace = Some(pace);
                    Some(pace)
                }
            }
        }
    };
    let Some(pace) = pace else {
        // The turn is at its end and the page is not: it goes the rest of the way by itself.
        send_off(leaf, toward, alone_width(scene));
        return leaf.shown;
    };
    let way = toward - pace.at;
    let left = if toward == 1.0 {
        (1.0 - pace.turned) * GONE_BY
    } else {
        pace.turned
    };
    if way.abs() < 1e-9 || left <= 1e-6 {
        return toward;
    }
    // A turn sent back the way it came goes on a little before it turns round, and its page with it.
    let gone = if toward == 1.0 {
        turned - pace.turned
    } else {
        pace.turned - turned
    };
    clamp(pace.at + way * crate::math::min(1.0, gone / left), 0.0, 1.0)
}

/// Lays out every curled page of `book`, front of the book first. A page
/// lies under the ones before it, so its line is nowhere nearer the spine
/// than theirs.
pub(crate) fn lay_curled(book: &mut [Leaf], columns: usize, rows: usize) {
    let mut front: Option<CurlLine> = None;
    for leaf in book.iter_mut() {
        let Some(curled) = leaf.curled.as_mut() else {
            continue;
        };
        let own = line_at(leaf.shape, leaf.shown, curled.lean);
        let line = match front {
            Some(front) => behind(own, front),
            None => own,
        };
        front = Some(line);
        let curl = curl_through(leaf.shape, line);
        curled.curl = Some(curl);
        lay_curl(
            leaf.shape,
            curl,
            columns,
            rows,
            &mut leaf.positions,
            &mut leaf.normals,
        );
    }
}
