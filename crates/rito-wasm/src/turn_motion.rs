//! The motion of a page turn as the web drives it: numbers in and out in
//! the layouts `rito_turn::turn_pack` gives every host. Where the host's
//! own physics decide, it passes their answer; otherwise the built-in rules
//! do.

use rito_turn::turn_motion::TurnMotion;
use rito_turn::turn_pack::{
    read_begin, read_turn_at, read_turn_physics, turn_step_code, write_turn_state, TURN_AT_NUMBERS,
    TURN_PHYSICS_NUMBERS, TURN_STATE_NUMBERS,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = RitoTurnMotion)]
pub struct RitoTurnMotion {
    motion: TurnMotion,
}

/// Where the host's physics begin a turn that cuts in: offset, velocity;
/// empty for the built-in rule.
fn begin(numbers: &[f64]) -> Option<rito_turn::turn_motion::Begin> {
    (numbers.len() >= 2).then(|| read_begin(numbers))
}

#[wasm_bindgen(js_class = RitoTurnMotion)]
impl RitoTurnMotion {
    /// A motion going by `physics` (`TURN_PHYSICS_NUMBERS` numbers).
    #[wasm_bindgen(constructor)]
    pub fn new(physics: &[f64]) -> Self {
        Self {
            motion: TurnMotion::new(read_turn_physics(physics)),
        }
    }

    /// The built-in rules' numbers and the page width a turn travels.
    pub fn configure(&mut self, physics: &[f64], width: f64) {
        self.motion.set_physics(read_turn_physics(physics));
        self.motion.set_width(width);
    }

    /// A finger takes the turn at `at` ms.
    #[wasm_bindgen(js_name = startDrag)]
    pub fn start_drag(&mut self, forward: bool, has_incoming: bool, at: f64, begin_at: &[f64]) {
        self.motion
            .start_drag(forward, has_incoming, at, begin(begin_at));
    }

    /// Follows the finger: `travel` px since it took the turn, or, with
    /// `carried`, the turn the host's physics made of that travel.
    pub fn drag(&mut self, travel: f64, at: f64, carried: bool) {
        if carried {
            self.motion.drag_carried(travel, at);
        } else {
            self.motion.drag(travel, at);
        }
    }

    /// Lets go; `lands` 1 or 0 is the host's physics' answer, -1 the
    /// built-in rule's. True when the page turns.
    pub fn release(&mut self, lands: i32) -> bool {
        self.motion.release((lands >= 0).then_some(lands != 0))
    }

    pub fn cancel(&mut self) -> bool {
        self.motion.cancel()
    }

    pub fn turn(&mut self, forward: bool, begin_at: &[f64]) {
        self.motion.turn(forward, begin(begin_at));
    }

    pub fn interrupt(&mut self, at: f64) -> bool {
        self.motion.interrupt(at)
    }

    #[wasm_bindgen(js_name = carryOn)]
    pub fn carry_on(&mut self, committed: bool) {
        self.motion.carry_on(committed);
    }

    /// Moves the turn on by `seconds`; `host_at` is where the host's motion
    /// is then while it carries one with physics of its own (x, velocity,
    /// done), from its first step; empty leaves it to the spring. Says what
    /// the step did (`rito_turn::turn_pack::turn_step_code`).
    pub fn step(&mut self, seconds: f64, host_at: &[f64], instant: bool) -> u32 {
        let host = (host_at.len() >= TURN_AT_NUMBERS).then(|| read_turn_at(host_at));
        turn_step_code(self.motion.step(seconds, host, instant))
    }

    pub fn finish(&mut self) {
        self.motion.finish();
    }

    pub fn reset(&mut self) {
        self.motion.reset();
    }

    /// Writes the motion's state into `out` (`TURN_STATE_NUMBERS` numbers).
    pub fn state(&self, out: &mut [f64]) {
        write_turn_state(&self.motion, out);
    }

    /// How many numbers each layout is: physics, state, a place.
    pub fn layouts() -> Vec<u32> {
        vec![
            TURN_PHYSICS_NUMBERS as u32,
            TURN_STATE_NUMBERS as u32,
            TURN_AT_NUMBERS as u32,
        ]
    }
}
