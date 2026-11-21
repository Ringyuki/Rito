//! The page turns of a reader as both readers' tests told them
//! (`touch-cancel-navigation`, `page_turn_controller`) and as the turn
//! lifecycle every host is held to (`kit/tests/fixtures/turn-lifecycle.json`)
//! says they end.

use crate::turn_controller::{
    Direction, Point, Sides, TurnAction, TurnController, TurnOutcome, TurnPages, TurnRequest,
};
use crate::turn_motion::Begin;
use crate::turn_physics::TurnPhysics;

const BOTH: Sides = Sides {
    next: true,
    previous: true,
};

/// Both neighbours there and drawable, and pages beyond them.
fn ready() -> TurnPages {
    TurnPages {
        can_turn: BOTH,
        there: BOTH,
        drawable: BOTH,
        beyond: BOTH,
    }
}

fn controller() -> TurnController {
    let mut controller = TurnController::new(TurnPhysics::default());
    controller.configure(TurnPhysics::default(), 400.0);
    controller
}

/// Plays the host: takes every action, landing turns at once (`lands`),
/// answering every question with the built-in rule; what it took.
fn host(controller: &mut TurnController, lands: bool) -> Vec<TurnAction> {
    let mut taken = Vec::new();
    loop {
        if let Some(request) = controller.request() {
            match request {
                TurnRequest::Begin { .. } => controller.answer_begin(None),
                TurnRequest::Lands(_) => controller.answer_lands(None),
            }
            continue;
        }
        let Some(action) = controller.take_action() else {
            return taken;
        };
        if let TurnAction::Land(_) = action {
            taken.push(action);
            controller.landed(ready(), lands);
            continue;
        }
        taken.push(action);
    }
}

/// Steps `frames` frames, playing the host after each; what it took.
fn frames(controller: &mut TurnController, frames: usize) -> Vec<TurnAction> {
    let mut taken = Vec::new();
    for _ in 0..frames {
        controller.step(ready(), 1.0 / 60.0, None);
        taken.extend(host(controller, true));
    }
    taken
}

/// Steps until nothing is on screen; what it took.
fn settle(controller: &mut TurnController) -> Vec<TurnAction> {
    let mut taken = Vec::new();
    for _ in 0..600 {
        if !controller.moving() {
            break;
        }
        taken.extend(frames(controller, 1));
    }
    taken
}

fn ends(actions: &[TurnAction]) -> Vec<TurnOutcome> {
    actions
        .iter()
        .filter_map(|action| match action {
            TurnAction::Ended { outcome, .. } => Some(*outcome),
            _ => None,
        })
        .collect()
}

fn starts(actions: &[TurnAction]) -> Vec<Direction> {
    actions
        .iter()
        .filter_map(|action| match action {
            TurnAction::Started(direction) => Some(*direction),
            _ => None,
        })
        .collect()
}

fn at(x: f64) -> Point {
    Point { x, y: 300.0 }
}

/// A finger that comes down at 300 and carries the turn to `to`, a frame
/// (16 ms) a sample from `from_ms`.
fn drag(controller: &mut TurnController, to: f64, from_ms: f64) -> Vec<TurnAction> {
    controller.finger_down(ready(), at(300.0), from_ms);
    let mut taken = host(controller, true);
    for step in 1..=5 {
        let x = 300.0 + (to - 300.0) * f64::from(step) / 5.0;
        controller.finger_move(
            ready(),
            at(x),
            x - 300.0,
            None,
            from_ms + 16.0 * f64::from(step),
        );
        taken.extend(host(controller, true));
    }
    taken
}

fn lift(controller: &mut TurnController, x: f64, ms: f64) -> Vec<TurnAction> {
    lift_at(controller, x, 300.0, ms)
}

/// A finger that came down at `down` lifts at `x`, at `ms`.
fn lift_at(controller: &mut TurnController, x: f64, down: f64, ms: f64) -> Vec<TurnAction> {
    controller.finger_up(ready(), at(x), x - down, ms);
    host(controller, true)
}

mod the_lifecycle_every_host_is_held_to {
    use super::*;

