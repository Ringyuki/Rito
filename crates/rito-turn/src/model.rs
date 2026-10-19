//! The paper turn's model: what is remembered of the leaves from frame to
//! frame, and each frame's sheets.
//!
//! A frame is taken in two steps, for the host decides between them whether
//! it can draw paper at all: `begin` reads the frame and moves the clock on;
//! then `lay` moves the leaves and lays them out, or nothing more is asked
//! when the host draws the frame plain. Page bitmaps are the host's: the
//! model names, for each face of each sheet, which leaf's page it shows, and
//! tells which leaf is led (whose pages the host takes anew from this
//! frame's) and which leaves left the book (whose pages it lets go).

use crate::aloft::{bring, lay_out};
use crate::curl_held::still_held;
use crate::curled::{curled_flat, is_there, wanted_curled};
use crate::frame::{Frame, PageRef, Phase, Scene};
use crate::leaf::LeafShape;
use crate::leaves::{leave_alone, place_in_book, Leaf, LeafId};
use crate::math::clamp;
use crate::mesh::grid_for;
use crate::motion::At;
use crate::physics::PaperSettle;
use crate::sheets::{sheets, Flat, Sheet};
use crate::swing::{alone_width, grab_for, leaf_turn, wanted_of, LeafTurn};

/// A frame this long after the last one, in ms, begins anew: nothing is in the air.
const SAME_TURN_WITHIN: f64 = 250.0;

/// Leaves the model forgot: the host lets their pages go, unless they were
/// taken in a GPU context since lost (`release` false), when they went with it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Forgotten {
    pub leaves: Vec<LeafId>,
    pub release: bool,
}

/// What `begin` found a frame to be.
#[derive(Debug, Clone, PartialEq)]
pub enum Begun {
    /// No leaf turns (one page a spread, turned back before the first page):
    /// the page shown is drawn where the turn has it.
    Shown { dx: f64, forgotten: Forgotten },
    /// The turn of the leaf printed with `spread`; `forgotten` is not empty
    /// when what was remembered was of another moment, and then whatever
    /// the host decided of earlier turns is decided anew.
    Turn {
        spread: i64,
        forgotten: Forgotten,
        anew: bool,
    },
}

/// A frame laid out: the led leaf and the pages it shows now, the leaves
/// that left the book, and the grid the sheets (`PaperModel::sheets`) are on.
#[derive(Debug, Clone, PartialEq)]
pub struct Laid {
    pub columns: usize,
    pub rows: usize,
    pub led: LeafId,
    /// The pages the led leaf shows this frame: on its front, and under it.
    pub front: Option<PageRef>,
    pub after: Option<PageRef>,
    pub left_book: Vec<LeafId>,
}

/// A frame read by `begin`, waiting for `lay`.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Pending {
    scene: Scene,
    frame: Frame,
    read: LeafTurn,
    shape: LeafShape,
    seconds: f64,
}

/// What the paper turn remembers between frames.
#[derive(Debug, Clone, PartialEq)]
pub struct PaperModel {
    /// The leaves in the air, in the order they come in the book.
    book: Vec<Leaf>,
    /// The leaf the turn on screen is of.
    led: Option<LeafId>,
    painted_at: f64,
    /// How many frames have been painted.
    painted: u64,
    /// The host's GPU context the leaves' pages were taken in.
    epoch: u64,
    next_id: u32,
    flat: Option<Flat>,
    /// Where the pages of the frame last laid out are bound.
    spine: f64,
    pending: Option<Pending>,
}

impl Default for PaperModel {
    fn default() -> Self {
        Self::new()
    }
}

impl PaperModel {
    pub fn new() -> Self {
        Self {
            book: Vec::new(),
            led: None,
            painted_at: f64::NEG_INFINITY,
            painted: 0,
            epoch: 0,
            next_id: 0,
            flat: None,
            spine: 0.0,
            pending: None,
        }
    }

