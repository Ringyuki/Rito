use serde_json::json;

use crate::{
    interaction::TextInteractionUnavailableReason,
    runtime::{
        RuntimeTextPointRequest, RuntimeTextRangeFromPointsRequest,
        RuntimeTextRangeFromPointsResolution, RuntimeTextRangeFromPointsResponse,
        RuntimeTextSelectionGranularity,
    },
};

#[test]
fn point_range_contract_has_stable_camel_case_serde() {
    let request = RuntimeTextRangeFromPointsRequest {
        anchor: RuntimeTextPointRequest {
            page_index: 2,
            x: 12.5,
            y: 24.0,
        },
        focus: RuntimeTextPointRequest {
            page_index: 3,
            x: 48.0,
            y: 36.5,
        },
        granularity: RuntimeTextSelectionGranularity::Paragraph,
    };
    assert_eq!(
        serde_json::to_value(request).expect("request serializes"),
        json!({
            "anchor": {"pageIndex": 2, "x": 12.5, "y": 24.0},
            "focus": {"pageIndex": 3, "x": 48.0, "y": 36.5},
            "granularity": "paragraph",
        })
    );
    assert_eq!(
        serde_json::to_value(RuntimeTextRangeFromPointsResponse {
            revision_id: "rev-4".to_owned(),
            resolution: RuntimeTextRangeFromPointsResolution::Miss,
        })
        .expect("miss response serializes"),
        json!({
            "revisionId": "rev-4",
            "resolution": {"status": "miss"},
        })
    );
    assert_eq!(
        serde_json::to_value(RuntimeTextRangeFromPointsResolution::Unavailable {
            reason: TextInteractionUnavailableReason::ShapeUnavailable,
        })
        .expect("unavailable response serializes"),
        json!({"status": "unavailable", "reason": "shapeUnavailable"})
    );
}
