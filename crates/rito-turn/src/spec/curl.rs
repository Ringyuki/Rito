//! A page curled over on itself, and how one no finger moves keeps step with its turn.
//!
//! "the order a curled page is drawn in" is not here: which way round the
//! triangles of a sheet are drawn is the host renderer's.

use super::curled_page::{
    at, forward, frame, has_set_off, laid, sheet, COLUMNS, PAGE, ROLL_RADIUS, ROWS, SCENE,
};
use super::{apart, assert_close, assert_is};
use crate::curl::{behind, curl_through, line_at, Curl, CurlLine};
use crate::curled::{curled_flat, is_there, lay_curled, wanted_curled, Curled};
use crate::frame::{Frame, Phase};
use crate::leaves::{fly, Leaf, GONE_BY};
use crate::math::{max, min};

#[track_caller]
fn assert_line(actual: CurlLine, expected: CurlLine) {
    assert_is(actual.top, expected.top);
    assert_is(actual.bottom, expected.bottom);
}

#[track_caller]
fn assert_curl(actual: Curl, expected: Curl) {
    assert_is(actual.dx, expected.dx);
    assert_is(actual.dy, expected.dy);
    assert_is(actual.at, expected.at);
    assert_is(actual.radius, expected.radius);
}

mod a_page_curled_over_on_itself {
    use super::*;

    #[test]
    fn is_not_stretched_neighbouring_points_stay_as_far_apart_as_they_lie_flat() {
        for (shown, lean) in [(0.3, 0.0), (0.25, 0.7), (0.6, -0.5), (0.93, 0.4)] {
            let positions = laid(shown, lean);
            let across = PAGE.width / (COLUMNS - 1) as f64;
            let down = PAGE.height / (ROWS - 1) as f64;
            let mut worst = 0.0;
            for row in (0..ROWS - 1).step_by(7) {
                for column in 0..COLUMNS - 1 {
                    let here = at(&positions, column, row);
                    worst = max(
                        worst,
                        (apart(here, at(&positions, column + 1, row)) - across).abs(),
                    );
                    worst = max(
                        worst,
                        (apart(here, at(&positions, column, row + 1)) - down).abs(),
                    );
                }
            }
            // A chord across the roll is shorter than the paper round it by a few thousandths.
            assert!(worst < 0.02, "{worst} at {shown}, {lean}");
        }
    }

    #[test]
    fn lies_flat_until_its_turn_begins_whichever_way_its_line_leans() {
        for lean in [0.0, 0.3, 0.9, -0.9] {
            let positions = laid(0.0, lean);
            for z in positions.iter().skip(2).step_by(3) {
                assert_is(f64::from(*z), 0.0);
            }
            let corner = at(&positions, COLUMNS - 1, ROWS - 1);
            assert_is(corner[0], 400.0);
            assert_is(corner[1], 600.0);
            assert_is(corner[2], 0.0);
        }
        // A hair into its turn only a corner has left the page, or a strip of its edge.
        let corner = laid(0.01, 0.9);
        assert!(at(&corner, COLUMNS - 1, ROWS - 1)[2] > 0.0);
        assert_is(at(&corner, COLUMNS - 1, 0)[2], 0.0);
        assert_is(at(&corner, COLUMNS - 12, ROWS - 1)[2], 0.0);
    }

    #[test]
    fn never_leaves_the_spine_its_line_stays_right_of_both_ends_of_it() {
        let mut shown = 0.0;
        while shown <= 1.0001 {
            for lean in [-2.0, -0.4, 0.0, 0.6, 2.0] {
                let line = line_at(PAGE, shown, lean);
                assert_close(
                    min(line.top, line.bottom),
                    400.0 * (1.0 - min(1.0, shown)),
                    9,
                );
                assert!(line.top >= 0.0);
                assert!(line.bottom >= 0.0);
                let positions = laid(shown, lean);
                // The paper bound at the spine lies where it lay.
                for (row, y) in [(0, 0.0), (ROWS - 1, 600.0)] {
                    let bound = at(&positions, 0, row);
                    assert_is(bound[0], 0.0);
                    assert_is(bound[1], y);
                    assert_is(bound[2], 0.0);
                }
            }
            shown += 0.05;
        }
    }

    #[test]
    fn is_out_of_the_frame_once_turned_lying_flat_past_the_spine_with_no_roll_left() {
        for lean in [0.0, 0.8, -0.8] {
            assert_is(curl_through(PAGE, line_at(PAGE, 1.0, lean)).radius, 0.0);
            let positions = laid(1.0, lean);
            for point in positions.chunks(3) {
                assert!(f64::from(point[0]) <= 1e-9);
                assert_is(f64::from(point[2]), 0.0);
            }
        }
    }