    /// Reads a frame at `now` (ms): `current` is the page shown, `incoming`
    /// the page in the slot the frame brings in; `epoch` names the host's GPU
    /// context.
    pub fn begin(
        &mut self,
        scene: Scene,
        frame: Frame,
        current: Option<PageRef>,
        incoming: Option<PageRef>,
        now: f64,
        epoch: u64,
    ) -> Begun {
        self.painted += 1;
        self.pending = None;
        let Some(read) = leaf_turn(scene, &frame, current, incoming) else {
            let forgotten = self.forget(epoch);
            return Begun::Shown {
                dx: frame.dx,
                forgotten,
            };
        };
        let shape = LeafShape {
            spine: scene.spine,
            width: scene.width - scene.spine,
            height: scene.height,
        };
        let anew = self.stale(shape, now, &frame, epoch);
        let forgotten = if anew {
            self.forget(epoch)
        } else {
            Forgotten::default()
        };
        let seconds = clamp((now - self.painted_at) / 1000.0, 0.0, 0.05);
        self.painted_at = now;
        self.pending = Some(Pending {
            scene,
            frame,
            read,
            shape,
            seconds,
        });
        Begun::Turn {
            spread: read.spread,
            forgotten,
            anew,
        }
    }

    /// Moves the leaves of the frame `begin` read on, and lays them out.
    /// `None` when no frame is waiting.
    pub fn lay(&mut self, epoch: u64) -> Option<Laid> {
        let Pending {
            scene,
            frame,
            read,
            shape,
            seconds,
        } = self.pending.take()?;
        self.epoch = epoch;
        let (columns, rows) = grid_for(scene.spine);
        let known = self.book.len();
        let (led, left_on_change) = self.leaf_of(scene, &frame, &read, shape);
        let wanted = if self.book[led].curled.is_some() {
            wanted_curled(&mut self.book[led], scene, &frame, &read, seconds)
        } else {
            wanted_of(&mut self.book[led], scene, &frame, &read)
        };
        let first = self.book.len() > known;
        let led_id = self.book[led].id;
        let out = bring(
            &mut self.book,
            led,
            wanted,
            frame.phase == Phase::Held,
            first,
            seconds,
        );
        let mut left_book = left_on_change;
        left_book.extend(out.iter().map(|leaf| leaf.id));
        lay_out(&mut self.book, columns, rows);
        self.flat = Some(Flat::for_shape(self.flat.take(), shape, columns, rows));
        self.spine = scene.spine;
        Some(Laid {
            columns,
            rows,
            led: led_id,
            front: read.front,
            after: read.after,
            left_book,
        })
    }

