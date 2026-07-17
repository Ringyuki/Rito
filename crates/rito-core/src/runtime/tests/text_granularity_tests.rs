use serde_json::json;

use super::pinned_font_policy_fixtures::{
    content_epub, face, font_aware_layout, policy, title_font,
};
use crate::{
    interaction::TextInteractionUnavailableReason,
    layout::{LineBox, LineRun, RunShape, RuntimeBlock, RuntimeChild, TextRunBox},
    runtime::{
        RuntimeDocument, RuntimePinnedFontGenericRole, RuntimeRevisionHandle,
        RuntimeTextPointRequest, RuntimeTextRangeFromPointsRequest,
        RuntimeTextRangeFromPointsResolution, RuntimeTextRangeFromPointsResponse,
        RuntimeTextSelectionGranularity,
    },
};

#[test]
fn runtime_point_range_uses_package_language_and_returns_exact_carets() {
    let bytes = content_epub(
        "fi",
        r#"<p style="font-family: serif">EU:ssa</p>"#,
        "",
        None,
    );
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &bytes,
        policy(vec![face(
            title_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("fi"),
        )]),
    )
    .expect("Finnish document opens");
    let revision = document
        .create_revision(&font_aware_layout())
        .expect("exact revision is created");
    let (x, y) = cluster_center(&document, &revision.revision_id, "EU:ssa", 2);
    let point = RuntimeTextPointRequest {
        page_index: 0,
        x,
        y,
    };
    let response = document
        .resolve_text_range_from_points_at(
            &RuntimeRevisionHandle::from(&revision),
            RuntimeTextRangeFromPointsRequest {
                anchor: point,
                focus: point,
                granularity: RuntimeTextSelectionGranularity::Word,
            },
        )
        .expect("versioned point range resolves");
    let RuntimeTextRangeFromPointsResolution::Resolved {
        anchor_caret,
        focus_caret,
        range,
    } = response.value.resolution
    else {
        panic!("Finnish locale keeps the colon inside the word");
    };

    assert_eq!(range.selected_text, "EU:ssa");
    assert_eq!(range.anchor, anchor_caret.address);
    assert_eq!(range.focus, focus_caret.address);
    let source_locator = range
        .source_locator
        .as_ref()
        .expect("single-resource range keeps its compatible locator");
    assert_eq!(anchor_caret.source_locator.href, source_locator.href);
    assert_eq!(focus_caret.source_locator.href, source_locator.href);
    let source_range = range
        .source_locator
        .as_ref()
        .expect("single-resource range keeps its compatible locator")
        .source_range
        .as_ref()
        .expect("resolved range has durable source endpoints");
    assert_eq!(
        anchor_caret.source_locator.source_point.as_ref(),
        Some(&source_range.start)
    );
    assert_eq!(
        focus_caret.source_locator.source_point.as_ref(),
        Some(&source_range.end)
    );
    assert_eq!(range.source_span.start.source_point, source_range.start);
    assert_eq!(range.source_span.end.source_point, source_range.end);
    assert_ne!(anchor_caret.geometry.x, point.x);
    assert_ne!(focus_caret.geometry.x, point.x);
}

#[test]
fn runtime_paragraph_excludes_source_whitespace_trimmed_by_layout() {
    let bytes = content_epub(
        "en",
        r#"<p style="font-family: serif">  alpha  </p><p style="font-family: serif">  next</p>"#,
        "",
        None,
    );
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &bytes,
        policy(vec![face(
            title_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("document with trim whitespace opens");
    let revision = document
        .create_revision(&font_aware_layout())
        .expect("exact revision is created");
    let (x, y) = cluster_center(&document, &revision.revision_id, "alpha", 2);
    let point = RuntimeTextPointRequest {
        page_index: 0,
        x,
        y,
    };
    let response = document
        .resolve_text_range_from_points_at(
            &RuntimeRevisionHandle::from(&revision),
            RuntimeTextRangeFromPointsRequest {
                anchor: point,
                focus: point,
                granularity: RuntimeTextSelectionGranularity::Paragraph,
            },
        )
        .expect("paragraph request is valid");
    let RuntimeTextRangeFromPointsResolution::Resolved {
        anchor_caret,
        focus_caret,
        range,
    } = response.value.resolution
    else {
        panic!("trimmed source whitespace does not block paragraph selection");
    };
    assert_eq!(range.selected_text, "alpha\n\n");
    assert_eq!(range.rects.len(), 1);
    assert_eq!(anchor_caret.address.block_index, 0);
    assert_eq!(focus_caret.address.block_index, 0);
    let source_range = range
        .source_locator
        .as_ref()
        .expect("single-resource range keeps its compatible locator")
        .source_range
        .as_ref()
        .expect("paragraph owns an exact source range");
    assert_eq!(
        focus_caret.source_locator.source_point.as_ref(),
        Some(&source_range.end)
    );
}

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

fn cluster_center(
    document: &RuntimeDocument,
    revision_id: &str,
    text: &str,
    logical_offset: u32,
) -> (f64, f64) {
    let (_, x, y) = cluster_center_with_page(document, revision_id, text, logical_offset);
    (x, y)
}

pub(super) fn cluster_center_with_page(
    document: &RuntimeDocument,
    revision_id: &str,
    text: &str,
    logical_offset: u32,
) -> (usize, f64, f64) {
    let revision = document
        .revisions
        .get(revision_id)
        .expect("stored revision exists");
    revision
        .layout
        .pages
        .iter()
        .enumerate()
        .find_map(|(page_index, page)| {
            page.content
                .iter()
                .find_map(|block| block_cluster_center(block, 0.0, 0.0, text, logical_offset))
                .map(|(x, y)| (page_index, x, y))
        })
        .expect("target cluster is retained")
}

fn block_cluster_center(
    block: &RuntimeBlock<LineBox>,
    offset_x: f64,
    offset_y: f64,
    text: &str,
    logical_offset: u32,
) -> Option<(f64, f64)> {
    let block_x = offset_x + block.x;
    let block_y = offset_y + block.y;
    block.children.iter().find_map(|child| match child {
        RuntimeChild::Line(line) => line.runs.iter().find_map(|run| match run {
            LineRun::Text(run) if run.text == text => {
                run_cluster_center(run, block_x + line.x, block_y + line.y, logical_offset)
            }
            LineRun::Text(_) => None,
            LineRun::Atom(_) | LineRun::Ruby(_) => None,
        }),
        RuntimeChild::Block(child) => {
            block_cluster_center(child, block_x, block_y, text, logical_offset)
        }
        RuntimeChild::Image(_) | RuntimeChild::Hr(_) => None,
    })
}

fn run_cluster_center(
    run: &TextRunBox,
    line_x: f64,
    line_y: f64,
    logical_offset: u32,
) -> Option<(f64, f64)> {
    let RunShape::Exact(shape) = &run.shape else {
        return None;
    };
    let mut cursor = 0.0;
    for cluster in &shape.clusters {
        let start = cursor;
        cursor += f64::from(cluster.advance);
        if cluster.logical_start <= logical_offset && logical_offset < cluster.logical_end {
            return Some((
                line_x + run.x + (start + cursor) / 2.0,
                line_y + run.y + run.height / 2.0,
            ));
        }
    }
    None
}
