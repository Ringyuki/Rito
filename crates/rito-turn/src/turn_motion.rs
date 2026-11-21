//! The motion of one page turn, whatever it looks like: the finger while
//! it holds the turn, then a spring to the neighbour or back. Displacement
//! is in px, negative while turning toward the next page; the host supplies
//! every time, so the path is the same at any frame rate and on every host.
//!
//! A turn another cuts into is not stopped: [`TurnMotion::carry_on`]
//! settles its outcome and leaves its picture going, and the turn that cuts
//! in begins where that picture is.
//!
//! Each place the built-in rules decide something, the host may answer
//! instead, with physics of its own written in its own language: where a
//! pull against the end of the book stretches ([`TurnMotion::drag_carried`]),
//! whether a release turns the page ([`TurnMotion::release`]), where a turn
//! that cuts in begins ([`Begin`]), and the motion that carries a turn to
//! rest ([`TurnMotion::set_host_settles`]).

use crate::math::clamp;
use crate::spring::{At, SpringSettle};
use crate::turn_physics::{FingerSamples, TurnPhysics, TurnRelease};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnPhase {
    Idle,
    /// A finger holds the turn.
    Dragging,
    /// Nothing holds it: it goes to the neighbour or back.
    Settling,
    /// What was left of a turn another cut into: its outcome is settled,
    /// and its picture goes the rest of the way to rest.
    Finishing,
}

/// One of the pages beside the one shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Neighbour {
    Next,
    Previous,
}

/// What a turn that was cut into left in the frame: the neighbour it was
/// leaving or going back to, or none for a pull against the end of the
/// book, which shows no neighbour.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Leaving {
    Next,
    Previous,
    None,
}

impl Leaving {
    fn of(neighbour: Option<Neighbour>) -> Self {
        match neighbour {
            Some(Neighbour::Next) => Self::Next,
            Some(Neighbour::Previous) => Self::Previous,
            None => Self::None,
        }
    }

    fn neighbour(self) -> Option<Neighbour> {
        match self {
            Self::Next => Some(Neighbour::Next),
            Self::Previous => Some(Neighbour::Previous),
            Self::None => None,
        }
    }
}

/// What a turn beginning now finds of the one it cuts into: where its
/// picture is (px, in the coordinates that turn's outcome left), how fast
/// it moves (px/s) and what it left in the frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Leftover {
    pub offset: f64,
    pub velocity: f64,
    pub leaving: Leaving,
}

impl Leftover {
    /// Whether a turn `forward`, with a neighbour that way or not, is
    /// between the same two pages as the turn it cuts into: the same page,
    /// turned again.
    pub fn same_pages(&self, forward: bool, has_incoming: bool) -> bool {
        let own = has_incoming.then_some(if forward {
            Leaving::Next
        } else {
            Leaving::Previous
        });
        own == Some(self.leaving)
    }
}

/// Where a turn that cuts into another begins, and how fast (px, px/s), when
/// the host's physics say so; by default where the picture is and as fast.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Begin {
    pub offset: f64,
    pub velocity: f64,
}

/// A motion the host carries on with physics of its own: started at
/// `from`, at `velocity`, toward `to`. `generation` changes each time a
/// motion starts, so the host knows when to start its own.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SettleRequest {
    pub generation: u64,
    pub from: f64,
    pub velocity: f64,
    pub to: f64,
}

/// What a step did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnStep {
    /// Nothing moves by itself.
    Still,
    Moving,
    /// The turn came to rest: on the neighbour, or back where it began.
    Settled {
        committed: bool,
    },
    /// What was left of a turn that was cut into came to rest. Its turn was
    /// over when it was cut into, so this settles nothing.
    Rested,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Settle {
    Spring(SpringSettle),
    Host,
}

/// The motion of one page turn. See the module.
#[derive(Debug, Clone, PartialEq)]
pub struct TurnMotion {
    physics: TurnPhysics,
    width: f64,
    host_settles: bool,
    phase: TurnPhase,
    forward: bool,
    has_incoming: bool,
    offset: f64,
    velocity: f64,
    target: f64,
    settle: Option<Settle>,
    request: SettleRequest,
    elapsed: f64,
    /// Added to what the motion says: the coordinates moved when the turn
    /// it was started for landed.
    shift: f64,
    samples: FingerSamples,
    /// How fast the finger carries the turn, px/ms.
    finger_speed: f64,
    /// Where the turn was when the finger took it: what its travel adds to.
    from: f64,
    /// What the turn this one began from left in the frame; none when it
    /// began at rest.
    leaving: Option<Leaving>,
}

