//! The leaves in the air, how the led one is brought where it is wanted,
//! the hold a finger takes of one, and a leaf left to come down by itself.
//!
//! The web's tests gave a leaf left alone a motion of their own: an even
//! one, or a spring that is never done. A leaf's motion here is the one it
//! goes by, so those tests are told against that motion: where it has the
//! leaf, and whether it is done.

use super::{assert_close, assert_is};
use crate::aloft::bring;
use crate::curled::curled_flat;
use crate::frame::Scene;
use crate::hold::{hold_of, swung_to, Point, View, NEAREST_HOLD};
use crate::leaf::{lay_leaf, leaf_point, pose_at, LeafGrab, LeafShape};
use crate::leaves::{
    fly, has_landed, in_the_air, keep_in_order, leave_alone, place_in_book, send_off, Leaf, LeafId,
    GONE_BY,
};
use crate::motion::{Alone, At};
use crate::swing::alone_width;

const COLUMNS: usize = 16;
const ROWS: usize = 12;
const TWO: LeafShape = LeafShape {
    spine: 400.0,
    width: 400.0,
    height: 600.0,
};
const ONE: LeafShape = LeafShape {
    spine: 0.0,
    width: 400.0,
    height: 600.0,
};
const VIEW: View = View {
    width: 800.0,
    height: 600.0,
    eye: 1920.0,
};
/// The CSS px a leaf left alone moves by: a frame 400 wide.
const WIDTH: f64 = 400.0;

fn leaf(spread: i64, shown: f64, shape: LeafShape) -> Leaf {
    Leaf {
        id: LeafId(spread as u32),
        spread,
        printed: Some(spread as u64),
        shape,
        curled: (shape.spine == 0.0).then(curled_flat),
        grab: LeafGrab { u: 1.0, v: 0.86 },
        hold: None,
        held_from: None,
        shown,
        speed: 0.0,
        let_go: None,
        flight: None,
        positions: vec![0.0; COLUMNS * ROWS * 3],
        normals: vec![0.0; COLUMNS * ROWS * 3],
    }
}

/// Where its own motion has a leaf on its own way, as it last moved it.
fn own_motion(leaf: &Leaf) -> At {
    let flight = leaf.flight.expect("on its own way");
    let mut motion = flight.motion;
    motion.step(flight.elapsed)
}

fn seen_across(x: f64, z: f64) -> f64 {
    VIEW.width / 2.0 + ((x - VIEW.width / 2.0) * VIEW.eye) / (VIEW.eye - z)
}

mod the_leaves_in_the_air {
    use super::*;

    #[test]
    fn come_in_the_order_of_the_spreads_printed_on_them() {
        let mut book = Vec::new();
        for spread in [12, 10, 13, 11] {
            place_in_book(&mut book, leaf(spread, 0.5, TWO));
        }
        let spreads: Vec<_> = book.iter().map(|placed| placed.spread).collect();
        assert_eq!(spreads, [10, 11, 12, 13]);
    }

    #[test]
    fn are_left_to_come_down_on_the_side_of_the_leaf_being_turned_they_belong_on() {
        let mut book = vec![leaf(10, 0.7, TWO), leaf(11, 0.4, TWO), leaf(12, 0.2, TWO)];
        leave_alone(&mut book, 1, WIDTH);
        // The one before it has been turned and lands left; the one after has not and goes back.
        let to: Vec<_> = book
            .iter()
            .map(|left| left.flight.map(|flight| flight.to))
            .collect();
        assert_eq!(to, [Some(1.0), None, Some(0.0)]);
        for left in &mut book {
            fly(left, 0.1);
        }
        // Each is where its own motion has it, on its own side.
        assert!(book[0].shown > 0.7);
        assert_is(book[0].shown, own_motion(&book[0]).x);
        assert_is(book[1].shown, 0.4);
        assert!(book[2].shown < 0.2);
        assert_is(book[2].shown, own_motion(&book[2]).x);
    }

