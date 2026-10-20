//! A curled page under a finger: before the finger has set off, once it
//! has, and once it has let go.

use super::curled_page::{
    coming_to_nothing, edge_gone_at, forward, has_set_off, line_at_height, sheet, PAGE,
    ROLL_RADIUS, SCENE,
};
use super::{assert_close, assert_is};
use crate::curl::line_at;
use crate::curled::{curled_flat, is_there, wanted_curled, Curled};
use crate::frame::{Frame, Incoming, Phase, Scene, Touch};
use crate::hold::Point;
use crate::leaf::LeafShape;
use crate::leaves::{fly, Leaf};
use crate::math::{max, min};
use crate::motion::At;
use crate::swing::LeafTurn;

const FRAME: f64 = 1.0 / 60.0;
type Spot = [f64; 2];

/// A frame of a turn whose finger came down at `from` and is, or was when it let go, at `to`.
fn fingered(phase: Phase, from: Spot, to: Spot) -> Frame {
    Frame {
        dx: 0.0,
        incoming: Some(Incoming::Next),
        phase,
        touch: Some(Touch {
            origin: Point {
                x: from[0],
                y: from[1],
            },
            position: Point { x: to[0], y: to[1] },
            farthest: None,
        }),
    }
}

/// The turn a finger has carried: half its own way across, turning on or bringing back.
fn carried(from: Spot, to: Spot, on: bool) -> LeafTurn {
    let way = if on { from[0] - to[0] } else { to[0] - from[0] };
    let along = min(1.0, max(0.0, way / 800.0));
    LeafTurn {
        forward: on,
        front_is_current: on,
        ..forward(if on { along } else { 1.0 - along })
    }
}

fn placed(leaf: &mut Leaf, of: &Frame, turn: &LeafTurn, seconds: f64) -> f64 {
    leaf.shown = wanted_curled(leaf, SCENE, of, turn, seconds);
    leaf.shown
}

/// Draws the page for its finger, `seconds` after its last frame.
fn drag_for(leaf: &mut Leaf, from: Spot, to: Spot, seconds: f64, on: bool) -> f64 {
    placed(
        leaf,
        &fingered(Phase::Held, from, to),
        &carried(from, to, on),
        seconds,
    )
}

/// Draws the page for its finger a frame after its last, turning on.
fn drag(leaf: &mut Leaf, from: Spot, to: Spot) -> f64 {
    drag_for(leaf, from, to, FRAME, true)
}

/// The finger staying where it is for `frames` more frames.
fn wait(leaf: &mut Leaf, from: Spot, to: Spot, frames: usize) {
    for _ in 0..frames {
        drag(leaf, from, to);
    }
}

/// The finger letting go at `to`, its turn going on (`Landing`) or back.
fn release(leaf: &mut Leaf, phase: Phase, from: Spot, to: Spot) -> f64 {
    placed(
        leaf,
        &fingered(phase, from, to),
        &carried(from, to, true),
        FRAME,
    )
}

/// What the first of a finger's way is eased to, on a page 400 wide.
fn eased(gone: f64) -> f64 {
    (gone * gone) / (gone + 0.008 * 400.0)
}

fn lean_of(leaf: &Leaf) -> f64 {
    leaf.curled.as_ref().map_or(f64::NAN, |curled| curled.lean)
}

/// Where its own motion has a leaf on its own way, as it last moved it.
fn own_motion(leaf: &Leaf) -> At {
    let flight = leaf.flight.expect("on its own way");
    let mut motion = flight.motion;
    motion.step(flight.elapsed)
}

mod a_curled_page_under_a_finger_that_has_yet_to_set_off {
    use super::*;

    #[test]
    fn carries_its_edge_as_far_as_the_finger_has_gone_from_the_first_of_its_way() {
        let mut leaf = sheet(0.0, curled_flat(), 5);
        // The first frame it is drawn in already shows what the finger has gone.
        drag(&mut leaf, [380.0, 300.0], [362.0, 300.0]);
        assert_close(edge_gone_at(&leaf, 300.0), eased(18.0), 0);
        for x in [376.0, 370.0, 364.0, 358.0, 357.0] {
            drag(&mut leaf, [380.0, 300.0], [x, 300.0]);
            assert!((edge_gone_at(&leaf, 300.0) - eased(380.0 - x)).abs() < 0.6);
        }
        assert!(!has_set_off(&leaf));
        // And back again by the way it came.
        assert_is(drag(&mut leaf, [380.0, 300.0], [380.0, 300.0]), 0.0);
        assert_is(drag(&mut leaf, [380.0, 300.0], [395.0, 300.0]), 0.0);
    }