impl TurnMotion {
    pub fn new(physics: TurnPhysics) -> Self {
        Self {
            physics,
            width: 0.0,
            host_settles: false,
            phase: TurnPhase::Idle,
            forward: true,
            has_incoming: true,
            offset: 0.0,
            velocity: 0.0,
            target: 0.0,
            settle: None,
            request: SettleRequest {
                generation: 0,
                from: 0.0,
                velocity: 0.0,
                to: 0.0,
            },
            elapsed: 0.0,
            shift: 0.0,
            samples: FingerSamples::default(),
            finger_speed: 0.0,
            from: 0.0,
            leaving: None,
        }
    }

    pub fn physics(&self) -> TurnPhysics {
        self.physics
    }

    /// The numbers the built-in rules go by from now on; a motion under
    /// way keeps the spring it started on.
    pub fn set_physics(&mut self, physics: TurnPhysics) {
        self.physics = physics;
    }

    /// The page width a whole turn travels, px.
    pub fn width(&self) -> f64 {
        self.width
    }

    pub fn set_width(&mut self, width: f64) {
        self.width = width;
    }

    /// Whether the host carries each motion that starts from now on to
    /// rest with physics of its own (see [`Self::settle_request`]) instead
    /// of the spring.
    pub fn set_host_settles(&mut self, host: bool) {
        self.host_settles = host;
    }

    pub fn phase(&self) -> TurnPhase {
        self.phase
    }

    pub fn offset(&self) -> f64 {
        self.offset
    }

    /// How fast the turn moves, px/s; 0 while a finger holds it.
    pub fn velocity(&self) -> f64 {
        if self.moving() {
            self.velocity
        } else {
            0.0
        }
    }

    /// Whether the turn goes toward the next page.
    pub fn forward(&self) -> bool {
        self.forward
    }

    /// Whether a neighbour lies the way the turn goes.
    pub fn has_incoming(&self) -> bool {
        self.has_incoming
    }

    /// Where the turn is going: a page width toward the neighbour, or 0.
    pub fn target(&self) -> f64 {
        self.target
    }

    /// Where the turn was when the finger took it.
    pub fn from(&self) -> f64 {
        self.from
    }

    /// Seconds since the motion carrying the turn began.
    pub fn elapsed(&self) -> f64 {
        self.elapsed
    }

    /// How fast the finger carries the turn, px/s, from its last few samples.
    pub fn finger_velocity(&self) -> f64 {
        self.finger_speed * 1000.0
    }

    /// Whether the turn goes to the neighbour by itself.
    pub fn committing(&self) -> bool {
        self.phase == TurnPhase::Settling && self.target != 0.0
    }

    /// Whether anything moves by itself.
    pub fn moving(&self) -> bool {
        matches!(self.phase, TurnPhase::Settling | TurnPhase::Finishing)
    }

    /// Whether the frame is still the picture of the turn this one cut
    /// into: it has not crossed its own start yet.
    pub fn on_far_side(&self) -> bool {
        self.phase != TurnPhase::Finishing
            && self.leaving.is_some()
            && if self.forward {
                self.offset > 0.0
            } else {
                self.offset < 0.0
            }
    }

    /// The neighbour in the frame: the turn's own, or the one the turn it
    /// cut into was leaving while this one is on the far side of its start.
    pub fn showing(&self) -> Option<Neighbour> {
        if let Some(leaving) = self.leaving {
            if self.phase == TurnPhase::Finishing || self.on_far_side() {
                return leaving.neighbour();
            }
        }
        self.own_neighbour()
    }

    /// Whether the turn is landing on its neighbour: going there by itself,
    /// and past the picture of any turn it cut into.
    pub fn landing(&self) -> bool {
        self.committing() && !self.on_far_side()
    }

    /// What the turn this one began from left in the frame; none when it
    /// began at rest.
    pub fn leaving(&self) -> Option<Leaving> {
        self.leaving
    }

    /// What is added to the motion carrying what is left of a turn that
    /// was cut into: the coordinates moved when that turn landed.
    pub fn shift(&self) -> f64 {
        self.shift
    }

    /// What a turn beginning now would find of the one it cuts into; none
    /// at rest.
    pub fn leftover(&self) -> Option<Leftover> {
        let leaving = self.leaving?;
        (self.phase == TurnPhase::Finishing).then_some(Leftover {
            offset: self.offset,
            velocity: self.velocity,
            leaving,
        })
    }

    /// The motion the host is to carry on, while it carries motions
    /// ([`Self::set_host_settles`]): the latest one started.
    pub fn settle_request(&self) -> SettleRequest {
        self.request
    }

