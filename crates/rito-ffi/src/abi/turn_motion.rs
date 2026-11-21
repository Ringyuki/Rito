//! The motion of a page turn (`rito-turn`) through the C ABI: the finger
//! while it holds the turn, the release, the spring and a turn cut into by
//! another. A host calls it on its UI thread, frame by frame, holding a
//! motion by a handle; numbers cross in the layouts `rito_turn::turn_pack`
//! fixes for every host. Where the host's own physics decide, it passes
//! their answer; otherwise the built-in rules do.

// `#[no_mangle]` exports only; raw memory is read and written in `memory`.
#![allow(unsafe_code)]

use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard, OnceLock},
};

use rito_turn::turn_motion::TurnMotion;
use rito_turn::turn_pack::{
    read_begin, read_turn_at, read_turn_physics, turn_step_code, write_turn_state, TURN_AT_NUMBERS,
    TURN_PHYSICS_NUMBERS, TURN_STATE_NUMBERS,
};

use super::memory::{invoke, read_numbers, write_ids, write_numbers, write_u32, write_u64};
use super::RitoOwnedBuffer;
use crate::error::FfiError;

/// The numbers of the layouts the motion's calls take, in the order
/// `rito_turn_motion_layouts` writes them: physics, state, a place.
const LAYOUTS: [u32; 3] = [
    TURN_PHYSICS_NUMBERS as u32,
    TURN_STATE_NUMBERS as u32,
    TURN_AT_NUMBERS as u32,
];

#[derive(Default)]
struct Motions {
    motions: HashMap<u64, TurnMotion>,
    created: u64,
}

static MOTIONS: OnceLock<Mutex<Motions>> = OnceLock::new();

fn motions() -> MutexGuard<'static, Motions> {
    MOTIONS
        .get_or_init(|| Mutex::new(Motions::default()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn with<T>(motion: u64, then: impl FnOnce(&mut TurnMotion) -> T) -> Result<T, FfiError> {
    let mut motions = motions();
    let held = motions
        .motions
        .get_mut(&motion)
        .ok_or_else(|| FfiError::not_found(format!("turn motion not found: {motion}")))?;
    Ok(then(held))
}

/// Where the host's physics begin a turn that cuts in, or null for the built-in rule.
fn begin(numbers: *const f64) -> Result<Option<rito_turn::turn_motion::Begin>, FfiError> {
    if numbers.is_null() {
        return Ok(None);
    }
    Ok(Some(read_begin(&read_numbers::<2>(numbers, "begin")?)))
}

#[no_mangle]
pub extern "C" fn rito_turn_motion_layouts(
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
pub extern "C" fn rito_turn_motion_new(
    physics: *const f64,
    motion_out: *mut u64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let physics = read_turn_physics(&read_numbers::<TURN_PHYSICS_NUMBERS>(physics, "physics")?);
        let mut motions = motions();
        motions.created += 1;
        let motion = motions.created;
        motions.motions.insert(motion, TurnMotion::new(physics));
        write_u64(motion_out, motion, "motion_out")
    })
}

#[no_mangle]
pub extern "C" fn rito_turn_motion_free(motion: u64, error_out: *mut RitoOwnedBuffer) -> u32 {
    invoke(error_out, || {
        motions().motions.remove(&motion);
        Ok(())
    })
}

/// Sets the built-in rules' numbers and the page width a turn travels.
#[no_mangle]
pub extern "C" fn rito_turn_motion_configure(
    motion: u64,
    physics: *const f64,
    width: f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let physics = read_turn_physics(&read_numbers::<TURN_PHYSICS_NUMBERS>(physics, "physics")?);
        with(motion, |held| {
            held.set_physics(physics);
            held.set_width(width);
        })
    })
}

/// A finger takes the turn at `at` ms. `begin` is offset and velocity where
/// the host's physics begin a turn that cuts in, or null for the built-in rule.
#[no_mangle]
pub extern "C" fn rito_turn_motion_start_drag(
    motion: u64,
    forward: u32,
    has_incoming: u32,
    at: f64,
    begin_at: *const f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let begin = begin(begin_at)?;
        with(motion, |held| {
            held.start_drag(forward != 0, has_incoming != 0, at, begin)
        })
    })
}

