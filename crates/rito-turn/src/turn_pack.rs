//! The numbers a host and a page turn's motion exchange, one layout for
//! every host: the web passes them as typed arrays through wasm, Flutter
//! as buffers through the C ABI.

use crate::spring::{At, Spring};
use crate::turn_motion::{Begin, Leaving, Neighbour, TurnMotion, TurnPhase, TurnStep};
use crate::turn_physics::TurnPhysics;

/// How many numbers the built-in rules' numbers are: the spring's stiffness
/// and damping, the swipe threshold (px), the velocity that commits (px/s),
/// the projection (s), the pull-back speed (px/s) and the elastic factor.
pub const TURN_PHYSICS_NUMBERS: usize = 7;

/// How many numbers a motion's state is (see [`write_turn_state`]).
pub const TURN_STATE_NUMBERS: usize = 19;

/// How many numbers a place in a motion is: x, velocity, done (1/0).
pub const TURN_AT_NUMBERS: usize = 3;

pub fn read_turn_physics(numbers: &[f64]) -> TurnPhysics {
    TurnPhysics {
        spring: Spring {
            stiffness: numbers[0],
            damping: numbers[1],
        },
        swipe_threshold: numbers[2],
        velocity_commit: numbers[3],
        projection: numbers[4],
        pull_back: numbers[5],
        elastic_factor: numbers[6],
    }
}

pub fn write_turn_physics(physics: &TurnPhysics, out: &mut [f64]) {
    out[..TURN_PHYSICS_NUMBERS].copy_from_slice(&[
        physics.spring.stiffness,
        physics.spring.damping,
        physics.swipe_threshold,
        physics.velocity_commit,
        physics.projection,
        physics.pull_back,
        physics.elastic_factor,
    ]);
}

/// Reads a place a host's own motion is at.
pub fn read_turn_at(numbers: &[f64]) -> At {
    At {
        x: numbers[0],
        velocity: numbers[1],
        done: numbers[2] != 0.0,
    }
}

/// Reads where the host's physics begin a turn that cuts in: offset, velocity.
pub fn read_begin(numbers: &[f64]) -> Begin {
    Begin {
        offset: numbers[0],
        velocity: numbers[1],
    }
}

fn flag(value: bool) -> f64 {
    if value {
        1.0
    } else {
        0.0
    }
}

fn neighbour(value: Option<Neighbour>) -> f64 {
    match value {
        None => 0.0,
        Some(Neighbour::Next) => 1.0,
        Some(Neighbour::Previous) => 2.0,
    }
}

fn leaving(value: Option<Leaving>) -> f64 {
    match value {
        None => 0.0,
        Some(Leaving::Next) => 1.0,
        Some(Leaving::Previous) => 2.0,
        Some(Leaving::None) => 3.0,
    }
}

/// Writes `motion`'s state: phase (0 idle, 1 dragging, 2 settling,
/// 3 finishing), forward, has incoming (1/0), offset, velocity, target,
/// from, finger velocity, elapsed; the neighbour showing (0 none, 1 next,
/// 2 previous), on the far side, committing, landing (1/0); what the turn
/// it began from left in the frame (0 nothing, it began at rest; 1 next,
/// 2 previous, 3 no neighbour); the motion the host is to carry on
/// (generation, from, velocity, to) and what is added to it.
pub fn write_turn_state(motion: &TurnMotion, out: &mut [f64]) {
    let phase = match motion.phase() {
        TurnPhase::Idle => 0.0,
        TurnPhase::Dragging => 1.0,
        TurnPhase::Settling => 2.0,
        TurnPhase::Finishing => 3.0,
    };
    let request = motion.settle_request();
    out[..TURN_STATE_NUMBERS].copy_from_slice(&[
        phase,
        flag(motion.forward()),
        flag(motion.has_incoming()),
        motion.offset(),
        motion.velocity(),
        motion.target(),
        motion.from(),
        motion.finger_velocity(),
        motion.elapsed(),
        neighbour(motion.showing()),
        flag(motion.on_far_side()),
        flag(motion.committing()),
        flag(motion.landing()),
        leaving(motion.leaving()),
        request.generation as f64,
        request.from,
        request.velocity,
        request.to,
        motion.shift(),
    ]);
}

/// A step as a number: 0 still, 1 moving, 2 settled on the neighbour,
/// 3 settled back where it began, 4 what was left of a turn come to rest.
pub fn turn_step_code(step: TurnStep) -> u32 {
    match step {
        TurnStep::Still => 0,
        TurnStep::Moving => 1,
        TurnStep::Settled { committed: true } => 2,
        TurnStep::Settled { committed: false } => 3,
        TurnStep::Rested => 4,
    }
}