    /// A finger takes the turn at `at` ms: from rest, or from what a turn it
    /// cut into had left ([`Begin`] when the host's physics place it).
    pub fn start_drag(&mut self, forward: bool, has_incoming: bool, at: f64, begin: Option<Begin>) {
        let (offset, _, leaving) = self.beginning(begin);
        self.phase = TurnPhase::Dragging;
        self.forward = forward;
        self.has_incoming = has_incoming;
        self.offset = offset;
        self.from = offset;
        self.leaving = leaving;
        self.velocity = 0.0;
        self.target = 0.0;
        self.settle = None;
        self.shift = 0.0;
        self.samples = FingerSamples::starting_at(offset, at);
        self.finger_speed = 0.0;
    }

    /// Follows a finger that has carried the turn `travel` px since it took
    /// it, at `at` ms. A pull with no neighbour stretches by the built-in
    /// rule; what the turn had already travelled does not.
    pub fn drag(&mut self, travel: f64, at: f64) {
        let carried = if self.has_incoming {
            travel
        } else {
            self.physics.resist(travel, self.width)
        };
        self.drag_carried(carried, at);
    }

    /// Follows a finger whose travel the host's physics have already made
    /// `carried` px of turn (a pull with no neighbour stretched its way).
    pub fn drag_carried(&mut self, carried: f64, at: f64) {
        if self.phase != TurnPhase::Dragging {
            return;
        }
        self.offset = self.within_a_page(self.from + carried);
        self.samples.push(self.offset, at);
        self.finger_speed = self.samples.speed();
    }

    /// The release a finger letting go now would make.
    pub fn release_info(&self) -> TurnRelease {
        TurnRelease {
            offset: self.offset,
            from: self.from,
            velocity: self.finger_velocity(),
            width: self.width,
            forward: self.forward,
        }
    }

    /// Lets go; true when the page turns. `lands` is the host's physics'
    /// answer; without it the built-in rule decides. With no neighbour the
    /// turn always goes back. It goes as fast as the finger carried it.
    pub fn release(&mut self, lands: Option<bool>) -> bool {
        if self.phase != TurnPhase::Dragging {
            return false;
        }
        let release = self.release_info();
        self.velocity = release.velocity;
        let lands = self.has_incoming && lands.unwrap_or_else(|| self.physics.lands(&release));
        self.settle_to(if lands { self.turn_target() } else { 0.0 });
        lands
    }

    /// Sends a turn that is held or going by itself back to where it
    /// started (also one that arrived but could not land); true when there
    /// was one. A finger taken away leaves it going as fast as it carried
    /// it; a turn already going back goes on as it was.
    pub fn cancel(&mut self) -> bool {
        match self.phase {
            TurnPhase::Dragging => self.velocity = self.finger_velocity(),
            TurnPhase::Settling if self.target == 0.0 => return true,
            TurnPhase::Settling => {}
            TurnPhase::Idle | TurnPhase::Finishing => return false,
        }
        self.settle_to(0.0);
        true
    }

    /// Turns toward a neighbour without a finger (a tap, a key): from rest,
    /// from what a turn it cut into had left, or on from where a turn that
    /// is held or going back is.
    pub fn turn(&mut self, forward: bool, begin: Option<Begin>) {
        if matches!(self.phase, TurnPhase::Idle | TurnPhase::Finishing) {
            let (offset, velocity, leaving) = self.beginning(begin);
            self.offset = offset;
            self.velocity = velocity;
            self.leaving = leaving;
        } else if self.phase == TurnPhase::Dragging {
            self.velocity = self.finger_velocity();
        }
        self.forward = forward;
        self.has_incoming = true;
        self.settle_to(self.turn_target());
    }

    /// A finger takes a turn that was going by itself at `at` ms: from where
    /// it is, its own speed measured from there. True when there was one.
    pub fn interrupt(&mut self, at: f64) -> bool {
        if self.phase != TurnPhase::Settling {
            return false;
        }
        self.phase = TurnPhase::Dragging;
        self.from = self.offset;
        self.target = 0.0;
        self.settle = None;
        self.shift = 0.0;
        self.samples = FingerSamples::starting_at(self.offset, at);
        self.finger_speed = self.velocity / 1000.0;
        true
    }

