use super::super::{
    resolve_text_range_from_points, LayoutTextRangeFromPointsResolution,
    LayoutTextSelectionGranularity, TextInteractionUnavailableReason,
};
use super::helpers::*;
use crate::layout::{RunShape, RunShapeUnavailableReason};

#[test]
fn point_granularity_reports_miss_and_authoritative_unavailability() {
    let flow = exact_flow("alpha");
    let page = one_flow_page(0, &flow, "alpha", uniform_shape(5));
    assert_eq!(
        resolve_text_range_from_points(
            std::slice::from_ref(&page),
            point(0, 15.0, -100.0),
            point(0, 15.0, 30.0),
            LayoutTextSelectionGranularity::Word,
            None,
            page_range(0, 0),
        ),
        LayoutTextRangeFromPointsResolution::Miss
    );

    let unavailable = one_flow_page(
        0,
        &flow,
        "alpha",
        RunShape::unavailable(RunShapeUnavailableReason::HostMetricsFallback, 50.0),
    );
    assert_eq!(
        resolve_text_range_from_points(
            &[unavailable],
            point(0, 15.0, 30.0),
            point(0, 15.0, 30.0),
            LayoutTextSelectionGranularity::Word,
            None,
            page_range(0, 0),
        ),
        LayoutTextRangeFromPointsResolution::Unavailable(
            TextInteractionUnavailableReason::ShapeUnavailable
        )
    );
}
