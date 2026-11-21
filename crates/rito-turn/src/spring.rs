//! A damped spring toward a target, solved in closed form: the motion a
//! turn nothing holds is carried on by, on every host to the bit.

use crate::math::{cos, exp, sign, sin, sqrt};

/// A damped harmonic oscillator (unit mass) toward a target.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Spring {
    pub stiffness: f64,
    pub damping: f64,
}

/// Where a motion is, how fast it goes, and whether it has come to rest.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct At {
    pub x: f64,
    pub velocity: f64,
    pub done: bool,
}

/// Settled once what motion remains is sub-pixel: within half a pixel of the
/// target, and not moving fast enough to carry more than half a pixel further.
const SETTLE_DISTANCE_PX: f64 = 0.5;

/// The spring's offset from its target and velocity `t` seconds on.
pub fn spring_at(config: Spring, offset: f64, velocity: f64, t: f64) -> (f64, f64) {
    let omega = sqrt(config.stiffness);
    let zeta = config.damping / (2.0 * omega);
    if (zeta - 1.0).abs() < 1e-6 {
        let c = velocity + omega * offset;
        let decay = exp(-omega * t);
        return ((offset + c * t) * decay, (velocity - omega * c * t) * decay);
    }
    if zeta < 1.0 {
        let a = zeta * omega;
        let wd = omega * sqrt(1.0 - zeta * zeta);
        let c = (velocity + a * offset) / wd;
        let decay = exp(-a * t);
        let cosine = cos(wd * t);
        let sine = sin(wd * t);
        return (
            decay * (offset * cosine + c * sine),
            decay * ((c * wd - a * offset) * cosine - (offset * wd + a * c) * sine),
        );
    }
    let root = omega * sqrt(zeta * zeta - 1.0);
    let slow = -zeta * omega + root;
    let fast = -zeta * omega - root;
    let slow_part = (velocity - fast * offset) / (slow - fast);
    let fast_part = offset - slow_part;
    let slow_decay = exp(slow * t);
    let fast_decay = exp(fast * t);
    (
        slow_part * slow_decay + fast_part * fast_decay,
        slow * slow_part * slow_decay + fast * fast_part * fast_decay,
    )
}

/// A spring that does not oscillate passes its target only when it starts
/// toward it faster than ω times the distance; a handed-over velocity is
/// bounded there, keeping the spring on its side of the target.
fn bounded_velocity(config: Spring, offset: f64, velocity: f64) -> f64 {
    let omega = sqrt(config.stiffness);
    if config.damping < 2.0 * omega || offset == 0.0 {
        return velocity;
    }
    let limit = omega * offset.abs();
    let toward = -sign(offset) * velocity;
    if toward > limit {
        -sign(offset) * limit
    } else {
        velocity
    }
}

/// The spring from `from` at `velocity` to `to`, read by the seconds since.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpringSettle {
    pub(crate) config: Spring,
    pub(crate) to: f64,
    pub(crate) offset: f64,
    pub(crate) start: f64,
    pub(crate) omega: f64,
}

impl SpringSettle {
    pub fn new(config: Spring, from: f64, velocity: f64, to: f64) -> Self {
        let offset = from - to;
        Self {
            config,
            to,
            offset,
            start: bounded_velocity(config, offset, velocity),
            omega: sqrt(config.stiffness),
        }
    }

    pub fn at(&self, seconds: f64) -> At {
        let (offset, velocity) = spring_at(self.config, self.offset, self.start, seconds);
        At {
            x: self.to + offset,
            velocity,
            done: offset.abs() < SETTLE_DISTANCE_PX
                && velocity.abs() / self.omega < SETTLE_DISTANCE_PX,
        }
    }
}
