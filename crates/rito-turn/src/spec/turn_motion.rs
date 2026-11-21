//! The motion of a page turn as the web kit's and Flutter's tests told it
//! while each host turned pages its own way (`transition-driver`,
//! `page_turn_motion`): one test for each sentence.

use crate::spring::{spring_at, At, Spring};
use crate::turn_motion::{Begin, Neighbour, TurnMotion, TurnPhase, TurnStep};
use crate::turn_physics::TurnPhysics;

fn motion() -> TurnMotion {
    motion_with(TurnPhysics::default())
}

fn motion_with(physics: TurnPhysics) -> TurnMotion {
    let mut motion = TurnMotion::new(physics);
    motion.set_width(400.0);
    motion
}

/// Steps until rest; the offsets the turn passed through.
fn settle(motion: &mut TurnMotion) -> Vec<f64> {
    let mut seen = Vec::new();
    for _ in 0..600 {
        if motion.phase() == TurnPhase::Idle {
            break;
        }
        motion.step(1.0 / 60.0, None, false);
        seen.push(motion.offset());
    }
    seen
}

/// Carries the turn to `travel`, the finger going `velocity` px/s as it
/// gets there: five samples a millisecond apart, from `now` ms.
fn carry(motion: &mut TurnMotion, now: &mut f64, travel: f64, velocity: f64) {
    for i in (0..5).rev() {
        *now += 1.0;
        motion.drag(travel - velocity * f64::from(i) / 1000.0, *now);
    }
}

fn dragged(forward: bool, has_incoming: bool) -> (TurnMotion, f64) {
    let mut motion = motion();
    motion.start_drag(forward, has_incoming, 0.0, None);
    (motion, 0.0)
}

/// Where a motion that takes one second at constant speed is: what a host's
/// own physics might carry a turn on.
fn steady(motion: &TurnMotion, elapsed: f64) -> At {
    let request = motion.settle_request();
    let t = elapsed.clamp(0.0, 1.0);
    At {
        x: request.from + (request.to - request.from) * t,
        velocity: request.to - request.from,
        done: elapsed >= 1.0,
    }
}

fn step_steady(motion: &mut TurnMotion, seconds: f64) -> TurnStep {
    let at = steady(motion, motion.elapsed() + seconds);
    motion.step(seconds, Some(at), false)
}

#[test]
fn a_drag_past_the_threshold_turns_the_page_and_lands_on_it() {
    let (mut motion, mut now) = dragged(true, true);
    carry(&mut motion, &mut now, -60.0, 0.0);
    assert!(motion.release(None));
    let seen = settle(&mut motion);
    assert_eq!(motion.offset(), -400.0);
    assert!(seen.iter().all(|&offset| offset >= -400.0));
}

#[test]
fn a_short_drag_goes_back_unless_it_was_flicked() {
    let (mut slow, mut now) = dragged(true, true);
    carry(&mut slow, &mut now, -10.0, -20.0);
    assert!(!slow.release(None));
    settle(&mut slow);
    assert_eq!(slow.offset(), 0.0);

    let (mut flick, mut now) = dragged(true, true);
    carry(&mut flick, &mut now, -10.0, -500.0);
    assert!(flick.release(None));
}

#[test]
fn dragging_back_past_the_start_or_pulling_back_keeps_the_page() {
    let (mut reversed, mut now) = dragged(true, true);
    carry(&mut reversed, &mut now, 20.0, -900.0);
    assert!(!reversed.release(None));

    let (mut pulling, mut now) = dragged(true, true);
    carry(&mut pulling, &mut now, -200.0, 80.0);
    assert!(!pulling.release(None));
}

#[test]
fn a_released_flick_carries_its_momentum_into_the_spring() {
    let (mut rest, mut now) = dragged(true, true);
    carry(&mut rest, &mut now, -60.0, 0.0);
    rest.release(None);
    let (mut flick, mut now) = dragged(true, true);
    carry(&mut flick, &mut now, -60.0, -2000.0);
    flick.release(None);
    assert!(settle(&mut flick).len() < settle(&mut rest).len());
}

