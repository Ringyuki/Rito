use std::mem::size_of;

use super::{
    ExactRunShape, RunShape, RunShapeCluster, RunShapeDirection, RunShapeFaceSpan,
    RunShapeProvenance, RunShapeUnavailableReason,
};

#[test]
fn retained_cluster_record_stays_within_the_memory_budget() {
    assert_eq!(size_of::<RunShapeCluster>(), 12);
    assert!(10_000 * size_of::<RunShapeCluster>() <= 120_000);
    assert_eq!(size_of::<RunShapeFaceSpan>(), 12);
    assert!(size_of::<RunShapeProvenance>() <= 16);

    let mut representative_clusters = Vec::new();
    for offset in 0..10 {
        representative_clusters.push(cluster(offset, offset + 1, 10.0));
    }
    let retained_shape_bytes = 1_000
        * (size_of::<RunShape>()
            + size_of::<ExactRunShape>()
            + 16
            + representative_clusters.capacity() * size_of::<RunShapeCluster>());
    assert!(retained_shape_bytes <= 320_000);
}

#[test]
fn derives_variable_width_caret_stops_without_retaining_a_second_table() {
    let shape = exact(
        RunShapeDirection::LeftToRight,
        vec![cluster(0, 1, 10.0), cluster(1, 2, 30.0)],
    );
    let stops = shape.caret_stops();

    assert_eq!(
        stops
            .iter()
            .map(|stop| (stop.logical_offset, stop.visual_offset))
            .collect::<Vec<_>>(),
        [(0, 0.0), (1, 10.0), (2, 40.0)]
    );
}

#[test]
fn derives_large_caret_tables_with_one_stop_per_unique_edge() {
    let clusters = (0..10_000)
        .map(|offset| cluster(offset, offset + 1, 1.0))
        .collect();
    let shape = exact(RunShapeDirection::LeftToRight, clusters);

    let stops = shape.caret_stops();

    assert_eq!(stops.len(), 10_001);
    assert_eq!(stops.first().map(|stop| stop.logical_offset), Some(0));
    assert_eq!(stops.last().map(|stop| stop.logical_offset), Some(10_000));
}

#[test]
fn closes_the_last_caret_with_the_exact_run_advance() {
    let shape = exact_with_advance(
        RunShapeDirection::LeftToRight,
        0.3,
        vec![cluster(0, 1, 0.1), cluster(1, 2, 0.1), cluster(2, 3, 0.1)],
    );

    assert_eq!(shape.advance, 0.3_f64);
    assert_eq!(
        shape.caret_stops().last().map(|stop| stop.visual_offset),
        Some(0.3_f32)
    );
}

#[test]
fn keeps_multi_code_unit_cluster_atomic_without_invented_carets() {
    let shape = exact(RunShapeDirection::LeftToRight, vec![cluster(0, 3, 18.0)]);

    assert_eq!(
        shape
            .caret_stops()
            .iter()
            .map(|stop| stop.logical_offset)
            .collect::<Vec<_>>(),
        [0, 3]
    );
}

#[test]
fn maps_right_to_left_logical_edges_to_visual_cluster_edges() {
    let shape = exact(
        RunShapeDirection::RightToLeft,
        vec![cluster(1, 2, 10.0), cluster(0, 1, 20.0)],
    );
    let stops = shape.caret_stops();

    assert_eq!(
        stops
            .iter()
            .map(|stop| (stop.logical_offset, stop.visual_offset))
            .collect::<Vec<_>>(),
        [(1, 10.0), (2, 0.0), (0, 30.0)]
    );
}

#[test]
fn applies_letter_spacing_only_at_real_cluster_gaps() {
    let shape = RunShape::Exact(exact(
        RunShapeDirection::LeftToRight,
        vec![cluster(0, 1, 10.0), cluster(1, 2, 20.0)],
    ))
    .apply_spacing("Wi", 0.0, 3.0, 33.0);
    let RunShape::Exact(shape) = shape else {
        panic!("simple clusters remain exact");
    };

    assert_eq!(shape.caret_stops()[1].visual_offset, 13.0);
    assert_eq!(shape.advance, 33.0);
}

#[test]
fn refuses_scalar_letter_spacing_inside_a_complex_cluster() {
    let shape = RunShape::Exact(exact(
        RunShapeDirection::LeftToRight,
        vec![cluster(0, 2, 10.0)],
    ))
    .apply_spacing("e\u{301}", 0.0, 2.0, 12.0);

    assert!(matches!(
        shape,
        RunShape::Unavailable(unavailable)
            if unavailable.reason == RunShapeUnavailableReason::NonClusterSafeSpacing
    ));
}

#[test]
fn in_place_spacing_preserves_unavailable_reason_and_updates_advance() {
    let mut shape = RunShape::unavailable(RunShapeUnavailableReason::HostMetricsFallback, 10.0);

    shape.apply_spacing_delta_in_place("a b", 2.0, 0.0, 12.0);

    assert!(matches!(
        shape,
        RunShape::Unavailable(unavailable)
            if unavailable.reason == RunShapeUnavailableReason::HostMetricsFallback
                && unavailable.advance == 12.0
    ));
}

fn exact(direction: RunShapeDirection, clusters: Vec<RunShapeCluster>) -> Box<ExactRunShape> {
    let advance = clusters
        .iter()
        .map(|cluster| f64::from(cluster.advance))
        .sum();
    exact_with_advance(direction, advance, clusters)
}

fn exact_with_advance(
    direction: RunShapeDirection,
    advance: f64,
    clusters: Vec<RunShapeCluster>,
) -> Box<ExactRunShape> {
    let RunShape::Exact(shape) = RunShape::exact(
        RunShapeProvenance::single([1; 8]),
        direction,
        advance,
        clusters,
    ) else {
        unreachable!();
    };
    shape
}

fn cluster(logical_start: u32, logical_end: u32, advance: f32) -> RunShapeCluster {
    RunShapeCluster {
        logical_start,
        logical_end,
        advance,
    }
}