    fn held_to(scenario: &str) -> Vec<TurnOutcome> {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/kit/tests/fixtures/turn-lifecycle.json"
        ))
        .expect("the turn lifecycle");
        fixture["ends"][scenario]
            .as_array()
            .expect("a scenario")
            .iter()
            .map(|outcome| match outcome.as_str() {
                Some("committed") => TurnOutcome::Committed,
                Some("cancelled") => TurnOutcome::Cancelled,
                _ => TurnOutcome::Interrupted,
            })
            .collect()
    }

    #[test]
    fn turn_lands() {
        let mut turns = controller();
        assert!(turns.command(ready(), Direction::Next));
        let mut taken = host(&mut turns, true);
        taken.extend(settle(&mut turns));
        assert_eq!(starts(&taken), [Direction::Next]);
        assert_eq!(ends(&taken), held_to("turn-lands"));
    }

    #[test]
    fn drag_goes_back() {
        let mut turns = controller();
        let mut taken = drag(&mut turns, 290.0, 0.0);
        taken.extend(lift(&mut turns, 290.0, 96.0));
        taken.extend(settle(&mut turns));
        assert_eq!(ends(&taken), held_to("drag-goes-back"));
    }

    #[test]
    fn turn_during_turn() {
        let mut turns = controller();
        turns.command(ready(), Direction::Next);
        let mut taken = host(&mut turns, true);
        taken.extend(frames(&mut turns, 6));
        assert!(turns.command(ready(), Direction::Next));
        taken.extend(host(&mut turns, true));
        taken.extend(settle(&mut turns));
        assert_eq!(starts(&taken), [Direction::Next, Direction::Next]);
        assert_eq!(ends(&taken), held_to("turn-during-turn"));
    }

    #[test]
    fn turn_back_during_turn() {
        let mut turns = controller();
        turns.command(ready(), Direction::Next);
        let mut taken = host(&mut turns, true);
        taken.extend(frames(&mut turns, 6));
        turns.command(ready(), Direction::Previous);
        taken.extend(host(&mut turns, true));
        taken.extend(settle(&mut turns));
        assert_eq!(starts(&taken), [Direction::Next, Direction::Previous]);
        assert_eq!(ends(&taken), held_to("turn-back-during-turn"));
    }

    #[test]
    fn finger_during_turn() {
        let mut turns = controller();
        turns.command(ready(), Direction::Next);
        let mut taken = host(&mut turns, true);
        taken.extend(frames(&mut turns, 6));
        taken.extend(drag(&mut turns, 100.0, 1000.0));
        taken.extend(lift(&mut turns, 100.0, 1096.0));
        taken.extend(settle(&mut turns));
        assert_eq!(ends(&taken), held_to("finger-during-turn"));
    }

    #[test]
    fn finger_rests_during_turn() {
        let mut turns = controller();
        turns.command(ready(), Direction::Next);
        let mut taken = host(&mut turns, true);
        taken.extend(frames(&mut turns, 6));
        turns.finger_down(ready(), at(300.0), 1000.0);
        taken.extend(host(&mut turns, true));
        taken.extend(lift(&mut turns, 300.0, 1050.0));
        taken.extend(settle(&mut turns));
        assert_eq!(ends(&taken), held_to("finger-rests-during-turn"));
    }

    #[test]
    fn jumps_and_relayouts_during_a_turn_or_a_drag() {
        for scenario in ["jump-during-turn", "relayout-during-turn"] {
            let mut turns = controller();
            turns.command(ready(), Direction::Next);
            let mut taken = host(&mut turns, true);
            taken.extend(frames(&mut turns, 3));
            turns.interrupt();
            taken.extend(host(&mut turns, true));
            assert_eq!(ends(&taken), held_to(scenario), "{scenario}");
            assert!(!turns.moving());
        }
        let mut turns = controller();
        let mut taken = drag(&mut turns, 200.0, 0.0);
        turns.interrupt();
        taken.extend(host(&mut turns, true));
        assert_eq!(ends(&taken), held_to("jump-during-drag"));
    }
}

#[test]
fn a_pull_against_the_end_of_the_book_moves_the_page_and_is_no_turn() {
    let mut turns = controller();
    let last = TurnPages {
        can_turn: Sides {
            next: false,
            previous: true,
        },
        ..ready()
    };
    turns.finger_down(last, at(300.0), 0.0);
    turns.finger_move(last, at(200.0), -100.0, None, 10.0);
    let mut taken = host(&mut turns, true);
    let frame = turns.frame().expect("the page moves");
    assert!(frame.offset < 0.0 && frame.offset > -100.0);
    assert_eq!(frame.incoming, None);
    turns.finger_up(last, at(200.0), -100.0, 20.0);
    taken.extend(host(&mut turns, true));
    taken.extend(settle(&mut turns));
    assert!(taken.is_empty(), "{taken:?}");
    assert!(turns.frame().is_none());
}

