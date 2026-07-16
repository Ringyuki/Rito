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
        RuntimeRevisionWorkBudget, RuntimeSearchRequest, RuntimeSearchSource,
        RuntimeSourceLocatorPendingReason, RuntimeSourceLocatorResolution, RuntimeSourcePoint,
        RuntimeSourceRange, RuntimeTextCaretResolution, RuntimeTextCaretResponse,
        RuntimeTextPointRequest, RuntimeTextRangeFromPointsResolution, RuntimeTextRangeRequest,
        RuntimeTextRangeResolution, RuntimeTextRangeToPointRequest, RuntimeVersioned,
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
        .resolve_text_range_at(
            &handle,
            RuntimeTextRangeRequest {
                anchor: right.address,
                focus: left.address,
            },
        )
        .expect("exact range resolves");
    let RuntimeTextRangeResolution::Resolved { range } = range.value.resolution else {
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
        .resolve_text_range_at(
            &handle,
            RuntimeTextRangeRequest {
                anchor: left.address,
                focus: left.address,
            },
        )
        .expect("collapsed range resolves");
    let RuntimeTextRangeResolution::Resolved { range } = collapsed.value.resolution else {
        panic!("collapsed range stays exact");
    };
    assert!(range.selected_text.is_empty());
    assert!(range.rects.is_empty());
}

