use super::{reset_scalar_visits, scalar_visits, PendingShapeSpacing};
use crate::layout::{
    text_shape::{RunShape, RunShapeDirection, RunShapeUnavailableReason},
    text_work::TextWorkYield,
};

mod support;

use support::{
    apply_spacing_bounded, apply_spacing_reference, assert_shape_bits_eq, cluster, exact, meter,
};

#[test]
fn matches_the_prefix_scan_reference_bit_for_bit() {
    let cases = [
        (
            "A V",
            RunShapeDirection::LeftToRight,
            vec![
                cluster(0, 1, 10.123_45),
                cluster(1, 2, 20.333_3),
                cluster(2, 3, 7.777_7),
            ],
        ),
        (
            "א 😀",
            RunShapeDirection::RightToLeft,
            vec![
                cluster(2, 4, 7.777_7),
                cluster(1, 2, 20.333_3),
                cluster(0, 1, 10.123_45),
            ],
        ),
        (
            " \u{301}a",
            RunShapeDirection::LeftToRight,
            vec![cluster(0, 2, 12.375), cluster(2, 3, 9.625)],
        ),
    ];

    for (text, direction, clusters) in cases {
        let baseline = exact(direction, clusters);
        let actual = apply_spacing_bounded(baseline.clone(), text, 0.1, 0.0, 123.456_789, 1);
        let expected = apply_spacing_reference(baseline, text, 0.1, 0.0, 123.456_789);

        assert_shape_bits_eq(&actual, &expected);
    }
}

#[test]
fn keeps_visual_letter_gap_placement_bit_exact_for_both_directions() {
    let cases = [
        (
            "A V",
            RunShapeDirection::LeftToRight,
            vec![cluster(0, 1, 3.25), cluster(1, 2, 4.5), cluster(2, 3, 5.75)],
        ),
        (
            "א ב",
            RunShapeDirection::RightToLeft,
            vec![cluster(2, 3, 3.25), cluster(1, 2, 4.5), cluster(0, 1, 5.75)],
        ),
    ];

    for (text, direction, clusters) in cases {
        let baseline = exact(direction, clusters);
        let actual = apply_spacing_bounded(baseline.clone(), text, 0.1, 8.0 / 29.0, 14.125, 1);
        let expected = apply_spacing_reference(baseline, text, 0.1, 8.0 / 29.0, 14.125);

        assert_shape_bits_eq(&actual, &expected);
    }
}

#[test]
fn scans_each_scalar_once_per_spacing_pass_in_both_directions() {
    const SCALAR_COUNT: usize = 10_000;
    let text = "a ".repeat(SCALAR_COUNT / 2);

    for direction in [
        RunShapeDirection::LeftToRight,
        RunShapeDirection::RightToLeft,
    ] {
        let offsets: Box<dyn Iterator<Item = usize>> = match direction {
            RunShapeDirection::LeftToRight => Box::new(0..SCALAR_COUNT),
            RunShapeDirection::RightToLeft => Box::new((0..SCALAR_COUNT).rev()),
        };
        let clusters = offsets
            .map(|offset| cluster(offset as u32, offset as u32 + 1, 1.0))
            .collect();
        let mut shape = exact(direction, clusters);
        let mut pending = PendingShapeSpacing::new(0.25, 0.0, SCALAR_COUNT as f64, None);
        let mut work = meter(usize::MAX);

        reset_scalar_visits();
        pending
            .advance(&mut shape, &text, &mut work)
            .expect("unbounded spacing completes");

        assert_eq!(scalar_visits(), (SCALAR_COUNT, 0));
    }
}

#[test]
fn unsafe_letter_spacing_yields_without_partially_mutating_clusters() {
    let text = "a\u{301}";
    let original = exact(RunShapeDirection::LeftToRight, vec![cluster(0, 2, 17.25)]);
    let mut actual = original.clone();
    let mut pending = PendingShapeSpacing::new(0.0, 2.5, 19.75, None);
    let mut first = meter(1);

    assert_eq!(
        pending.advance(&mut actual, text, &mut first),
        Err(TextWorkYield)
    );
    assert_shape_bits_eq(&actual, &original);

    let mut second = meter(1);
    pending
        .advance(&mut actual, text, &mut second)
        .expect("second scalar completes the safety decision");
    assert!(matches!(
        actual,
        RunShape::Unavailable(shape)
            if shape.reason == RunShapeUnavailableReason::NonClusterSafeSpacing
                && shape.advance.to_bits() == 19.75_f64.to_bits()
    ));
}

#[test]
fn astral_scalar_resumes_without_repeating_or_livelocking() {
    let text = "😀a";
    for (direction, clusters) in [
        (
            RunShapeDirection::LeftToRight,
            vec![cluster(0, 2, 7.25), cluster(2, 3, 8.5)],
        ),
        (
            RunShapeDirection::RightToLeft,
            vec![cluster(2, 3, 8.5), cluster(0, 2, 7.25)],
        ),
    ] {
        let baseline = exact(direction, clusters);
        let expected = apply_spacing_reference(baseline.clone(), text, 0.5, 0.25, 16.0);
        let mut actual = baseline;
        let mut pending = PendingShapeSpacing::new(0.5, 0.25, 16.0, None);
        let mut yields = 0;

        loop {
            let mut work = meter(1);
            match pending.advance(&mut actual, text, &mut work) {
                Ok(()) => break,
                Err(TextWorkYield) => yields += 1,
            }
            assert!(yields < 20, "astral spacing must not livelock");
        }

        assert!(yields >= 5);
        assert_shape_bits_eq(&actual, &expected);
    }
}

#[test]
fn unavailable_shapes_update_advance_without_scanning_text() {
    let mut shape = RunShape::unavailable(RunShapeUnavailableReason::HostMetricsFallback, 1.0);
    let mut pending = PendingShapeSpacing::new(2.0, 3.0, 19.0, None);
    let mut work = meter(1);
    assert_eq!(work.take_utf16_units(1), 1);

    reset_scalar_visits();
    pending
        .advance(&mut shape, &"😀 ".repeat(10_000), &mut work)
        .expect("unavailable shape spacing is constant work");

    assert_eq!(shape.advance().to_bits(), 19.0_f64.to_bits());
    assert_eq!(scalar_visits(), (0, 0));
}

#[test]
fn malformed_utf16_cluster_boundary_degrades_without_panicking() {
    for mut shape in [
        exact(RunShapeDirection::LeftToRight, vec![cluster(0, 1, 7.25)]),
        exact(RunShapeDirection::LeftToRight, Vec::new()),
        exact(RunShapeDirection::RightToLeft, vec![cluster(0, 1, 7.25)]),
    ] {
        let mut pending = PendingShapeSpacing::new(1.0, 0.0, 8.25, None);

        loop {
            let mut work = meter(1);
            if pending.advance(&mut shape, "😀", &mut work).is_ok() {
                break;
            }
        }

        assert!(matches!(
            shape,
            RunShape::Unavailable(unavailable)
                if unavailable.reason == RunShapeUnavailableReason::NonClusterSafeSpacing
        ));
    }
}