#[test]
fn every_key_pressed_while_turns_land_turns_a_page() {
    let mut turns = controller();
    let mut taken = Vec::new();
    for _ in 0..3 {
        assert!(turns.command(ready(), Direction::Next));
        // The reader is still landing the turn when the next key comes.
    }
    // Land one turn at a time, as the reader does.
    for _ in 0..3 {
        while let Some(action) = turns.take_action() {
            taken.push(action);
            if let TurnAction::Land(_) = action {
                turns.landed(ready(), true);
            }
        }
    }
    taken.extend(settle(&mut turns));
    assert_eq!(starts(&taken), [Direction::Next; 3]);
    assert_eq!(ends(&taken), [TurnOutcome::Committed; 3]);
}

#[test]
fn a_finger_holding_the_page_keeps_it_from_keys() {
    let mut turns = controller();
    drag(&mut turns, 250.0, 0.0);
    assert!(!turns.command(ready(), Direction::Previous));
    assert!(turns.held());
}

#[test]
fn a_release_decided_is_not_taken_back_by_a_late_cancel() {
    let mut turns = controller();
    let mut taken = drag(&mut turns, 100.0, 0.0);
    taken.extend(lift(&mut turns, 100.0, 96.0));
    turns.finger_cancel(ready());
    taken.extend(host(&mut turns, true));
    taken.extend(settle(&mut turns));
    assert_eq!(ends(&taken), [TurnOutcome::Committed]);
}

#[test]
fn a_key_toward_no_further_page_leaves_the_turn_on_screen_alone() {
    let mut turns = controller();
    turns.command(ready(), Direction::Next);
    host(&mut turns, true);
    let last = TurnPages {
        beyond: Sides {
            next: false,
            previous: true,
        },
        ..ready()
    };
    assert!(!turns.command(last, Direction::Next));
    assert!(turns.turning().is_some(), "the turn goes on");
}

#[test]
fn a_turn_going_back_is_sent_on_by_a_key_its_way() {
    let mut turns = controller();
    let mut taken = drag(&mut turns, 290.0, 0.0);
    taken.extend(lift(&mut turns, 290.0, 96.0));
    taken.extend(frames(&mut turns, 2));
    assert!(turns.command(ready(), Direction::Next));
    taken.extend(host(&mut turns, true));
    taken.extend(settle(&mut turns));
    // One turn, sent on: not a turn back and another.
    assert_eq!(starts(&taken), [Direction::Next]);
    assert_eq!(ends(&taken), [TurnOutcome::Committed]);
}

#[test]
fn a_turn_waits_for_its_page_and_a_newer_key_takes_its_place() {
    let mut turns = controller();
    let away = TurnPages {
        there: Sides::default(),
        ..ready()
    };
    assert!(turns.command(away, Direction::Next));
    assert_eq!(host(&mut turns, true), [TurnAction::Fetch(Direction::Next)]);
    assert!(turns.command(away, Direction::Previous));
    assert_eq!(
        host(&mut turns, true),
        [TurnAction::Fetch(Direction::Previous)]
    );
    turns.pages(ready());
    let taken = host(&mut turns, true);
    assert_eq!(starts(&taken), [Direction::Previous]);
}

#[test]
fn a_finger_takes_the_place_of_a_turn_waiting_for_its_page() {
    let mut turns = controller();
    let away = TurnPages {
        there: Sides {
            next: true,
            previous: false,
        },
        ..ready()
    };
    assert!(turns.command(away, Direction::Previous));
    assert_eq!(
        host(&mut turns, true),
        [TurnAction::Fetch(Direction::Previous)]
    );
    turns.finger_down(away, at(300.0), 0.0);
    turns.finger_move(away, at(250.0), -50.0, None, 16.0);
    let mut taken = host(&mut turns, true);
    // The page the key asked for arrives: the finger's turn is the one on screen.
    turns.pages(ready());
    taken.extend(host(&mut turns, true));
    assert_eq!(starts(&taken), [Direction::Next]);
    assert_eq!(turns.turning(), Some(Direction::Next));
}

#[test]
fn a_turn_waits_for_its_effect_only_so_long() {
    let mut turns = controller();
    let undrawable = TurnPages {
        drawable: Sides::default(),
        ..ready()
    };
    turns.command(undrawable, Direction::Next);
    assert_eq!(
        host(&mut turns, true),
        [TurnAction::WaitForEffect { seconds: 0.5 }]
    );
    turns.overdue(undrawable);
    assert_eq!(starts(&host(&mut turns, true)), [Direction::Next]);
}

