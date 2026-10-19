//! How a paper turn moves: what a finger carries it by, whether letting go
//! turns the page, how a turn nothing holds comes to rest, a turn that cuts
//! into another, and the spring.

use super::{assert_close, assert_is};
use crate::frame::Touch;
use crate::hold::Point;
use crate::motion::{At, Spring, SpringSettle};
use crate::physics::{grab_of, lands, travel, PaperSettle, Release};
use crate::PaperModel;

/// The width of a frame and where its pages are bound: one page a spread, and two.
const ONE: (f64, f64) = (400.0, 0.0);
const TWO: (f64, f64) = (400.0, 200.0);

fn touch(from_x: f64, to_x: f64) -> Touch {
    touch_at(from_x, to_x, 300.0)
}

fn touch_at(from_x: f64, to_x: f64, y: f64) -> Touch {
    Touch {
        origin: Point { x: from_x, y },
        position: Point { x: to_x, y },
        farthest: None,
    }
}

fn carried(points: &Touch, (width, spine): (f64, f64)) -> f64 {
    travel(points, width, spine)
}

#[track_caller]
fn assert_at(at: At, x: f64, velocity: f64, done: bool) {
    assert_is(at.x, x);
    assert_is(at.velocity, velocity);
    assert_eq!(at.done, done, "done at {}", at.x);
}

mod how_far_a_finger_carries_a_paper_turn {
    use super::*;

    #[test]
    fn keeps_the_held_point_under_the_finger_over_the_spine_at_half_a_turn() {
        // Two pages: taken 180 px right of the spine and carried to it.
        assert_close(carried(&touch(380.0, 200.0), TWO), -200.0, 6);
        assert_is(carried(&touch(380.0, 380.0), ONE), 0.0);
    }

    #[test]
    fn carries_the_edge_of_one_page_as_far_as_the_finger_goes_wherever_it_went_down() {
        // The edge of a page 400 wide comes over the spine after the finger has gone 400: half a turn.
        assert_close(
            carried(&touch(380.0, 180.0), ONE),
            -400.0 * (200.0 / 800.0),
            6,
        );
        assert_close(
            carried(&touch(250.0, 50.0), ONE),
            -400.0 * (200.0 / 800.0),
            6,
        );
        // Back the same: the page before comes in by half what the finger has gone, from nothing.
        assert_close(carried(&touch(60.0, 100.0), ONE), 400.0 * (40.0 / 800.0), 6);
        assert_close(carried(&touch(60.0, 66.0), ONE), 400.0 * (6.0 / 800.0), 6);
    }

    #[test]
    fn turns_back_by_the_sheet_lying_left_of_the_spine() {
        // Two pages: taken 160 px left of the spine and carried to it.
        assert_close(carried(&touch(40.0, 200.0), TWO), 200.0, 6);
    }

    #[test]
    fn takes_a_sheet_no_nearer_the_spine_than_a_hand_could_turn_it_by() {
        assert_is(
            grab_of(Some(&touch(210.0, 200.0)), 400.0, 200.0, 600.0).u,
            0.35,
        );
        let grab = grab_of(Some(&touch_at(390.0, 380.0, 150.0)), 400.0, 200.0, 600.0);
        assert_is(grab.u, 0.95);
        assert_is(grab.v, 0.25);
        // One page is taken by its outer edge, whichever way it is turned.
        assert_is(grab_of(Some(&touch(20.0, 10.0)), 400.0, 0.0, 600.0).u, 1.0);
        assert_is(grab_of(Some(&touch(20.0, 60.0)), 400.0, 0.0, 600.0).u, 1.0);
        // A turn no finger started takes the outer edge, toward the lower corner.
        let unheld = grab_of(None, 400.0, 0.0, 600.0);
        assert_is(unheld.u, 1.0);
        assert_is(unheld.v, 0.86);
    }
}

mod whether_letting_a_paper_turn_go_turns_the_page {
    use super::*;

    fn release(dx: f64, velocity: f64, from_x: f64, to_x: f64) -> bool {
        lands(&Release {
            dx,
            from: 0.0,
            velocity,
            width: 400.0,
            forward: true,
            touch: Some(touch(from_x, to_x)),
            spine: None,
        })
    }

    #[test]
    fn a_pull_of_a_fifth_of_the_way_or_a_flick_does_a_nudge_or_a_pull_back_does_not() {
        assert!(release(-100.0, 0.0, 380.0, 190.0));
        assert!(release(-40.0, -500.0, 380.0, 300.0));
        assert!(!release(-40.0, 0.0, 380.0, 300.0));
        assert!(!release(-8.0, -900.0, 380.0, 365.0));
        assert!(!release(-200.0, 150.0, 380.0, 0.0));
    }
}

mod whether_letting_a_page_curled_over_go_turns_it {
    use super::*;

