//! How far over a curled page must be for the edge of its paper turned over
//! to be where a finger has it, how a page comes to its finger, and how
//! much a held page leans.

use super::{assert_close, assert_is};
use crate::curl::{curl_through, lay_curl, line_at, CurlLine};
use crate::curl_hold::{edge_gone, got_to, leant_by, shown_for, still_short};
use crate::hold::View;
use crate::leaf::LeafShape;
use crate::math::{max, or_one};

const PHONE: LeafShape = LeafShape {
    spine: 0.0,
    width: 393.0,
    height: 760.0,
};

fn view_of(shape: LeafShape) -> View {
    View {
        width: shape.width,
        height: shape.height,
        eye: 2.4 * max(shape.width, shape.height),
    }
}

/// How far the free edge shows from where it lies flat at the height `y`, read off the page as it is laid out.
fn edge_on_the_mesh(shape: LeafShape, shown: f64, lean: f64, y: f64) -> Option<f64> {
    let columns = 2;
    let rows = 1201;
    let mut positions = vec![0.0; columns * rows * 3];
    let mut normals = positions.clone();
    lay_curl(
        shape,
        curl_through(shape, line_at(shape, shown, lean)),
        columns,
        rows,
        &mut positions,
        &mut normals,
    );
    let view = view_of(shape);
    let seen = |row: usize| {
        let p = (row * columns + 1) * 3;
        let k = view.eye / (view.eye - f64::from(positions[p + 2]));
        [
            view.width / 2.0 + (f64::from(positions[p]) - view.width / 2.0) * k,
            view.height / 2.0 + (f64::from(positions[p + 1]) - view.height / 2.0) * k,
        ]
    };
    for row in 1..rows {
        let before = seen(row - 1);
        let here = seen(row);
        if before[1] <= y && here[1] >= y {
            let share = (y - before[1]) / or_one(here[1] - before[1]);
            return Some(shape.width - (before[0] + (here[0] - before[0]) * share));
        }
    }
    // The edge does not show at that height: its end has been carried past it.
    None
}

/// How far in from the page's edge the line is at the height `y`.
fn line_in(shape: LeafShape, line: CurlLine, y: f64) -> f64 {
    shape.spine + shape.width - (line.top + ((line.bottom - line.top) * y) / shape.height)
}

mod how_far_over_a_curled_page_is_for_where_its_edge_is_wanted {
    use super::*;

    #[test]
    fn puts_the_edge_where_it_is_asked_for_at_any_height_and_lean_the_paper_can_take() {
        let view = view_of(PHONE);
        let mut checked = 0;
        for y in [40.0, 200.0, 380.0, 600.0, 730.0] {
            for to in [0.5, 3.0, 12.0, 40.0, 61.0, 62.0, 90.0, 180.0, 300.0, 500.0] {
                for wanted in [-0.7, -0.2, 0.0, 0.2, 0.7] {
                    let lean = leant_by(PHONE, wanted, to, y, 0.0);
                    let shown = shown_for(PHONE, to, lean, y, view);
                    let read = edge_on_the_mesh(PHONE, shown, lean, y)
                        .unwrap_or_else(|| panic!("no edge at {y} for {to}"));
                    // Where the edge shows is worked out again from how high it stands until it settles.
                    assert!((read - to).abs() < 0.1, "{read} for {to} at {y}");
                    checked += 1;
                }
            }
        }
        assert_eq!(checked, 250);
    }

    #[test]
    fn is_in_one_place_only_for_what_is_asked_of_it_with_any_lean_a_held_page_is_given() {
        let tablet = LeafShape {
            spine: 0.0,
            width: 768.0,
            height: 1024.0,
        };
        let wide = LeafShape {
            spine: 0.0,
            width: 1280.0,
            height: 720.0,
        };
        for shape in [PHONE, tablet, wide] {
            let view = view_of(shape);
            for y in [
                0.0,
                shape.height * 0.3,
                shape.height * 0.6,
                shape.height * 0.97,
            ] {
                for share in [0.01, 0.1, 0.4, 0.9, 1.5, 1.9] {
                    for wanted in [-3.0, -0.3, 0.0, 0.3, 3.0] {
                        let to = share * shape.width;
                        let lean = leant_by(shape, wanted, to, y, 0.0);
                        // Short of it everywhere before, and at or past it everywhere after.
                        let mut crossed = 0;
                        let mut before = got_to(shape, 0.0, lean, y, view) >= to;
                        let mut shown = 0.0025;
                        while shown <= 1.0001 {
                            let past = got_to(shape, shown, lean, y, view) >= to;
                            if past != before {
                                crossed += 1;
                            }
                            before = past;
                            shown += 0.0025;
                        }
                        assert_eq!(crossed, 1);
                        let shown = shown_for(shape, to, lean, y, view);
                        assert_close(got_to(shape, shown, lean, y, view), to, 3);
                    }
                }
            }
        }
        // On a page taller than wide it comes in one way only, with any lean at all: one kept
        // from when it was taken, and all the way from turned for a page brought back.
        for lean in [-0.8, -0.4, 0.0, 0.4, 0.8] {
            for y in [0.0, 230.0, 680.0] {
                let mut last = f64::NEG_INFINITY;
                let mut shown = 0.0;
                while shown <= 1.0001 {
                    let got = got_to(PHONE, shown, lean, y, view_of(PHONE));
                    assert!(got >= last);
                    last = got;
                    shown += 0.0025;
                }
            }
        }
    }

