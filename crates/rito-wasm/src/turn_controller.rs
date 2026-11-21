//! The page turns of a reader as the web drives them: what the host knows
//! of the pages, each action and the controller's state cross in the
//! layouts `rito_turn::turn_controller_pack` gives every host.

use rito_turn::turn_controller::{Point, TurnController};
use rito_turn::turn_controller_pack::{
    read_direction, read_turn_pages, write_controller_state, write_turn_action,
    TURN_ACTION_NUMBERS, TURN_CONTROLLER_STATE_NUMBERS, TURN_PAGES_NUMBERS,
};
use rito_turn::turn_pack::{read_begin, read_turn_at, read_turn_physics, TURN_AT_NUMBERS};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = RitoTurnController)]
pub struct RitoTurnController {
    controller: TurnController,
}

fn point(x: f64, y: f64) -> Point {
    Point { x, y }
}

#[wasm_bindgen(js_class = RitoTurnController)]
impl RitoTurnController {
    /// Page turns going by `physics` (`TURN_PHYSICS_NUMBERS` numbers).
    #[wasm_bindgen(constructor)]
    pub fn new(physics: &[f64]) -> Self {
        Self {
            controller: TurnController::new(read_turn_physics(physics)),
        }
    }

    /// The built-in rules' numbers, the page width a turn travels, and
    /// whether turns land at once.
    pub fn configure(&mut self, physics: &[f64], width: f64, instant: bool) {
        self.controller.configure(read_turn_physics(physics), width);
        self.controller.set_instant(instant);
    }

    #[wasm_bindgen(js_name = fingerDown)]
    pub fn finger_down(&mut self, pages: &[f64], x: f64, y: f64, at: f64) {
        self.controller
            .finger_down(read_turn_pages(pages), point(x, y), at);
    }

    /// `resisted`: the host's physics' stretch of `travel`, NaN for the built-in.
    #[wasm_bindgen(js_name = fingerMove)]
    pub fn finger_move(
        &mut self,
        pages: &[f64],
        x: f64,
        y: f64,
        travel: f64,
        resisted: f64,
        at: f64,
    ) {
        let resisted = (!resisted.is_nan()).then_some(resisted);
        self.controller
            .finger_move(read_turn_pages(pages), point(x, y), travel, resisted, at);
    }

    #[wasm_bindgen(js_name = fingerUp)]
    pub fn finger_up(&mut self, pages: &[f64], x: f64, y: f64, travel: f64, at: f64) {
        self.controller
            .finger_up(read_turn_pages(pages), point(x, y), travel, at);
    }

    #[wasm_bindgen(js_name = fingerCancel)]
    pub fn finger_cancel(&mut self, pages: &[f64]) {
        self.controller.finger_cancel(read_turn_pages(pages));
    }

    /// Turns to the neighbour `direction` (0 next, 1 previous); whether it was taken.
    pub fn command(&mut self, pages: &[f64], direction: u32) -> bool {
        self.controller
            .command(read_turn_pages(pages), read_direction(direction))
    }

    #[wasm_bindgen(js_name = playJump)]
    pub fn play_jump(&mut self, pages: &[f64], direction: u32) {
        self.controller
            .play_jump(read_turn_pages(pages), read_direction(direction));
    }

    pub fn landed(&mut self, pages: &[f64], ok: bool) {
        self.controller.landed(read_turn_pages(pages), ok);
    }

    pub fn pages(&mut self, pages: &[f64]) {
        self.controller.pages(read_turn_pages(pages));
    }

    pub fn overdue(&mut self, pages: &[f64]) {
        self.controller.overdue(read_turn_pages(pages));
    }

    pub fn interrupt(&mut self) {
        self.controller.interrupt();
    }

    /// `host_at`: x, velocity, done while the host's physics carry the motion; else empty.
    pub fn step(&mut self, pages: &[f64], seconds: f64, host_at: &[f64]) {
        let host = (host_at.len() >= TURN_AT_NUMBERS).then(|| read_turn_at(host_at));
        self.controller.step(read_turn_pages(pages), seconds, host);
    }

    /// `begin`: offset, velocity; empty for the built-in rule.
    #[wasm_bindgen(js_name = answerBegin)]
    pub fn answer_begin(&mut self, begin: &[f64]) {
        self.controller
            .answer_begin((begin.len() >= 2).then(|| read_begin(begin)));
    }

    /// `lands`: 1 or 0, -1 for the built-in rule.
    #[wasm_bindgen(js_name = answerLands)]
    pub fn answer_lands(&mut self, lands: i32) {
        self.controller
            .answer_lands((lands >= 0).then_some(lands != 0));
    }

    /// Writes the next action into `out` (kind 0: none).
    #[wasm_bindgen(js_name = takeAction)]
    pub fn take_action(&mut self, out: &mut [f64]) {
        write_turn_action(self.controller.take_action(), out);
    }

    /// Writes the controller's state into `out`.
    pub fn state(&self, out: &mut [f64]) {
        write_controller_state(&self.controller, out);
    }

    /// How many numbers each layout is: pages, action, state.
    pub fn layouts() -> Vec<u32> {
        vec![
            TURN_PAGES_NUMBERS as u32,
            TURN_ACTION_NUMBERS as u32,
            TURN_CONTROLLER_STATE_NUMBERS as u32,
        ]
    }
}
