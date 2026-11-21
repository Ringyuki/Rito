//! The page turns of a reader, whatever they look like: when a turn begins
//! and ends, when the reader lands it, what a finger, a key or a jump does
//! to a turn on screen, and a turn waiting for the page it brings in. The
//! motion of each turn is [`TurnMotion`]'s.
//!
//! The host tells it what happens (a finger, a key, the reader landed a
//! turn, a page arrived, a frame's seconds), each time with what it knows of
//! the pages ([`TurnPages`]), and carries out what it asks
//! ([`TurnAction`]): land a turn on the reader, fetch a page, say a turn
//! began or ended. Where a turn's physics are the host's own, the
//! controller asks ([`TurnRequest`]) and waits for the answer.
//!
//! One start and exactly one end for every turn. A turn commits on the
//! reader the moment it is decided, so the page is ready when the animation
//! arrives. A turn or a finger that comes while a turn is on screen cuts
//! into it: that turn ends as soon as the reader has landed it, wherever
//! its picture is, and the picture carries on for the turn that cut in to
//! begin from.

use std::collections::VecDeque;

use crate::spring::At;
use crate::turn_motion::{Begin, Leftover, Neighbour, TurnMotion, TurnPhase, TurnStep};
use crate::turn_physics::{TurnPhysics, TurnRelease};

/// The way a turn goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Next,
    Previous,
}

impl Direction {
    fn forward(self) -> bool {
        self == Self::Next
    }

    fn of_travel(travel: f64) -> Self {
        if travel < 0.0 {
            Self::Next
        } else {
            Self::Previous
        }
    }
}

/// One thing for each way: next, then previous.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Sides {
    pub next: bool,
    pub previous: bool,
}

impl Sides {
    fn of(self, direction: Direction) -> bool {
        match direction {
            Direction::Next => self.next,
            Direction::Previous => self.previous,
        }
    }
}

/// What the host knows of the pages beside the one shown, as it tells the
/// controller anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TurnPages {
    /// Whether a page lies that way.
    pub can_turn: Sides,
    /// Whether that page is in its slot, painted.
    pub there: Sides,
    /// Whether the effect can draw a turn that way now (it may have to take
    /// the page where it draws from first).
    pub drawable: Sides,
    /// Whether a page lies that way beyond the one the turn on screen brings
    /// in: where a key pressed during the turn would go.
    pub beyond: Sides,
}

/// How a turn ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnOutcome {
    /// It landed on its neighbour.
    Committed,
    /// It went back to the page it left.
    Cancelled,
    /// A jump or a relayout ended it wherever it was.
    Interrupted,
}

/// What the host is to do.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TurnAction {
    /// A turn began.
    Started(Direction),
    /// A turn ended. Committed, the page it brought in is the page shown now;
    /// `carries`, the picture goes on moving (what is left of it), the page
    /// it left beside the page it landed on.
    Ended {
        direction: Direction,
        outcome: TurnOutcome,
        carries: bool,
    },
    /// Land the turn on the reader; tell [`TurnController::landed`] how it went.
    Land(Direction),
    /// Bring the page that way into its slot; tell [`TurnController::pages`] once it is.
    Fetch(Direction),
    /// The effect cannot draw the page yet: wait `seconds` for it, then tell
    /// [`TurnController::overdue`].
    WaitForEffect { seconds: f64 },
    /// What was left of a turn that was cut into came to rest: the page it
    /// left is no longer in the frame.
    Rested,
}

/// What the controller asks of physics of the host's own, waiting for the
/// answer before it does anything else.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TurnRequest {
    /// Where a turn that cuts into what is left of another begins:
    /// [`TurnController::answer_begin`].
    Begin {
        leftover: Leftover,
        forward: bool,
        has_incoming: bool,
    },
    /// Whether a release turns the page: [`TurnController::answer_lands`].
    Lands(TurnRelease),
}

/// What moves the turn the frame shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FramePhase {
    Held,
    Landing,
    Returning,
}