#[test]
fn cross_paragraph_text_range_round_trips_after_reflow() {
    let bytes = content_epub(
        "en",
        r#"<p style="font-family: serif">first</p>
          <p style="font-family: serif">second</p>"#,
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
        .create_revision(&font_aware_layout())
        .expect("initial revision is created");
    let initial_handle = RuntimeRevisionHandle::from(&initial);
    let first = text_run_bounds_by_text(&document, &initial.revision_id, "first");
    let second = text_run_bounds_by_text(&document, &initial.revision_id, "second");
    let start = document
        .resolve_text_caret_at(
            &initial_handle,
            RuntimeTextPointRequest {
                page_index: first.0,
                x: first.1 - 100.0,
                y: first.2 + first.4 / 2.0,
            },
        )
        .expect("first paragraph start resolves");
    let end = document
        .resolve_text_caret_at(
            &initial_handle,
            RuntimeTextPointRequest {
                page_index: second.0,
                x: second.1 + second.3 + 100.0,
                y: second.2 + second.4 / 2.0,
            },
        )
        .expect("second paragraph end resolves");
    let (start, end) = match (start.value.resolution, end.value.resolution) {
        (
            RuntimeTextCaretResolution::Resolved { caret: start },
            RuntimeTextCaretResolution::Resolved { caret: end },
        ) => (start, end),
        resolutions => panic!("cross-paragraph carets are exact: {resolutions:?}"),
    };
    let selected = document
        .resolve_text_range_at(
            &initial_handle,
            RuntimeTextRangeRequest {
                anchor: start.address,
                focus: end.address,
            },
        )
        .expect("cross-paragraph range resolves");
    let RuntimeTextRangeResolution::Resolved { range: selected } = selected.value.resolution else {
        panic!("cross-paragraph range stays exact");
    };
    assert_eq!(selected.selected_text, "first\n\nsecond");
    assert!(selected.rects.len() >= 2);
    let href = selected.source_locator.href.clone();
    let source_range = selected
        .source_locator
        .source_range
        .clone()
        .expect("cross-paragraph selection owns one durable source range");
    assert_ne!(source_range.start.node_path, source_range.end.node_path);

    let mut reflow_config = font_aware_layout();
    reflow_config.root_font_size = 22.0;
    let reflowed = document
        .create_revision(&reflow_config)
        .expect("reflowed revision is created");
    let projected = document
        .resolve_exact_source_range_at(
            &RuntimeRevisionHandle::from(&reflowed),
            RuntimeExactSourceRangeRequest {
                href,
                source_range: source_range.clone(),
            },
        )
        .expect("cross-paragraph source range projects after reflow");
    let RuntimeExactSourceRangeResolution::Resolved { range: projected } =
        projected.value.resolution
    else {
        panic!("cross-paragraph source range remains exact after reflow: {projected:#?}");
    };
    assert_eq!(projected.selected_text, "first\n\nsecond");
    assert_eq!(projected.source_locator.source_range, Some(source_range));
    assert!(projected.rects.len() >= 2);
}

#[test]
fn native_search_source_reuses_authoritative_exact_shape_projection() {
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
    let search = document
        .search_at(
            &handle,
            RuntimeSearchRequest {
                query: "Wi".to_owned(),
                case_sensitive: true,
                whole_word: false,
                limit: Some(1),
            },
        )
        .expect("native search succeeds");
    let result = search.value.results.first().expect("search match");
    let RuntimeSearchSource::Resolved { href, source_range } = &result.source else {
        panic!("search match owns an exact durable source range");
    };

    let projected = document
        .resolve_exact_source_range_at(
            &handle,
            RuntimeExactSourceRangeRequest {
                href: href.clone(),
                source_range: source_range.clone(),
            },
        )
        .expect("search source projects through exact shapes");
    let RuntimeExactSourceRangeResolution::Resolved { range } = projected.value.resolution else {
        panic!("pinned search match projects exactly");
    };
    assert_eq!(range.selected_text, "Wi");
    assert_eq!(range.rects.len(), 1);
    assert!(range.rects[0].width > 0.0);
}

#[test]
fn embedded_nested_search_source_projects_non_tail_range_exactly() {
    let font = title_font();
    let bytes = content_epub(
        "zh-CN",
        r#"<div class="embedded"><table><tr><td><p><span>关于我</span></p></td></tr></table></div>"#,
        r#"@font-face { font-family: embedded; src: url(book.ttf); } .embedded { font-family: embedded; }"#,
        Some(&font),
    );
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let revision = document
        .create_revision(&font_aware_layout())
        .expect("font-aware revision is created");
    let handle = RuntimeRevisionHandle::from(&revision);
    let search = document
        .search_at(
            &handle,
            RuntimeSearchRequest {
                query: "关于".to_owned(),
                case_sensitive: true,
                whole_word: false,
                limit: Some(1),
            },
        )
        .expect("native search succeeds");
    let result = search.value.results.first().expect("search match");
    let RuntimeSearchSource::Resolved { href, source_range } = &result.source else {
        panic!("search match owns an exact durable source range");
    };

    let projected = document
        .resolve_exact_source_range_at(
            &handle,
            RuntimeExactSourceRangeRequest {
                href: href.clone(),
                source_range: source_range.clone(),
            },
        )
        .expect("search source projects through exact shapes");
    let RuntimeExactSourceRangeResolution::Resolved { range } = projected.value.resolution else {
        panic!("embedded search match projects exactly: {projected:#?}");
    };
    assert_eq!(range.selected_text, "关于");
    assert_eq!(range.rects.len(), 1);
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
    assert_eq!(
        serde_json::to_value(RuntimeTextRangeToPointRequest {
            anchor: address,
            focus: RuntimeTextPointRequest {
                page_index: 7,
                x: 12.5,
                y: 24.0,
            },
        })
        .expect("range-to-point request serializes"),
        json!({
            "anchor": {
                "pageIndex": 2,
                "blockIndex": 3,
                "lineIndex": 4,
                "runIndex": 5,
                "charIndex": 6,
                "affinity": "downstream",
            },
            "focus": { "pageIndex": 7, "x": 12.5, "y": 24.0 },
        })
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
fn bounded_follow_up_rebinds_an_old_address_to_a_live_point_atomically() {
    let bytes = content_epub(
        "en",
        r#"<p style="font-family: serif; page-break-after: always">first</p><p style="font-family: serif; page-break-after: always">second</p><p style="font-family: serif">third</p>"#,
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
                max_top_level_nodes: 2,
            },
        })
        .expect("first block is paginated");
    let initial_handle = RuntimeRevisionHandle::from(&initial.revision);
    let first = text_run_bounds_by_text(&document, &initial.revision.revision_id, "first");
    let anchor = document
        .resolve_text_caret_at(
            &initial_handle,
            RuntimeTextPointRequest {
                page_index: first.0,
                x: first.1 - 100.0,
                y: first.2 + first.4 / 2.0,
            },
        )
        .expect("initial anchor resolves");
    let RuntimeTextCaretResolution::Resolved { caret: anchor } = anchor.value.resolution else {
        panic!("initial anchor is exact");
    };

    let cursor = initial.continuation.expect("third block remains");
    let advanced = document
        .continue_revision(RuntimeContinueRevisionRequest {
            revision_id: cursor.revision_id,
            revision_version: cursor.revision_version,
            cursor: cursor.cursor,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .expect("third block is paginated");
    let current_handle = RuntimeRevisionHandle::from(&advanced.revision);
    assert!(current_handle.revision_version > initial_handle.revision_version);
    let third = text_run_bounds_by_text(&document, &advanced.revision.revision_id, "third");

    let response = document
        .resolve_text_range_to_point_at(
            &current_handle,
            RuntimeTextRangeToPointRequest {
                anchor: anchor.address,
                focus: RuntimeTextPointRequest {
                    page_index: third.0,
                    x: third.1 + third.3 + 100.0,
                    y: third.2 + third.4 / 2.0,
                },
            },
        )
        .expect("old stable-prefix address resolves against the current version");
    let RuntimeTextRangeFromPointsResolution::Resolved {
        anchor_caret,
        focus_caret,
        range,
    } = response.value.resolution
    else {
        panic!("cross-version range resolves atomically");
    };

    assert_eq!(response.revision, current_handle);
    assert_eq!(anchor_caret.address, anchor.address);
    assert_eq!(focus_caret.address.page_index, third.0);
    assert_eq!(range.selected_text, "first\n\nsecond\n\nthird");
    assert!(range.rects.len() >= 3);
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

fn text_run_bounds_by_text(
    document: &RuntimeDocument,
    revision_id: &str,
    expected: &str,
) -> (usize, f64, f64, f64, f64) {
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
            page.content.iter().find_map(|block| {
                block_text_run_by_text(block, 0.0, 0.0, expected)
                    .map(|(x, y, width, height)| (page_index, x, y, width, height))
            })
        })
        .unwrap_or_else(|| panic!("revision has a text run for {expected:?}"))
}

fn block_text_run_by_text(
    block: &RuntimeBlock<LineBox>,
    offset_x: f64,
    offset_y: f64,
    expected: &str,
) -> Option<(f64, f64, f64, f64)> {
    let block_x = offset_x + block.x;
    let block_y = offset_y + block.y;
    block.children.iter().find_map(|child| match child {
        RuntimeChild::Line(line) => line.runs.iter().find_map(|run| match run {
            LineRun::Text(run) if run.text == expected => {
                Some(run_bounds(run, block_x + line.x, block_y + line.y))
            }
            LineRun::Text(_) | LineRun::Atom(_) | LineRun::Ruby(_) => None,
        }),
        RuntimeChild::Block(child) => block_text_run_by_text(child, block_x, block_y, expected),
        RuntimeChild::Image(_) | RuntimeChild::Hr(_) => None,
    })
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