    #[test]
    fn never_pass_through_each_other_the_leaf_being_turned_takes_along_what_it_would_pass() {
        let mut book = [leaf(10, 0.6, TWO), leaf(11, 0.9, TWO), leaf(12, 0.95, TWO)];
        keep_in_order(&mut book, 1);
        let shown: Vec<_> = book.iter().map(|kept| kept.shown).collect();
        assert_eq!(shown, [0.9, 0.9, 0.9]);

        let mut lower = [leaf(10, 0.1, TWO), leaf(11, 0.3, TWO), leaf(12, 0.2, TWO)];
        keep_in_order(&mut lower, 0);
        let shown: Vec<_> = lower.iter().map(|kept| kept.shown).collect();
        assert_eq!(shown, [0.1, 0.1, 0.1]);
    }

    #[test]
    fn have_landed_a_pixel_short_of_flat_not_when_a_spring_has_crept_the_rest() {
        // Let go fast, it finishes on a spring; in a frame 1200 CSS px wide a thousandth of a
        // turn is more than a pixel, and the spring takes a few frames more to creep that.
        let mut settling = leaf(10, 0.5, TWO);
        settling.speed = 3.0;
        send_off(&mut settling, 1.0, 1200.0);
        assert!(!fly(&mut settling, 0.05));
        assert!(in_the_air(&settling));
        let mut frames = 0;
        while !fly(&mut settling, 1.0 / 60.0) {
            frames += 1;
            assert!(frames < 60, "it never landed");
        }
        assert_is(settling.shown, 1.0);
        assert!(has_landed(&settling));
        // Its spring has not crept the rest of the way.
        assert!(!own_motion(&settling).done);
    }

    #[test]
    fn a_page_curled_over_has_left_the_frame_while_its_motion_is_still_going() {
        let mut leaving = leaf(10, 0.2, ONE);
        send_off(&mut leaving, 1.0, WIDTH);
        // Some of its own way on, it is farther out than its motion has it: by 1 / GONE_BY of it.
        assert!(!fly(&mut leaving, 0.05));
        let own = own_motion(&leaving).x;
        assert_close(leaving.shown, 0.2 + (own - 0.2) / GONE_BY, 6);
        assert!(leaving.shown > own);
        // It is out once its motion has gone that share of the way, and then it has landed.
        let mut frames = 0;
        while !fly(&mut leaving, 0.005) {
            frames += 1;
            assert!(frames < 200, "it never left");
        }
        assert_is(leaving.shown, 1.0);
        assert!(has_landed(&leaving));
        let own = own_motion(&leaving);
        assert!(own.x >= 0.2 + 0.8 * GONE_BY - 1e-9);
        assert!(!own.done);

        // Coming back to lie flat it is as far ahead of its motion, and flat while that still goes.
        let mut returning = leaf(11, 0.6, ONE);
        send_off(&mut returning, 0.0, WIDTH);
        assert!(!fly(&mut returning, 0.05));
        let own = own_motion(&returning).x;
        assert_close(returning.shown, 0.6 - (0.6 - own) / GONE_BY, 6);
        let mut frames = 0;
        while !fly(&mut returning, 0.005) {
            frames += 1;
            assert!(frames < 200, "it never lay flat");
        }
        assert_is(returning.shown, 0.0);
        assert!(!own_motion(&returning).done);
        // A leaf of two pages is never hurried, either way.
        let mut swung = leaf(12, 0.2, TWO);
        send_off(&mut swung, 1.0, WIDTH);
        fly(&mut swung, 0.05);
        assert_close(swung.shown, own_motion(&swung).x, 6);
        let mut swung_back = leaf(13, 0.6, TWO);
        send_off(&mut swung_back, 0.0, WIDTH);
        fly(&mut swung_back, 0.05);
        assert_close(swung_back.shown, own_motion(&swung_back).x, 6);
    }
}

mod how_the_leaf_a_turn_leads_is_brought_where_it_is_wanted {
    use super::*;

