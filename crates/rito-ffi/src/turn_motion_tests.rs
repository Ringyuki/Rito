//! A page turn's motion through the C ABI moves as the engine's motion
//! moves, bit for bit, and the header's layouts are the engine's.

use std::{fs, path::Path, ptr};

use rito_turn::spring::At;
use rito_turn::turn_motion::{Begin, TurnMotion};
use rito_turn::turn_pack::{
    turn_step_code, write_turn_physics, write_turn_state, TURN_PHYSICS_NUMBERS, TURN_STATE_NUMBERS,
};
use rito_turn::turn_physics::TurnPhysics;

use crate::{
    rito_turn_motion_carry_on, rito_turn_motion_configure, rito_turn_motion_drag,
    rito_turn_motion_free, rito_turn_motion_layouts, rito_turn_motion_new,
    rito_turn_motion_release, rito_turn_motion_start_drag, rito_turn_motion_state,
    rito_turn_motion_step, rito_turn_motion_turn, RitoOwnedBuffer, RITO_STATUS_NOT_FOUND,
    RITO_STATUS_OK,
};

fn ok(status: u32) {
    assert_eq!(status, RITO_STATUS_OK);
}

fn physics_numbers(physics: &TurnPhysics) -> [f64; TURN_PHYSICS_NUMBERS] {
    let mut numbers = [0.0; TURN_PHYSICS_NUMBERS];
    write_turn_physics(physics, &mut numbers);
    numbers
}

fn state_through_abi(motion: u64) -> [f64; TURN_STATE_NUMBERS] {
    let mut numbers = [0.0; TURN_STATE_NUMBERS];
    let mut error = RitoOwnedBuffer::EMPTY;
    ok(rito_turn_motion_state(
        motion,
        numbers.as_mut_ptr(),
        &mut error,
    ));
    numbers
}

fn state_of(motion: &TurnMotion) -> [f64; TURN_STATE_NUMBERS] {
    let mut numbers = [0.0; TURN_STATE_NUMBERS];
    write_turn_state(motion, &mut numbers);
    numbers
}

fn same_bits(abi: [f64; TURN_STATE_NUMBERS], model: [f64; TURN_STATE_NUMBERS]) {
    let bits = |numbers: [f64; TURN_STATE_NUMBERS]| numbers.map(f64::to_bits);
    assert_eq!(bits(abi), bits(model), "{abi:?} != {model:?}");
}

#[test]
fn the_header_lays_the_numbers_out_as_the_engine_does() {
    let header =
        fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("include/rito_ffi.h"))
            .expect("the public header is readable");
    let mut layouts = [0u32; 3];
    let mut error = RitoOwnedBuffer::EMPTY;
    ok(rito_turn_motion_layouts(layouts.as_mut_ptr(), &mut error));
    for (name, numbers) in ["PHYSICS", "STATE", "AT"].iter().zip(layouts) {
        let define = format!("#define RITO_TURN_MOTION_{name}_NUMBERS UINT32_C({numbers})");
        assert!(header.contains(&define), "rito_ffi.h does not say {define}");
    }
}

#[test]
fn a_finger_turn_and_a_cut_moves_through_the_abi_as_the_engine_moves_it() {
    let physics = TurnPhysics::default();
    let numbers = physics_numbers(&physics);
    let mut error = RitoOwnedBuffer::EMPTY;
    let mut motion = 0;
    ok(rito_turn_motion_new(
        numbers.as_ptr(),
        &mut motion,
        &mut error,
    ));
    ok(rito_turn_motion_configure(
        motion,
        numbers.as_ptr(),
        390.0,
        0,
        &mut error,
    ));
    let mut model = TurnMotion::new(physics);
    model.set_width(390.0);

    ok(rito_turn_motion_start_drag(
        motion,
        1,
        1,
        0.0,
        ptr::null(),
        &mut error,
    ));
    model.start_drag(true, true, 0.0, None);
    for step in 1..=6 {
        let at = f64::from(step) * 8.0;
        ok(rito_turn_motion_drag(motion, -at * 1.7, at, 0, &mut error));
        model.drag(-at * 1.7, at);
        same_bits(state_through_abi(motion), state_of(&model));
    }
    let mut lands = 0;
    ok(rito_turn_motion_release(motion, -1, &mut lands, &mut error));
    assert_eq!(lands != 0, model.release(None));
    for _ in 0..9 {
        let mut step = 0;
        ok(rito_turn_motion_step(
            motion,
            1.0 / 60.0,
            ptr::null(),
            0,
            &mut step,
            &mut error,
        ));
        assert_eq!(step, turn_step_code(model.step(1.0 / 60.0, None, false)));
        same_bits(state_through_abi(motion), state_of(&model));
    }
    ok(rito_turn_motion_carry_on(motion, 1, &mut error));
    model.carry_on(true);
    let begin = [12.5, -300.0];
    ok(rito_turn_motion_turn(motion, 1, begin.as_ptr(), &mut error));
    model.turn(
        true,
        Some(Begin {
            offset: 12.5,
            velocity: -300.0,
        }),
    );
    same_bits(state_through_abi(motion), state_of(&model));
    ok(rito_turn_motion_free(motion, &mut error));
}

#[test]
fn a_motion_the_host_carries_is_read_from_the_host() {
    let physics = TurnPhysics::default();
    let numbers = physics_numbers(&physics);
    let mut error = RitoOwnedBuffer::EMPTY;
    let mut motion = 0;
    ok(rito_turn_motion_new(
        numbers.as_ptr(),
        &mut motion,
        &mut error,
    ));
    ok(rito_turn_motion_configure(
        motion,
        numbers.as_ptr(),
        400.0,
        1,
        &mut error,
    ));
    ok(rito_turn_motion_turn(motion, 0, ptr::null(), &mut error));
    let state = state_through_abi(motion);
    // The motion to carry on: generation, from, velocity, to.
    assert_eq!(&state[14..18], &[1.0, 0.0, 0.0, 400.0]);
    let at = [100.0, 400.0, 0.0];
    let mut step = 0;
    ok(rito_turn_motion_step(
        motion,
        0.25,
        at.as_ptr(),
        0,
        &mut step,
        &mut error,
    ));
    assert_eq!(step, 1);
    assert_eq!(state_through_abi(motion)[3], 100.0);
    let done = [400.0, 0.0, 1.0];
    ok(rito_turn_motion_step(
        motion,
        0.75,
        done.as_ptr(),
        0,
        &mut step,
        &mut error,
    ));
    assert_eq!(step, 2);
    let mut model = TurnMotion::new(physics);
    model.set_width(400.0);
    model.set_host_settles(true);
    model.turn(false, None);
    model.step(
        0.25,
        Some(At {
            x: 100.0,
            velocity: 400.0,
            done: false,
        }),
        false,
    );
    model.step(
        0.75,
        Some(At {
            x: 400.0,
            velocity: 0.0,
            done: true,
        }),
        false,
    );
    same_bits(state_through_abi(motion), state_of(&model));
    ok(rito_turn_motion_free(motion, &mut error));
    let mut state = [0.0; TURN_STATE_NUMBERS];
    assert_eq!(
        rito_turn_motion_state(motion, state.as_mut_ptr(), &mut error),
        RITO_STATUS_NOT_FOUND
    );
    crate::rito_buffer_free(&mut error);
}
