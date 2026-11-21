//! The page turns of a reader through the C ABI decide as the engine's
//! controller decides, and the header's layouts are the engine's.

use std::{fs, path::Path, ptr};

use rito_turn::turn_controller::{Direction, Point, Sides, TurnController, TurnPages};
use rito_turn::turn_controller_pack::{
    write_controller_state, TURN_ACTION_NUMBERS, TURN_CONTROLLER_STATE_NUMBERS, TURN_PAGES_NUMBERS,
};
use rito_turn::turn_pack::{write_turn_physics, TURN_PHYSICS_NUMBERS};
use rito_turn::turn_physics::TurnPhysics;

use crate::{
    rito_turn_controller_command, rito_turn_controller_configure, rito_turn_controller_finger_down,
    rito_turn_controller_finger_move, rito_turn_controller_free, rito_turn_controller_landed,
    rito_turn_controller_layouts, rito_turn_controller_new, rito_turn_controller_state,
    rito_turn_controller_step, rito_turn_controller_take_action, RitoOwnedBuffer, RITO_STATUS_OK,
};

fn ok(status: u32) {
    assert_eq!(status, RITO_STATUS_OK);
}

const PAGES: [f64; TURN_PAGES_NUMBERS] = [1.0; TURN_PAGES_NUMBERS];

fn ready() -> TurnPages {
    let both = Sides {
        next: true,
        previous: true,
    };
    TurnPages {
        can_turn: both,
        there: both,
        drawable: both,
        beyond: both,
    }
}

fn state(controller: u64) -> [u64; TURN_CONTROLLER_STATE_NUMBERS] {
    let mut numbers = [0.0; TURN_CONTROLLER_STATE_NUMBERS];
    let mut error = RitoOwnedBuffer::EMPTY;
    ok(rito_turn_controller_state(
        controller,
        numbers.as_mut_ptr(),
        &mut error,
    ));
    numbers.map(f64::to_bits)
}

fn model_state(model: &TurnController) -> [u64; TURN_CONTROLLER_STATE_NUMBERS] {
    let mut numbers = [0.0; TURN_CONTROLLER_STATE_NUMBERS];
    write_controller_state(model, &mut numbers);
    numbers.map(f64::to_bits)
}

#[test]
fn the_header_lays_the_numbers_out_as_the_engine_does() {
    let header =
        fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("include/rito_ffi.h"))
            .expect("the public header is readable");
    let mut layouts = [0u32; 3];
    let mut error = RitoOwnedBuffer::EMPTY;
    ok(rito_turn_controller_layouts(
        layouts.as_mut_ptr(),
        &mut error,
    ));
    for (name, numbers) in ["PAGES", "ACTION", "STATE"].iter().zip(layouts) {
        let define = format!("#define RITO_TURN_CONTROLLER_{name}_NUMBERS UINT32_C({numbers})");
        assert!(header.contains(&define), "rito_ffi.h does not say {define}");
    }
}

#[test]
fn a_key_turn_and_a_finger_decide_through_the_abi_as_the_engine_decides() {
    let physics = TurnPhysics::default();
    let mut numbers = [0.0; TURN_PHYSICS_NUMBERS];
    write_turn_physics(&physics, &mut numbers);
    let mut error = RitoOwnedBuffer::EMPTY;
    let mut controller = 0;
    ok(rito_turn_controller_new(
        numbers.as_ptr(),
        &mut controller,
        &mut error,
    ));
    ok(rito_turn_controller_configure(
        controller,
        numbers.as_ptr(),
        400.0,
        0,
        &mut error,
    ));
    let mut model = TurnController::new(physics);
    model.configure(physics, 400.0);

    let mut taken = 0;
    ok(rito_turn_controller_command(
        controller,
        PAGES.as_ptr(),
        0,
        &mut taken,
        &mut error,
    ));
    assert_eq!(taken != 0, model.command(ready(), Direction::Next));
    // Started, then land: kinds 1 and 3, next.
    let mut action = [0.0; TURN_ACTION_NUMBERS];
    ok(rito_turn_controller_take_action(
        controller,
        action.as_mut_ptr(),
        &mut error,
    ));
    assert_eq!(action, [1.0, 0.0, 0.0, 0.0, 0.0]);
    ok(rito_turn_controller_take_action(
        controller,
        action.as_mut_ptr(),
        &mut error,
    ));
    assert_eq!(action, [3.0, 0.0, 0.0, 0.0, 0.0]);
    while model.take_action().is_some() {}
    ok(rito_turn_controller_landed(
        controller,
        PAGES.as_ptr(),
        1,
        &mut error,
    ));
    model.landed(ready(), true);
    for _ in 0..5 {
        ok(rito_turn_controller_step(
            controller,
            PAGES.as_ptr(),
            1.0 / 60.0,
            ptr::null(),
            &mut error,
        ));
        model.step(ready(), 1.0 / 60.0, None);
        assert_eq!(state(controller), model_state(&model));
    }
    ok(rito_turn_controller_finger_down(
        controller,
        PAGES.as_ptr(),
        300.0,
        200.0,
        1000.0,
        &mut error,
    ));
    model.finger_down(ready(), Point { x: 300.0, y: 200.0 }, 1000.0);
    ok(rito_turn_controller_finger_move(
        controller,
        PAGES.as_ptr(),
        250.0,
        200.0,
        -50.0,
        f64::NAN,
        1016.0,
        &mut error,
    ));
    model.finger_move(ready(), Point { x: 250.0, y: 200.0 }, -50.0, None, 1016.0);
    assert_eq!(state(controller), model_state(&model));
    ok(rito_turn_controller_free(controller, &mut error));
}