    #[test]
    fn rolls_at_one_radius_until_its_line_nears_the_spine_and_tightens_evenly_from_there() {
        let mut before = curl_through(PAGE, line_at(PAGE, 0.0, 0.5));
        assert_close(before.radius, ROLL_RADIUS, 9);
        let mut shown = 0.002;
        while shown <= 1.0 {
            let now = curl_through(PAGE, line_at(PAGE, shown, 0.5));
            assert!(now.radius <= ROLL_RADIUS + 1e-9);
            // No step in the radius, nor in where the line lies or how it leans.
            assert!((now.radius - before.radius).abs() < 0.6);
            // The end that trails comes in faster than the one that leads once the line must stand up.
            assert!((now.at - before.at).abs() < 2.5);
            assert!((now.dy - before.dy).abs() < 0.01);
            before = now;
            shown += 0.002;
        }
        assert!(before.radius < 0.6);
    }

    #[test]
    fn carries_its_lifted_edge_twice_as_far_as_its_line_goes_once_it_lies_on_top_of_its_roll() {
        let middle = ROWS / 2;
        let [early, ..] = at(&laid(0.5, 0.0), COLUMNS - 1, middle);
        let [later, ..] = at(&laid(0.6, 0.0), COLUMNS - 1, middle);
        // A tenth of a turn: the line comes in 40, the edge lying on top 80.
        // Positions are kept in single precision, which at 300 or so is good to a few millionths.
        assert_close(later - early, -80.0, 4);
        assert_close(
            at(&laid(0.6, 0.0), COLUMNS - 1, middle)[2],
            2.0 * ROLL_RADIUS,
            6,
        );
    }

    #[test]
    fn lifts_no_farther_than_the_page_lying_on_it_has() {
        let front = line_at(PAGE, 0.3, 0.6);
        let own = line_at(PAGE, 0.5, 0.0);
        let kept = behind(own, front);
        assert_is(kept.top, front.top);
        assert_is(kept.bottom, front.bottom);
        // Where the page in front has not lifted, at its trailing end, the one behind cannot either.
        assert_line(
            behind(line_at(PAGE, 0.1, 0.0), front),
            CurlLine {
                top: front.top,
                bottom: 360.0,
            },
        );
        // Where it has not caught the page in front up at all, it is its own.
        assert_line(
            behind(line_at(PAGE, 0.1, 0.0), line_at(PAGE, 0.3, 0.0)),
            line_at(PAGE, 0.1, 0.0),
        );
        // A page in front that is turned and gone holds nothing back.
        assert_line(behind(own, line_at(PAGE, 1.0, 0.6)), own);
        // As the page in front goes on, the one behind follows without a step.
        let mut last = behind(own, line_at(PAGE, 0.3, 0.6));
        let mut shown = 0.3;
        while shown <= 1.0 {
            let now = behind(own, line_at(PAGE, shown, 0.6));
            assert!((now.top - last.top).abs() + (now.bottom - last.bottom).abs() < 8.0);
            last = now;
            shown += 0.005;
        }
        assert_line(last, own);
    }
}

/// Draws the page where it is wanted a frame on, as the effect does.
fn follow(leaf: &mut Leaf, of: &Frame, turned: f64) -> f64 {
    leaf.shown = wanted_curled(leaf, SCENE, of, &forward(turned), 1.0 / 60.0);
    leaf.shown
}

fn lean_of(leaf: &Leaf) -> f64 {
    leaf.curled.as_ref().expect("a curled page").lean
}

mod how_a_curled_page_no_finger_moves_keeps_step_with_its_turn {
    use super::*;

    #[test]
    fn turned_by_a_key_sweeps_across_upright_and_is_gone_before_its_turn_stops() {
        let mut leaf = sheet(0.0, curled_flat(), 5);
        assert_is(follow(&mut leaf, &frame(Phase::Landing, None), 0.0), 0.0);
        let mut last = 0.0;
        let mut turned = 0.01;
        while turned < GONE_BY {
            let now = follow(&mut leaf, &frame(Phase::Landing, None), turned);
            assert!(now > last);
            assert_is(lean_of(&leaf), 0.0);
            assert!(!is_there(&leaf));
            last = now;
            turned += 0.01;
        }
        assert_is(
            follow(&mut leaf, &frame(Phase::Landing, None), GONE_BY),
            1.0,
        );
        // It is where its turn takes it, with the turn still on its way.
        assert!(is_there(&leaf));
    }

