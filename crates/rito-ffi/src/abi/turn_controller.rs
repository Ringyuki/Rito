//! The page turns of a reader (`rito-turn`) through the C ABI: when a turn
//! begins, lands and ends, and what a finger, a key or a jump does to one on
//! screen. A host calls it on its UI thread, holding a controller by a
//! handle; every call takes what the host knows of the pages, and the host
//! carries out the actions it takes from the controller and answers its
//! questions. Numbers cross in the layouts `rito_turn::turn_controller_pack`
//! fixes for every host.

// `#[no_mangle]` exports only; raw memory is read and written in `memory`.
#![allow(unsafe_code)]

use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard, OnceLock},
};

use rito_turn::turn_controller::{Point, TurnController, TurnPages};
use rito_turn::turn_controller_pack::{
    read_direction, read_turn_pages, write_controller_state, write_turn_action,
    TURN_ACTION_NUMBERS, TURN_CONTROLLER_STATE_NUMBERS, TURN_PAGES_NUMBERS,
};
use rito_turn::turn_pack::{
    read_begin, read_turn_at, read_turn_physics, TURN_AT_NUMBERS, TURN_PHYSICS_NUMBERS,
};

use super::memory::{invoke, read_numbers, write_ids, write_numbers, write_u32, write_u64};
use super::RitoOwnedBuffer;
use crate::error::FfiError;

/// The numbers of the layouts the controller's calls take, in the order
/// `rito_turn_controller_layouts` writes them: pages, action, state.
const LAYOUTS: [u32; 3] = [
    TURN_PAGES_NUMBERS as u32,
    TURN_ACTION_NUMBERS as u32,
    TURN_CONTROLLER_STATE_NUMBERS as u32,
];

#[derive(Default)]
struct Controllers {
    controllers: HashMap<u64, TurnController>,
    created: u64,
}

static CONTROLLERS: OnceLock<Mutex<Controllers>> = OnceLock::new();

fn controllers() -> MutexGuard<'static, Controllers> {
    CONTROLLERS
        .get_or_init(|| Mutex::new(Controllers::default()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn with<T>(controller: u64, then: impl FnOnce(&mut TurnController) -> T) -> Result<T, FfiError> {
    let mut controllers = controllers();
    let held = controllers
        .controllers
        .get_mut(&controller)
        .ok_or_else(|| FfiError::not_found(format!("turn controller not found: {controller}")))?;
    Ok(then(held))
}

fn pages(numbers: *const f64) -> Result<TurnPages, FfiError> {
    Ok(read_turn_pages(&read_numbers::<TURN_PAGES_NUMBERS>(
        numbers, "pages",
    )?))
}

fn point(x: f64, y: f64) -> Point {
    Point { x, y }
}

#[no_mangle]
pub extern "C" fn rito_turn_controller_layouts(
    layouts_out: *mut u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let mut count = 0;
        write_ids(
            layouts_out,
            LAYOUTS.len() as u32,
            &mut count,
            &LAYOUTS,
            "layouts_out",
        )
    })
}

#[no_mangle]
pub extern "C" fn rito_turn_controller_new(
    physics: *const f64,
    controller_out: *mut u64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let physics = read_turn_physics(&read_numbers::<TURN_PHYSICS_NUMBERS>(physics, "physics")?);
        let mut controllers = controllers();
        controllers.created += 1;
        let controller = controllers.created;
        controllers
            .controllers
            .insert(controller, TurnController::new(physics));
        write_u64(controller_out, controller, "controller_out")
    })
}

#[no_mangle]
pub extern "C" fn rito_turn_controller_free(
    controller: u64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        controllers().controllers.remove(&controller);
        Ok(())
    })
}

/// The built-in rules' numbers, the page width a turn travels, and whether
/// turns land at once (an effect that does not animate).
#[no_mangle]
pub extern "C" fn rito_turn_controller_configure(
    controller: u64,
    physics: *const f64,
    width: f64,
    instant: u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let physics = read_turn_physics(&read_numbers::<TURN_PHYSICS_NUMBERS>(physics, "physics")?);
        with(controller, |held| {
            held.configure(physics, width);
            held.set_instant(instant != 0);
        })
    })
}

/// A finger came down at `x`, `y` and moved far enough to mean a drag, at `at` ms.
#[no_mangle]
pub extern "C" fn rito_turn_controller_finger_down(
    controller: u64,
    pages_now: *const f64,
    x: f64,
    y: f64,
    at: f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let pages = pages(pages_now)?;
        with(controller, |held| held.finger_down(pages, point(x, y), at))
    })
}

/// The finger is at `x`, `y`, having carried the turn `travel` px; `resisted`
/// is what the host's physics make of it against the end of the book, NaN
/// for the built-in stretch.
#[no_mangle]
pub extern "C" fn rito_turn_controller_finger_move(
    controller: u64,
    pages_now: *const f64,
    x: f64,
    y: f64,
    travel: f64,
    resisted: f64,
    at: f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let pages = pages(pages_now)?;
        let resisted = (!resisted.is_nan()).then_some(resisted);
        with(controller, |held| {
            held.finger_move(pages, point(x, y), travel, resisted, at);
        })
    })
}

