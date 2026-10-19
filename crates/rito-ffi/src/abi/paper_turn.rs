//! The paper page turn's model (`rito-turn`) through the C ABI. A host
//! calls it on its UI thread, frame by frame, not through a session's
//! actor; it holds a model by a handle. Numbers cross in the layouts
//! `rito_turn::pack` fixes for every host, and a sheet's points are copied
//! into the host's own arrays.

// `#[no_mangle]` exports only; raw memory is read and written in `memory`.
#![allow(unsafe_code)]

use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard, OnceLock},
};

use rito_turn::frame::Touch;
use rito_turn::hold::Point;
use rito_turn::pack::{
    read_release, write_sheet, FrameInput, FRAME_NUMBERS, RELEASE_NUMBERS, SHEET_NUMBERS,
};
use rito_turn::physics::{lands, travel, PaperSettle, SETTLE_NUMBERS};
use rito_turn::{eye_height, Begun, Forgotten, LeafId, PaperModel};

use super::memory::{
    invoke, read_numbers, write_floats, write_ids, write_numbers, write_u32, write_u64,
};
use super::RitoOwnedBuffer;
use crate::error::FfiError;

/// What `rito_paper_turn_begin` writes: whether a leaf turns (1) or the page
/// shown is drawn where the turn has it (0), the spread of the leaf turned,
/// whether what was remembered was of another moment (1/0), and whether
/// the forgotten leaves' pages are the host's to let go (1/0).
pub const RITO_PAPER_TURN_BEGUN_NUMBERS: usize = 4;
/// What `rito_paper_turn_lay` writes: whether a frame was laid out (1/0),
/// the led leaf, the grid's columns and rows, how many sheets, and the led
/// leaf's front and after pages (present, spread, buffer each).
pub const RITO_PAPER_TURN_LAID_NUMBERS: usize = 11;
/// What `rito_paper_turn_state` writes: frames painted, whether the page is
/// there, whether it is gone, and whether a leaf is still aloft (1/0 each).
pub const RITO_PAPER_TURN_STATE_NUMBERS: usize = 4;
/// The numbers of the layouts the paper turn's calls take, in the order
/// `rito_paper_turn_layouts` writes them.
const LAYOUTS: [u32; 7] = [
    FRAME_NUMBERS as u32,
    SHEET_NUMBERS as u32,
    RELEASE_NUMBERS as u32,
    SETTLE_NUMBERS as u32,
    RITO_PAPER_TURN_BEGUN_NUMBERS as u32,
    RITO_PAPER_TURN_LAID_NUMBERS as u32,
    RITO_PAPER_TURN_STATE_NUMBERS as u32,
];

#[derive(Default)]
struct Turns {
    models: HashMap<u64, PaperModel>,
    created: u64,
}

static TURNS: OnceLock<Mutex<Turns>> = OnceLock::new();