    /// A finger down at `from`, at `to` when it lifts, having been as far as `farthest`; the turn going at `velocity`.
    fn release(from: f64, to: f64, farthest: f64, velocity: f64, forward: bool) -> bool {
        lands(&Release {
            // Under a finger the page is where the finger is, whatever the turn's own way says.
            dx: (to - from) / 2.0,
            from: 0.0,
            velocity,
            width: 400.0,
            forward,
            touch: Some(Touch {
                farthest: Some(Point {
                    x: farthest,
                    y: 300.0,
                }),
                ..touch(from, to)
            }),
            spine: Some(0.0),
        })
    }

    /// A finger pulling on, lifted where it was farthest, the turn at rest.
    fn pulled(from: f64, to: f64) -> bool {
        release(from, to, to, 0.0, true)
    }

    #[test]
    fn a_pull_out_does_however_short_a_nudge_does_not() {
        assert!(pulled(250.0, 220.0));
        assert!(pulled(250.0, 226.0));
        assert!(!pulled(250.0, 228.0));
        assert!(!pulled(250.0, 250.0));
        // A page brought back goes by the same, the other way.
        assert!(release(60.0, 90.0, 90.0, 0.0, false));
        assert!(!release(60.0, 80.0, 80.0, 0.0, false));
        // Left out, the farthest the finger has been is where it is.
        assert!(lands(&Release {
            dx: -15.0,
            from: 0.0,
            velocity: 0.0,
            width: 400.0,
            forward: true,
            touch: Some(touch(250.0, 220.0)),
            spine: Some(0.0),
        }));
    }

    #[test]
    fn a_finger_come_back_from_its_farthest_does_not_more_of_it_after_a_long_pull() {
        // Out 60, back 20: within what a hand gives as it lifts.
        assert!(release(250.0, 210.0, 190.0, 0.0, true));
        assert!(!release(250.0, 216.0, 190.0, 0.0, true));
        // Out 300 and relaxed by 60 turns still; brought back 90 does not.
        assert!(release(380.0, 140.0, 80.0, 0.0, true));
        assert!(!release(380.0, 170.0, 80.0, 0.0, true));
        // Back past where it came down.
        assert!(!release(250.0, 270.0, 150.0, 0.0, true));
        assert!(!release(60.0, 120.0, 200.0, 0.0, false));
    }

    #[test]
    fn a_finger_flinging_it_back_does_not_whatever_it_had_pulled() {
        // The turn goes half as fast as the finger: 260 a second of it is the finger at 520.
        assert!(!release(250.0, 150.0, 140.0, 260.0, true));
        assert!(release(250.0, 150.0, 140.0, 240.0, true));
        // Going on, however fast, is no reason to go back.
        assert!(release(250.0, 150.0, 150.0, -900.0, true));
        assert!(!release(60.0, 160.0, 170.0, -260.0, false));
    }

    #[test]
    fn is_asked_of_one_page_a_spread_only_a_leaf_of_two_goes_by_how_far_its_turn_has_gone() {
        let leaf = |spine: Option<f64>| {
            lands(&Release {
                dx: -15.0,
                from: 0.0,
                velocity: 0.0,
                width: 400.0,
                forward: true,
                touch: Some(touch(380.0, 350.0)),
                spine,
            })
        };
        assert!(leaf(Some(0.0)));
        assert!(!leaf(Some(200.0)));
        // A caller that does not say where the pages are bound gets the leaf's rule.
        assert!(!leaf(None));
    }
}

/// A turn let go, as `settle` makes it with no frame painted: nothing else in the air, and its page nowhere yet.
fn settle(from: f64, velocity: f64, to: f64) -> PaperSettle {
    PaperSettle::new(from, velocity, to, 0)
}

fn step(settle: &mut PaperSettle, seconds: f64) -> At {
    settle.step(seconds, false, 0, false)
}

mod how_a_paper_turn_comes_to_rest {
    use super::*;

    #[test]
    fn a_leaf_no_finger_turned_is_off_at_once_lands_softly_and_takes_well_under_half_a_second() {
        let mut turn = settle(0.0, 0.0, -800.0);
        let start = step(&mut turn, 0.0);
        assert_is(start.x, 0.0);
        assert!(!start.done);
        // Nearly a quarter of the way in the first fifth of the time, two thirds by half time.
        assert!(step(&mut turn, 0.076).x / -800.0 > 0.22);
        assert_close(step(&mut turn, 0.19).x / -800.0, 0.658, 2);
        let late = step(&mut turn, 0.36).velocity.abs();
        let early = step(&mut turn, 0.1).velocity.abs();
        assert!(late < early / 4.0);
        assert!(!step(&mut turn, 0.37).done);
        // A shorter way takes less time, though never none.
        let mut nudge = settle(-40.0, 0.0, 0.0);
        assert!(step(&mut nudge, 0.15).x < 0.0);
        assert_is(step(&mut nudge, 0.25).x, 0.0);
    }

    #[test]
    fn a_turn_let_go_on_the_move_keeps_its_momentum() {
        let mut turn = settle(-100.0, -900.0, -400.0);
        assert!(step(&mut turn, 0.016).velocity < -700.0);
    }

    #[test]
    fn draws_the_leaf_exactly_where_it_lands_before_the_turn_is_over() {
        let mut turn = settle(0.0, 0.0, -800.0);
        assert_at(step(&mut turn, 0.38), -800.0, 0.0, false);
        assert_at(step(&mut turn, 0.397), -800.0, 0.0, true);
    }
}