    // `bring` is what moves the led leaf on: a leaf seen before, not held, is
    // brought on by the frame's time; one first seen this frame by none; a
    // page held, at once.
    #[test]
    fn no_faster_than_a_jump_of_the_hand_may_be_but_for_a_page_that_is_where_a_finger_has_it() {
        let mut jumped = vec![leaf(5, 0.1, ONE)];
        bring(&mut jumped, 0, 0.9, false, false, 1.0 / 60.0);
        assert_close(jumped[0].shown, 0.1 + 9.0 / 60.0, 9);
        // First seen this frame, with no time gone, it stays where its turn starts from.
        let mut seen = vec![leaf(6, 0.0, ONE)];
        bring(&mut seen, 0, 0.5, false, true, 1.0 / 60.0);
        assert_is(seen[0].shown, 0.0);
        // Under a finger it is where the finger has it, and its speed is what that took.
        let mut held = vec![leaf(7, 0.1, ONE)];
        bring(&mut held, 0, 0.9, true, false, 1.0 / 60.0);
        assert_is(held[0].shown, 0.9);
        assert_close(held[0].speed, 0.8 * 60.0, 6);
    }
}

fn laid(shown: f64) -> Leaf {
    let mut turned = leaf(10, shown, TWO);
    lay_leaf(
        TWO,
        pose_at(TWO, turned.grab, shown),
        COLUMNS,
        ROWS,
        &mut turned.positions,
        &mut turned.normals,
    );
    turned
}

mod the_hold_a_finger_takes_of_a_leaf_in_the_air {
    use super::*;

    #[test]
    fn is_of_the_point_of_the_leaf_showing_under_the_finger() {
        let turned = laid(0.35);
        let u = 12.0 / (COLUMNS - 1) as f64;
        let v = 7.0 / (ROWS - 1) as f64;
        let [x, y, z] = leaf_point(
            TWO,
            pose_at(TWO, turned.grab, 0.35),
            u * TWO.width,
            v * TWO.height,
        );
        let finger = Point {
            x: seen_across(x, z),
            y: VIEW.height / 2.0 + ((y - VIEW.height / 2.0) * VIEW.eye) / (VIEW.eye - z),
        };
        let hold = hold_of(&turned.positions, COLUMNS, ROWS, VIEW, finger);
        assert_close(hold.u, u, 6);
        assert_close(hold.v, v, 6);
        assert_close(hold.offset, 0.0, 3);
    }

    #[test]
    fn is_no_nearer_the_spine_than_a_hand_turns_a_leaf_by_and_keeps_its_distance_from_the_finger() {
        let turned = laid(0.35);
        let hold = hold_of(
            &turned.positions,
            COLUMNS,
            ROWS,
            VIEW,
            Point { x: 395.0, y: 300.0 },
        );
        assert!(hold.u >= NEAREST_HOLD);
        assert!(hold.offset.abs() > 1.0);
    }

    #[test]
    fn leaves_the_leaf_where_it_is_when_the_finger_has_not_moved_and_follows_it_when_it_has() {
        for shown in [0.15, 0.4, 0.62, 0.85] {
            let turned = laid(shown);
            let finger = Point { x: 380.0, y: 420.0 };
            let hold = hold_of(&turned.positions, COLUMNS, ROWS, VIEW, finger);
            assert_close(
                swung_to(TWO, turned.grab, hold, VIEW, finger.x, 1.0),
                shown,
                3,
            );
            // Toward the right the leaf comes back, toward the left it goes on over.
            assert!(swung_to(TWO, turned.grab, hold, VIEW, finger.x + 40.0, 1.0) < shown);
            assert!(swung_to(TWO, turned.grab, hold, VIEW, finger.x - 40.0, 1.0) > shown);
        }
    }
}

mod a_leaf_left_to_come_down_by_itself {
    use super::*;

    #[test]
    fn comes_down_at_the_same_pace_at_any_device_pixel_ratio() {
        let at = |css_pixel: f64| {
            let scene = Scene {
                width: 800.0 * css_pixel,
                height: 600.0 * css_pixel,
                spine: 0.0,
                css_pixel,
            };
            let mut motion = Alone::new(alone_width(scene), 0.4, -1.5, 0.0);
            [0.0, 0.05, 0.1, 0.2, 0.3, 0.5].map(|seconds| motion.step(seconds))
        };
        for dense in [at(2.0), at(3.0)] {
            for (dense, plain) in dense.iter().zip(at(1.0)) {
                assert_is(dense.x, plain.x);
                assert_is(dense.velocity, plain.velocity);
                assert_eq!(dense.done, plain.done);
            }
        }
    }
}
