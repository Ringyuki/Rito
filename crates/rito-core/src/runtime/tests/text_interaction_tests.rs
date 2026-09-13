use super::pinned_font_policy_fixtures::{content_epub, face, layout, policy, title_font};
use crate::{
    interaction::{TextCaretAddress, TextCaretAffinity, TextInteractionUnavailableReason},
    runtime::{
        RuntimeDocument, RuntimeExactSourceRangeRequest, RuntimeExactSourceRangeResolution,
        RuntimePinnedFontGenericRole, RuntimeRevisionAccessErrorKind, RuntimeRevisionHandle,
        RuntimeSearchRequest, RuntimeSearchSource, RuntimeSourcePoint, RuntimeSourceRange,
        RuntimeTextCaretResolution, RuntimeTextCaretResponse, RuntimeTextPointRequest,
        RuntimeTextRangeToPointRequest, RuntimeVersioned,
    },
};
use serde_json::json;

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
        .create_revision(&layout())
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
    let mut document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("document opens");
    let revision = document
        .create_revision(&layout())
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
fn exact_text_reads_reject_stale_versions_and_non_finite_points() {
    let bytes = content_epub("en", "<p>Wi</p>", "", None);
    let mut document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("document opens");
    let revision = document
        .create_revision(&layout())
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
#[test]
fn wrapped_break_all_paragraph_resolves_exact_source_range_by_node_path() {
    let mixed = "柊丁柊七柊万柊世";
    let wrapped = format!("{mixed}{mixed}");
    let body = format!(
        r#"<p>柊柊柊柊柊</p><p>丁七万世</p><p>柊柊丁七</p><p>WiAV</p><p class="wrapped">{wrapped}</p>"#
    );
    let stylesheet = r#"
body { margin: 0; font-family: "Author", serif; font-size: 32px; line-height: 1.5; }
p { margin: 0 0 12px; }
.wrapped { width: 180px; word-break: break-all; }
"#;
    let bytes = content_epub(
        "zh",
        &body,
        stylesheet,
        Some(&crate::runtime::tests::pinned_font_policy_fixtures::author_illustration_font()),
    );
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &bytes,
        policy(vec![face(
            crate::runtime::tests::pinned_font_policy_fixtures::illustration_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("zh"),
        )]),
    )
    .expect("pinned document opens");
    let revision = document
        .create_revision(&layout())
        .expect("font-aware revision is created");
    let handle = RuntimeRevisionHandle::from(&revision);
    let projected = document
        .resolve_exact_source_range_at(
            &handle,
            RuntimeExactSourceRangeRequest {
                href: "chapter.xhtml".to_owned(),
                source_range: RuntimeSourceRange {
                    start: RuntimeSourcePoint {
                        node_path: vec![4, 0],
                        text_offset: 0,
                    },
                    end: RuntimeSourcePoint {
                        node_path: vec![4, 0],
                        text_offset: 16,
                    },
                },
            },
        )
        .expect("request resolves");
    match projected.value.resolution {
        RuntimeExactSourceRangeResolution::Resolved { range } => {
            assert_eq!(range.selected_text, wrapped);
            assert!(range.rects.len() > 1, "wrapped range spans several lines");
        }
        other => panic!("expected resolved wrapped range, got {other:?}"),
    }
}
