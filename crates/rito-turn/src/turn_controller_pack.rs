//! The numbers a host and the page turns of a reader exchange, one layout
//! for every host: the web passes them as typed arrays through wasm,
//! Flutter as buffers through the C ABI.

use crate::turn_controller::{
    Direction, FramePhase, Sides, TurnAction, TurnController, TurnOutcome, TurnPages, TurnRequest,
};
use crate::turn_motion::{Leaving, Neighbour};
use crate::turn_pack::{write_turn_state, TURN_STATE_NUMBERS};

/// How many numbers what the host knows of the pages is: whether a page lies
/// next and previous, whether each is there, whether the effect can draw
/// each, and whether a page lies beyond the one the turn on screen brings in,
/// next and previous (1/0 each).
pub const TURN_PAGES_NUMBERS: usize = 8;

/// How many numbers an action is: its kind (0 none, 1 started, 2 ended,
/// 3 land, 4 fetch, 5 wait for the effect, 6 rested), its direction (0 next,
/// 1 previous), an ended turn's outcome (0 committed, 1 cancelled,
/// 2 interrupted) and whether it carries (1/0), and the seconds to wait.
pub const TURN_ACTION_NUMBERS: usize = 5;

/// How many numbers the controller's state is (see [`write_controller_state`]).
pub const TURN_CONTROLLER_STATE_NUMBERS: usize = 21 + TURN_STATE_NUMBERS;

fn flag(value: bool) -> f64 {
    if value {
        1.0
    } else {
        0.0
    }
}

fn sides(next: f64, previous: f64) -> Sides {
    Sides {
        next: next != 0.0,
        previous: previous != 0.0,
    }
}

pub fn read_turn_pages(numbers: &[f64]) -> TurnPages {
    TurnPages {
        can_turn: sides(numbers[0], numbers[1]),
        there: sides(numbers[2], numbers[3]),
        drawable: sides(numbers[4], numbers[5]),
        beyond: sides(numbers[6], numbers[7]),
    }
}

/// A direction as a number: 0 next, 1 previous.
pub fn read_direction(number: u32) -> Direction {
    if number == 0 {
        Direction::Next
    } else {
        Direction::Previous
    }
}

fn direction(value: Direction) -> f64 {
    match value {
        Direction::Next => 0.0,
        Direction::Previous => 1.0,
    }
}

/// Writes `action`, or kind 0 for none.
pub fn write_turn_action(action: Option<TurnAction>, out: &mut [f64]) {
    out[..TURN_ACTION_NUMBERS].fill(0.0);
    let Some(action) = action else {
        return;
    };
    match action {
        TurnAction::Started(way) => out[..2].copy_from_slice(&[1.0, direction(way)]),
        TurnAction::Ended {
            direction: way,
            outcome,
            carries,
        } => {
            let outcome = match outcome {
                TurnOutcome::Committed => 0.0,
                TurnOutcome::Cancelled => 1.0,
                TurnOutcome::Interrupted => 2.0,
            };
            out[..4].copy_from_slice(&[2.0, direction(way), outcome, flag(carries)]);
        }
        TurnAction::Land(way) => out[..2].copy_from_slice(&[3.0, direction(way)]),
        TurnAction::Fetch(way) => out[..2].copy_from_slice(&[4.0, direction(way)]),
        TurnAction::WaitForEffect { seconds } => {
            out[0] = 5.0;
            out[4] = seconds;
        }
        TurnAction::Rested => out[0] = 6.0,
    }
}

fn neighbour(value: Option<Neighbour>) -> f64 {
    match value {
        None => 0.0,
        Some(Neighbour::Next) => 1.0,
        Some(Neighbour::Previous) => 2.0,
    }
}

fn leaving(value: Leaving) -> f64 {
    match value {
        Leaving::None => 0.0,
        Leaving::Next => 1.0,
        Leaving::Previous => 2.0,
    }
}

/// Writes the controller's state: the turn on screen (0 none, 1 next,
/// 2 previous), whether anything is on screen, whether a finger holds the
/// page; the question open (0 none, 1 where a turn begins: the leftover's
/// offset, velocity and leaving 0 none / 1 next / 2 previous, forward,
/// has incoming; 2 whether a release lands: offset, from, velocity, width,
/// forward); the frame (present, offset, incoming 0 none / 1 next /
/// 2 previous, phase 0 held / 1 landing / 2 returning, velocity) and its
/// touch (present, origin x, y, position x, y, farthest x, y); then the
/// motion's state (`turn_pack::write_turn_state`).
pub fn write_controller_state(controller: &TurnController, out: &mut [f64]) {
    out[..TURN_CONTROLLER_STATE_NUMBERS].fill(0.0);
    out[0] = match controller.turning() {
        None => 0.0,
        Some(Direction::Next) => 1.0,
        Some(Direction::Previous) => 2.0,
    };
    out[1] = flag(controller.moving());
    out[2] = flag(controller.held());
    match controller.request() {
        None => {}
        Some(TurnRequest::Begin {
            leftover,
            forward,
            has_incoming,
        }) => out[3..9].copy_from_slice(&[
            1.0,
            leftover.offset,
            leftover.velocity,
            leaving(leftover.leaving),
            flag(forward),
            flag(has_incoming),
        ]),
        Some(TurnRequest::Lands(release)) => out[3..9].copy_from_slice(&[
            2.0,
            release.offset,
            release.from,
            release.velocity,
            release.width,
            flag(release.forward),
        ]),
    }
    if let Some(frame) = controller.frame() {
        let phase = match frame.phase {
            FramePhase::Held => 0.0,
            FramePhase::Landing => 1.0,
            FramePhase::Returning => 2.0,
        };
        out[9..14].copy_from_slice(&[
            1.0,
            frame.offset,
            neighbour(frame.incoming),
            phase,
            frame.velocity,
        ]);
        if let Some(touch) = frame.touch {
            out[14..21].copy_from_slice(&[
                1.0,
                touch.origin.x,
                touch.origin.y,
                touch.position.x,
                touch.position.y,
                touch.farthest.x,
                touch.farthest.y,
            ]);
        }
    }
    write_turn_state(controller.motion(), &mut out[21..]);
}