    /// The sheets of the frame last laid out, from the front of the book to the back.
    pub fn sheets(&self) -> Vec<Sheet<'_>> {
        match self.flat.as_ref() {
            Some(flat) => sheets(flat, &self.book, self.spine),
            None => Vec::new(),
        }
    }

    /// Nothing is in the air any more. `epoch` names the host's GPU context:
    /// pages taken in another went with it.
    pub fn forget(&mut self, epoch: u64) -> Forgotten {
        let forgotten = Forgotten {
            leaves: self.book.iter().map(|leaf| leaf.id).collect(),
            release: self.epoch == epoch,
        };
        self.book.clear();
        self.led = None;
        forgotten
    }

    /// How many frames have been painted.
    pub fn painted(&self) -> u64 {
        self.painted
    }

    /// Whether a leaf left to come down still counts at `now` (ms): for as long as frames are drawn to bring it down.
    pub fn aloft(&self, now: f64) -> bool {
        now - self.painted_at <= SAME_TURN_WITHIN
            && self.book.iter().any(|leaf| leaf.flight.is_some())
    }

    fn led_leaf(&self) -> Option<&Leaf> {
        let id = self.led?;
        self.book.iter().find(|leaf| leaf.id == id)
    }

    /// Whether the page the turn is of is where its turn takes it, the turn still on its way.
    pub fn there(&self) -> bool {
        self.led_leaf().is_some_and(is_there)
    }

    /// Whether that page has left the frame for good.
    pub fn gone(&self) -> bool {
        self.led_leaf()
            .is_some_and(|leaf| is_there(leaf) && leaf.shown >= 1.0)
    }

    /// Where a turn that cuts into another begins, and how fast.
    pub fn begins(&self, dx: f64, velocity: f64, same_spreads: bool) -> (f64, f64) {
        if !same_spreads {
            return (0.0, 0.0);
        }
        // A page already out of the frame has nothing left to carry on with: it is brought back at once.
        (dx, if self.gone() { 0.0 } else { velocity })
    }

    /// How a turn nothing holds goes from `from` at `velocity` to `to`.
    pub fn settle(&self, from: f64, velocity: f64, to: f64) -> PaperSettle {
        PaperSettle::new(from, velocity, to, self.painted)
    }

    /// Steps `settle` to `seconds` after it began, at `now` (ms): once a frame.
    pub fn settle_step(&self, settle: &mut PaperSettle, seconds: f64, now: f64) -> At {
        settle.step(seconds, self.aloft(now), self.painted, self.there())
    }

    /// Whether what is remembered of the leaves is of another moment: long
    /// ago, another size, another GPU. A page a finger still holds is of this
    /// one however long its last frame took.
    fn stale(&self, shape: LeafShape, now: f64, frame: &Frame, epoch: u64) -> bool {
        let held = still_held(self.led_leaf().and_then(|leaf| leaf.curled.as_ref()), frame);
        (now - self.painted_at > SAME_TURN_WITHIN && !held)
            || (!self.book.is_empty() && self.epoch != epoch)
            || !self.book.iter().all(|leaf| leaf.shape == shape)
    }

    /// The leaf this frame is of: one already in the air, taken up where it
    /// is, or a new one lying where its turn starts from. Every other leaf in
    /// the air is left to come down by itself. Also answers the leaf it
    /// replaced, the same place in another book, whose pages are let go.
    fn leaf_of(
        &mut self,
        scene: Scene,
        frame: &Frame,
        read: &LeafTurn,
        shape: LeafShape,
    ) -> (usize, Vec<LeafId>) {
        let printed = read.front.map(|page| page.content);
        let mut replaced = Vec::new();
        let mut found = self.book.iter().position(|leaf| leaf.spread == read.spread);
        // The same place in another book: what is remembered of it is of something else.
        if let Some(at) = found {
            if self.book[at].printed != printed {
                replaced.push(self.book.remove(at).id);
                found = None;
            }
        }
        let at = match found {
            Some(at) => at,
            None => {
                let leaf = self.new_leaf(scene, frame, read, shape);
                place_in_book(&mut self.book, leaf)
            }
        };
        let id = self.book[at].id;
        if self.led != Some(id) {
            let leaf = &mut self.book[at];
            leaf.flight = None;
            // It goes on from where it is, whatever it was doing by itself.
            if let Some(curled) = leaf.curled.as_mut() {
                curled.pace = None;
            }
            leave_alone(&mut self.book, at, alone_width(scene));
        }
        self.led = Some(id);
        (at, replaced)
    }

    /// A leaf lying where its turn starts from: a page to curl over with one page a spread.
    fn new_leaf(&mut self, scene: Scene, frame: &Frame, read: &LeafTurn, shape: LeafShape) -> Leaf {
        let (columns, rows) = grid_for(shape.spine);
        let id = LeafId(self.next_id);
        self.next_id = self.next_id.wrapping_add(1);
        Leaf {
            id,
            spread: read.spread,
            printed: read.front.map(|page| page.content),
            shape,
            curled: if shape.spine == 0.0 {
                Some(curled_flat())
            } else {
                None
            },
            grab: grab_for(frame, scene),
            hold: None,
            held_from: None,
            shown: if read.forward { 0.0 } else { 1.0 },
            speed: 0.0,
            let_go: None,
            flight: None,
            positions: vec![0.0; columns * rows * 3],
            normals: vec![0.0; columns * rows * 3],
        }
    }
}
