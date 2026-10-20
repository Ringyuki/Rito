//! The paper turn through the C ABI answers what the model answers, bit for
//! bit, and the header's layouts are the model's.

use std::{fs, path::Path, ptr};

use rito_turn::frame::{Frame, Incoming, PageRef, Phase, Scene, Touch};
use rito_turn::hold::Point;
use rito_turn::pack::{write_sheet, FrameInput, FRAME_NUMBERS, SHEET_NUMBERS};
use rito_turn::physics::SETTLE_NUMBERS;
use rito_turn::{Begun, PaperModel};

use crate::{
    rito_paper_turn_begin, rito_paper_turn_free, rito_paper_turn_lay, rito_paper_turn_layouts,
    rito_paper_turn_new, rito_paper_turn_settle, rito_paper_turn_settle_step,
    rito_paper_turn_sheet, RitoOwnedBuffer, RITO_PAPER_TURN_BEGUN_NUMBERS,
    RITO_PAPER_TURN_LAID_NUMBERS, RITO_STATUS_OK,
};

fn ok(status: u32) {
    assert_eq!(status, RITO_STATUS_OK);
}

#[test]
fn the_header_lays_the_numbers_out_as_the_model_does() {
    let header =
        fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("include/rito_ffi.h"))
            .expect("the public header is readable");
    let mut layouts = [0u32; 7];
    let mut error = RitoOwnedBuffer::EMPTY;
    ok(rito_paper_turn_layouts(layouts.as_mut_ptr(), &mut error));
    let names = [
        "FRAME", "SHEET", "RELEASE", "SETTLE", "BEGUN", "LAID", "STATE",
    ];
    for (name, numbers) in names.iter().zip(layouts) {
        let define = format!("#define RITO_PAPER_TURN_{name}_NUMBERS UINT32_C({numbers})");
        assert!(header.contains(&define), "rito_ffi.h does not say {define}");
    }
}

/// A two-page frame turned by a key and a one-page page curled by a finger.
fn frames() -> Vec<FrameInput> {
    let mut frames = Vec::new();
    for step in 0..30u32 {
        let t = f64::from(step) / 29.0;
        frames.push(FrameInput {
            scene: Scene {
                width: 1200.0,
                height: 900.0,
                spine: 600.0,
                css_pixel: 1.0,
            },
            frame: Frame {
                dx: -1200.0 * t * t * (3.0 - 2.0 * t),
                incoming: Some(Incoming::Next),
                phase: Phase::Landing,
                touch: None,
            },
            current: Some(PageRef {
                spread: 4,
                buffer: 1,
            }),
            incoming: Some(PageRef {
                spread: 5,
                buffer: 2,
            }),
            now: f64::from(step) * 16.0,
            epoch: 1,
        });
    }
    for step in 0..30u32 {
        let x = 388.0 - 6.0 * f64::from(step);
        frames.push(FrameInput {
            scene: Scene {
                width: 400.0,
                height: 600.0,
                spine: 0.0,
                css_pixel: 1.0,
            },
            frame: Frame {
                dx: (x - 388.0) / 2.0,
                incoming: Some(Incoming::Next),
                phase: Phase::Held,
                touch: Some(Touch {
                    origin: Point { x: 388.0, y: 60.0 },
                    position: Point { x, y: 80.0 },
                    farthest: None,
                }),
            },
            current: Some(PageRef {
                spread: 7,
                buffer: 3,
            }),
            incoming: Some(PageRef {
                spread: 8,
                buffer: 4,
            }),
            now: 1000.0 + f64::from(step) * 16.0,
            epoch: 1,
        });
    }
    frames
}

