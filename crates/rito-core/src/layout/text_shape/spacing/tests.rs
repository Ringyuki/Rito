use super::{apply_spacing_delta, reset_scalar_visits, scalar_visits};
use crate::layout::text_shape::{
    ExactRunShape, RunShape, RunShapeCluster, RunShapeDirection, RunShapeProvenance,
    RunShapeUnavailableReason,
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
        let actual = baseline.clone().apply_spacing(text, 0.1, 0.0, 123.456_789);
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
        let actual = baseline
            .clone()
            .apply_spacing(text, 0.1, 8.0 / 29.0, 14.125);
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
        let RunShape::Exact(mut shape) = exact(direction, clusters) else {
            unreachable!();
        };

        reset_scalar_visits();
        assert!(apply_spacing_delta(&mut shape, &text, 0.25, 0.0));

        assert_eq!(scalar_visits(), SCALAR_COUNT);
    }
}

fn apply_spacing_reference(
    mut shape: RunShape,
    text: &str,
    word_spacing_delta: f64,
    letter_spacing_delta: f64,
    expected_advance: f64,
) -> RunShape {
    let RunShape::Exact(exact) = &mut shape else {
        return shape;
    };
    let scalar_gaps = text.chars().count().saturating_sub(1);
    let cluster_gaps = exact.clusters.len().saturating_sub(1);
    if letter_spacing_delta != 0.0 && scalar_gaps != cluster_gaps {
        return RunShape::unavailable(
            RunShapeUnavailableReason::NonClusterSafeSpacing,
            expected_advance,
        );
    }
    for (visual_index, cluster) in exact.clusters.iter_mut().enumerate() {
        let mut advance = f64::from(cluster.advance);
        let cluster_text = utf16_slice_reference(
            text,
            cluster.logical_start as usize,
            cluster.logical_end as usize,
        );
        advance += cluster_text
            .chars()
            .filter(|character| *character == ' ')
            .count() as f64
            * word_spacing_delta;
        if visual_index < cluster_gaps {
            advance += letter_spacing_delta;
        }
        cluster.advance = advance as f32;
    }
    exact.advance = expected_advance;
    shape
}

fn utf16_slice_reference(text: &str, start: usize, end: usize) -> &str {
    let mut utf16_offset = 0usize;
    let mut start_byte = None;
    let mut end_byte = None;
    for (byte, character) in text.char_indices() {
        if utf16_offset == start {
            start_byte = Some(byte);
        }
        if utf16_offset == end {
            end_byte = Some(byte);
            break;
        }
        utf16_offset += character.len_utf16();
    }
    let start_byte = start_byte.unwrap_or(text.len());
    let end_byte = end_byte.unwrap_or({
        if utf16_offset == end {
            text.len()
        } else {
            start_byte
        }
    });
    &text[start_byte..end_byte]
}

fn assert_shape_bits_eq(actual: &RunShape, expected: &RunShape) {
    match (actual, expected) {
        (RunShape::Exact(actual), RunShape::Exact(expected)) => {
            assert_eq!(actual.advance.to_bits(), expected.advance.to_bits());
            assert_eq!(actual.direction, expected.direction);
            assert_eq!(actual.provenance, expected.provenance);
            assert_eq!(actual.clusters.len(), expected.clusters.len());
            for (actual, expected) in actual.clusters.iter().zip(&expected.clusters) {
                assert_eq!(actual.logical_start, expected.logical_start);
                assert_eq!(actual.logical_end, expected.logical_end);
                assert_eq!(actual.advance.to_bits(), expected.advance.to_bits());
            }
        }
        (RunShape::Unavailable(actual), RunShape::Unavailable(expected)) => {
            assert_eq!(actual.reason, expected.reason);
            assert_eq!(actual.advance.to_bits(), expected.advance.to_bits());
        }
        _ => panic!("shape availability differs"),
    }
}

fn exact(direction: RunShapeDirection, clusters: Vec<RunShapeCluster>) -> RunShape {
    let advance = clusters
        .iter()
        .map(|cluster| f64::from(cluster.advance))
        .sum();
    RunShape::Exact(Box::new(ExactRunShape {
        advance,
        direction,
        provenance: RunShapeProvenance::single([1; 8]),
        clusters,
    }))
}

fn cluster(logical_start: u32, logical_end: u32, advance: f32) -> RunShapeCluster {
    RunShapeCluster {
        logical_start,
        logical_end,
        advance,
    }
}
