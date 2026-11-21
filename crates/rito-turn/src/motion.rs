//! How something nothing holds moves: a spring toward its target, and the
//! ways a leaf left alone goes. Each is data stepped by the seconds since it
//! began; what it keeps between steps (that it has landed) is kept in it, so
//! a host steps it exactly once a frame.

use crate::math::{min, pow};
pub use crate::spring::{spring_at, At, Spring, SpringSettle};

/// A leaf let go on the move finishes on this spring: quick, and never past its target.
const LEAF_SPRING: Spring = Spring {
    stiffness: 260.0,
    damping: 32.3,
};
/// How long a leaf turned by no finger takes, seconds: the whole way, and a nudge of it.
const WHOLE_TURN: f64 = 0.38;
const SHORTEST_TURN: f64 = 0.2;
/// A turn let go slower than this many of its remaining lengths a second is
/// finished at the leaf's own pace; a faster one keeps its momentum.
const UNHURRIED: f64 = 1.2;
/// How long a leaf sent back the way it came takes to stop, seconds.
const STOPS_IN: f64 = 0.1;

/// From `from` to `to` at the leaf's own pace: off at once, fastest early,
/// slowing all the way in.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Unhurried {
    from: f64,
    to: f64,
    duration: f64,
}

impl Unhurried {
    fn new(from: f64, to: f64) -> Self {
        let share = min(1.0, (to - from).abs() / 800.0);
        Self {
            from,
            to,
            duration: SHORTEST_TURN + (WHOLE_TURN - SHORTEST_TURN) * share,
        }
    }

    fn at(&self, seconds: f64) -> At {
        let t = min(1.0, seconds / self.duration);
        // A smooth step taken early: two thirds of the way by half time.
        let early = pow(t, 0.72);
        let eased = early * early * (3.0 - 2.0 * early);
        let speed = (6.0 * early * (1.0 - early) * 0.72 * pow(t, -0.28)) / self.duration;
        At {
            x: self.from + (self.to - self.from) * eased,
            velocity: if t > 0.0 {
                (self.to - self.from) * speed
            } else {
                0.0
            },
            done: t >= 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Way {
    /// Already there: a spring would carry what speed it had past the page and creep back.
    There {
        to: f64,
    },
    Unhurried(Unhurried),
    /// Sent back the way it came while still on the move: it slows evenly to
    /// a stop in `STOPS_IN`, and comes back from there at its own pace.
    TurnedRound {
        stop: f64,
        velocity: f64,
        back: Unhurried,
    },
    Spring(SpringSettle),
}

impl Way {
    fn of(from: f64, velocity: f64, to: f64) -> Self {
        let way = to - from;
        if way.abs() < 0.5 {
            return Self::There { to };
        }
        if velocity * way < 0.0 && velocity.abs() > UNHURRIED * way.abs() {
            let stop = from + (velocity * STOPS_IN) / 2.0;
            return Self::TurnedRound {
                stop,
                velocity,
                back: Unhurried::new(stop, to),
            };
        }
        if velocity.abs() < UNHURRIED * way.abs() {
            Self::Unhurried(Unhurried::new(from, to))
        } else {
            Self::Spring(SpringSettle::new(LEAF_SPRING, from, velocity, to))
        }
    }

    fn at(&self, seconds: f64) -> At {
        match self {
            Self::There { to } => At {
                x: *to,
                velocity: 0.0,
                done: true,
            },
            Self::Unhurried(unhurried) => unhurried.at(seconds),
            Self::TurnedRound {
                stop,
                velocity,
                back,
            } => {
                if seconds >= STOPS_IN {
                    return back.at(seconds - STOPS_IN);
                }
                let slowed = 1.0 - seconds / STOPS_IN;
                At {
                    x: stop - (velocity * STOPS_IN * slowed * slowed) / 2.0,
                    velocity: velocity * slowed,
                    done: false,
                }
            }
            Self::Spring(spring) => spring.at(seconds),
        }
    }
}

/// How a leaf nothing holds goes from `from` at `velocity` to `to`: at its
/// own pace when it is slow, keeping its momentum when it is not, and with
/// one frame drawn exactly where it lands before it is done.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LeafMotion {
    way: Way,
    to: f64,
    landed: bool,
}

impl LeafMotion {
    pub fn new(from: f64, velocity: f64, to: f64) -> Self {
        Self {
            way: Way::of(from, velocity, to),
            to,
            landed: false,
        }
    }

    /// Where it is `seconds` after it began. Once its way is done, the first
    /// step stands exactly where it lands, not yet done; every later one is done.
    pub fn step(&mut self, seconds: f64) -> At {
        let at = self.way.at(seconds);
        if !at.done {
            return at;
        }
        let done = self.landed;
        self.landed = true;
        At {
            x: self.to,
            velocity: 0.0,
            done,
        }
    }
}

/// How a leaf nothing leads comes down, in turns of the leaf: as a turn let
/// go does, in a frame `width` CSS px wide.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Alone {
    width: f64,
    motion: LeafMotion,
}

impl Alone {
    pub fn new(width: f64, from: f64, speed: f64, to: f64) -> Self {
        Self {
            width,
            motion: LeafMotion::new(-from * width, -speed * width, -to * width),
        }
    }

    pub fn step(&mut self, seconds: f64) -> At {
        let at = self.motion.step(seconds);
        At {
            x: -at.x / self.width,
            velocity: -at.velocity / self.width,
            done: at.done,
        }
    }
}

/// How many numbers a `LeafMotion` is written as.
pub(crate) const LEAF_MOTION_NUMBERS: usize = 9;

impl LeafMotion {
    /// The motion as numbers, for a host to hold between steps: its way (a
    /// tag and up to six parameters), where it ends, and whether it has landed.
    pub(crate) fn write(&self, out: &mut [f64]) {
        out[..LEAF_MOTION_NUMBERS].fill(0.0);
        match self.way {
            Way::There { to } => {
                out[0] = 0.0;
                out[1] = to;
            }
            Way::Unhurried(Unhurried { from, to, duration }) => {
                out[0] = 1.0;
                out[1..4].copy_from_slice(&[from, to, duration]);
            }
            Way::TurnedRound {
                stop,
                velocity,
                back,
            } => {
                out[0] = 2.0;
                out[1..6].copy_from_slice(&[stop, velocity, back.from, back.to, back.duration]);
            }
            Way::Spring(spring) => {
                out[0] = 3.0;
                out[1..7].copy_from_slice(&[
                    spring.config.stiffness,
                    spring.config.damping,
                    spring.to,
                    spring.offset,
                    spring.start,
                    spring.omega,
                ]);
            }
        }
        out[7] = self.to;
        out[8] = if self.landed { 1.0 } else { 0.0 };
    }

    /// The motion `write` wrote.
    pub(crate) fn read(numbers: &[f64]) -> Self {
        let unhurried = |at: usize| Unhurried {
            from: numbers[at],
            to: numbers[at + 1],
            duration: numbers[at + 2],
        };
        let way = match numbers[0] as u8 {
            0 => Way::There { to: numbers[1] },
            1 => Way::Unhurried(unhurried(1)),
            2 => Way::TurnedRound {
                stop: numbers[1],
                velocity: numbers[2],
                back: unhurried(3),
            },
            _ => Way::Spring(SpringSettle {
                config: Spring {
                    stiffness: numbers[1],
                    damping: numbers[2],
                },
                to: numbers[3],
                offset: numbers[4],
                start: numbers[5],
                omega: numbers[6],
            }),
        };
        Self {
            way,
            to: numbers[7],
            landed: numbers[8] != 0.0,
        }
    }
}