#[no_mangle]
pub extern "C" fn rito_turn_controller_finger_up(
    controller: u64,
    pages_now: *const f64,
    x: f64,
    y: f64,
    travel: f64,
    at: f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let pages = pages(pages_now)?;
        with(controller, |held| {
            held.finger_up(pages, point(x, y), travel, at);
        })
    })
}

#[no_mangle]
pub extern "C" fn rito_turn_controller_finger_cancel(
    controller: u64,
    pages_now: *const f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let pages = pages(pages_now)?;
        with(controller, |held| held.finger_cancel(pages))
    })
}

/// Turns to the neighbour `direction` (0 next, 1 previous); writes whether
/// the command was taken.
#[no_mangle]
pub extern "C" fn rito_turn_controller_command(
    controller: u64,
    pages_now: *const f64,
    direction: u32,
    taken_out: *mut u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let pages = pages(pages_now)?;
        let taken = with(controller, |held| {
            held.command(pages, read_direction(direction))
        })?;
        write_u32(taken_out, u32::from(taken), "taken_out")
    })
}

/// A jump the reader has made, played as a turn `direction` from the page it left.
#[no_mangle]
pub extern "C" fn rito_turn_controller_play_jump(
    controller: u64,
    pages_now: *const f64,
    direction: u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let pages = pages(pages_now)?;
        with(controller, |held| {
            held.play_jump(pages, read_direction(direction));
        })
    })
}

/// The reader landed the turn on screen (`ok` 1), or could not (0).
#[no_mangle]
pub extern "C" fn rito_turn_controller_landed(
    controller: u64,
    pages_now: *const f64,
    ok: u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let pages = pages(pages_now)?;
        with(controller, |held| held.landed(pages, ok != 0))
    })
}

/// What the host knows of the pages changed.
#[no_mangle]
pub extern "C" fn rito_turn_controller_pages(
    controller: u64,
    pages_now: *const f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let pages = pages(pages_now)?;
        with(controller, |held| held.pages(pages))
    })
}

/// The effect was waited for as long as it may be.
#[no_mangle]
pub extern "C" fn rito_turn_controller_overdue(
    controller: u64,
    pages_now: *const f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let pages = pages(pages_now)?;
        with(controller, |held| held.overdue(pages))
    })
}

/// Something else moved the reader (a jump, a relayout).
#[no_mangle]
pub extern "C" fn rito_turn_controller_interrupt(
    controller: u64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || with(controller, TurnController::interrupt))
}

/// Something the reader is asked directly ends what is on screen at once,
/// where its turn was going.
#[no_mangle]
pub extern "C" fn rito_turn_controller_settle_now(
    controller: u64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || with(controller, TurnController::settle_now))
}

/// Moves what is on screen on by `seconds`; `host_at` is where the host's
/// physics' motion is then (x, velocity, done) while they carry it, from
/// its first step, else null.
#[no_mangle]
pub extern "C" fn rito_turn_controller_step(
    controller: u64,
    pages_now: *const f64,
    seconds: f64,
    host_at: *const f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let pages = pages(pages_now)?;
        let host = if host_at.is_null() {
            None
        } else {
            Some(read_turn_at(&read_numbers::<TURN_AT_NUMBERS>(
                host_at, "host_at",
            )?))
        };
        with(controller, |held| held.step(pages, seconds, host))
    })
}

/// Answers where a turn begins: `begin` is offset, velocity, or null for the built-in rule.
#[no_mangle]
pub extern "C" fn rito_turn_controller_answer_begin(
    controller: u64,
    begin: *const f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let begin = if begin.is_null() {
            None
        } else {
            Some(read_begin(&read_numbers::<2>(begin, "begin")?))
        };
        with(controller, |held| held.answer_begin(begin))
    })
}

/// Answers whether a release lands: 1 or 0, or -1 for the built-in rule.
#[no_mangle]
pub extern "C" fn rito_turn_controller_answer_lands(
    controller: u64,
    lands: i32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let lands = (lands >= 0).then_some(lands != 0);
        with(controller, |held| held.answer_lands(lands))
    })
}

/// Writes the next action the host is to take (kind 0: none).
#[no_mangle]
pub extern "C" fn rito_turn_controller_take_action(
    controller: u64,
    action_out: *mut f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let action = with(controller, TurnController::take_action)?;
        let mut numbers = [0.0; TURN_ACTION_NUMBERS];
        write_turn_action(action, &mut numbers);
        write_numbers(action_out, &numbers, "action_out")
    })
}

/// Writes the controller's state (`rito_turn::turn_controller_pack::write_controller_state`).
#[no_mangle]
pub extern "C" fn rito_turn_controller_state(
    controller: u64,
    state_out: *mut f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let mut numbers = [0.0; TURN_CONTROLLER_STATE_NUMBERS];
        with(controller, |held| {
            write_controller_state(held, &mut numbers)
        })?;
        write_numbers(state_out, &numbers, "state_out")
    })
}