#[test]
fn no_preset_carries_a_turn_past_the_neighbour_however_hard_flicked() {
    for spring in [
        TurnPhysics::STANDARD,
        TurnPhysics::SNAPPY,
        TurnPhysics::GENTLE,
    ] {
        for velocity in [0.0, -800.0, -3000.0, -20000.0] {
            let mut motion = motion_with(TurnPhysics {
                spring,
                ..TurnPhysics::default()
            });
            let mut now = 0.0;
            motion.start_drag(true, true, now, None);
            carry(&mut motion, &mut now, -60.0, velocity);
            motion.release(None);
            let mut lowest: f64 = 0.0;
            for _ in 0..400 {
                if motion.step(1.0 / 120.0, None, false) != TurnStep::Moving {
                    break;
                }
                lowest = lowest.min(motion.offset());
            }
            assert!(lowest >= -400.0, "{spring:?} at {velocity}: {lowest}");
        }
    }
}

#[test]
fn a_turn_traces_the_same_path_whatever_the_frame_rate() {
    let at = |frame: f64| {
        let mut motion = motion();
        motion.turn(true, None);
        let mut t = 0.0;
        while t < 0.3 - 1e-9 {
            motion.step(frame, None, false);
            t += frame;
        }
        motion.offset()
    };
    let reference = at(0.001);
    for frame in [0.006, 0.0075, 0.01, 0.012, 0.015, 0.02, 0.03] {
        assert!((at(frame) - reference).abs() < 1e-6, "{frame}");
    }
}

#[test]
fn the_spring_is_the_curve_both_readers_were_held_to_sample_for_sample() {
    let table: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/kit/tests/fixtures/spring-samples.json"
    ))
    .expect("spring samples");
    let number = |value: &serde_json::Value| value.as_f64().expect("a number");
    for case in table["cases"].as_array().expect("cases") {
        let spring = match case["preset"].as_str() {
            Some("default") => TurnPhysics::STANDARD,
            Some("snappy") => TurnPhysics::SNAPPY,
            Some("gentle") => TurnPhysics::GENTLE,
            _ => Spring {
                stiffness: number(&case["spring"]["stiffness"]),
                damping: number(&case["spring"]["damping"]),
            },
        };
        for sample in case["samples"].as_array().expect("samples") {
            let (offset, velocity) = spring_at(
                spring,
                number(&case["offset"]),
                number(&case["velocity"]),
                number(&sample["t"]),
            );
            assert!((offset - number(&sample["offset"])).abs() < 1e-9);
            assert!((velocity - number(&sample["velocity"])).abs() < 1e-9);
        }
    }
}

mod a_turn_that_is_cut_into {
    use super::*;

    /// A turn to the next page, part of the way there.
    fn in_flight() -> TurnMotion {
        let mut motion = motion();
        motion.turn(true, None);
        for _ in 0..6 {
            motion.step(1.0 / 60.0, None, false);
        }
        motion
    }

    #[test]
    fn carries_its_picture_on_the_page_it_left_still_leaving() {
        let mut motion = in_flight();
        let offset = motion.offset();
        let velocity = motion.velocity();
        assert!(offset < 0.0);

        motion.carry_on(true);

        // The same picture in the coordinates of the page it landed on.
        assert_eq!(motion.phase(), TurnPhase::Finishing);
        assert!((motion.offset() - (offset + 400.0)).abs() < 1e-9);
        assert_eq!(motion.velocity(), velocity);
        assert_eq!(motion.showing(), Some(Neighbour::Previous));
        // Coming to rest is no turn coming to rest: its turn is over.
        let mut steps = Vec::new();
        for _ in 0..600 {
            if !motion.moving() {
                break;
            }
            steps.push(motion.step(1.0 / 60.0, None, false));
            assert!(motion.offset() >= 0.0);
        }
        assert_eq!(steps.last(), Some(&TurnStep::Rested));
        assert!(!steps
            .iter()
            .any(|step| matches!(step, TurnStep::Settled { .. })));
        assert_eq!(motion.phase(), TurnPhase::Idle);
        assert_eq!(motion.offset(), 0.0);
    }

