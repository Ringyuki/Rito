//! The built-in rules a page turn moves by, whatever it looks like: how a
//! pull against the end of the book resists, whether a release turns the
//! page, and how fast a finger carries the turn. Every number is the
//! host's to set; the defaults are the ones the web and Flutter readers
//! have always turned pages with.

use crate::math::{max, sign};
use crate::spring::Spring;

/// The numbers the built-in rules go by.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TurnPhysics {
    /// The spring that carries a turn nothing holds to rest.
    pub spring: Spring,
    /// A release this far from where the finger took the turn (px, after
    /// its velocity is projected over `projection`) turns the page.
    pub swipe_threshold: f64,
    /// A release this fast (px/s) turns the page however far it went.
    pub velocity_commit: f64,
    /// How long a release's velocity is projected over, seconds.
    pub projection: f64,
    /// A finger pulling the turn back faster than this (px/s) leaves the page.
    pub pull_back: f64,
    /// How hard a pull against the first or last page resists, 0 to 1.
    pub elastic_factor: f64,
}

impl TurnPhysics {
    /// Between `SNAPPY` and `GENTLE`.
    pub const STANDARD: Spring = Spring {
        stiffness: 180.0,
        damping: 27.0,
    };
    /// Lands fast.
    pub const SNAPPY: Spring = Spring {
        stiffness: 320.0,
        damping: 36.0,
    };
    /// Drifts in.
    pub const GENTLE: Spring = Spring {
        stiffness: 110.0,
        damping: 21.0,
    };

    /// Where a pull of `travel` px leaves the page when no neighbour lies
    /// that way: it stretches like a rubber band, never past
    /// `elastic_factor` of a page.
    pub fn resist(&self, travel: f64, width: f64) -> f64 {
        if travel == 0.0 || width <= 0.0 {
            return 0.0;
        }
        let stretch = 1.0 - 1.0 / (travel.abs() / width + 1.0);
        sign(travel) * stretch * width * self.elastic_factor
    }

    /// Whether a turn let go turns the page; otherwise it goes back. It
    /// goes by how far the finger carried the turn: where the turn was when
    /// the finger took it says nothing of what the finger meant.
    pub fn lands(&self, release: &TurnRelease) -> bool {
        let carried = release.offset - release.from;
        let toward = if release.forward { -1.0 } else { 1.0 };
        // Dragged back past where it took it, or pulling back: the page stays.
        if carried * toward < 0.0 || release.velocity * toward < -self.pull_back {
            return false;
        }
        (carried + release.velocity * self.projection).abs() > self.swipe_threshold
            || release.velocity.abs() > self.velocity_commit
    }
}

impl Default for TurnPhysics {
    fn default() -> Self {
        Self {
            spring: Self::STANDARD,
            swipe_threshold: 50.0,
            velocity_commit: 400.0,
            projection: 0.15,
            pull_back: 50.0,
            elastic_factor: 0.55,
        }
    }
}

/// A turn at the moment its finger lets go: where it is (px, negative
/// toward the next page), where it was when the finger took it, how fast
/// the finger was carrying it (px/s), the page width and which way it turns.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TurnRelease {
    pub offset: f64,
    pub from: f64,
    pub velocity: f64,
    pub width: f64,
    pub forward: bool,
}

/// How many of a finger's last samples its speed is measured from.
pub(crate) const SPEED_WINDOW: usize = 5;

/// A finger's last few places along the turn (px) and when (ms).
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct FingerSamples {
    samples: [(f64, f64); SPEED_WINDOW],
    len: usize,
}

impl FingerSamples {
    pub(crate) fn starting_at(offset: f64, at: f64) -> Self {
        let mut samples = Self::default();
        samples.push(offset, at);
        samples
    }

    pub(crate) fn push(&mut self, offset: f64, at: f64) {
        if self.len == SPEED_WINDOW {
            self.samples.copy_within(1.., 0);
            self.len -= 1;
        }
        self.samples[self.len] = (offset, at);
        self.len += 1;
    }

    /// How fast the samples move, px/ms: each step's speed, the later ones
    /// weighing more, no step shorter than a millisecond.
    pub(crate) fn speed(&self) -> f64 {
        let samples = &self.samples[..self.len];
        if samples.len() < 2 || samples[samples.len() - 1].1 - samples[0].1 < 1.0 {
            return 0.0;
        }
        let mut weighted = 0.0;
        let mut weights = 0.0;
        for i in 1..samples.len() {
            let step = max(samples[i].1 - samples[i - 1].1, 1.0);
            weighted += (samples[i].0 - samples[i - 1].0) / step * i as f64;
            weights += i as f64;
        }
        weighted / weights
    }
}
