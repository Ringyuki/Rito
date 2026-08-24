use std::num::NonZeroUsize;

use super::super::PendingShapeSpacing;
use crate::layout::{
    text_shape::{
        ExactRunShape, RunShape, RunShapeCluster, RunShapeDirection, RunShapeProvenance,
        RunShapeUnavailableReason,
    },
    text_work::{TextWorkBudget, TextWorkMeter},
};

pub(super) fn apply_spacing_bounded(
    mut shape: RunShape,
    text: &str,
    word_spacing_delta: f64,
    letter_spacing_delta: f64,
    expected_advance: f64,
    quantum: usize,
) -> RunShape {
    let mut pending = PendingShapeSpacing::new(
        word_spacing_delta,
        letter_spacing_delta,
        expected_advance,
        None,
    );
    loop {
        let mut work = meter(quantum);
        if pending.advance(&mut shape, text, &mut work).is_ok() {
            return shape;
        }
    }
}

pub(super) fn meter(max_utf16_units: usize) -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(
        NonZeroUsize::new(max_utf16_units).expect("text limit is non-zero"),
        NonZeroUsize::new(1).expect("operation limit is non-zero"),
    ))
}

pub(super) fn apply_spacing_reference(
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

pub(super) fn assert_shape_bits_eq(actual: &RunShape, expected: &RunShape) {
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

pub(super) fn exact(direction: RunShapeDirection, clusters: Vec<RunShapeCluster>) -> RunShape {
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

pub(super) fn cluster(logical_start: u32, logical_end: u32, advance: f32) -> RunShapeCluster {
    RunShapeCluster {
        logical_start,
        logical_end,
        advance,
    }
}