    #[test]
    fn lifts_nothing_for_a_finger_that_goes_up_or_down_only_or_the_other_way() {
        let mut leaf = sheet(0.0, curled_flat(), 5);
        let mut y = 300.0;
        while y >= 100.0 {
            assert_is(drag(&mut leaf, [380.0, 300.0], [380.0, y]), 0.0);
            y -= 4.0;
        }
        // Its turn goes on, and the finger goes back: however far, that is not setting off.
        for x in [390.0, 420.0, 500.0] {
            assert_is(drag(&mut leaf, [300.0, 300.0], [x, 300.0]), 0.0);
        }
        assert!(!has_set_off(&leaf));
    }

    #[test]
    fn keeps_its_distance_from_the_finger_a_slip_from_mid_page_lifts_next_to_nothing() {
        let mut leaf = sheet(0.0, curled_flat(), 5);
        drag(&mut leaf, [200.0, 300.0], [190.0, 300.0]);
        drag(&mut leaf, [200.0, 300.0], [180.0, 300.0]);
        // The finger is 220 from the edge it would be brought to; the edge has gone 17.
        assert!(edge_gone_at(&leaf, 300.0) < 18.0);
        wait(&mut leaf, [200.0, 300.0], [180.0, 300.0], 30);
        assert!(edge_gone_at(&leaf, 300.0) < 18.0);
    }
}

/// A page taken at mid page and mid height, its finger just set off.
struct SetOff {
    leaf: Leaf,
    gap: f64,
    at: Spot,
}

fn set_off_from(from: Spot) -> SetOff {
    let mut leaf = sheet(0.0, curled_flat(), 5);
    let at = [from[0] - 30.0, from[1]];
    drag(&mut leaf, from, [from[0] - 20.0, from[1]]);
    drag(&mut leaf, from, at);
    SetOff {
        leaf,
        gap: 400.0 - at[0] - eased(30.0),
        at,
    }
}

mod a_curled_page_whose_finger_has_set_off {
    use super::*;

    const MID: Spot = [220.0, 300.0];

    #[test]
    fn is_where_it_was_in_the_frame_the_finger_sets_off_and_gathers_way_from_rest() {
        let SetOff { mut leaf, gap, at } = set_off_from(MID);
        assert!(has_set_off(&leaf));
        // That frame is drawn for the finger's own way, as the one before it was.
        assert!((edge_gone_at(&leaf, 300.0) - eased(30.0)).abs() < 0.6);
        // The next has it on its way: begun, and no leap.
        drag(&mut leaf, MID, at);
        let first = edge_gone_at(&leaf, 300.0) - eased(30.0);
        assert!(first > 0.05 * gap);
        assert!(first < 0.14 * gap);
    }

    #[test]
    fn comes_to_the_finger_with_the_finger_at_rest_never_by_much_in_a_frame_and_is_under_it_in_a_quarter_of_a_second(
    ) {
        let SetOff { mut leaf, gap, at } = set_off_from(MID);
        let mut last = edge_gone_at(&leaf, 300.0);
        let mut most = 0.0;
        for _ in 0..15 {
            drag(&mut leaf, MID, at);
            let now = edge_gone_at(&leaf, 300.0);
            assert!(now >= last - 1e-6);
            most = max(most, now - last);
            last = now;
        }
        assert!(most < 0.25 * gap);
        assert!(most > 0.15 * gap);
        // The edge of the paper turned over is where the finger is.
        assert!((last - (400.0 - at[0])).abs() < 0.6);
        // A tenth of a second in it was nine tenths of the way.
        let mut again = set_off_from(MID);
        wait(&mut again.leaf, MID, again.at, 6);
        let left = 400.0 - again.at[0] - edge_gone_at(&again.leaf, 300.0);
        assert!(left < 0.12 * gap);
        assert!(left > 0.06 * gap);
    }

