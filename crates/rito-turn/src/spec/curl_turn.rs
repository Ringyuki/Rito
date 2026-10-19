//! A page curled over, turned by a finger: the whole model, frame by frame,
//! as a host drives it.

use super::{assert_close, assert_is};
use crate::frame::{Frame, Incoming, PageRef, Phase, Scene, Touch};
use crate::hold::Point;
use crate::physics::PaperSettle;
use crate::{Begun, PaperModel};

/// The GPU context the pages are taken in.
const EPOCH: u64 = 1;

/// The paper turn with one page a spread, and how far over the page was in
/// each frame it laid out.
struct Staged {
    model: PaperModel,
    density: f64,
    scene: Scene,
    /// The clock the leaf moves by, in ms.
    now: f64,
    /// The pages before, shown and after: a page is told from another by its buffer.
    pages: Vec<PageRef>,
    places: Vec<f64>,
}

impl Staged {
    fn new(density: f64) -> Self {
        Self {
            model: PaperModel::new(),
            density,
            scene: Scene {
                width: 400.0 * density,
                height: 600.0 * density,
                spine: 0.0,
                css_pixel: density,
            },
            now: 1000.0,
            pages: [3, 4, 5]
                .map(|spread| PageRef {
                    spread,
                    buffer: 1000 + spread as u64,
                })
                .to_vec(),
            places: Vec::new(),
        }
    }

    /// A frame of the turn on to the next page, the finger down at x 220 and at `x`, in CSS px.
    fn frame(&self, phase: Phase, x: f64, dx: f64) -> Frame {
        let density = self.density;
        Frame {
            dx: dx * density,
            incoming: Some(Incoming::Next),
            phase,
            touch: Some(Touch {
                origin: Point {
                    x: 220.0 * density,
                    y: 300.0 * density,
                },
                position: Point {
                    x: x * density,
                    y: 300.0 * density,
                },
                farthest: None,
            }),
        }
    }

    /// Paints a frame `after` ms on; returns how far over the page was drawn.
    fn paint(&mut self, of: Frame, after: f64) -> f64 {
        self.now += after;
        let incoming = match of.incoming {
            Some(Incoming::Next) => self.pages.get(2).copied(),
            Some(Incoming::Prev) => self.pages.first().copied(),
            None => None,
        };
        let current = self.pages.get(1).copied();
        let begun = self
            .model
            .begin(self.scene, of, current, incoming, self.now, EPOCH);
        if let Begun::Turn { .. } = begun {
            self.model.lay(EPOCH).expect("a frame waits");
            // The page first lifted comes first in the book: the one the finger took.
            let shown = self
                .model
                .sheets()
                .iter()
                .find(|sheet| sheet.still.is_none())
                .map_or(f64::NAN, |sheet| sheet.shown);
            self.places.push(shown);
        }
        self.places.last().copied().unwrap_or(f64::NAN)
    }

    /// The finger at `x`, its turn half the finger's way across.
    fn held(&mut self, x: f64, after: f64) -> f64 {
        let frame = self.frame(Phase::Held, x, -(220.0 - x) / 2.0);
        self.paint(frame, after)
    }

    /// Steps a turn let go at `x` to its end as the driver does; returns where each frame drew the page.
    fn let_go(&mut self, settle: &mut PaperSettle, phase: Phase, x: f64) -> Vec<f64> {
        let mut drawn = Vec::new();
        for step in 1..=120 {
            let at = self
                .model
                .settle_step(settle, f64::from(step) * 0.016, self.now);
            if at.done {
                return drawn;
            }
            let frame = self.frame(phase, x, at.x);
            drawn.push(self.paint(frame, 16.0));
        }
        panic!("the turn did not end");
    }

    /// The page taken at mid page and brought under the finger at 150.
    fn under_finger(&mut self) -> f64 {
        self.held(200.0, 16.0);
        self.held(150.0, 16.0);
        let mut last = f64::NAN;
        for _ in 0..20 {
            last = self.held(150.0, 16.0);
        }
        last
    }

    /// The page after it turned by a key, the one the finger had left to itself: how many
    /// frames that one takes to leave.
    fn left_alone(&mut self) -> usize {
        self.pages.remove(0);
        self.pages.push(PageRef {
            spread: 6,
            buffer: 2006,
        });
        let key = Frame {
            touch: None,
            ..self.frame(Phase::Landing, 0.0, 0.0)
        };
        let mut last = self.places.last().copied().unwrap_or(0.0);
        for count in 1..=60 {
            // Once it has left it is out of the book, and the page turned after it is the first drawn.
            let first = self.paint(
                Frame {
                    dx: -(count as f64) * self.density,
                    ..key
                },
                16.0,
            );
            if first < last {
                return count;
            }
            last = first;
        }
        panic!("the page left to itself did not leave");
    }
}