mod a_paper_turn_that_cuts_into_another {
    use super::*;

    #[test]
    fn takes_up_the_same_leaf_where_it_is_and_lifts_another_from_flat() {
        let paper = PaperModel::new();
        // Turned back: the same sheet, from where it is and as fast.
        let (dx, velocity) = paper.begins(150.0, -900.0, true);
        assert_is(dx, 150.0);
        assert_is(velocity, -900.0);
        // Turned on: the next sheet starts flat; the one in the air is the effect's to bring down.
        let (dx, velocity) = paper.begins(150.0, -900.0, false);
        assert_is(dx, 0.0);
        assert_is(velocity, 0.0);
    }

    #[test]
    fn is_not_over_while_a_leaf_it_left_in_the_air_is_still_coming_down() {
        let mut aloft = true;
        let mut turn = settle(0.0, 0.0, -800.0);
        turn.step(0.38, aloft, 0, false);
        assert_at(turn.step(0.4, aloft, 0, false), -800.0, 0.0, false);
        assert!(!turn.step(0.6, aloft, 0, false).done);
        aloft = false;
        assert_at(turn.step(0.62, aloft, 0, false), -800.0, 0.0, true);
    }

    #[test]
    fn sent_back_the_way_it_came_slows_to_a_stop_before_it_comes_back() {
        let mut turn = settle(-300.0, -1400.0, 0.0);
        // It carries on, slower and slower, for a tenth of a second.
        assert_close(step(&mut turn, 0.0).velocity, -1400.0, 6);
        assert!(step(&mut turn, 0.05).x < -300.0);
        assert_close(step(&mut turn, 0.05).velocity, -700.0, 6);
        let stopped = step(&mut turn, 0.1);
        assert_close(stopped.x, -370.0, 6);
        assert_close(stopped.velocity, 0.0, 6);
        // Then back at its own pace, never the old way again.
        assert!(step(&mut turn, 0.15).x > stopped.x);
        assert!(step(&mut turn, 0.15).velocity > 0.0);
        assert_is(step(&mut turn, 0.6).x, 0.0);
    }

    #[test]
    fn is_over_a_frame_after_its_page_is_where_it_takes_it_with_its_own_motion_still_on_its_way() {
        let mut painted = 0;
        let mut there = false;
        let mut turn = PaperSettle::new(100.0, 0.0, 400.0, painted);
        assert!(!turn.step(0.05, false, painted, there).done);
        // The page lies flat again, but no frame has shown it so since the turn was let go.
        there = true;
        assert!(turn.step(0.06, false, painted, there).x < 400.0);
        painted = 1;
        assert_at(turn.step(0.08, false, painted, there), 400.0, 0.0, false);
        assert_at(turn.step(0.1, false, painted, there), 400.0, 0.0, true);
    }

    #[test]
    fn with_nowhere_left_to_go_is_there_whatever_speed_it_was_let_go_at() {
        let mut turn = settle(-400.0, -900.0, -400.0);
        assert_at(step(&mut turn, 0.0), -400.0, 0.0, false);
        assert_at(step(&mut turn, 0.016), -400.0, 0.0, true);
    }

    #[test]
    fn is_let_go_by_what_the_finger_carried_it_wherever_the_finger_took_it() {
        let release = |dx: f64, from: f64| {
            lands(&Release {
                dx,
                from,
                velocity: 0.0,
                width: 400.0,
                forward: false,
                touch: Some(touch(100.0, 100.0 + (dx - from))),
                spine: None,
            })
        };
        // Taken 170 px short of lying flat again: a nudge leaves it, a pull of a quarter turns it back.
        assert!(!release(200.0, 170.0));
        assert!(release(270.0, 170.0));
    }
}

mod the_spring_as_a_motion {
    use super::*;

    /// The spring stepped by a frame of `ms` from where it is, its velocity
    /// bounded anew each step as a stepped spring's is, and settled once what
    /// motion remains is sub-pixel.
    fn step_spring(state: (f64, f64), target: f64, config: Spring, ms: f64) -> (f64, f64) {
        let at = SpringSettle::new(config, state.0, state.1, target).at(ms / 1000.0);
        let settled = (at.x - target).abs() < 0.5
            && at.velocity.abs() / crate::math::sqrt(config.stiffness) < 0.5;
        if settled {
            (target, 0.0)
        } else {
            (at.x, at.velocity)
        }
    }

    #[test]
    fn follows_the_path_the_stepped_spring_does() {
        let config = Spring {
            stiffness: 180.0,
            damping: 27.0,
        };
        let settle = SpringSettle::new(config, -60.0, -1200.0, -800.0);
        let mut stepped = (-60.0, -1200.0);
        for frame in 1..=40 {
            stepped = step_spring(stepped, -800.0, config, 16.0);
            let at = settle.at(f64::from(frame) * 0.016);
            assert_close(at.x, stepped.0, 6);
            assert_close(at.velocity, stepped.1, 5);
        }
    }
}