    /// Settles the outcome of the turn that is open and leaves its picture
    /// going: the rest of it, in the coordinates that outcome leaves. A turn
    /// that landed (`committed`) has a new current page: what was a page
    /// width short of arriving is now that far from rest, the page it left
    /// beside it. One that was going back stays where it is. Nothing lies
    /// more than a page from rest.
    pub fn carry_on(&mut self, committed: bool) {
        if matches!(self.phase, TurnPhase::Idle | TurnPhase::Finishing) {
            return;
        }
        let shift = match (committed, self.forward) {
            (false, _) => 0.0,
            (true, true) => self.width,
            (true, false) => -self.width,
        };
        let moved = self.offset + shift;
        let offset = self.within_a_page(moved);
        self.leaving = Some(match (committed, self.forward) {
            (true, true) => Leaving::Previous,
            (true, false) => Leaving::Next,
            (false, _) => Leaving::of(self.showing()),
        });
        // A turn left alone keeps the motion it was on; one a finger held,
        // or cut short, starts one.
        if self.phase == TurnPhase::Settling && offset == moved {
            self.shift += shift;
        } else {
            if self.phase == TurnPhase::Dragging {
                self.velocity = self.finger_velocity();
            }
            self.start_settle(offset, 0.0);
        }
        self.offset = offset;
        self.target = 0.0;
        self.from = 0.0;
        self.phase = TurnPhase::Finishing;
    }

    /// Moves the turn on by `seconds`. While the host carries the motion,
    /// `host` is where its motion is at [`Self::elapsed`] plus `seconds`;
    /// `instant` lands at once.
    pub fn step(&mut self, seconds: f64, host: Option<At>, instant: bool) -> TurnStep {
        let Some(settle) = self.settle.filter(|_| self.moving()) else {
            return TurnStep::Still;
        };
        self.elapsed += seconds;
        let at = match settle {
            Settle::Spring(spring) => Some(spring.at(self.elapsed)),
            Settle::Host => host,
        };
        if let Some(at) = at {
            self.offset = at.x + self.shift;
            self.velocity = at.velocity;
        }
        if !instant && !at.is_some_and(|at| at.done) {
            return TurnStep::Moving;
        }
        let finishing = self.phase == TurnPhase::Finishing;
        let committed = self.target != 0.0;
        self.finish();
        if finishing {
            TurnStep::Rested
        } else {
            TurnStep::Settled { committed }
        }
    }

    /// Puts the turn where it was going and stops it.
    pub fn finish(&mut self) {
        self.offset = self.target;
        self.velocity = 0.0;
        self.phase = TurnPhase::Idle;
        self.settle = None;
        self.shift = 0.0;
        if self.target == 0.0 {
            self.leaving = None;
        }
    }

    /// Back to rest at once, nothing kept.
    pub fn reset(&mut self) {
        self.phase = TurnPhase::Idle;
        self.offset = 0.0;
        self.velocity = 0.0;
        self.target = 0.0;
        self.settle = None;
        self.shift = 0.0;
        self.from = 0.0;
        self.leaving = None;
    }

    fn own_neighbour(&self) -> Option<Neighbour> {
        self.has_incoming.then_some(if self.forward {
            Neighbour::Next
        } else {
            Neighbour::Previous
        })
    }

    fn turn_target(&self) -> f64 {
        if self.forward {
            -self.width
        } else {
            self.width
        }
    }

    /// A turn goes no farther than a page either way: beyond it there is no
    /// page to show.
    fn within_a_page(&self, offset: f64) -> f64 {
        if self.width > 0.0 {
            clamp(offset, -self.width, self.width)
        } else {
            offset
        }
    }

    /// What a turn beginning now starts from: what the host's physics make
    /// of what the turn it cut into left, else that itself, or rest. A turn
    /// that begins elsewhere shows nothing of the one it cut into.
    fn beginning(&self, begin: Option<Begin>) -> (f64, f64, Option<Leaving>) {
        let Some(left) = self.leftover() else {
            return (0.0, 0.0, None);
        };
        let at = begin.unwrap_or(Begin {
            offset: left.offset,
            velocity: left.velocity,
        });
        let leaving = (at.offset == left.offset).then_some(left.leaving);
        (at.offset, at.velocity, leaving)
    }

    fn settle_to(&mut self, target: f64) {
        self.target = target;
        self.phase = TurnPhase::Settling;
        self.from = 0.0;
        self.start_settle(self.offset, target);
    }

    fn start_settle(&mut self, from: f64, to: f64) {
        self.settle = Some(if self.host_settles {
            Settle::Host
        } else {
            Settle::Spring(SpringSettle::new(
                self.physics.spring,
                from,
                self.velocity,
                to,
            ))
        });
        self.request = SettleRequest {
            generation: self.request.generation + 1,
            from,
            velocity: self.velocity,
            to,
        };
        self.elapsed = 0.0;
        self.shift = 0.0;
    }
}