    #[test]
    fn goes_on_from_where_it_is_when_what_moves_its_turn_changes() {
        let mut leaf = sheet(0.0, curled_flat(), 5);
        let landing = frame(Phase::Landing, None);
        let returning = frame(Phase::Returning, None);
        follow(&mut leaf, &landing, 0.02);
        let ahead = follow(&mut leaf, &landing, 0.4);
        // Sent back while still going on: it keeps going with its turn, then comes back with it.
        assert_close(follow(&mut leaf, &returning, 0.4), ahead, 6);
        assert!(follow(&mut leaf, &returning, 0.44) > ahead);
        assert_close(follow(&mut leaf, &returning, 0.2), ahead / 2.0, 6);
        assert!(!is_there(&leaf));
        assert_is(follow(&mut leaf, &returning, 0.0), 0.0);
        assert!(is_there(&leaf));
    }

    #[test]
    fn gone_from_the_frame_with_its_turn_still_on_its_way_stays_gone_until_the_turn_has_come_back_for_it(
    ) {
        let mut leaf = sheet(0.0, curled_flat(), 5);
        let landing = frame(Phase::Landing, None);
        let returning = frame(Phase::Returning, None);
        follow(&mut leaf, &landing, 0.02);
        assert_is(follow(&mut leaf, &landing, 0.9), 1.0);
        // Sent back: the turn goes on a little, turns round, and the page comes in with it.
        assert_is(follow(&mut leaf, &returning, 0.9), 1.0);
        assert_is(follow(&mut leaf, &returning, 0.94), 1.0);
        assert_close(follow(&mut leaf, &returning, 0.45), 0.5, 6);
    }

    #[test]
    fn let_go_where_there_is_no_page_to_turn_to_comes_back_in_step_with_its_turn() {
        let mut leaf = sheet(0.0, curled_flat(), 5);
        let end = |phase: Phase, x: f64| Frame {
            incoming: None,
            ..frame(phase, Some([300.0, x, 300.0]))
        };
        // The turn is the pull as the end of the book resists it: 100 px of finger, 40 of turn.
        follow(&mut leaf, &end(Phase::Held, 340.0), 0.02);
        follow(&mut leaf, &end(Phase::Held, 280.0), 0.05);
        let held = leaf.shown;
        assert!(held > 0.0);
        // Nothing comes to the finger there: a pull twice as hard is twice the turn, no more.
        assert!(!has_set_off(&leaf));
        assert_close(
            follow(&mut leaf, &end(Phase::Returning, 280.0), 0.05),
            held,
            6,
        );
        assert!(leaf.flight.is_none());
        assert_close(
            follow(&mut leaf, &end(Phase::Returning, 280.0), 0.025),
            held / 2.0,
            6,
        );
        assert_is(follow(&mut leaf, &end(Phase::Returning, 280.0), 0.0), 0.0);
    }

    #[test]
    fn finishes_by_itself_when_its_turn_is_at_its_end_and_it_is_not() {
        let mut leaf = sheet(0.5, curled_flat(), 5);
        // Its turn is all but over: nothing is left to carry it there.
        let stays = follow(&mut leaf, &frame(Phase::Landing, None), 0.995);
        assert_is(stays, 0.5);
        assert_is(leaf.flight.expect("on its own way").to, 1.0);
        // And it is left to that until it is there: its own way is not begun again.
        fly(&mut leaf, 0.05);
        let on_its_way = leaf.shown;
        assert!(on_its_way > 0.5);
        assert_is(
            follow(&mut leaf, &frame(Phase::Landing, None), 1.0),
            on_its_way,
        );
        assert_is(leaf.flight.expect("on its own way").elapsed, 0.05);
    }

    #[test]
    fn lays_a_page_behind_another_no_farther_over_than_the_one_in_front() {
        let front = sheet(
            0.3,
            Curled {
                lean: 0.6,
                ..curled_flat()
            },
            5,
        );
        let back = sheet(0.5, curled_flat(), 6);
        let mut book = vec![front, back];
        lay_curled(&mut book, COLUMNS, ROWS);
        let line = line_at(PAGE, 0.3, 0.6);
        let laid_back = book[1].curled.as_ref().and_then(|curled| curled.curl);
        assert_curl(laid_back.expect("laid out"), curl_through(PAGE, line));
        // By itself it would have gone farther.
        let mut alone = vec![sheet(0.5, curled_flat(), 6)];
        lay_curled(&mut alone, COLUMNS, ROWS);
        let alone_at = alone[0].curled.as_ref().and_then(|curled| curled.curl);
        assert!(alone_at.expect("laid out").at < laid_back.map_or(0.0, |curl| curl.at));
    }
}