    #[test]
    fn stays_where_it_is_when_it_was_going_back() {
        let (mut motion, now) = dragged(true, true);
        motion.drag(-120.0, now);
        motion.cancel();
        motion.step(1.0 / 60.0, None, false);
        let offset = motion.offset();
        motion.carry_on(false);
        assert_eq!(motion.offset(), offset);
        assert_eq!(motion.showing(), Some(Neighbour::Next));
    }

    #[test]
    fn keeps_the_motion_it_was_on_rather_than_starting_one() {
        let mut motion = motion();
        motion.set_host_settles(true);
        motion.turn(true, None);
        let generation = motion.settle_request().generation;
        step_steady(&mut motion, 0.5);
        assert!((motion.offset() + 200.0).abs() < 1e-9);
        motion.carry_on(true);
        assert_eq!(motion.settle_request().generation, generation);
        // Three quarters of the way through that same second.
        step_steady(&mut motion, 0.25);
        assert!((motion.offset() - 100.0).abs() < 1e-9);
    }

    #[test]
    fn hands_its_picture_and_its_speed_to_the_turn_that_cuts_in() {
        let mut motion = in_flight();
        let offset = motion.offset();
        let velocity = motion.velocity();
        motion.carry_on(true);
        motion.turn(true, None);

        assert_eq!(motion.phase(), TurnPhase::Settling);
        assert!((motion.offset() - (offset + 400.0)).abs() < 1e-9);
        assert_eq!(motion.velocity(), velocity);
        // Still the page that turn was leaving, until this one crosses its start.
        assert!(motion.on_far_side());
        assert_eq!(motion.showing(), Some(Neighbour::Previous));
        let seen = settle(&mut motion);
        assert_eq!(motion.offset(), -400.0);
        assert_eq!(motion.showing(), Some(Neighbour::Next));
        assert!(seen.windows(2).all(|pair| pair[1] <= pair[0]));
    }

    #[test]
    fn is_never_more_than_a_page_from_rest_however_often_it_is_cut_into() {
        let mut motion = motion();
        motion.turn(true, None);
        motion.step(1.0 / 60.0, None, false);
        motion.carry_on(true);
        motion.turn(true, None);
        assert!(motion.offset() > 0.0);
        motion.carry_on(true);
        assert_eq!(motion.offset(), 400.0);
    }

    #[test]
    fn under_a_finger_adds_what_the_finger_carries_and_is_let_go_by_that() {
        let mut motion = in_flight();
        motion.carry_on(true);
        let left = motion.offset();
        assert!(left > 150.0);
        motion.start_drag(true, true, 0.0, None);
        motion.drag(-120.0, 0.0);
        assert!((motion.offset() - (left - 120.0)).abs() < 1e-9);
        // Still short of its own start, and a pull toward the next page all the same.
        assert!(motion.release(None));
    }

    #[test]
    fn against_the_end_of_the_book_resists_the_pull_not_what_was_left() {
        let mut motion = in_flight();
        motion.carry_on(true);
        let left = motion.offset();
        motion.start_drag(true, false, 0.0, None);
        motion.drag(-40.0, 0.0);
        let pulled = motion.offset() - left;
        assert!(pulled < 0.0 && pulled > -40.0);
        assert_eq!(motion.showing(), Some(Neighbour::Previous));
    }

    #[test]
    fn begins_where_its_physics_say_told_what_was_left() {
        let mut motion = in_flight();
        let offset = motion.offset();
        motion.carry_on(true);
        let left = motion.leftover().expect("what was left");
        assert!((left.offset - (offset + 400.0)).abs() < 1e-9);
        assert!(!left.same_pages(true, true));
        motion.turn(
            true,
            Some(Begin {
                offset: 0.0,
                velocity: 0.0,
            }),
        );
        // It starts at rest, and shows nothing of the turn before.
        assert_eq!(motion.offset(), 0.0);
        assert_eq!(motion.showing(), Some(Neighbour::Next));

        motion.carry_on(true);
        assert!(motion
            .leftover()
            .expect("what was left")
            .same_pages(false, true));
    }
}