    #[test]
    fn is_under_the_finger_from_there_wherever_the_finger_goes_however_fast_and_back_past_where_it_came_down(
    ) {
        let SetOff { mut leaf, at, .. } = set_off_from(MID);
        wait(&mut leaf, MID, at, 20);
        for (x, y, within) in [
            (120.0, 300.0, 0.6),
            (60.0, 200.0, 1.5),
            (150.0, 420.0, 1.5),
            // Where it came down: the page is not flat again, it is in the hand.
            (220.0, 300.0, 0.6),
            (300.0, 300.0, 0.6),
        ] {
            drag(&mut leaf, MID, [x, y]);
            assert!((edge_gone_at(&leaf, y) - (400.0 - x)).abs() < within);
            // The paper the finger holds is lifted.
            assert!(line_at_height(&leaf, y) < 400.0);
        }
        // Brought to the page's own edge it lies flat.
        assert_is(drag(&mut leaf, MID, [400.0, 300.0]), 0.0);
    }

    #[test]
    fn follows_the_finger_while_it_is_still_coming_to_it() {
        let SetOff { mut leaf, .. } = set_off_from(MID);
        // The finger goes on 12 px a frame as the page comes: the gap closes all the same.
        let mut gap = f64::INFINITY;
        let mut x = 178.0;
        while x >= 22.0 {
            drag(&mut leaf, MID, [x, 300.0]);
            let now = 400.0 - x - edge_gone_at(&leaf, 300.0);
            assert!(now < gap);
            gap = now;
            x -= 12.0;
        }
        assert!(gap.abs() < 0.6);
    }

    #[test]
    fn brought_back_comes_in_until_its_edge_is_under_the_finger_lying_flat_left_of_its_roll() {
        let mut leaf = sheet(1.0, curled_flat(), 5);
        // Before the finger has set off next to nothing shows: a sliver by the spine.
        drag_for(&mut leaf, [30.0, 300.0], [50.0, 300.0], FRAME, false);
        assert!(line_at_height(&leaf, 300.0) > 0.0);
        assert!(line_at_height(&leaf, 300.0) < 8.0);
        // Its edge, out of the frame on the left, has come back just as far as the finger has gone.
        assert!((edge_gone_at(&leaf, 300.0) - (800.0 - 20.0)).abs() < 0.6);
        drag_for(&mut leaf, [30.0, 300.0], [60.0, 300.0], FRAME, false);
        assert!(has_set_off(&leaf));
        let sliver = line_at_height(&leaf, 300.0);
        assert!(sliver < 10.0);
        let mut last = sliver;
        for _ in 0..20 {
            drag_for(&mut leaf, [30.0, 300.0], [60.0, 300.0], FRAME, false);
            assert!(line_at_height(&leaf, 300.0) >= last - 1e-6);
            last = line_at_height(&leaf, 300.0);
        }
        assert!((edge_gone_at(&leaf, 300.0) - 340.0).abs() < 0.6);
        // The paper leaves the page right of the finger: all that is left of it lies flat.
        assert!(last > 60.0);
        for (x, y, within) in [
            (200.0, 300.0, 0.6),
            (320.0, 200.0, 1.5),
            (120.0, 300.0, 0.6),
        ] {
            drag_for(&mut leaf, [30.0, 300.0], [x, y], FRAME, false);
            assert!((edge_gone_at(&leaf, y) - (400.0 - x)).abs() < within);
            // Nearly flat again the edge is still round the roll, which stands a little past the
            // finger: all that is farther left of the finger than the roll is wide lies flat.
            assert!(line_at_height(&leaf, y) > x - ROLL_RADIUS);
        }
    }