/// Where `value` first is in `drawn`, or -1, as the web looked it up.
fn index_of(drawn: &[f64], value: f64) -> i64 {
    drawn
        .iter()
        .position(|place| *place == value)
        .map_or(-1, |at| at as i64)
}

mod a_page_curled_over_turned_by_a_finger {
    use super::*;

    #[test]
    fn is_where_the_finger_has_it_still_when_a_frame_is_long_in_coming() {
        let mut staged = Staged::new(1.0);
        let under = staged.under_finger();
        assert!(under > 0.35);
        // Half a second without a frame: it is not taken for a page of another turn and begun anew.
        assert_close(staged.held(150.0, 500.0), under, 6);
        assert_close(staged.held(150.0, 16.0), under, 6);
    }

    #[test]
    fn let_go_to_turn_finishes_by_itself_and_its_turn_is_over_as_soon_as_it_is_out_of_the_frame() {
        let mut staged = Staged::new(1.0);
        let under = staged.under_finger();
        let mut settle = staged.model.settle(-35.0, 0.0, -400.0);
        let drawn = staged.let_go(&mut settle, Phase::Landing, 150.0);
        // It is off in the frame it is let go in, from where it was: no leap, and only ever on.
        assert!(drawn.first().copied().unwrap_or(0.0) - under < 0.05);
        let mut before = under;
        for &now in &drawn {
            assert!(now >= before);
            before = now;
        }
        let out = index_of(&drawn, 1.0);
        assert!(out > 4);
        // One frame is drawn of it there, and no more: nothing waits for a motion nobody sees.
        assert!(drawn.len() as i64 - out <= 2);
        assert!(drawn.len() < 16);
    }

    #[test]
    fn let_go_with_its_turn_where_it_began_goes_back_by_itself_and_the_turn_waits_for_it() {
        let mut staged = Staged::new(1.0);
        staged.under_finger();
        // The finger takes it back to where it came down: the turn is at its start, the page in the hand.
        let mut under = f64::NAN;
        let mut x = 160.0;
        while x <= 220.0 {
            under = staged.held(x, 16.0);
            x += 10.0;
        }
        assert!(under > 0.25);
        let mut settle = staged.model.settle(0.0, 0.0, 0.0);
        let drawn = staged.let_go(&mut settle, Phase::Returning, 220.0);
        // It goes on back as it was going: 5 px of line a frame, and a little more to be flat in time.
        let first = drawn.first().copied().unwrap_or(0.0);
        assert!(under - first > 0.01);
        assert!(under - first < 0.03);
        let mut before = under;
        for &now in &drawn {
            assert!(now <= before);
            before = now;
        }
        // It took its time lying down, and the turn was not over before it had.
        let flat = index_of(&drawn, 0.0);
        assert!(flat > 4);
        assert!(drawn.len() as i64 - flat <= 2);
    }

    #[test]
    fn takes_as_long_by_itself_whatever_its_frame_is_drawn_at_let_go_or_left_for_another_page() {
        let let_go_in = |density: f64| {
            let mut staged = Staged::new(density);
            staged.under_finger();
            let mut settle = staged.model.settle(-35.0, 0.0, -400.0);
            staged.let_go(&mut settle, Phase::Landing, 150.0).len()
        };
        assert_eq!(let_go_in(3.0), let_go_in(1.0));
        let left_in = |density: f64| {
            let mut staged = Staged::new(density);
            staged.under_finger();
            staged.left_alone()
        };
        assert!(left_in(1.0) > 5);
        assert_eq!(left_in(3.0), left_in(1.0));
    }

    #[test]
    fn gone_from_the_frame_has_nothing_left_for_a_turn_that_cuts_in_to_carry_on_with() {
        let mut staged = Staged::new(1.0);
        staged.under_finger();
        let mut settle = staged.model.settle(-35.0, 0.0, -400.0);
        let (dx, velocity) = staged.model.begins(-200.0, -900.0, true);
        assert_is(dx, -200.0);
        assert_is(velocity, -900.0);
        staged.let_go(&mut settle, Phase::Landing, 150.0);
        let (dx, velocity) = staged.model.begins(-200.0, -900.0, true);
        assert_is(dx, -200.0);
        assert_is(velocity, 0.0);
    }
}