#[test]
fn a_pull_with_no_neighbour_stretches_and_never_turns() {
    let (mut motion, mut now) = dragged(true, false);
    carry(&mut motion, &mut now, -400.0, -3000.0);
    assert!((motion.offset() + 110.0).abs() < 0.001);
    assert!(!motion.release(None));
    settle(&mut motion);
    assert_eq!(motion.offset(), 0.0);
}

#[test]
fn an_instant_turn_lands_on_its_first_step() {
    let mut motion = motion();
    motion.turn(false, None);
    assert_eq!(
        motion.step(1.0 / 60.0, None, true),
        TurnStep::Settled { committed: true }
    );
    assert_eq!(motion.offset(), 400.0);
}

#[test]
fn a_release_the_host_decides_lands_as_it_says() {
    let (mut motion, mut now) = dragged(true, true);
    carry(&mut motion, &mut now, -10.0, 0.0);
    assert!(motion.release(Some(true)));
    assert_eq!(motion.target(), -400.0);
    // With no neighbour there is nothing to land on, whatever the host says.
    let (mut against, _) = dragged(true, false);
    assert!(!against.release(Some(true)));
}

#[test]
fn a_motion_the_host_carries_moves_the_turn_as_it_says_and_ends_when_it_does() {
    let mut motion = motion();
    motion.set_host_settles(true);
    motion.turn(true, None);
    let request = motion.settle_request();
    assert_eq!(
        (request.from, request.velocity, request.to),
        (0.0, 0.0, -400.0)
    );
    assert_eq!(step_steady(&mut motion, 0.5), TurnStep::Moving);
    assert!((motion.offset() + 200.0).abs() < 1e-9);
    assert_eq!(
        step_steady(&mut motion, 0.5),
        TurnStep::Settled { committed: true }
    );
    assert_eq!(motion.offset(), -400.0);
}

#[test]
fn a_finger_that_takes_a_turn_in_flight_carries_it_from_where_it_is() {
    let mut motion = motion();
    motion.turn(true, None);
    for _ in 0..6 {
        motion.step(1.0 / 60.0, None, false);
    }
    let offset = motion.offset();
    assert!(motion.interrupt(10.0));
    assert_eq!(motion.phase(), TurnPhase::Dragging);
    motion.drag(-20.0, 26.0);
    assert!((motion.offset() - (offset - 20.0)).abs() < 1e-9);
    assert!(!motion.interrupt(30.0));
}

#[test]
fn a_cancelled_turn_goes_back_and_one_going_back_goes_on_as_it_was() {
    let (mut motion, mut now) = dragged(true, true);
    carry(&mut motion, &mut now, -120.0, -300.0);
    assert!(motion.cancel());
    assert_eq!(motion.target(), 0.0);
    let generation = motion.settle_request().generation;
    assert!(motion.cancel());
    assert_eq!(motion.settle_request().generation, generation);
    settle(&mut motion);
    assert!(!motion.cancel());
}

#[test]
fn the_rules_numbers_are_the_ones_both_readers_turned_pages_with() {
    let physics = TurnPhysics::default();
    assert_eq!(physics.spring, TurnPhysics::STANDARD);
    assert_eq!(
        (
            TurnPhysics::STANDARD.stiffness,
            TurnPhysics::STANDARD.damping
        ),
        (180.0, 27.0)
    );
    assert_eq!(
        (TurnPhysics::SNAPPY.stiffness, TurnPhysics::SNAPPY.damping),
        (320.0, 36.0)
    );
    assert_eq!(
        (TurnPhysics::GENTLE.stiffness, TurnPhysics::GENTLE.damping),
        (110.0, 21.0)
    );
    assert_eq!(physics.swipe_threshold, 50.0);
    assert_eq!(physics.velocity_commit, 400.0);
    assert_eq!(physics.projection, 0.15);
    assert_eq!(physics.pull_back, 50.0);
    assert_eq!(physics.elastic_factor, 0.55);
}