    #[test]
    fn leans_over_to_how_it_will_lean_under_the_finger_without_turning_round_the_paper_it_holds_lifted_all_the_way(
    ) {
        for (from, seconds, rises) in [
            // Low on the page and far from its edge: the corner it was peeled by has to stand up.
            ([220.0, 560.0], FRAME, false),
            ([90.0, 560.0], FRAME, false),
            // Free to lean more on its way there than at either end of it: it does not.
            ([220.0, 540.0], FRAME, false),
            // Higher: it could not lean as it was asked to until it had come over.
            ([220.0, 450.0], FRAME / 2.0, true),
        ] {
            let SetOff { mut leaf, at, .. } = set_off_from(from);
            let before = lean_of(&leaf);
            let mut last = before;
            for _ in 0..40 {
                drag_for(&mut leaf, from, at, seconds, true);
                let now = lean_of(&leaf);
                if rises {
                    assert!(now >= last - 1e-9);
                } else {
                    assert!(now <= last + 1e-9);
                }
                assert!(line_at_height(&leaf, from[1]) < 400.0);
                last = now;
            }
            assert!((last - before).abs() > 0.03);
            assert!((edge_gone_at(&leaf, from[1]) - (400.0 - at[0])).abs() < 1.5);
        }
        // Under the finger the corner it is peeled from is beside it: 40 from the corner, 210 gone.
        let mut low = set_off_from([220.0, 560.0]);
        wait(&mut low.leaf, [220.0, 560.0], low.at, 40);
        assert_close(lean_of(&low.leaf), 40.0 / 210.0, 3);
    }

    #[test]
    fn goes_only_to_a_finger_it_is_short_of_one_already_past_its_finger_keeps_its_distance() {
        // In the air, its edge at 223; the finger comes down right of that and draws it on.
        let mut leaf = sheet(0.3, curled_flat(), 5);
        drag(&mut leaf, [350.0, 300.0], [341.0, 300.0]);
        assert_close(leaf.shown, 0.3, 6);
        let taken = edge_gone_at(&leaf, 300.0);
        let mut last = taken;
        for x in [320.0, 320.0, 320.0, 300.0, 300.0, 280.0] {
            drag(&mut leaf, [350.0, 300.0], [x, 300.0]);
            let now = edge_gone_at(&leaf, 300.0);
            // Never back toward the finger, against the way the hand is going.
            assert!(now >= last - 1e-6);
            assert!((now - (taken + 341.0 - x)).abs() < 0.6);
            last = now;
        }
        assert!(has_set_off(&leaf));
        assert!(coming_to_nothing(&leaf));
        // A page gone from the frame is as gone in the frame it is taken in, and stays so.
        let mut gone = sheet(1.0, curled_flat(), 5);
        for x in [250.0, 200.0, 200.0, 200.0] {
            assert_is(drag(&mut gone, [380.0, 300.0], [x, 300.0]), 1.0);
        }
    }

    #[test]
    fn taken_in_the_air_is_where_it_was_whether_or_not_it_is_lifted_where_the_finger_is() {
        for (shown, lean, y) in [
            (0.25, 0.5, 100.0),
            (0.02, 0.5, 300.0),
            (0.4, -0.3, 590.0),
            (0.6, 0.0, 300.0),
            (0.3, 0.3, 560.0),
            // Barely lifted: its edge still shows where it lay.
            (0.01, 0.0, 300.0),
        ] {
            let mut leaf = sheet(
                shown,
                Curled {
                    lean,
                    ..curled_flat()
                },
                5,
            );
            let line = line_at(PAGE, shown, lean);
            // The finger has moved 180 px by the time it takes the page: none of that is the page's.
            let taken = drag(&mut leaf, [380.0, y + 9.0], [200.0, y]);
            assert_close(taken, shown, 5);
            assert_close(line_at(PAGE, taken, lean_of(&leaf)).top, line.top, 2);
            assert_close(line_at(PAGE, taken, lean_of(&leaf)).bottom, line.bottom, 2);
            // A hair's way on, a moment later, is a hair's difference; barely lifted, its line comes
            // in as fast as it does when a page first lifts, and no faster: a share of the roll's
            // radius, for the paper must round the roll before its edge shows coming in.
            let on = drag_for(&mut leaf, [380.0, y + 9.0], [199.0, y], 1e-4, true);
            let most = if shown < 0.02 { 0.7 * ROLL_RADIUS } else { 3.0 };
            assert!((on - taken).abs() * 400.0 < most);
            assert!(on >= taken);
            // And whatever comes of it from there, it does not go back the way it came.
            let mut last = on;
            for _ in 0..12 {
                let now = drag(&mut leaf, [380.0, y + 9.0], [199.0, y]);
                assert!(now >= last - 1e-9);
                last = now;
            }
        }
    }

