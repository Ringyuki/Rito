//! A leaf turned about the spine.
//!
//! "is told to the GPU as triangles between its points" is not here: the
//! grid of triangles a sheet is drawn with is the host renderer's.

use super::{apart, assert_close, assert_is};
use crate::leaf::{lay_leaf, leaf_point, pose_at, LeafGrab, LeafShape};
use crate::math::{max, min, PI};

const SHAPE: LeafShape = LeafShape {
    spine: 400.0,
    width: 400.0,
    height: 600.0,
};
const COLUMNS: usize = 33;
const ROWS: usize = 25;
const BY_CORNER: LeafGrab = LeafGrab { u: 1.0, v: 1.0 };
const BY_EDGE: LeafGrab = LeafGrab { u: 1.0, v: 0.5 };

struct Laid {
    positions: Vec<f32>,
    normals: Vec<f32>,
}

fn laid(grab: LeafGrab, turned: f64) -> Laid {
    let mut positions = vec![0.0; COLUMNS * ROWS * 3];
    let mut normals = vec![0.0; COLUMNS * ROWS * 3];
    lay_leaf(
        SHAPE,
        pose_at(SHAPE, grab, turned),
        COLUMNS,
        ROWS,
        &mut positions,
        &mut normals,
    );
    Laid { positions, normals }
}

fn point(values: &[f32], column: usize, row: usize) -> [f64; 3] {
    let p = (row * COLUMNS + column) * 3;
    [
        f64::from(values[p]),
        f64::from(values[p + 1]),
        f64::from(values[p + 2]),
    ]
}

mod a_leaf_turned_about_the_spine {
    use super::*;

    #[test]
    fn lies_flat_face_up_before_it_is_turned() {
        let Laid { positions, normals } = laid(BY_CORNER, 0.0);
        for (column, row) in [(0, 0), (11, 7), (COLUMNS - 1, ROWS - 1)] {
            let [x, y, z] = point(&positions, column, row);
            assert_close(x, 400.0 + (column as f64 / (COLUMNS - 1) as f64) * 400.0, 3);
            assert_close(y, (row as f64 / (ROWS - 1) as f64) * 600.0, 3);
            assert_close(z, 0.0, 3);
            assert_close(point(&normals, column, row)[2], 1.0, 5);
        }
    }

    #[test]
    fn lies_flat_on_the_far_side_face_down_once_turned() {
        let Laid { positions, normals } = laid(BY_CORNER, 1.0);
        for (column, row) in [(0, 0), (11, 7), (COLUMNS - 1, ROWS - 1)] {
            let [x, y, z] = point(&positions, column, row);
            assert_close(x, 400.0 - (column as f64 / (COLUMNS - 1) as f64) * 400.0, 2);
            assert_close(y, (row as f64 / (ROWS - 1) as f64) * 600.0, 2);
            assert_close(z, 0.0, 2);
            assert_close(point(&normals, column, row)[2], -1.0, 4);
        }
    }

    #[test]
    fn stays_bound_at_the_spine_all_the_way_over() {
        let mut turned = 0.0;
        while turned <= 1.0 {
            for down in [0.0, 220.0, 600.0] {
                let [x, y, z] = leaf_point(SHAPE, pose_at(SHAPE, BY_CORNER, turned), 0.0, down);
                assert_is(x, 400.0);
                assert_is(z, 0.0);
                assert_close(y, down, 6);
            }
            turned += 0.05;
        }
    }

    #[test]
    fn bends_without_stretching_neighbours_stay_as_far_apart_as_they_are_flat() {
        let flat = laid(BY_CORNER, 0.0).positions;
        for grab in [BY_CORNER, BY_EDGE, LeafGrab { u: 1.0, v: 0.1 }] {
            for turned in [0.12, 0.35, 0.5, 0.7, 0.93] {
                let Laid { positions, .. } = laid(grab, turned);
                let mut worst = 0.0;
                for row in 0..ROWS - 1 {
                    for column in 0..COLUMNS - 1 {
                        for (dc, dr) in [(1, 0), (0, 1)] {
                            let now = apart(
                                point(&positions, column, row),
                                point(&positions, column + dc, row + dr),
                            );
                            let was = apart(
                                point(&flat, column, row),
                                point(&flat, column + dc, row + dr),
                            );
                            worst = max(worst, (now / was - 1.0).abs());
                        }
                    }
                }
                // A step round the bend is a chord of it: shorter than its arc by a hair.
                assert!(worst < 0.004, "{worst} at {turned}");
            }
        }
    }

    #[test]
    fn arches_in_the_air_however_it_is_taken_off_the_straight_line_from_the_spine_to_its_edge() {
        for grab in [BY_EDGE, BY_CORNER, LeafGrab { u: 1.0, v: 0.0 }] {
            let Laid { positions, .. } = laid(grab, 0.3);
            let row = ROWS / 2;
            let edge = point(&positions, COLUMNS - 1, row);
            let middle = point(&positions, (COLUMNS - 1) / 2, row);
            let spine = point(&positions, 0, row);
            let on_line = [0, 1, 2].map(|axis| (spine[axis] + edge[axis]) / 2.0);
            // A tenth of the leaf's width, give or take.
            assert!(apart(middle, on_line) > 30.0);
            assert!(apart(middle, on_line) < 60.0);
        }
    }

    #[test]
    fn leads_with_the_corner_it_is_taken_by() {
        let Laid { positions, .. } = laid(BY_CORNER, 0.3);
        let bottom = point(&positions, COLUMNS - 1, ROWS - 1);
        let top = point(&positions, COLUMNS - 1, 0);
        assert!(bottom[0] < top[0] - 20.0);
        assert!(bottom[2] > top[2]);
    }

    #[test]
    fn never_goes_under_the_pages_and_comes_down_edge_first() {
        for grab in [BY_CORNER, BY_EDGE] {
            let mut turned = 0.0;
            while turned <= 1.0001 {
                let Laid { positions, .. } = laid(grab, turned);
                let lowest = positions
                    .iter()
                    .skip(2)
                    .step_by(3)
                    .fold(f64::INFINITY, |lowest, z| min(lowest, f64::from(*z)));
                assert!(lowest > -0.05, "{lowest} at {turned}");
                turned += 0.01;
            }
        }
        // Near the end the outer corner is down while the middle of the leaf still stands off the page.
        let Laid { positions, .. } = laid(BY_CORNER, 0.93);
        assert!(point(&positions, COLUMNS - 1, ROWS - 1)[2] < 1.0);
        assert!(point(&positions, (COLUMNS - 1) / 2, ROWS - 1)[2] > 8.0);
    }

    #[test]
    fn swings_evenly_and_is_flat_at_both_ends_of_the_turn() {
        let start = pose_at(SHAPE, BY_CORNER, 0.0);
        assert_is(start.swing, 0.0);
        assert_is(start.cone, PI / 2.0);
        assert_close(pose_at(SHAPE, BY_CORNER, 0.5).swing, PI / 2.0, 9);
        let end = pose_at(SHAPE, BY_CORNER, 1.0);
        assert_close(end.swing, PI, 9);
        assert_close(end.cone, PI / 2.0, 4);
        // Taken by the middle of its edge it bends round a point much farther off.
        assert!(
            pose_at(SHAPE, BY_EDGE, 0.4).apex.abs()
                > pose_at(SHAPE, BY_CORNER, 0.4).apex.abs() * 2.0
        );
    }
}