fn turns() -> MutexGuard<'static, Turns> {
    TURNS
        .get_or_init(|| Mutex::new(Turns::default()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn with<T>(turn: u64, then: impl FnOnce(&mut PaperModel) -> T) -> Result<T, FfiError> {
    let mut turns = turns();
    let model = turns
        .models
        .get_mut(&turn)
        .ok_or_else(|| FfiError::not_found(format!("paper turn not found: {turn}")))?;
    Ok(then(model))
}

fn ids(leaves: &[LeafId]) -> Vec<u32> {
    leaves.iter().map(|leaf| leaf.0).collect()
}

fn flag(value: bool) -> f64 {
    if value {
        1.0
    } else {
        0.0
    }
}

fn page(numbers: &mut [f64], page: Option<rito_turn::frame::PageRef>) {
    if let Some(page) = page {
        numbers.copy_from_slice(&[1.0, page.spread as f64, page.buffer as f64]);
    }
}

#[no_mangle]
pub extern "C" fn rito_paper_turn_layouts(
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
pub extern "C" fn rito_paper_turn_new(turn_out: *mut u64, error_out: *mut RitoOwnedBuffer) -> u32 {
    invoke(error_out, || {
        let mut turns = turns();
        turns.created += 1;
        let turn = turns.created;
        turns.models.insert(turn, PaperModel::new());
        write_u64(turn_out, turn, "turn_out")
    })
}

#[no_mangle]
pub extern "C" fn rito_paper_turn_free(turn: u64, error_out: *mut RitoOwnedBuffer) -> u32 {
    invoke(error_out, || {
        turns().models.remove(&turn);
        Ok(())
    })
}

#[no_mangle]
pub extern "C" fn rito_paper_turn_begin(
    turn: u64,
    frame: *const f64,
    begun_out: *mut f64,
    leaves_out: *mut u32,
    leaves_capacity: u32,
    leaf_count_out: *mut u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let input = FrameInput::read(&read_numbers::<FRAME_NUMBERS>(frame, "frame")?);
        let begun = with(turn, |model| {
            model.begin(
                input.scene,
                input.frame,
                input.current,
                input.incoming,
                input.now,
                input.epoch,
            )
        })?;
        let (turns, spread, anew, forgotten) = match begun {
            Begun::Shown { forgotten, .. } => (false, 0, false, forgotten),
            Begun::Turn {
                spread,
                forgotten,
                anew,
            } => (true, spread, anew, forgotten),
        };
        write_numbers(
            begun_out,
            &[
                flag(turns),
                spread as f64,
                flag(anew),
                flag(forgotten.release),
            ],
            "begun_out",
        )?;
        let leaves = ids(&forgotten.leaves);
        write_ids(
            leaves_out,
            leaves_capacity,
            leaf_count_out,
            &leaves,
            "leaves_out",
        )
    })
}

#[no_mangle]
pub extern "C" fn rito_paper_turn_lay(
    turn: u64,
    epoch: u64,
    laid_out: *mut f64,
    leaves_out: *mut u32,
    leaves_capacity: u32,
    leaf_count_out: *mut u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let laid = with(turn, |model| {
            let laid = model.lay(epoch)?;
            Some((laid, model.sheets().len()))
        })?;
        let mut numbers = [0.0; RITO_PAPER_TURN_LAID_NUMBERS];
        let mut leaves = Vec::new();
        if let Some((laid, sheets)) = laid {
            numbers[..5].copy_from_slice(&[
                1.0,
                f64::from(laid.led.0),
                laid.columns as f64,
                laid.rows as f64,
                sheets as f64,
            ]);
            page(&mut numbers[5..8], laid.front);
            page(&mut numbers[8..11], laid.after);
            leaves = ids(&laid.left_book);
        }
        write_numbers(laid_out, &numbers, "laid_out")?;
        write_ids(
            leaves_out,
            leaves_capacity,
            leaf_count_out,
            &leaves,
            "leaves_out",
        )
    })
}

/// Writes sheet `index` of the frame last laid out, and its points where
/// the host passes arrays for them (both null to leave them, as for a
/// sheet lying still whose points the host has).
#[no_mangle]
pub extern "C" fn rito_paper_turn_sheet(
    turn: u64,
    index: u32,
    sheet_out: *mut f64,
    positions_out: *mut f32,
    normals_out: *mut f32,
    points_capacity: u64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        with(turn, |model| {
            let sheets = model.sheets();
            let sheet = sheets
                .get(index as usize)
                .ok_or_else(|| FfiError::not_found(format!("no sheet {index} in the frame")))?;
            let mut numbers = [0.0; SHEET_NUMBERS];
            write_sheet(sheet, &mut numbers);
            write_numbers(sheet_out, &numbers, "sheet_out")?;
            if positions_out.is_null() && normals_out.is_null() {
                return Ok(());
            }
            write_floats(
                positions_out,
                points_capacity,
                sheet.positions,
                "positions_out",
            )?;
            write_floats(normals_out, points_capacity, sheet.normals, "normals_out")
        })?
    })
}

