use serde_json::{json, Value};

use super::{VisualGeometry, VisualRect};
use crate::layout::content::RuntimeBlock;

#[test]
fn applies_offset_transform_and_clip_in_parent_space() {
    let block = block(Some(json!({
        "visualOffset": { "dx": 5, "dy": -2 },
        "transform": [{ "kind": "scale", "sx": 2, "sy": 1 }],
        "clipToBounds": true,
    })));
    let visual = VisualGeometry::page().enter_block(&block, 10.0, 20.0);

    assert_eq!(
        visual.resolve_rect(VisualRect::new(10.0, 20.0, 20.0, 10.0)),
        Some(VisualRect::new(-35.0, 18.0, 40.0, 10.0))
    );
    assert_eq!(
        visual.resolve_rect(VisualRect::new(-100.0, -100.0, 10.0, 10.0)),
        None
    );
    assert!(visual.supports_axis_aligned_interaction());
    assert_eq!(visual.inverse_point(-15.0, 28.0), Some((20.0, 30.0)));
    assert_eq!(
        visual.resolve_vertical_segment(20.0, 25.0, 10.0),
        Some(VisualRect::new(-15.0, 23.0, 0.0, 10.0))
    );
}

#[test]
fn resolves_percentage_translation_against_block_size() {
    let block = block(Some(json!({
        "transform": [{
            "kind": "translate",
            "x": { "unit": "percent", "value": 25 },
            "y": { "unit": "px", "value": 3 },
        }],
    })));
    let visual = VisualGeometry::page().enter_block(&block, 0.0, 0.0);

    assert_eq!(
        visual.resolve_rect(VisualRect::new(1.0, 2.0, 3.0, 4.0)),
        Some(VisualRect::new(26.0, 5.0, 3.0, 4.0))
    );
}

#[test]
fn rejects_degenerate_scale_for_exact_point_interaction() {
    let block = block(Some(json!({
        "transform": [{ "kind": "scale", "sx": 0, "sy": 1 }],
    })));
    let visual = VisualGeometry::page().enter_block(&block, 0.0, 0.0);

    assert!(!visual.supports_axis_aligned_interaction());
    assert_eq!(visual.inverse_point(0.0, 0.0), None);
    assert_eq!(visual.resolve_vertical_segment(0.0, 0.0, 10.0), None);
}

#[test]
fn counter_rotation_does_not_restore_a_lost_exact_clip() {
    let parent = block(Some(json!({
        "transform": [{ "kind": "rotate", "rad": 0.5 }],
        "clipToBounds": true,
    })));
    let child = block(Some(json!({
        "transform": [{ "kind": "rotate", "rad": -0.5 }],
    })));
    let parent_visual = VisualGeometry::page().enter_block(&parent, 10.0, 20.0);
    let child_visual = parent_visual.enter_block(&child, 10.0, 20.0);

    assert!(!parent_visual.supports_axis_aligned_interaction());
    assert!(!child_visual.supports_axis_aligned_interaction());
}

#[test]
fn rounded_overflow_clip_is_not_claimed_as_exact_rect_geometry() {
    let block = block(Some(json!({
        "clipToBounds": true,
        "radius": { "px": 12 },
    })));
    let visual = VisualGeometry::page().enter_block(&block, 10.0, 20.0);

    assert!(!visual.supports_axis_aligned_interaction());
}

#[test]
fn caret_touching_only_the_clip_boundary_has_no_visible_geometry() {
    let block = block(Some(json!({ "clipToBounds": true })));
    let visual = VisualGeometry::page().enter_block(&block, 10.0, 20.0);

    assert_eq!(visual.resolve_vertical_segment(20.0, 0.0, 20.0), None);
}

fn block(paint: Option<Value>) -> RuntimeBlock<()> {
    RuntimeBlock {
        x: 10.0,
        y: 20.0,
        width: 100.0,
        height: 50.0,
        semantic_tag: None,
        anchor_id: None,
        paint,
        border_box: None,
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children: Vec::new(),
    }
}
