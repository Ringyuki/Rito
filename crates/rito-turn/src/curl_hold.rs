//! How far over a curled page must be for the edge of its paper turned over
//! to be where a finger has it.
//!
//! A finger does not move the line the paper leaves the pages at: it moves
//! the edge of the paper turned over, which the line follows by the shape of
//! the roll. So a held page is laid out by asking how far over it must be
//! for its edge to have gone as far as the finger has it, at the height the
//! finger holds it. The edge goes round the roll before it runs on top of
//! it, so the line comes in fast as a page lifts and at half the finger's
//! pace after.
//!
//! Lengths are in the units a frame is drawn in.

use crate::curl::{curl_through, laid_back, line_at, stands_at, Curl, CurlLine};
use crate::hold::View;
use crate::leaf::LeafShape;
use crate::math::{clamp, exp, max, min, or_one, PI};

/// No line leans more than this, as a tangent.
const LEANS_MOST: f64 = 0.8;
/// A finger counts as no nearer the corner a page is peeled from than this share of the page's width.
const BY_THE_CORNER: f64 = 0.05;
/// The first of a finger's way is eased into, over this share of the page's width.
const EASES_IN: f64 = 0.008;
/// The least the edge counts as gone for each unit its line has come in.
const STILL_COMES_IN: f64 = 1e-3;
/// How many times where the edge shows is worked out again from how high it stands there.
const SETTLES_IN: usize = 3;
/// What a page's way to the finger that has set off with it is timed by, seconds.
const COMES_IN: f64 = 0.027;

/// Where the line crosses the page at the height `y`, as x.
fn line_across(shape: LeafShape, line: CurlLine, y: f64) -> f64 {
    let down = clamp(y / or_one(shape.height), 0.0, 1.0);
    line.top + (line.bottom - line.top) * down
}

/// How far past the line the paper lay whose edge shows at a height where
/// the line is `short` of the page's edge.
fn past_for(curl: Curl, short: f64) -> f64 {
    let Curl { dx, radius, .. } = curl;
    let ratio = curl.dy / dx;
    let leans = ratio * ratio * dx;
    let half_turn = PI * radius;
    let on_top = (short - leans * half_turn) / (1.0 / dx - 2.0 * leans);
    if on_top >= half_turn {
        return on_top;
    }
    let mut low = 0.0;
    let mut high = half_turn;
    for _ in 0..24 {
        let middle = (low + high) / 2.0;
        if middle / dx - leans * laid_back(middle, radius) < short {
            low = middle;
        } else {
            high = middle;
        }
    }
    (low + high) / 2.0
}

/// How far the edge of a page's paper has gone from where it lies flat, as
/// the eye sees it at the height `y`, with the page leaving the pages at
/// `line`. Where the paper has yet to lift at that height it is how far the
/// finger has still to go before it does, below zero.
pub fn edge_gone(shape: LeafShape, line: CurlLine, y: f64, view: View) -> f64 {
    let curl = curl_through(shape, line);
    let edge = shape.spine + shape.width;
    let short = edge - line_across(shape, line, y);
    if short <= 0.0 {
        let ratio = curl.dy / curl.dx;
        return (2.0 * short) / (1.0 - ratio * ratio);
    }
    // Paper in the air shows farther from the middle of the frame than it is: the edge that
    // shows at this height lies nearer the middle by how high it stands.
    let mut past = past_for(curl, short);
    for _ in 0..SETTLES_IN {
        let stands = stands_at(past, curl.radius);
        let lies = view.height / 2.0 + ((y - view.height / 2.0) * (view.eye - stands)) / view.eye;
        let there = edge - line_across(shape, line, lies);
        if there <= 0.0 {
            return STILL_COMES_IN * short;
        }
        past = past_for(curl, there);
    }
    let gone = curl.dx * laid_back(past, curl.radius);
    let middle = view.width / 2.0;
    let shows =
        middle + ((edge - gone - middle) * view.eye) / (view.eye - stands_at(past, curl.radius));
    // Barely lifted, it shows a hair outward of where it lay: it is counted as coming in all the same.
    max(STILL_COMES_IN * short, edge - shows)
}

/// How far the edge of a page's paper has gone, the page `shown` of the way over and leaning by `lean`.
pub fn got_to(shape: LeafShape, shown: f64, lean: f64, y: f64, view: View) -> f64 {
    edge_gone(shape, line_at(shape, shown, lean), y, view)
}

/// How far over a page leaning by `lean` must be for its edge to have gone
/// `to`, at the height `y`.
pub fn shown_for(shape: LeafShape, to: f64, lean: f64, y: f64, view: View) -> f64 {
    if got_to(shape, 0.0, lean, y, view) >= to {
        return 0.0;
    }
    if got_to(shape, 1.0, lean, y, view) <= to {
        return 1.0;
    }
    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..30 {
        let middle = (low + high) / 2.0;
        if got_to(shape, middle, lean, y, view) < to {
            low = middle;
        } else {
            high = middle;
        }
    }
    (low + high) / 2.0
}

/// The share still to go of what a page was short of its finger, `seconds`
/// after the finger set off with it.
pub fn still_short(seconds: f64) -> f64 {
    let through = max(0.0, seconds) / COMES_IN;
    (1.0 + through) * exp(-through)
}

/// A finger's way as a page taken lying flat is drawn for it: the first of it eased into.
pub fn eased_in(shape: LeafShape, gone: f64) -> f64 {
    if gone <= 0.0 {
        return gone;
    }
    (gone * gone) / (gone + EASES_IN * shape.width)
}

/// How much a page held at the height `y` leans, when `wanted` is what the
/// finger asks for and its edge has gone `gone`.
pub fn leant_by(shape: LeafShape, wanted: f64, gone: f64, y: f64, kept: f64) -> f64 {
    let nearest = BY_THE_CORNER * shape.width;
    let within = |to_corner: f64, as_taken: f64| {
        let reach = max(to_corner, nearest);
        let lifted = if gone > 0.0 {
            min(gone / reach, reach / gone)
        } else {
            0.0
        };
        max(min(lifted, LEANS_MOST), min(as_taken, LEANS_MOST))
    };
    let lower_leads = within(shape.height - y, max(kept, 0.0));
    let upper_leads = within(y, max(-kept, 0.0));
    min(lower_leads, max(-upper_leads, wanted))
}