    #[test]
    fn is_taken_anew_by_a_finger_that_comes_down_again_where_the_last_one_did_and_by_one_that_finds_it_left_to_itself(
    ) {
        let SetOff { mut leaf, at, .. } = set_off_from(MID);
        wait(&mut leaf, MID, at, 20);
        // Let go, it is on its own way; a finger comes down on the very point the last one did.
        release(&mut leaf, Phase::Returning, MID, at);
        fly(&mut leaf, 0.05);
        let flying = leaf.shown;
        assert!(flying < 0.4);
        assert_close(drag(&mut leaf, MID, [214.0, 300.0]), flying, 5);
        assert!(!has_set_off(&leaf));
        // Left to itself while another page was the turn's, and taken up again by the same finger.
        let mut left = set_off_from(MID);
        wait(&mut left.leaf, MID, left.at, 20);
        left.leaf.shown = 0.2;
        if let Some(curled) = left.leaf.curled.as_mut() {
            curled.pace = None;
        }
        assert_close(drag(&mut left.leaf, MID, left.at), 0.2, 5);
    }
}

/// A page held under a finger at 150, mid height, going at `speed` turns a second.
fn held_at(speed: f64) -> Leaf {
    let mut leaf = sheet(0.0, curled_flat(), 5);
    drag(&mut leaf, [220.0, 300.0], [200.0, 300.0]);
    drag(&mut leaf, [220.0, 300.0], [150.0, 300.0]);
    wait(&mut leaf, [220.0, 300.0], [150.0, 300.0], 20);
    leaf.speed = speed;
    leaf
}

/// Flies it to rest as the effect does; returns each place it was drawn at.
fn flown(leaf: &mut Leaf) -> Vec<f64> {
    let mut places = Vec::new();
    for _ in 0..120 {
        if leaf.flight.is_none() {
            break;
        }
        let landed = fly(leaf, FRAME);
        places.push(leaf.shown);
        if !landed {
            continue;
        }
        // It is there while its own motion is still slowing down.
        assert!(!own_motion(leaf).done);
        leaf.flight = None;
    }
    places
}

mod a_curled_page_its_finger_has_let_go {
    use super::*;

    const DOWN: Spot = [220.0, 300.0];
    const UP: Spot = [150.0, 300.0];

    #[test]
    fn finishes_by_itself_from_where_it_is_as_fast_as_it_was_going_and_is_gone_before_its_motion_has_stopped(
    ) {
        let mut leaf = held_at(1.2);
        let held = leaf.shown;
        assert!(held > 0.35);
        // The frame it is let go in shows it where it was.
        assert_is(release(&mut leaf, Phase::Landing, DOWN, UP), held);
        assert_is(leaf.flight.expect("on its own way").to, 1.0);
        assert!(!is_there(&leaf));
        let places = flown(&mut leaf);
        // On at about the pace it had: the page 400 wide went 8 px of line a frame.
        let first = places.first().copied().unwrap_or(0.0);
        assert!(first - held > 0.6 * 1.2 * FRAME);
        assert!(first - held < 3.0 * 1.2 * FRAME);
        let mut before = held;
        for &now in &places {
            assert!(now > before);
            before = now;
        }
        assert_is(*places.last().expect("drawn"), 1.0);
        assert!(places.len() < 16);
        // Its turn finds it there, and is over.
        assert_is(release(&mut leaf, Phase::Landing, DOWN, UP), 1.0);
        assert!(leaf.flight.is_none());
        assert!(is_there(&leaf));
    }

