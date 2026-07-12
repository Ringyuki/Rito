use super::pinned_font_policy_fixtures::{
    content_epub, face, font_aware_layout, policy, title_font,
};
use crate::{
    interaction::{TextCaretAddress, TextCaretAffinity, TextInteractionUnavailableReason},
    layout::{
        LayoutRuntimePage, LineBox, LineBreaking, LineRun, RuntimeBlock, RuntimeChild, TextRunBox,
    },
    runtime::{
        RuntimeBoundedRevisionRequest, RuntimeContinueRevisionRequest, RuntimeDocument,
        RuntimeExactSourceRangeRequest, RuntimeExactSourceRangeResolution,
        RuntimePinnedFontGenericRole, RuntimeRevisionAccessErrorKind, RuntimeRevisionHandle,
        RuntimeRevisionWorkBudget, RuntimeSameFlowTextRangeRequest,
        RuntimeSameFlowTextRangeResolution, RuntimeSourceLocatorPendingReason,
        RuntimeSourceLocatorResolution, RuntimeSourcePoint, RuntimeSourceRange,
        RuntimeTextCaretResolution, RuntimeTextCaretResponse, RuntimeTextPointRequest,
        RuntimeVersioned,
    },
};
use serde_json::json;

#[test]
fn pinned_revision_resolves_exact_point_range_and_source_locator() {
    let bytes = content_epub("en", r#"<p style="font-family: serif">Wi</p>"#, "", None);
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &bytes,
        policy(vec![face(
            title_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("pinned document opens");
    let revision = document
        .create_revision(&font_aware_layout())
        .expect("font-aware revision is created");
    let handle = RuntimeRevisionHandle::from(&revision);
    let (x, y, width, height) = first_text_run_bounds(&document, &revision.revision_id);

    let left = document
        .resolve_text_caret_at(
            &handle,
            RuntimeTextPointRequest {
                page_index: 0,
                x: x - 100.0,
                y: y + height / 2.0,
            },
        )
        .expect("left point resolves");
    let right = document
        .resolve_text_caret_at(
            &handle,
            RuntimeTextPointRequest {
                page_index: 0,
                x: x + width + 100.0,
                y: y + height / 2.0,
            },
        )
        .expect("right point resolves");
    let (left, right) = match (left.value.resolution, right.value.resolution) {
        (
            RuntimeTextCaretResolution::Resolved { caret: left },
            RuntimeTextCaretResolution::Resolved { caret: right },
        ) => (left, right),
        resolutions => panic!("exact carets expected, got {resolutions:?}"),
    };
    assert_eq!((left.address.char_index, right.address.char_index), (0, 2));
    assert!(left.source_locator.href.ends_with("chapter.xhtml"));

    let range = document
        .resolve_same_flow_text_range_at(
            &handle,
            RuntimeSameFlowTextRangeRequest {
                anchor: right.address,
                focus: left.address,
            },
        )
        .expect("exact range resolves");
    let RuntimeSameFlowTextRangeResolution::Resolved { range } = range.value.resolution else {
        panic!("pinned range is exact");
    };
    assert_eq!(range.selected_text, "Wi");
    assert_eq!(range.start, left.address);
    assert_eq!(range.end, right.address);
    assert_eq!(range.rects.len(), 1);
    assert_eq!(range.rects[0].page_index, 0);
    assert!(range.source_locator.source_range.is_some());
    let locator = document
        .resolve_source_locator_at(&handle, range.source_locator.clone())
        .expect("returned source range is valid");
    assert!(matches!(
        locator.value,
        RuntimeSourceLocatorResolution::Resolved { page_index: 0, .. }
    ));
    let source_range = range
        .source_locator
        .source_range
        .clone()
        .expect("selected range owns an exact source range");
    let projected = document
        .resolve_exact_source_range_at(
            &handle,
            RuntimeExactSourceRangeRequest {
                href: range.source_locator.href.clone(),
                source_range: source_range.clone(),
            },
        )
        .expect("durable source range projects through retained exact shapes");
    let RuntimeExactSourceRangeResolution::Resolved { range: projected } =
        projected.value.resolution
    else {
        panic!("durable source range remains exact");
    };
    assert_eq!(projected.selected_text, "Wi");
    assert_eq!(projected.source_locator.source_range, Some(source_range));
    assert_eq!(projected.rects, range.rects);

    let collapsed = document
        .resolve_same_flow_text_range_at(
            &handle,
            RuntimeSameFlowTextRangeRequest {
                anchor: left.address,
                focus: left.address,
            },
        )
        .expect("collapsed range resolves");
    let RuntimeSameFlowTextRangeResolution::Resolved { range } = collapsed.value.resolution else {
        panic!("collapsed range stays exact");
    };
    assert!(range.selected_text.is_empty());
    assert!(range.rects.is_empty());
}

#[test]
fn exact_text_contract_uses_stable_camel_case_serde_shapes() {
    let address = TextCaretAddress {
        page_index: 2,
        block_index: 3,
        line_index: 4,
        run_index: 5,
        char_index: 6,
        affinity: TextCaretAffinity::Downstream,
    };
    assert_eq!(
        serde_json::to_value(address).expect("address serializes"),
        json!({
            "pageIndex": 2,
            "blockIndex": 3,
            "lineIndex": 4,
            "runIndex": 5,
            "charIndex": 6,
            "affinity": "downstream",
        })
    );
    let response = RuntimeTextCaretResponse {
        revision_id: "rev-7".to_owned(),
        page_index: 2,
        spread_index: 1,
        resolution: RuntimeTextCaretResolution::Unavailable {
            reason: TextInteractionUnavailableReason::VisualGeometryUnavailable,
        },
    };
    assert_eq!(
        serde_json::to_value(RuntimeVersioned::new(
            RuntimeRevisionHandle::new("rev-7", 3),
            response,
        ))
        .expect("versioned response serializes"),
        json!({
            "revision": { "revisionId": "rev-7", "revisionVersion": 3 },
            "value": {
                "revisionId": "rev-7",
                "pageIndex": 2,
                "spreadIndex": 1,
                "resolution": {
                    "status": "unavailable",
                    "reason": "visualGeometryUnavailable",
                },
            },
        })
    );
    assert_eq!(
        serde_json::to_value(RuntimeTextCaretResolution::Miss).expect("miss serializes"),
        json!({ "status": "miss" })
    );
}

#[test]
fn exact_source_range_contract_uses_a_narrow_camel_case_request() {
    let request = RuntimeExactSourceRangeRequest {
        href: "Text/chapter.xhtml".to_owned(),
        source_range: crate::runtime::RuntimeSourceRange {
            start: crate::runtime::RuntimeSourcePoint {
                node_path: vec![1, 2],
                text_offset: 3,
            },
            end: crate::runtime::RuntimeSourcePoint {
                node_path: vec![1, 2],
                text_offset: 5,
            },
        },
    };
    assert_eq!(
        serde_json::to_value(request).expect("exact source range request serializes"),
        json!({
            "href": "Text/chapter.xhtml",
            "sourceRange": {
                "start": { "nodePath": [1, 2], "textOffset": 3 },
                "end": { "nodePath": [1, 2], "textOffset": 5 },
            },
        })
    );
}

#[test]
fn exact_source_range_waits_for_both_endpoints_to_be_paginated() {
    let bytes = content_epub(
        "en",
        r#"<p style="font-family: serif">first</p><p style="font-family: serif">second</p>"#,
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
    .expect("pinned document opens");
    let initial = document
        .create_bounded_revision(RuntimeBoundedRevisionRequest {
            layout_config: font_aware_layout(),
            line_breaking: LineBreaking::Greedy,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .expect("first block is paginated");
    let initial_handle = RuntimeRevisionHandle::from(&initial.revision);
    let indices = document
        .get_chapter_text_indices_at(&initial_handle)
        .expect("source indices are revision gated");
    let chapter = indices
        .value
        .entries
        .values()
        .next()
        .expect("chapter index exists");
    let span = chapter
        .spans
        .last()
        .expect("second paragraph has a text span");
    let request = RuntimeExactSourceRangeRequest {
        href: chapter.href.clone(),
        source_range: RuntimeSourceRange {
            start: RuntimeSourcePoint {
                node_path: span.node_path.clone(),
                text_offset: span.source_start,
            },
            end: RuntimeSourcePoint {
                node_path: span.node_path.clone(),
                text_offset: span.source_end,
            },
        },
    };
    let pending = document
        .resolve_exact_source_range_at(&initial_handle, request.clone())
        .expect("future source range is valid");
    assert_eq!(
        pending.value.resolution,
        RuntimeExactSourceRangeResolution::Pending {
            reason: RuntimeSourceLocatorPendingReason::NotPaginated,
        }
    );

    let cursor = initial.continuation.expect("second block remains");
    let completed = document
        .continue_revision(RuntimeContinueRevisionRequest {
            revision_id: cursor.revision_id,
            revision_version: cursor.revision_version,
            cursor: cursor.cursor,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .expect("second block is paginated");
    let resolved = document
        .resolve_exact_source_range_at(&RuntimeRevisionHandle::from(&completed.revision), request)
        .expect("completed exact source range resolves");
    let RuntimeExactSourceRangeResolution::Resolved { range } = resolved.value.resolution else {
        panic!("completed source range is exact");
    };
    assert_eq!(range.selected_text, "second");
    assert!(!range.rects.is_empty());
}

#[test]
fn host_measured_text_is_unavailable_instead_of_interpolated() {
    let bytes = content_epub("en", "<p>Wi</p>", "", None);
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let revision = document
        .create_revision(&font_aware_layout())
        .expect("font-aware revision is created");
    let handle = RuntimeRevisionHandle::from(&revision);
    let (x, y, width, height) = first_text_run_bounds(&document, &revision.revision_id);

    let response = document
        .resolve_text_caret_at(
            &handle,
            RuntimeTextPointRequest {
                page_index: 0,
                x: x + width / 2.0,
                y: y + height / 2.0,
            },
        )
        .expect("capability result is returned");

    assert_eq!(
        response.value.resolution,
        RuntimeTextCaretResolution::Unavailable {
            reason: TextInteractionUnavailableReason::ShapeUnavailable,
        }
    );
}

#[test]
fn exact_text_reads_reject_stale_versions_and_non_finite_points() {
    let bytes = content_epub("en", "<p>Wi</p>", "", None);
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let revision = document
        .create_revision(&font_aware_layout())
        .expect("revision is created");
    let stale = RuntimeRevisionHandle::new(&revision.revision_id, revision.revision_version + 1);
    let request = RuntimeTextPointRequest {
        page_index: 0,
        x: 0.0,
        y: 0.0,
    };

    let error = document
        .resolve_text_caret_at(&stale, request)
        .expect_err("stale version fails");
    assert_eq!(
        error.kind,
        RuntimeRevisionAccessErrorKind::StaleRevisionVersion
    );
    let error = document
        .resolve_text_caret_at(
            &RuntimeRevisionHandle::from(&revision),
            RuntimeTextPointRequest {
                x: f64::NAN,
                ..request
            },
        )
        .expect_err("non-finite point fails");
    assert_eq!(error.kind, RuntimeRevisionAccessErrorKind::OperationFailed);

    let error = document
        .resolve_exact_source_range_at(
            &stale,
            RuntimeExactSourceRangeRequest {
                href: "chapter.xhtml".to_owned(),
                source_range: crate::runtime::RuntimeSourceRange {
                    start: crate::runtime::RuntimeSourcePoint {
                        node_path: vec![0],
                        text_offset: 0,
                    },
                    end: crate::runtime::RuntimeSourcePoint {
                        node_path: vec![0],
                        text_offset: 1,
                    },
                },
            },
        )
        .expect_err("stale exact source range fails before lazy source parsing");
    assert_eq!(
        error.kind,
        RuntimeRevisionAccessErrorKind::StaleRevisionVersion
    );
}

fn first_text_run_bounds(document: &RuntimeDocument, revision_id: &str) -> (f64, f64, f64, f64) {
    let revision = document
        .revisions
        .get(revision_id)
        .expect("stored revision exists");
    first_page_text_run(&revision.layout.pages[0]).expect("revision has a text run")
}

fn first_page_text_run(page: &LayoutRuntimePage) -> Option<(f64, f64, f64, f64)> {
    page.content
        .iter()
        .find_map(|block| first_block_text_run(block, 0.0, 0.0))
}

fn first_block_text_run(
    block: &RuntimeBlock<LineBox>,
    offset_x: f64,
    offset_y: f64,
) -> Option<(f64, f64, f64, f64)> {
    let block_x = offset_x + block.x;
    let block_y = offset_y + block.y;
    block.children.iter().find_map(|child| match child {
        RuntimeChild::Line(line) => line.runs.iter().find_map(|run| match run {
            LineRun::Text(run) => Some(run_bounds(run, block_x + line.x, block_y + line.y)),
            LineRun::Atom(_) | LineRun::Ruby(_) => None,
        }),
        RuntimeChild::Block(child) => first_block_text_run(child, block_x, block_y),
        RuntimeChild::Image(_) | RuntimeChild::Hr(_) => None,
    })
}

fn run_bounds(run: &TextRunBox, line_x: f64, line_y: f64) -> (f64, f64, f64, f64) {
    (line_x + run.x, line_y + run.y, run.width, run.height)
}
