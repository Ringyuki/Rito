//! How a paper turn moves: what a finger's way carries the turn by, whether
//! letting go turns the page, where a turn that cuts in begins, and how a
//! turn nothing holds comes to rest.

use crate::frame::Touch;
use crate::hold::NEAREST_HOLD;
use crate::leaf::LeafGrab;
use crate::math::{clamp, max, or_one};
use crate::motion::{At, LeafMotion};

/// Where a turn no finger started takes the leaf: its outer edge, toward the lower corner.
const UNHELD_GRAB: LeafGrab = LeafGrab { u: 1.0, v: 0.86 };
/// A finger must have moved this far, CSS px, for letting go to turn the page.
pub const LEAST_PULL: f64 = 24.0;
/// A page curled over goes back when its finger has come back this far from
/// its farthest, CSS px, or by this share of its farthest pull where that is more.
const CAME_BACK: f64 = 24.0;
const CAME_BACK_SHARE: f64 = 0.25;
/// And when its finger is going back faster than this as it lets go, CSS px a second.
const FLUNG_BACK: f64 = 500.0;

/// Which point of the leaf a finger took hold of, in a frame `width` wide
/// bound at `spine` and `height` high.
pub fn grab_of(touch: Option<&Touch>, width: f64, spine: f64, height: f64) -> LeafGrab {
    let Some(touch) = touch else {
        return UNHELD_GRAB;
    };
    let leaf = width - spine;
    let back = touch.position.x > touch.origin.x;
    let out = if spine > 0.0 {
        if back {
            spine - touch.origin.x
        } else {
            touch.origin.x - spine
        }
    } else {
        leaf
    };
    LeafGrab {
        u: clamp(out / or_one(leaf), NEAREST_HOLD, 1.0),
        v: clamp(touch.origin.y / or_one(height), 0.0, 1.0),
    }
}

/// How far a finger has carried the turn: the held point goes as far as the
/// finger, and a whole turn takes it twice its distance from the spine.
pub fn travel(touch: &Touch, width: f64, spine: f64) -> f64 {
    let moved = touch.position.x - touch.origin.x;
    if moved == 0.0 {
        return 0.0;
    }
    let grab = grab_of(Some(touch), width, spine, 1.0);
    let radius = grab.u * (width - spine);
    width * clamp(moved / (2.0 * radius), -1.0, 1.0)
}

/// A turn at the moment its finger lets go.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Release {
    pub dx: f64,
    pub from: f64,
    pub velocity: f64,
    pub width: f64,
    pub forward: bool,
    pub touch: Option<Touch>,
    pub spine: Option<f64>,
}

/// Whether a turn let go turns the page.
pub fn lands(release: &Release) -> bool {
    let toward = if release.forward { -1.0 } else { 1.0 };
    if release.spine == Some(0.0) {
        if let Some(touch) = release.touch {
            return curled_lands(&touch, toward, release.velocity);
        }
    }
    // How far the finger carried the leaf, wherever it took it.
    let along = max(
        0.0,
        ((release.dx - release.from) * toward) / or_one(release.width),
    );
    let speed = (release.velocity * toward) / or_one(release.width);
    let pulled = release.touch.map_or(f64::INFINITY, |touch| {
        (touch.position.x - touch.origin.x) * toward
    });
    // Pulling back, or barely moved: the page stays.
    if speed < -0.25 || pulled < LEAST_PULL {
        return false;
    }
    along + speed * 0.15 > 0.2 || speed > 1.0
}

/// Whether a page curled over turns when its finger lets go: a page pulled
/// out and not brought back turns, however short the pull; one brought
/// back, or flung back, does not.
fn curled_lands(touch: &Touch, toward: f64, velocity: f64) -> bool {
    let pulled = (touch.position.x - touch.origin.x) * toward;
    let most = (touch.farthest.unwrap_or(touch.position).x - touch.origin.x) * toward;
    // The finger goes twice as far as the turn it carries, and as fast.
    let going_back = -2.0 * velocity * toward;
    pulled >= LEAST_PULL
        && most - pulled <= max(CAME_BACK, CAME_BACK_SHARE * most)
        && going_back <= FLUNG_BACK
}

/// How a turn nothing holds comes to rest, held by the host and stepped by
/// the model exactly once a frame (`PaperModel::settle_step`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PaperSettle {
    pub(crate) motion: LeafMotion,
    pub(crate) to: f64,
    /// How many frames had been painted when it began.
    pub(crate) began: u64,
    /// That the frame of the page where its turn takes it has been drawn.
    pub(crate) shown: bool,
}

impl PaperSettle {
    pub(crate) fn new(from: f64, velocity: f64, to: f64, painted: u64) -> Self {
        Self {
            motion: LeafMotion::new(from, velocity, to),
            to,
            began: painted,
            shown: false,
        }
    }

    /// The step, told what the effect knows now: whether a leaf is still in
    /// the air, how many frames have been painted, and whether the page is
    /// where its turn takes it.
    pub(crate) fn step(&mut self, seconds: f64, aloft: bool, painted: u64, there: bool) -> At {
        let at = self.motion.step(seconds);
        if at.done {
            return if aloft { At { done: false, ..at } } else { at };
        }
        // The page has got there: one frame is drawn of that, and the turn is over.
        if painted > self.began && there && !aloft {
            let done = self.shown;
            self.shown = true;
            return At {
                x: self.to,
                velocity: 0.0,
                done,
            };
        }
        at
    }
}

/// How many numbers a `PaperSettle` is written as.
pub const SETTLE_NUMBERS: usize = crate::motion::LEAF_MOTION_NUMBERS + 3;

impl PaperSettle {
    /// The settle as numbers: what a host holds between steps, in place of
    /// the settle itself, so that nothing of it lives on in the model.
    pub fn write(&self, out: &mut [f64]) {
        let motion = crate::motion::LEAF_MOTION_NUMBERS;
        self.motion.write(&mut out[..motion]);
        out[motion] = self.to;
        out[motion + 1] = self.began as f64;
        out[motion + 2] = if self.shown { 1.0 } else { 0.0 };
    }

    /// The settle `write` wrote.
    pub fn read(numbers: &[f64]) -> Self {
        let motion = crate::motion::LEAF_MOTION_NUMBERS;
        Self {
            motion: LeafMotion::read(&numbers[..motion]),
            to: numbers[motion],
            began: numbers[motion + 1] as u64,
            shown: numbers[motion + 2] != 0.0,
        }
    }
}