    #[test]
    fn carries_the_edge_through_where_the_paper_has_yet_to_lift_without_a_step() {
        let view = view_of(PHONE);
        // A corner peel: at mid height the line is still beyond the page's edge.
        let line = line_at(PHONE, 0.1, 0.5);
        assert!(line_in(PHONE, line, 300.0) < 0.0);
        let there = edge_gone(PHONE, line, 300.0, view);
        assert!(there < 0.0);
        // Asked to be a little farther on, the page is a little farther over, and so on until it lifts there.
        assert_close(shown_for(PHONE, there, 0.5, 300.0, view), 0.1, 6);
        let mut last = 0.1;
        // No step: the line comes in by no more than a share of the roll's radius for each unit.
        let radius = 0.13 * PHONE.width;
        for more in 1..=620 {
            let shown = shown_for(PHONE, there + f64::from(more), 0.5, 300.0, view);
            assert!(shown >= last);
            assert!((shown - last) * PHONE.width < 0.4 * radius);
            last = shown;
        }
        // By the time the edge is asked to have gone somewhere, the paper has lifted there.
        assert!(there + 620.0 > 0.0);
        assert!(line_in(PHONE, line_at(PHONE, last, 0.5), 300.0) > 0.0);
    }

    #[test]
    fn lies_flat_short_of_anything_asked_of_it_and_is_turned_past_all_its_edge_can_go() {
        let view = view_of(PHONE);
        assert_is(shown_for(PHONE, 0.0, 0.0, 380.0, view), 0.0);
        assert_is(shown_for(PHONE, 2.0 * 393.0, 0.3, 380.0, view), 1.0);
        // Turned, its edge has gone twice the page's width: where a page brought back begins.
        assert_close(got_to(PHONE, 1.0, 0.0, 380.0, view), 2.0 * 393.0, 6);
    }
}

mod how_a_page_comes_to_the_finger_that_has_set_off_with_it {
    use super::*;

    #[test]
    fn is_off_from_rest_nine_tenths_of_the_way_in_a_tenth_of_a_second_and_never_turns_round() {
        assert_is(still_short(0.0), 1.0);
        // A frame on it has hardly moved: at a sixtieth of a second an eighth of the way, where
        // an approach that slows from the start would have taken a third.
        assert!(1.0 - still_short(1.0 / 60.0) < 0.14);
        assert!(1.0 - still_short(1.0 / 120.0) < 0.04);
        assert!(still_short(0.11) < 0.1);
        assert!(still_short(0.1) > 0.1);
        assert!(still_short(0.25) < 0.001);
        let mut last = 1.0;
        let mut seconds = 0.004;
        while seconds < 0.4 {
            let now = still_short(seconds);
            assert!(now < last);
            // No more than a quarter of the way in any frame of a sixtieth.
            assert!(still_short(seconds) - still_short(seconds + 1.0 / 60.0) < 0.25);
            last = now;
            seconds += 0.004;
        }
    }
}

mod how_much_a_held_page_leans {
    use super::*;

    #[test]
    fn not_at_all_before_its_edge_has_gone_anywhere_unless_it_leant_when_it_was_taken() {
        assert_is(leant_by(PHONE, 0.6, 0.0, 700.0, 0.0), 0.0);
        assert_is(leant_by(PHONE, -0.6, 0.0, 60.0, 0.0), -0.0);
        assert_is(leant_by(PHONE, 0.6, 0.0, 300.0, 0.45), 0.45);
        assert_is(leant_by(PHONE, -0.6, -40.0, 300.0, -0.3), -0.3);
    }

    #[test]
    fn by_a_corner_at_once_half_way_up_the_edge_only_as_the_page_comes_over() {
        // 40 from the bottom corner: free to lean after as much again of the edge's way.
        assert_close(leant_by(PHONE, 0.55, 30.0, 720.0, 0.0), 0.55, 9);
        // Half way up: the paper there lifts first.
        assert_close(leant_by(PHONE, 0.55, 30.0, 380.0, 0.0), 30.0 / 380.0, 9);
        assert_close(leant_by(PHONE, 0.55, 300.0, 380.0, 0.0), 0.55, 9);
        // The other way it is the upper corner that leads, and the distance to that one that counts.
        assert_close(leant_by(PHONE, -0.55, 30.0, 380.0, 0.0), -30.0 / 380.0, 9);
        assert_close(leant_by(PHONE, -0.55, 30.0, 40.0, 0.0), -0.55, 9);
    }

    #[test]
    fn so_that_the_paper_at_the_finger_is_lifted_and_the_corner_it_is_peeled_from_is_no_higher_than_the_finger(
    ) {
        let view = view_of(PHONE);
        for y in [100.0, 380.0, 600.0, 720.0, 755.0] {
            let mut gone = 2.0;
            while gone <= 600.0 {
                let lean = leant_by(PHONE, 0.8, gone, y, 0.0);
                let shown = shown_for(PHONE, gone, lean, y, view);
                let line = line_at(PHONE, shown, lean);
                assert!(line_in(PHONE, line, y) > 0.0);
                // The edge that shows at the finger's height is the page's own, not past its corner:
                // but for a finger nearer the corner than it counts as being.
                if PHONE.height - y >= 0.05 * PHONE.width {
                    assert!(edge_on_the_mesh(PHONE, shown, lean, y).is_some());
                } else {
                    assert!(gone * lean <= 0.05 * PHONE.width + 1e-9);
                }
                gone += 7.0;
            }
        }
    }

    #[test]
    fn never_past_what_a_page_wider_than_it_is_tall_can_be_laid_out_by() {
        let wide = LeafShape {
            spine: 0.0,
            width: 1280.0,
            height: 720.0,
        };
        let mut gone = 1.0;
        while gone < 2400.0 {
            assert!(leant_by(wide, 3.0, gone, 700.0, 0.0).abs() <= 0.8);
            assert!(leant_by(wide, -3.0, gone, 20.0, 0.0).abs() <= 0.8);
            gone += 13.0;
        }
    }
}
