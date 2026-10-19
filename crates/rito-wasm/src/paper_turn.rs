//! The page turn's model as the web draws it: a frame's numbers in, each
//! sheet's numbers and points out, in the layouts `rito_turn::pack` gives
//! every host. A host keeps the pages the sheets show; the model names them.

use js_sys::Float32Array;
use rito_turn::frame::Touch;
use rito_turn::hold::Point;
use rito_turn::pack::{read_release, write_sheet, FrameInput, SHEET_NUMBERS};
use rito_turn::physics::{lands, travel, PaperSettle, SETTLE_NUMBERS};
use rito_turn::{eye_height, Begun, Forgotten, Laid, PaperModel};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = RitoPaperTurn)]
pub struct RitoPaperTurn {
    model: PaperModel,
    spread: f64,
    anew: bool,
    forgotten: Forgotten,
    laid: Option<Laid>,
}

impl Default for RitoPaperTurn {
    fn default() -> Self {
        Self::new()
    }
}

fn page_numbers(page: Option<rito_turn::frame::PageRef>, out: &mut [f64]) {
    match page {
        Some(page) => out.copy_from_slice(&[1.0, page.spread as f64, page.buffer as f64]),
        None => out.fill(0.0),
    }
}

#[wasm_bindgen(js_class = RitoPaperTurn)]
impl RitoPaperTurn {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            model: PaperModel::new(),
            spread: 0.0,
            anew: false,
            forgotten: Forgotten::default(),
            laid: None,
        }
    }

    /// Reads a frame (`rito_turn::pack::FrameInput`). Answers 0 when no leaf
    /// turns, the page shown being drawn where the turn has it, and 1 for a
    /// leaf's turn; `spread`, `anew` and the leaves forgotten tell the rest.
    pub fn begin(&mut self, input: &[f64]) -> u8 {
        let input = FrameInput::read(input);
        self.laid = None;
        match self.model.begin(
            input.scene,
            input.frame,
            input.current,
            input.incoming,
            input.now,
            input.epoch,
        ) {
            Begun::Shown { forgotten, .. } => {
                self.forgotten = forgotten;
                self.anew = false;
                0
            }
            Begun::Turn {
                spread,
                forgotten,
                anew,
            } => {
                self.spread = spread as f64;
                self.forgotten = forgotten;
                self.anew = anew;
                1
            }
        }
    }

    /// The spread printed on the front of the leaf the frame turns.
    #[wasm_bindgen(getter)]
    pub fn spread(&self) -> f64 {
        self.spread
    }

    /// Whether what was remembered was of another moment, and is forgotten.
    #[wasm_bindgen(getter)]
    pub fn anew(&self) -> bool {
        self.anew
    }

    /// The leaves the last `begin` or `forget` forgot.
    #[wasm_bindgen(js_name = forgottenLeaves)]
    pub fn forgotten_leaves(&self) -> Vec<u32> {
        self.forgotten.leaves.iter().map(|leaf| leaf.0).collect()
    }

    /// Whether their pages are let go: not when they were taken in a GPU context since lost.
    #[wasm_bindgen(js_name = forgottenRelease)]
    pub fn forgotten_release(&self) -> bool {
        self.forgotten.release
    }

    /// Moves the leaves of the frame `begin` read on and lays them out. False when no frame waits.
    pub fn lay(&mut self, epoch: f64) -> bool {
        self.laid = self.model.lay(epoch as u64);
        self.laid.is_some()
    }

    /// The leaf the frame laid out is of.
    #[wasm_bindgen(getter)]
    pub fn led(&self) -> u32 {
        self.laid.as_ref().map_or(0, |laid| laid.led.0)
    }

    /// The pages the led leaf shows this frame: front then after, each present, spread, buffer.
    #[wasm_bindgen(js_name = ledPages)]
    pub fn led_pages(&self, out: &mut [f64]) {
        let laid = self.laid.as_ref();
        page_numbers(laid.and_then(|laid| laid.front), &mut out[..3]);
        page_numbers(laid.and_then(|laid| laid.after), &mut out[3..6]);
    }

    /// The leaves that left the book this frame: their pages are let go.
    #[wasm_bindgen(js_name = leftBook)]
    pub fn left_book(&self) -> Vec<u32> {
        self.laid.as_ref().map_or_else(Vec::new, |laid| {
            laid.left_book.iter().map(|leaf| leaf.0).collect()
        })
    }

    #[wasm_bindgen(getter)]
    pub fn columns(&self) -> u32 {
        self.laid.as_ref().map_or(0, |laid| laid.columns as u32)
    }

    #[wasm_bindgen(getter)]
    pub fn rows(&self) -> u32 {
        self.laid.as_ref().map_or(0, |laid| laid.rows as u32)
    }

    /// How many sheets the frame laid out has.
    #[wasm_bindgen(js_name = sheetCount)]
    pub fn sheet_count(&self) -> u32 {
        self.model.sheets().len() as u32
    }

    /// A sheet's description (`rito_turn::pack::write_sheet`).
    pub fn sheet(&self, index: u32, out: &mut [f64]) {
        if let Some(sheet) = self.model.sheets().get(index as usize) {
            write_sheet(sheet, &mut out[..SHEET_NUMBERS]);
        }
    }

    /// A sheet's points, x, y, z, row by row from the spine outward, and
    /// the direction it faces at each, copied straight into the host's arrays.
    pub fn points(&self, index: u32, positions: &Float32Array, normals: &Float32Array) {
        if let Some(sheet) = self.model.sheets().get(index as usize) {
            positions
                .subarray(0, sheet.positions.len() as u32)
                .copy_from(sheet.positions);
            normals
                .subarray(0, sheet.normals.len() as u32)
                .copy_from(sheet.normals);
        }
    }

    /// Nothing is in the air any more; the leaves forgotten tell whose pages to let go.
    pub fn forget(&mut self, epoch: f64) {
        self.forgotten = self.model.forget(epoch as u64);
        self.laid = None;
    }

    /// How many frames have been painted.
    #[wasm_bindgen(getter)]
    pub fn painted(&self) -> f64 {
        self.model.painted() as f64
    }

    /// Whether the page the turn is of is where its turn takes it.
    #[wasm_bindgen(getter)]
    pub fn there(&self) -> bool {
        self.model.there()
    }

    /// Whether the page the turn is of has left the frame for good.
    #[wasm_bindgen(getter)]
    pub fn gone(&self) -> bool {
        self.model.gone()
    }

    /// Whether a leaf left to come down still counts at `now` (ms).
    pub fn aloft(&self, now: f64) -> bool {
        self.model.aloft(now)
    }

    /// Where a turn that cuts into another begins, and how fast: into `out`.
    pub fn begins(&self, dx: f64, velocity: f64, same_spreads: bool, out: &mut [f64]) {
        let (dx, velocity) = self.model.begins(dx, velocity, same_spreads);
        out[0] = dx;
        out[1] = velocity;
    }

    /// How a turn nothing holds comes to rest, as the numbers the host holds.
    pub fn settle(&self, from: f64, velocity: f64, to: f64, out: &mut [f64]) {
        self.model
            .settle(from, velocity, to)
            .write(&mut out[..SETTLE_NUMBERS]);
    }

    /// Steps a settle the host holds to `seconds` after it began, at `now`
    /// (ms): once a frame. Writes x, velocity and done (1 or 0) into `out`.
    #[wasm_bindgen(js_name = settleStep)]
    pub fn settle_step(&self, state: &mut [f64], seconds: f64, now: f64, out: &mut [f64]) {
        let mut settle = PaperSettle::read(state);
        let at = self.model.settle_step(&mut settle, seconds, now);
        settle.write(state);
        out[0] = at.x;
        out[1] = at.velocity;
        out[2] = if at.done { 1.0 } else { 0.0 };
    }

    /// How far a finger has carried a turn: origin x, y and position x, y in `touch`.
    pub fn travel(touch: &[f64], width: f64, spine: f64) -> f64 {
        let touch = Touch {
            origin: Point {
                x: touch[0],
                y: touch[1],
            },
            position: Point {
                x: touch[2],
                y: touch[3],
            },
            farthest: None,
        };
        travel(&touch, width, spine)
    }

    /// Whether a turn let go turns the page (`rito_turn::pack::read_release`).
    pub fn lands(release: &[f64]) -> bool {
        lands(&read_release(release))
    }

    /// How high the eye is over a frame of this size.
    #[wasm_bindgen(js_name = eyeHeight)]
    pub fn eye_height(width: f64, height: f64) -> f64 {
        eye_height(width, height)
    }

    /// How many numbers each layout is: frame, sheet, release, settle.
    pub fn layouts() -> Vec<u32> {
        vec![
            rito_turn::pack::FRAME_NUMBERS as u32,
            SHEET_NUMBERS as u32,
            rito_turn::pack::RELEASE_NUMBERS as u32,
            SETTLE_NUMBERS as u32,
        ]
    }
}
