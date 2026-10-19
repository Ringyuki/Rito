//! Moving the leaves of the book on by a frame, and laying them out.

use crate::curled::lay_curled;
use crate::leaf::{lay_leaf, pose_at};
use crate::leaves::{fly, has_landed, keep_in_order, Leaf};
use crate::math::{max, min};

/// How fast a leaf is brought to where it is wanted at most, in turns per second.
const FASTEST: f64 = 9.0;
/// How many leaves may be coming down by themselves; one more and the first left lands at once.
const ALONE_AT_MOST: usize = 3;

/// Moves every leaf of `book` on by a frame: the led one toward how far over
/// it is `wanted`, every other on its own way. Those that have come to rest,
/// and any more than may be in the air at once, are taken out of the book
/// and returned, in that order.
fn move_on(
    book: &mut Vec<Leaf>,
    led: usize,
    wanted: f64,
    led_seconds: f64,
    seconds: f64,
    at_once: bool,
) -> Vec<Leaf> {
    if book[led].flight.is_some() {
        // Let go with nowhere left for its turn to take it, it comes down by itself.
        if fly(&mut book[led], seconds) {
            book[led].flight = None;
        }
    } else {
        let leaf = &mut book[led];
        let reach = if at_once {
            f64::INFINITY
        } else {
            FASTEST * led_seconds
        };
        let before = leaf.shown;
        leaf.shown += min(reach, max(-reach, wanted - leaf.shown));
        if led_seconds > 0.0 {
            leaf.speed = (leaf.shown - before) / led_seconds;
        }
    }
    for (index, leaf) in book.iter_mut().enumerate() {
        if index != led {
            fly(leaf, seconds);
        }
    }
    // Pages curled over are kept apart where they are laid out, by the lines they leave the page at.
    if book[led].curled.is_none() {
        keep_in_order(book, led);
    }
    let led_id = book[led].id;
    let landed: Vec<_> = book
        .iter()
        .filter(|leaf| leaf.id != led_id && has_landed(leaf))
        .map(|leaf| leaf.id)
        .collect();
    let mut alone: Vec<_> = book
        .iter()
        .filter(|leaf| leaf.id != led_id && !landed.contains(&leaf.id))
        .map(|leaf| (leaf.id, leaf.flight.map_or(0.0, |flight| flight.elapsed)))
        .collect();
    // More in the air than can be: the one left alone longest lands at once.
    alone.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(core::cmp::Ordering::Equal));
    let out: Vec<_> = landed
        .into_iter()
        .chain(alone.into_iter().skip(ALONE_AT_MOST).map(|(id, _)| id))
        .collect();
    out.iter()
        .map(|id| {
            let at = book
                .iter()
                .position(|leaf| leaf.id == *id)
                .expect("in the book");
            book.remove(at)
        })
        .collect()
}

/// Moves the leaves on by a frame as a turn's frame has them: the led one
/// toward how far over it is `wanted`, and returns those that are done. A
/// leaf first seen this frame lies where its turn starts from. A page under
/// a finger is where the finger has it: brought there in its first frame as
/// fast as a jump of the hand may be, and at once after.
pub(crate) fn bring(
    book: &mut Vec<Leaf>,
    led: usize,
    wanted: f64,
    held: bool,
    first: bool,
    seconds: f64,
) -> Vec<Leaf> {
    let taken = book[led].curled.is_some() && held;
    let led_seconds = if first && !taken { 0.0 } else { seconds };
    move_on(book, led, wanted, led_seconds, seconds, taken && !first)
}

/// Lays every leaf of `book` out where it now is, on a grid of `columns` by `rows`.
pub(crate) fn lay_out(book: &mut [Leaf], columns: usize, rows: usize) {
    lay_curled(book, columns, rows);
    for leaf in book.iter_mut() {
        if leaf.curled.is_some() {
            continue;
        }
        let pose = pose_at(leaf.shape, leaf.grab, leaf.shown);
        lay_leaf(
            leaf.shape,
            pose,
            columns,
            rows,
            &mut leaf.positions,
            &mut leaf.normals,
        );
    }
}
