//! What a host tells the turn of a frame.

use crate::hold::Point;

/// The frame a turn is drawn in: its size in the units it is drawn in, where
/// the pages are bound (0 with one page a spread), and how many of those
/// units a CSS px is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Scene {
    pub width: f64,
    pub height: f64,
    pub spine: f64,
    pub css_pixel: f64,
}

/// What is moving a turn: a finger holds it, it is on its way to the
/// neighbour, or on its way back to the spread it left.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Held,
    Landing,
    Returning,
}

/// Which neighbour a turn brings in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Incoming {
    Next,
    Prev,
}

/// The finger that moved a turn: where it took hold, where it is (or let
/// go), and where it was when it had carried the turn farthest.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Touch {
    pub origin: Point,
    pub position: Point,
    pub farthest: Option<Point>,
}

/// One frame of a turn: how far it has travelled (`dx`, negative while
/// turning forward), which neighbour comes in (none while pulling against
/// the first or last spread), what moves it, and the finger that moved it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Frame {
    pub dx: f64,
    pub incoming: Option<Incoming>,
    pub phase: Phase,
    pub touch: Option<Touch>,
}

/// A page a turn may show: the spread printed on it, and the host's identity
/// of the buffer it is painted in (the same while that buffer is repainted).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageRef {
    pub spread: i64,
    pub content: u64,
}