    #[test]
    fn sent_back_lies_flat_again_the_same_way() {
        let mut leaf = held_at(-0.8);
        let held = leaf.shown;
        assert_is(release(&mut leaf, Phase::Returning, DOWN, UP), held);
        assert_is(leaf.flight.expect("on its own way").to, 0.0);
        assert_is(leaf.speed, -0.8);
        let places = flown(&mut leaf);
        let mut before = held;
        for &now in &places {
            assert!(now < before);
            before = now;
        }
        assert_is(*places.last().expect("drawn"), 0.0);
        assert!(places.len() < 16);
        assert_is(release(&mut leaf, Phase::Returning, DOWN, UP), 0.0);
        assert!(is_there(&leaf));
    }

    #[test]
    fn starts_from_rest_when_it_was_going_the_other_way_it_was_coming_to_the_finger_not_carried_by_the_hand(
    ) {
        let mut leaf = held_at(2.5);
        let held = leaf.shown;
        release(&mut leaf, Phase::Returning, DOWN, UP);
        assert_is(leaf.speed, 0.0);
        fly(&mut leaf, FRAME);
        // It does not carry on over before it comes back.
        assert!(leaf.shown < held);
    }

    #[test]
    fn is_left_to_its_own_way_by_a_turn_that_takes_it_the_same_way_and_taken_from_it_by_one_that_does_not(
    ) {
        let mut leaf = held_at(1.2);
        release(&mut leaf, Phase::Landing, DOWN, UP);
        fly(&mut leaf, 0.03);
        let flying = leaf.shown;
        let key = |phase: Phase| Frame {
            touch: None,
            ..fingered(phase, [0.0, 0.0], [0.0, 0.0])
        };
        // A key turns the same page on: it is on its way there already.
        assert_is(
            placed(&mut leaf, &key(Phase::Landing), &forward(0.3), FRAME),
            flying,
        );
        assert_is(leaf.flight.expect("on its own way").elapsed, 0.03);
        // A key turns it back: it keeps step with that turn from where it is.
        let back = key(Phase::Returning);
        assert_is(placed(&mut leaf, &back, &forward(0.5), FRAME), flying);
        assert!(leaf.flight.is_none());
        assert_close(
            placed(&mut leaf, &back, &forward(0.25), FRAME),
            flying / 2.0,
            6,
        );
        // Let go by a finger the other way while on its own way, it is sent off anew from there.
        let mut again = held_at(1.2);
        release(&mut again, Phase::Landing, DOWN, UP);
        fly(&mut again, 0.03);
        let there = again.shown;
        assert_is(release(&mut again, Phase::Returning, DOWN, UP), there);
        let flight = again.flight.expect("on its own way");
        assert_is(flight.to, 0.0);
        assert_is(flight.elapsed, 0.0);
        assert_is(flight.from, there);
    }

    #[test]
    fn goes_by_itself_in_the_same_time_whatever_its_frame_is_drawn_at() {
        let mut plain = held_at(0.4);
        release(&mut plain, Phase::Landing, DOWN, UP);
        // The same page on a canvas of three pixels to each CSS one.
        let mut dense = Leaf {
            shape: LeafShape {
                spine: 0.0,
                width: 1200.0,
                height: 1800.0,
            },
            ..sheet(plain.shown, curled_flat(), 5)
        };
        dense.speed = 0.4;
        let fine = Scene {
            width: 1200.0,
            height: 1800.0,
            spine: 0.0,
            css_pixel: 3.0,
        };
        let let3 = fingered(Phase::Landing, [660.0, 900.0], [450.0, 900.0]);
        wanted_curled(&mut dense, fine, &let3, &forward(0.1), FRAME);
        let mut here = plain.flight.expect("on its own way").motion;
        let mut there = dense.flight.expect("on its own way").motion;
        for seconds in [0.02, 0.08, 0.15, 0.3] {
            let (here, there) = (here.step(seconds), there.step(seconds));
            assert_close(there.x, here.x, 9);
            assert_eq!(there.done, here.done);
        }
    }

    #[test]
    fn let_go_before_any_frame_showed_it_held_turns_from_where_it_lies() {
        let mut leaf = sheet(0.0, curled_flat(), 5);
        assert_is(release(&mut leaf, Phase::Landing, DOWN, UP), 0.0);
        assert_is(leaf.flight.expect("on its own way").to, 1.0);
        assert_is(*flown(&mut leaf).last().expect("drawn"), 1.0);
    }
}