/// Follows the finger at `at` ms: `travel` px since it took the turn, or,
/// with `carried` 1, the turn the host's physics made of that travel.
#[no_mangle]
pub extern "C" fn rito_turn_motion_drag(
    motion: u64,
    travel: f64,
    at: f64,
    carried: u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        with(motion, |held| {
            if carried != 0 {
                held.drag_carried(travel, at);
            } else {
                held.drag(travel, at);
            }
        })
    })
}

/// Lets go. `lands` is the host's physics' answer (1 turns, 0 goes back),
/// or -1 for the built-in rule; writes whether the page turns.
#[no_mangle]
pub extern "C" fn rito_turn_motion_release(
    motion: u64,
    lands: i32,
    lands_out: *mut u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let decided = (lands >= 0).then_some(lands != 0);
        let turned = with(motion, |held| held.release(decided))?;
        write_u32(lands_out, u32::from(turned), "lands_out")
    })
}

#[no_mangle]
pub extern "C" fn rito_turn_motion_cancel(
    motion: u64,
    cancelled_out: *mut u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let cancelled = with(motion, TurnMotion::cancel)?;
        write_u32(cancelled_out, u32::from(cancelled), "cancelled_out")
    })
}

/// Turns toward a neighbour without a finger; `begin` as in `start_drag`.
#[no_mangle]
pub extern "C" fn rito_turn_motion_turn(
    motion: u64,
    forward: u32,
    begin_at: *const f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let begin = begin(begin_at)?;
        with(motion, |held| held.turn(forward != 0, begin))
    })
}

#[no_mangle]
pub extern "C" fn rito_turn_motion_interrupt(
    motion: u64,
    at: f64,
    interrupted_out: *mut u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let interrupted = with(motion, |held| held.interrupt(at))?;
        write_u32(interrupted_out, u32::from(interrupted), "interrupted_out")
    })
}

#[no_mangle]
pub extern "C" fn rito_turn_motion_carry_on(
    motion: u64,
    committed: u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        with(motion, |held| held.carry_on(committed != 0))
    })
}

/// Moves the turn on by `seconds`. A host carrying the motion with physics
/// of its own passes `host_at`, where its motion is then (x, velocity,
/// done), at every step of it from the first; null at the first leaves it
/// to the spring. `instant` 1 lands at once. Writes what the step did
/// (`rito_turn::turn_pack::turn_step_code`).
#[no_mangle]
pub extern "C" fn rito_turn_motion_step(
    motion: u64,
    seconds: f64,
    host_at: *const f64,
    instant: u32,
    step_out: *mut u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let host = if host_at.is_null() {
            None
        } else {
            Some(read_turn_at(&read_numbers::<TURN_AT_NUMBERS>(
                host_at, "host_at",
            )?))
        };
        let step = with(motion, |held| held.step(seconds, host, instant != 0))?;
        write_u32(step_out, turn_step_code(step), "step_out")
    })
}

#[no_mangle]
pub extern "C" fn rito_turn_motion_finish(motion: u64, error_out: *mut RitoOwnedBuffer) -> u32 {
    invoke(error_out, || with(motion, TurnMotion::finish))
}

#[no_mangle]
pub extern "C" fn rito_turn_motion_reset(motion: u64, error_out: *mut RitoOwnedBuffer) -> u32 {
    invoke(error_out, || with(motion, TurnMotion::reset))
}

/// Writes the motion's state (`rito_turn::turn_pack::write_turn_state`).
#[no_mangle]
pub extern "C" fn rito_turn_motion_state(
    motion: u64,
    state_out: *mut f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let mut numbers = [0.0; TURN_STATE_NUMBERS];
        with(motion, |held| write_turn_state(held, &mut numbers))?;
        write_numbers(state_out, &numbers, "state_out")
    })
}