#[test]
fn a_turn_the_reader_cannot_land_goes_back() {
    let mut turns = controller();
    turns.command(ready(), Direction::Next);
    let mut taken = host(&mut turns, false);
    taken.extend(settle(&mut turns));
    assert_eq!(ends(&taken), [TurnOutcome::Cancelled]);
    assert!(!turns.moving());
}

#[test]
fn a_turn_that_cuts_in_asks_the_hosts_physics_where_it_begins() {
    let mut turns = controller();
    turns.command(ready(), Direction::Next);
    host(&mut turns, true);
    frames(&mut turns, 6);
    turns.command(ready(), Direction::Next);
    // The first turn ends and leaves its picture; the next asks where it begins.
    while let Some(action) = turns.take_action() {
        if let TurnAction::Land(_) = action {
            turns.landed(ready(), true);
        }
    }
    let Some(TurnRequest::Begin {
        leftover, forward, ..
    }) = turns.request()
    else {
        panic!("no question asked");
    };
    assert!(forward && leftover.offset > 0.0);
    turns.answer_begin(Some(Begin {
        offset: 0.0,
        velocity: 0.0,
    }));
    assert_eq!(turns.frame().expect("a turn").offset, 0.0);
}

#[test]
fn a_finger_that_lifts_while_it_waits_still_makes_its_turn() {
    let mut turns = controller();
    turns.command(ready(), Direction::Next);
    // The reader is slow to land: the finger comes, flicks and lifts meanwhile.
    turns.take_action();
    turns.take_action();
    turns.finger_down(ready(), at(300.0), 100.0);
    turns.finger_move(ready(), at(150.0), -150.0, None, 105.0);
    turns.finger_up(ready(), at(100.0), -200.0, 110.0);
    turns.landed(ready(), true);
    let mut taken = host(&mut turns, true);
    taken.extend(settle(&mut turns));
    assert_eq!(starts(&taken), [Direction::Next]);
    assert_eq!(ends(&taken).len(), 2);
}

#[test]
fn a_finger_is_timed_from_when_it_came_down() {
    let mut turns = controller();
    // Down at 0, past the slop by its first move 30 ms later: 15 px in 30 ms.
    turns.finger_down(ready(), at(300.0), 0.0);
    turns.finger_move(ready(), at(285.0), -15.0, None, 30.0);
    host(&mut turns, true);
    assert!((turns.motion().finger_velocity() + 500.0).abs() < 1e-9);
}

#[test]
fn a_short_drag_held_still_before_it_lifts_goes_back() {
    let mut turns = controller();
    turns.finger_down(ready(), at(250.0), 0.0);
    turns.finger_move(ready(), at(238.0), -12.0, None, 8.0);
    turns.finger_move(ready(), at(232.0), -18.0, None, 24.0);
    let mut taken = host(&mut turns, true);
    taken.extend(lift_at(&mut turns, 232.0, 250.0, 424.0));
    taken.extend(settle(&mut turns));
    assert_eq!(ends(&taken), [TurnOutcome::Cancelled]);
}

#[test]
fn a_finger_that_has_not_moved_turns_nothing() {
    let mut turns = controller();
    turns.finger_down(ready(), at(300.0), 0.0);
    turns.finger_move(ready(), at(300.0), 0.0, None, 5.0);
    assert!(host(&mut turns, true).is_empty());
    assert!(turns.turning().is_none());
}

#[test]
fn a_turn_no_finger_made_says_of_no_finger() {
    let mut turns = controller();
    drag(&mut turns, 100.0, 0.0);
    lift(&mut turns, 100.0, 96.0);
    settle(&mut turns);
    turns.command(ready(), Direction::Next);
    host(&mut turns, true);
    assert!(turns.frame().expect("a turn").touch.is_none());
}

#[test]
fn something_asked_directly_ends_the_turn_where_it_was_going_and_stops_it() {
    let mut turns = controller();
    turns.command(ready(), Direction::Next);
    host(&mut turns, true);
    frames(&mut turns, 3);
    turns.settle_now();
    assert_eq!(
        host(&mut turns, true),
        [TurnAction::Ended {
            direction: Direction::Next,
            outcome: TurnOutcome::Committed,
            carries: false,
        }]
    );
    assert!(!turns.moving());

    drag(&mut turns, 200.0, 2000.0);
    turns.settle_now();
    assert_eq!(ends(&host(&mut turns, true)), [TurnOutcome::Cancelled]);
}