#[test]
fn a_turn_through_the_abi_is_the_model_s_turn_bit_for_bit() {
    let mut error = RitoOwnedBuffer::EMPTY;
    let mut turn = 0u64;
    ok(rito_paper_turn_new(&mut turn, &mut error));
    let mut model = PaperModel::new();
    for input in frames() {
        let mut numbers = [0.0; FRAME_NUMBERS];
        input.write(&mut numbers);
        let mut begun = [0.0; RITO_PAPER_TURN_BEGUN_NUMBERS];
        let mut leaves = [0u32; 8];
        let mut count = 0u32;
        ok(rito_paper_turn_begin(
            turn,
            numbers.as_ptr(),
            begun.as_mut_ptr(),
            leaves.as_mut_ptr(),
            8,
            &mut count,
            &mut error,
        ));
        let ours = model.begin(
            input.scene,
            input.frame,
            input.current,
            input.incoming,
            input.now,
            input.epoch,
        );
        let Begun::Turn { spread, .. } = ours else {
            assert_eq!(begun[0], 0.0);
            continue;
        };
        assert_eq!(begun[..2], [1.0, spread as f64]);

        let mut laid = [0.0; RITO_PAPER_TURN_LAID_NUMBERS];
        ok(rito_paper_turn_lay(
            turn,
            1,
            laid.as_mut_ptr(),
            leaves.as_mut_ptr(),
            8,
            &mut count,
            &mut error,
        ));
        let direct = model.lay(1).expect("a frame waits");
        assert_eq!(
            laid[1..4],
            [
                f64::from(direct.led.0),
                direct.columns as f64,
                direct.rows as f64
            ]
        );
        let sheets = model.sheets();
        assert_eq!(laid[4], sheets.len() as f64);
        let length = direct.columns * direct.rows * 3;
        for (index, sheet) in sheets.iter().enumerate() {
            let mut described = [0.0; SHEET_NUMBERS];
            let mut positions = vec![0.0f32; length];
            let mut normals = vec![0.0f32; length];
            ok(rito_paper_turn_sheet(
                turn,
                index as u32,
                described.as_mut_ptr(),
                positions.as_mut_ptr(),
                normals.as_mut_ptr(),
                length as u64,
                &mut error,
            ));
            let mut expected = [0.0; SHEET_NUMBERS];
            write_sheet(sheet, &mut expected);
            assert_eq!(described.map(f64::to_bits), expected.map(f64::to_bits));
            assert!(positions
                .iter()
                .zip(sheet.positions)
                .all(|(a, b)| a.to_bits() == b.to_bits()));
            assert!(normals
                .iter()
                .zip(sheet.normals)
                .all(|(a, b)| a.to_bits() == b.to_bits()));
            // Without arrays only the description is written.
            ok(rito_paper_turn_sheet(
                turn,
                index as u32,
                described.as_mut_ptr(),
                ptr::null_mut(),
                ptr::null_mut(),
                0,
                &mut error,
            ));
        }
    }

    let mut settle = [0.0; SETTLE_NUMBERS];
    ok(rito_paper_turn_settle(
        turn,
        -100.0,
        -900.0,
        -400.0,
        settle.as_mut_ptr(),
        &mut error,
    ));
    let mut direct = model.settle(-100.0, -900.0, -400.0);
    for step in 0..40u32 {
        let seconds = f64::from(step) / 60.0;
        let mut at = [0.0; 3];
        ok(rito_paper_turn_settle_step(
            turn,
            settle.as_mut_ptr(),
            seconds,
            2000.0,
            at.as_mut_ptr(),
            &mut error,
        ));
        let expected = model.settle_step(&mut direct, seconds, 2000.0);
        assert_eq!(at[0].to_bits(), expected.x.to_bits());
        assert_eq!(at[2], if expected.done { 1.0 } else { 0.0 });
    }
    ok(rito_paper_turn_free(turn, &mut error));
    // Gone with it: nothing more is asked of it.
    assert_ne!(
        rito_paper_turn_lay(
            turn,
            1,
            [0.0; 11].as_mut_ptr(),
            ptr::null_mut(),
            0,
            &mut 0,
            &mut error
        ),
        RITO_STATUS_OK
    );
    crate::rito_buffer_free(&mut error);
}