/// A point of the frame a turn is drawn in.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// The finger that moved a turn: where it took hold, where it is, and where
/// it was when it had carried the turn farthest the way the turn goes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Touch {
    pub origin: Point,
    pub position: Point,
    pub farthest: Point,
}

/// What a frame of the turn on screen shows.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TurnFrame {
    pub offset: f64,
    pub incoming: Option<Neighbour>,
    pub phase: FramePhase,
    pub velocity: f64,
    pub touch: Option<Touch>,
}

/// How long a turn waits for its effect before it begins regardless, seconds.
pub const EFFECT_PATIENCE: f64 = 0.5;

/// The most turns asked for while one is on screen that wait their turn.
const PENDING_AT_MOST: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq)]
struct Open {
    direction: Direction,
    committing: bool,
    landing: bool,
    landed: Option<bool>,
    /// A jump played as a turn, held still until the effect can draw it.
    held: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FingerState {
    /// No finger holds the turn.
    Away,
    /// A finger holds it, or is about to with its first move.
    Holding,
    /// A finger came down on a turn and takes hold once that turn is over.
    Waiting,
    /// One that lifted while it waited: its turn is still made, and let go at once.
    LiftedWaiting,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Finger {
    state: FingerState,
    origin: Point,
    position: Point,
    travel: f64,
    resisted: Option<f64>,
    /// When it was last heard of, ms.
    at: f64,
    /// When it took hold, ms: where its speed is measured from.
    took_hold: f64,
    /// How far it carried the turn at its farthest, and where it was then.
    farthest: Option<(f64, Point)>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Awaiting {
    direction: Direction,
    by_key: bool,
    lifted: bool,
    /// The effect is waited for, and its patience ran out.
    effect_waited: bool,
    overdue: bool,
}

/// What to do once physics of the host's own have answered.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Asked {
    BeginDrag {
        forward: bool,
        has_incoming: bool,
        release: bool,
    },
    BeginTurn {
        forward: bool,
    },
    Release,
}

/// The page turns of a reader. See the module.
#[derive(Debug, Clone)]
pub struct TurnController {
    motion: TurnMotion,
    open: Option<Open>,
    /// A pull against the end of the book: the finger moves the page, and
    /// it is no turn.
    pulling: bool,
    finger: Finger,
    pending: VecDeque<Direction>,
    awaiting: Option<Awaiting>,
    asked: Option<(Asked, TurnRequest)>,
    actions: VecDeque<TurnAction>,
    instant: bool,
    /// What the host last said of the pages.
    pages: TurnPages,
}

impl TurnController {
    pub fn new(physics: TurnPhysics) -> Self {
        Self {
            motion: TurnMotion::new(physics),
            open: None,
            pulling: false,
            finger: Finger {
                state: FingerState::Away,
                origin: Point::default(),
                position: Point::default(),
                travel: 0.0,
                resisted: None,
                at: 0.0,
                took_hold: 0.0,
                farthest: None,
            },
            pending: VecDeque::new(),
            awaiting: None,
            asked: None,
            actions: VecDeque::new(),
            instant: false,
            pages: TurnPages::default(),
        }
    }

    pub fn motion(&self) -> &TurnMotion {
        &self.motion
    }

    /// The built-in rules' numbers and the page width a turn travels.
    pub fn configure(&mut self, physics: TurnPhysics, width: f64) {
        self.motion.set_physics(physics);
        self.motion.set_width(width);
    }

    /// Whether turns land at once (an effect that does not animate).
    pub fn set_instant(&mut self, instant: bool) {
        self.instant = instant;
    }

    /// The next thing the host is to do, if any.
    pub fn take_action(&mut self) -> Option<TurnAction> {
        self.actions.pop_front()
    }

    /// What the controller waits to be told by the host's physics.
    pub fn request(&self) -> Option<TurnRequest> {
        self.asked.map(|(_, request)| request)
    }

    /// The direction of the turn on screen; none when no turn is.
    pub fn turning(&self) -> Option<Direction> {
        self.open.map(|open| open.direction)
    }

    /// Whether anything is on screen: a turn, a pull against the end of the
    /// book, or what is left of a turn that was cut into.
    pub fn moving(&self) -> bool {
        self.open.is_some() || self.motion.phase() != TurnPhase::Idle
    }

    /// Whether a finger holds the page.
    pub fn held(&self) -> bool {
        self.finger.state == FingerState::Holding
    }

    /// The frame an effect paints; none with nothing on screen.
    pub fn frame(&self) -> Option<TurnFrame> {
        let phase = self.motion.phase();
        if self.open.is_none() && !self.pulling && phase != TurnPhase::Finishing {
            return None;
        }
        let committing = self.open.is_some_and(|open| open.committing);
        let frame_phase = if phase == TurnPhase::Dragging {
            FramePhase::Held
        } else if committing && phase != TurnPhase::Finishing && !self.motion.on_far_side() {
            FramePhase::Landing
        } else {
            FramePhase::Returning
        };
        let touch = (self.open.is_some() || self.pulling)
            .then(|| self.touch())
            .flatten();
        Some(TurnFrame {
            offset: self.motion.offset(),
            incoming: self.motion.showing(),
            phase: frame_phase,
            velocity: self.motion.velocity(),
            touch,
        })
    }

    /// The release a finger letting go now would make.
    pub fn release_info(&self) -> TurnRelease {
        self.motion.release_info()
    }

    fn touch(&self) -> Option<Touch> {
        let (_, farthest) = self.finger.farthest?;
        Some(Touch {
            origin: self.finger.origin,
            position: self.finger.position,
            farthest,
        })
    }

    // --- Fingers -------------------------------------------------------

    /// A finger came down at `origin` at `at` ms and has since moved far
    /// enough, the way pages turn, to mean a drag: where and when it came
    /// down is where and when it took hold, and its speed is measured from
    /// there. On a turn on screen it cuts into it, and takes the page once
    /// that turn is over; a turn still waiting for its page gives way to
    /// it, as to a newer key.
    pub fn finger_down(&mut self, pages: TurnPages, origin: Point, at: f64) {
        self.pages = pages;
        self.answer_pending_with_defaults();
        self.awaiting = None;
        self.finger = Finger {
            state: FingerState::Holding,
            origin,
            position: origin,
            travel: 0.0,
            resisted: None,
            at,
            took_hold: at,
            farthest: None,
        };
        if self.open.is_some() {
            self.finger.state = FingerState::Waiting;
            self.settle_open();
        }
    }

    /// The finger is at `position`, having carried the turn `travel` px
    /// since it took hold (the host's physics read it); `resisted` is what
    /// those physics make of the travel against the end of the book, none
    /// for the built-in stretch.
    pub fn finger_move(
        &mut self,
        pages: TurnPages,
        position: Point,
        travel: f64,
        resisted: Option<f64>,
        at: f64,
    ) {
        self.pages = pages;
        self.answer_pending_with_defaults();
        self.finger.position = position;
        self.finger.travel = travel;
        self.finger.resisted = resisted;
        self.finger.at = at;
        if self.finger.state != FingerState::Holding {
            return;
        }
        if let Some(awaiting) = self.awaiting {
            self.track(awaiting.direction.forward());
            return;
        }
        if self.open.is_none() && !self.pulling && self.motion.phase() != TurnPhase::Dragging {
            if travel == 0.0 {
                return;
            }
            self.begin_by_finger(Direction::of_travel(travel), false);
            return;
        }
        self.follow();
    }

    /// The finger lifted at `position`; the turn goes on as fast as the
    /// finger was carrying it.
    pub fn finger_up(&mut self, pages: TurnPages, position: Point, travel: f64, at: f64) {
        self.pages = pages;
        self.answer_pending_with_defaults();
        let state = self.finger.state;
        self.finger.state = FingerState::Away;
        if state == FingerState::Waiting {
            self.finger.position = position;
            self.finger.travel = travel;
            self.finger.at = at;
            self.finger.state = FingerState::LiftedWaiting;
            return;
        }
        if state != FingerState::Holding {
            return;
        }
        self.finger.position = position;
        self.finger.travel = travel;
        self.finger.at = at;
        if let Some(awaiting) = self.awaiting.as_mut() {
            awaiting.lifted = true;
            let forward = awaiting.direction.forward();
            self.track(forward);
            return;
        }
        if self.motion.phase() != TurnPhase::Dragging {
            return;
        }
        self.follow();
        self.release();
    }

    /// The finger was taken away (another gesture won): the page goes back.
    /// A turn it let go of already goes where its release sent it.
    pub fn finger_cancel(&mut self, pages: TurnPages) {
        self.pages = pages;
        self.answer_pending_with_defaults();
        let state = self.finger.state;
        self.finger.state = FingerState::Away;
        if state != FingerState::Holding {
            return;
        }
        if self.awaiting.is_some_and(|awaiting| !awaiting.by_key) {
            self.awaiting = None;
            return;
        }
        if self.motion.phase() == TurnPhase::Dragging {
            self.motion.cancel();
        }
    }

    fn track(&mut self, forward: bool) {
        let travel = self.finger.travel;
        let farther =
            self.finger.farthest.is_none_or(
                |(far, _)| {
                    if forward {
                        travel < far
                    } else {
                        travel > far
                    }
                },
            );
        if farther {
            self.finger.farthest = Some((travel, self.finger.position));
        }
    }

    /// The motion follows the finger.
    fn follow(&mut self) {
        let forward = self.motion.forward();
        self.track(forward);
        match self.finger.resisted.filter(|_| !self.motion.has_incoming()) {
            Some(carried) => self.motion.drag_carried(carried, self.finger.at),
            None => self.motion.drag(self.finger.travel, self.finger.at),
        }
    }

    /// A finger's turn `direction`: a pull against the end of the book when
    /// no page lies that way, else a turn, now or once its page is ready.
    fn begin_by_finger(&mut self, direction: Direction, release: bool) {
        if !self.pages.can_turn.of(direction) {
            self.pulling = true;
            self.begin_motion(Asked::BeginDrag {
                forward: direction.forward(),
                has_incoming: false,
                release,
            });
            return;
        }
        if self.wait_for(direction, false) {
            self.track(direction.forward());
            return;
        }
        self.start(direction, true);
        self.begin_motion(Asked::BeginDrag {
            forward: direction.forward(),
            has_incoming: true,
            release,
        });
    }

    fn release(&mut self) {
        if self.motion.has_incoming() {
            self.ask(
                Asked::Release,
                TurnRequest::Lands(self.motion.release_info()),
            );
            return;
        }
        self.finish_release(None);
    }

    fn finish_release(&mut self, lands: Option<bool>) {
        if self.motion.release(lands) {
            self.commit();
        }
    }

    // --- Keys and taps -------------------------------------------------

    /// Turns to the neighbour `direction` (a tap, a key). True when the
    /// command was taken; false at the end of the book, or while a finger
    /// holds the page.
    pub fn command(&mut self, pages: TurnPages, direction: Direction) -> bool {
        self.pages = pages;
        self.answer_pending_with_defaults();
        if self.finger.state == FingerState::Holding {
            return false;
        }
        let Some(open) = self.open else {
            if !pages.can_turn.of(direction) {
                return false;
            }
            if let Some(awaiting) = self.awaiting.as_mut() {
                // A newer command takes the place of the one waiting for its page.
                awaiting.direction = direction;
                awaiting.by_key = true;
                self.resume_awaiting();
                return true;
            }
            self.turn_now(direction);
            return true;
        };
        if direction == open.direction && !open.committing && pages.can_turn.of(direction) {
            // The turn on screen is sent on to the neighbour after all.
            self.motion.turn(direction.forward(), None);
            self.commit();
            return true;
        }
        if direction == open.direction && !pages.beyond.of(direction) {
            return false;
        }
        if self.pending.len() < PENDING_AT_MOST {
            self.pending.push_back(direction);
        }
        self.settle_open();
        true
    }

    fn turn_now(&mut self, direction: Direction) {
        if self.wait_for(direction, true) {
            return;
        }
        self.start(direction, false);
        self.begin_motion(Asked::BeginTurn {
            forward: direction.forward(),
        });
    }

    /// A jump the reader has already made, played as a turn `direction`
    /// from the page it left: decided and landed, held still until the
    /// effect can draw it.
    pub fn play_jump(&mut self, pages: TurnPages, direction: Direction) {
        self.pages = pages;
        self.answer_pending_with_defaults();
        self.interrupt();
        self.finger.farthest = None;
        self.open = Some(Open {
            direction,
            committing: true,
            landing: false,
            landed: Some(true),
            held: false,
        });
        self.actions.push_back(TurnAction::Started(direction));
        if pages.drawable.of(direction) {
            self.motion.turn(direction.forward(), None);
        } else {
            if let Some(open) = self.open.as_mut() {
                open.held = true;
            }
            self.actions.push_back(TurnAction::WaitForEffect {
                seconds: EFFECT_PATIENCE,
            });
        }
    }

    // --- The reader and the pages ------------------------------------

    /// The reader landed the turn on screen (`ok`), or could not.
    pub fn landed(&mut self, pages: TurnPages, ok: bool) {
        self.pages = pages;
        self.answer_pending_with_defaults();
        if let Some(open) = self.open.as_mut() {
            if open.landing {
                open.landing = false;
                open.landed = Some(ok);
            }
        }
        self.settle_open();
    }

    /// What the host knows of the pages changed: a page arrived, the effect
    /// can draw one now, a neighbour came to be or went.
    pub fn pages(&mut self, pages: TurnPages) {
        self.pages = pages;
        self.answer_pending_with_defaults();
        if let Some(open) = self.open {
            if open.held && pages.drawable.of(open.direction) {
                if let Some(open) = self.open.as_mut() {
                    open.held = false;
                }
                self.motion.turn(open.direction.forward(), None);
                return;
            }
        }
        self.resume_awaiting();
    }

    /// The effect was waited for as long as it may be: what waits for it
    /// begins, drawn as the effect can.
    pub fn overdue(&mut self, pages: TurnPages) {
        self.pages = pages;
        self.answer_pending_with_defaults();
        if let Some(open) = self.open.as_mut() {
            if open.held {
                open.held = false;
                let forward = open.direction.forward();
                self.motion.turn(forward, None);
                return;
            }
        }
        if let Some(awaiting) = self.awaiting.as_mut() {
            awaiting.overdue = true;
        }
        self.resume_awaiting();
    }

    /// Something else moved the reader (a jump, a relayout): nothing that
    /// was on its way carries on, a finger's drag included.
    pub fn interrupt(&mut self) {
        self.asked = None;
        self.motion.reset();
        self.pending.clear();
        self.awaiting = None;
        self.pulling = false;
        if self.finger.state != FingerState::Away {
            self.finger.state = FingerState::Away;
        }
        self.end(TurnOutcome::Interrupted, false);
    }

    /// Something the reader is asked directly (a selection, a position)
    /// ends what is on screen at once, where its turn was going: a turn
    /// decided and landed lands, any other goes back, and nothing carries
    /// on; nothing waiting begins.
    pub fn settle_now(&mut self) {
        self.asked = None;
        self.pending.clear();
        self.awaiting = None;
        self.pulling = false;
        self.finger.state = FingerState::Away;
        let committed = self
            .open
            .is_some_and(|open| open.committing && open.landed == Some(true));
        self.motion.reset();
        self.end(
            if committed {
                TurnOutcome::Committed
            } else {
                TurnOutcome::Cancelled
            },
            false,
        );
    }

    /// Moves what is on screen on by `seconds`. While the host's physics
    /// carry the motion, `host` is where it is then, from its first step.
    pub fn step(&mut self, pages: TurnPages, seconds: f64, host: Option<At>) {
        self.pages = pages;
        self.answer_pending_with_defaults();
        let finishing = self.motion.phase() == TurnPhase::Finishing;
        match self.motion.step(seconds, host, self.instant) {
            TurnStep::Settled { .. } => {
                if self.open.is_none() {
                    // A pull against the end of the book back at rest.
                    self.pulling = false;
                }
                self.settle_open();
            }
            TurnStep::Rested if finishing => self.actions.push_back(TurnAction::Rested),
            _ => {}
        }
    }

    // --- Answers -------------------------------------------------------

    /// Where the host's physics begin the turn [`TurnRequest::Begin`] asked
    /// about; none for the built-in rule.
    pub fn answer_begin(&mut self, begin: Option<Begin>) {
        let Some((asked, TurnRequest::Begin { .. })) = self.asked else {
            return;
        };
        self.asked = None;
        self.go_on(asked, begin);
    }

    /// Whether the release [`TurnRequest::Lands`] asked about turns the page,
    /// as the host's physics say; none for the built-in rule.
    pub fn answer_lands(&mut self, lands: Option<bool>) {
        let Some((Asked::Release, TurnRequest::Lands(_))) = self.asked else {
            return;
        };
        self.asked = None;
        self.finish_release(lands);
    }

    /// A host that tells something new while a question is open meant the
    /// built-in rule.
    fn answer_pending_with_defaults(&mut self) {
        while let Some((asked, request)) = self.asked.take() {
            match request {
                TurnRequest::Begin { .. } => self.go_on(asked, None),
                TurnRequest::Lands(_) => self.finish_release(None),
            }
        }
    }

    fn ask(&mut self, asked: Asked, request: TurnRequest) {
        self.asked = Some((asked, request));
    }

    /// Begins the motion of a turn: from what a turn it cut into left, as
    /// the host's physics say (asked first), or from rest.
    fn begin_motion(&mut self, asked: Asked) {
        let (forward, has_incoming) = match asked {
            Asked::BeginDrag {
                forward,
                has_incoming,
                ..
            } => (forward, has_incoming),
            Asked::BeginTurn { forward } => (forward, true),
            Asked::Release => return,
        };
        match self.motion.leftover() {
            Some(leftover) => self.ask(
                asked,
                TurnRequest::Begin {
                    leftover,
                    forward,
                    has_incoming,
                },
            ),
            None => self.go_on(asked, None),
        }
    }

    fn go_on(&mut self, asked: Asked, begin: Option<Begin>) {
        match asked {
            Asked::BeginDrag {
                forward,
                has_incoming,
                release,
            } => {
                self.motion
                    .start_drag(forward, has_incoming, self.finger.took_hold, begin);
                self.follow();
                if release {
                    self.release();
                }
            }
            Asked::BeginTurn { forward } => {
                self.motion.turn(forward, begin);
                self.commit();
            }
            Asked::Release => self.finish_release(None),
        }
    }

    // --- Turns ---------------------------------------------------------

    /// Opens a turn `direction`; one no finger makes keeps nothing of the
    /// last finger's.
    fn start(&mut self, direction: Direction, by_finger: bool) {
        self.end(TurnOutcome::Interrupted, false);
        self.pulling = false;
        if !by_finger {
            self.finger.farthest = None;
        }
        self.open = Some(Open {
            direction,
            committing: false,
            landing: false,
            landed: None,
            held: false,
        });
        self.actions.push_back(TurnAction::Started(direction));
    }

    /// Lands the decided turn on the reader while the animation plays.
    fn commit(&mut self) {
        let Some(open) = self.open.as_mut() else {
            return;
        };
        if open.committing {
            return;
        }
        open.committing = true;
        open.landing = true;
        let direction = open.direction;
        self.actions.push_back(TurnAction::Land(direction));
    }

    /// Ends the turn on screen once it can be ended: when it has come to
    /// rest, or at once when a turn or a finger has cut into it. A turn that
    /// was decided waits for the reader to land it either way; cut into, it
    /// then ends wherever its picture is and the picture carries on.
    fn settle_open(&mut self) {
        let Some(open) = self.open else {
            self.after_turn();
            return;
        };
        if open.held {
            return;
        }
        let phase = self.motion.phase();
        let at_rest = !self.motion.moving() && phase != TurnPhase::Dragging;
        let cut = !self.pending.is_empty() || self.finger.state == FingerState::Waiting;
        if !at_rest && !cut {
            return;
        }
        if open.committing && open.landing {
            return;
        }
        if open.committing && open.landed == Some(false) {
            // The neighbour could not be shown: the page goes back.
            if let Some(open) = self.open.as_mut() {
                open.committing = false;
            }
            self.motion.cancel();
            if !cut {
                return;
            }
        }
        let carries = self.motion.phase() != TurnPhase::Idle && !self.instant;
        let committed = self
            .open
            .is_some_and(|open| open.committing && open.landed == Some(true));
        if carries {
            self.motion.carry_on(committed);
        } else {
            self.motion.reset();
        }
        let outcome = if committed {
            TurnOutcome::Committed
        } else {
            TurnOutcome::Cancelled
        };
        self.end(outcome, carries);
        self.after_turn();
    }

    fn end(&mut self, outcome: TurnOutcome, carries: bool) {
        let Some(open) = self.open.take() else {
            return;
        };
        self.actions.push_back(TurnAction::Ended {
            direction: open.direction,
            outcome,
            carries,
        });
    }

    /// What comes after a turn: the finger that waited takes hold where it
    /// is by now, or the next turn asked for begins.
    fn after_turn(&mut self) {
        let lifted = self.finger.state == FingerState::LiftedWaiting;
        if self.finger.state == FingerState::Waiting || lifted {
            self.finger.state = if lifted {
                FingerState::Away
            } else {
                FingerState::Holding
            };
            self.pending.clear();
            if self.finger.travel != 0.0 {
                let direction = Direction::of_travel(self.finger.travel);
                self.begin_by_finger(direction, lifted);
            }
            return;
        }
        while let Some(direction) = self.pending.pop_front() {
            if self.pages.can_turn.of(direction) {
                self.turn_now(direction);
                return;
            }
        }
    }

    // --- Waiting for a page ------------------------------------------

    /// Waits for the page a turn `direction` brings in when it is to be had
    /// but not in its slot yet, or not yet where the effect can draw it
    /// from; false when the turn can begin now.
    fn wait_for(&mut self, direction: Direction, by_key: bool) -> bool {
        if self.pages.there.of(direction) && self.pages.drawable.of(direction) {
            return false;
        }
        self.awaiting = Some(Awaiting {
            direction,
            by_key,
            lifted: false,
            effect_waited: false,
            overdue: false,
        });
        self.resume_awaiting();
        self.awaiting.is_some()
    }

    /// Takes a waiting turn up again where it stands: its page fetched if
    /// its slot is empty, else the turn begun if the effect can draw it (or
    /// was waited for long enough), else the effect waited for.
    fn resume_awaiting(&mut self) {
        let Some(awaiting) = self.awaiting else {
            return;
        };
        let pages = self.pages;
        let direction = awaiting.direction;
        if !pages.can_turn.of(direction) {
            // The page will not be had.
            self.awaiting = None;
            self.finger.farthest = None;
            return;
        }
        if !pages.there.of(direction) {
            self.actions.push_back(TurnAction::Fetch(direction));
            return;
        }
        if !pages.drawable.of(direction) && !awaiting.overdue {
            if !awaiting.effect_waited {
                if let Some(awaiting) = self.awaiting.as_mut() {
                    awaiting.effect_waited = true;
                }
                self.actions.push_back(TurnAction::WaitForEffect {
                    seconds: EFFECT_PATIENCE,
                });
            }
            return;
        }
        self.awaiting = None;
        if awaiting.by_key {
            self.start(direction, false);
            self.begin_motion(Asked::BeginTurn {
                forward: direction.forward(),
            });
            return;
        }
        if self.finger.state != FingerState::Holding && !awaiting.lifted {
            return;
        }
        self.start(direction, true);
        self.begin_motion(Asked::BeginDrag {
            forward: direction.forward(),
            has_incoming: true,
            release: awaiting.lifted,
        });
    }
}