#[no_mangle]
pub extern "C" fn rito_paper_turn_forget(
    turn: u64,
    epoch: u64,
    release_out: *mut u32,
    leaves_out: *mut u32,
    leaves_capacity: u32,
    leaf_count_out: *mut u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let Forgotten { leaves, release } = with(turn, |model| model.forget(epoch))?;
        write_u32(release_out, u32::from(release), "release_out")?;
        write_ids(
            leaves_out,
            leaves_capacity,
            leaf_count_out,
            &ids(&leaves),
            "leaves_out",
        )
    })
}

/// Writes what the turn tells of its page at `now` (ms).
#[no_mangle]
pub extern "C" fn rito_paper_turn_state(
    turn: u64,
    now: f64,
    state_out: *mut f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let state = with(turn, |model| {
            [
                model.painted() as f64,
                flag(model.there()),
                flag(model.gone()),
                flag(model.aloft(now)),
            ]
        })?;
        write_numbers(state_out, &state, "state_out")
    })
}

#[no_mangle]
pub extern "C" fn rito_paper_turn_begins(
    turn: u64,
    dx: f64,
    velocity: f64,
    same_spreads: u32,
    begins_out: *mut f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let (dx, velocity) = with(turn, |model| model.begins(dx, velocity, same_spreads != 0))?;
        write_numbers(begins_out, &[dx, velocity], "begins_out")
    })
}

/// Writes how a turn nothing holds comes to rest: the numbers the host holds and steps.
#[no_mangle]
pub extern "C" fn rito_paper_turn_settle(
    turn: u64,
    from: f64,
    velocity: f64,
    to: f64,
    settle_out: *mut f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let mut numbers = [0.0; SETTLE_NUMBERS];
        with(turn, |model| model.settle(from, velocity, to))?.write(&mut numbers);
        write_numbers(settle_out, &numbers, "settle_out")
    })
}

/// Steps the settle the host holds in `settle` to `seconds` after it began,
/// at `now` (ms), once a frame; writes x, velocity and done (1/0).
#[no_mangle]
pub extern "C" fn rito_paper_turn_settle_step(
    turn: u64,
    settle: *mut f64,
    seconds: f64,
    now: f64,
    at_out: *mut f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let mut held = PaperSettle::read(&read_numbers::<SETTLE_NUMBERS>(settle, "settle")?);
        let at = with(turn, |model| model.settle_step(&mut held, seconds, now))?;
        let mut numbers = [0.0; SETTLE_NUMBERS];
        held.write(&mut numbers);
        write_numbers(settle, &numbers, "settle")?;
        write_numbers(at_out, &[at.x, at.velocity, flag(at.done)], "at_out")
    })
}

/// How far a finger has carried a turn: `touch` is origin x, y and position x, y.
#[no_mangle]
pub extern "C" fn rito_paper_turn_travel(
    touch: *const f64,
    width: f64,
    spine: f64,
    travel_out: *mut f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let [origin_x, origin_y, x, y] = read_numbers::<4>(touch, "touch")?;
        let touch = Touch {
            origin: Point {
                x: origin_x,
                y: origin_y,
            },
            position: Point { x, y },
            farthest: None,
        };
        write_numbers(travel_out, &[travel(&touch, width, spine)], "travel_out")
    })
}

#[no_mangle]
pub extern "C" fn rito_paper_turn_lands(
    release: *const f64,
    lands_out: *mut u32,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        let release = read_release(&read_numbers::<RELEASE_NUMBERS>(release, "release")?);
        write_u32(lands_out, u32::from(lands(&release)), "lands_out")
    })
}

#[no_mangle]
pub extern "C" fn rito_paper_turn_eye_height(
    width: f64,
    height: f64,
    eye_out: *mut f64,
    error_out: *mut RitoOwnedBuffer,
) -> u32 {
    invoke(error_out, || {
        write_numbers(eye_out, &[eye_height(width, height)], "eye_out")
    })
}
