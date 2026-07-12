use serde_json::json;

use super::fixture::{fixture_epub, layout, multi_chapter_fixture_epub};
use crate::{
    interaction::{TextCaretAddress, TextCaretAffinity},
    layout::{LineBreaking, SearchTextPosition},
    runtime::{
        RuntimeBoundedRevisionRequest, RuntimeContinueRevisionRequest, RuntimeDocument,
        RuntimeExactSourceRangeRequest, RuntimeInitialFrameRequest, RuntimeLocatorRequest,
        RuntimePageTargetKind, RuntimePrefetchRequest, RuntimeResourceKind,
        RuntimeRevisionAccessErrorKind, RuntimeRevisionHandle, RuntimeRevisionWorkBudget,
        RuntimeSameFlowTextRangeRequest, RuntimeSearchRequest, RuntimeSemanticRole,
        RuntimeSourceLocator, RuntimeSourceLocatorPendingReason, RuntimeSourceLocatorResolution,
        RuntimeTextPointRequest, RuntimeTextRangeGeometryRequest, RuntimeVersioned,
    },
};

fn handle_for(summary: &crate::runtime::RuntimeRevisionSummary) -> RuntimeRevisionHandle {
    RuntimeRevisionHandle::from(summary)
}

#[test]
fn versioned_internal_target_locator_can_remain_pending() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let initial = document
        .create_bounded_revision(RuntimeBoundedRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Greedy,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .expect("first chapter is published");
    let handle = handle_for(&initial.revision);
    let targets = document
        .get_page_targets_at(&handle, 0)
        .expect("version-gated targets");
    let link = targets
        .value
        .entries
        .iter()
        .find(|target| target.label == "chapter one")
        .expect("future-chapter link target");
    assert_eq!(link.kind, RuntimePageTargetKind::Link);
    assert_eq!(link.href.as_deref(), Some("chapter-2.xhtml#target"));
    let destination = link
        .target_locator
        .clone()
        .expect("internal link has a canonical destination");
    assert_eq!(destination.href, "chapter-2.xhtml");
    assert_eq!(destination.anchor_id.as_deref(), Some("target"));

    let resolution = document
        .resolve_source_locator_at(&handle, destination)
        .expect("future target is a valid versioned locator");
    assert!(matches!(
        resolution.value,
        RuntimeSourceLocatorResolution::Pending {
            reason: RuntimeSourceLocatorPendingReason::NotPaginated,
            ..
        }
    ));
}

fn source_locator(href: &str) -> RuntimeSourceLocator {
    RuntimeSourceLocator {
        href: href.to_owned(),
        anchor_id: None,
        source_point: None,
        source_range: None,
        progression: None,
    }
}

fn search_request() -> RuntimeSearchRequest {
    RuntimeSearchRequest {
        query: "runtime".to_owned(),
        case_sensitive: false,
        whole_word: false,
        limit: Some(1),
    }
}

#[test]
fn revision_access_contract_is_serde_stable_and_reports_focused_errors() {
    let handle = RuntimeRevisionHandle::new("rev-7", 3);
    let wrapped = RuntimeVersioned::new(handle.clone(), None::<usize>);
    assert_eq!(
        serde_json::to_value(wrapped).expect("versioned option serializes"),
        json!({
            "revision": {"revisionId": "rev-7", "revisionVersion": 3},
            "value": null
        })
    );

    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let unknown = document
        .validate_revision_handle(&handle)
        .expect_err("unknown revision is rejected");
    assert_eq!(
        unknown.kind,
        RuntimeRevisionAccessErrorKind::UnknownRevision
    );
    assert_eq!(unknown.to_string(), "unknown revision: rev-7");
    assert_eq!(
        document
            .shape_provenance_diagnostic_at(&handle)
            .expect_err("forged diagnostic handle is rejected")
            .kind,
        RuntimeRevisionAccessErrorKind::UnknownRevision
    );
    assert_eq!(
        document
            .get_page_semantics_at(&handle, 0)
            .expect_err("forged page-semantics handle is rejected")
            .kind,
        RuntimeRevisionAccessErrorKind::UnknownRevision
    );

    let revision = document
        .create_revision(&layout())
        .expect("revision exists");
    let current = handle_for(&revision);
    let failed = document
        .get_frame_at(&current, revision.spread_count)
        .expect_err("operation failure is typed");
    assert_eq!(failed.kind, RuntimeRevisionAccessErrorKind::OperationFailed);
    assert!(failed.message.contains("unknown spread index"));
}

#[test]
fn eager_version_zero_supports_all_versioned_read_surfaces() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision exists");
    let handle = handle_for(&revision);
    assert_eq!(handle.revision_version, 0);

    let frame = document.get_frame_at(&handle, 0).expect("frame");
    assert_eq!(frame.revision, handle);
    document
        .get_frame_summary_at(&handle, 0)
        .expect("frame summary");
    document
        .get_frame_command_buffer_at(&handle, 0)
        .expect("command buffer");
    document
        .prefetch_frames_at(
            &handle,
            RuntimePrefetchRequest {
                spread_indexes: vec![0],
            },
        )
        .expect("prefetch");
    assert!(document
        .initial_frame_decision_at(
            &handle,
            RuntimeInitialFrameRequest {
                spread_index: Some(0),
                anchor_progress: None,
            },
        )
        .expect("initial frame")
        .value
        .is_some());
    assert_eq!(
        document
            .cached_frame_count_at(&handle)
            .expect("cache count")
            .value,
        Some(1)
    );
    document
        .frame_resource_warm_plan_at(&handle, 0)
        .expect("resource warm plan");
    document
        .get_resource_at(&handle, RuntimeResourceKind::Image, "Images/cover.png")
        .expect("resource");

    let search = document
        .search_at(&handle, search_request())
        .expect("search")
        .value;
    let result = search.results.first().expect("search result");
    document
        .resolve_locator_at(
            &handle,
            RuntimeLocatorRequest {
                href: "chapter.xhtml#intro".to_owned(),
            },
        )
        .expect("href locator");
    document
        .resolve_source_locator_at(&handle, source_locator("chapter.xhtml"))
        .expect("source locator");
    let targets = document
        .get_page_targets_at(&handle, result.page_index)
        .expect("page targets");
    assert_eq!(targets.revision, handle);
    assert!(targets
        .value
        .entries
        .iter()
        .any(|target| target.kind == RuntimePageTargetKind::Footnote));
    let semantics = document
        .get_page_semantics_at(&handle, result.page_index)
        .expect("page semantics");
    assert_eq!(semantics.revision, handle);
    assert_eq!(semantics.value.revision_id, handle.revision_id);
    assert_eq!(semantics.value.page_index, result.page_index);
    assert_eq!(semantics.value.spread_index, result.spread_index);
    assert!(semantics
        .value
        .nodes
        .iter()
        .any(|node| node.role == RuntimeSemanticRole::Paragraph));
    let wrong_page = document
        .get_page_semantics_at(&handle, revision.page_count)
        .expect_err("page outside this revision is rejected");
    assert_eq!(
        wrong_page.kind,
        RuntimeRevisionAccessErrorKind::OperationFailed
    );
    assert!(wrong_page.message.contains("unknown page index"));
    document
        .get_page_text_positions_at(&handle, result.page_index)
        .expect("text positions");
    document
        .get_text_range_geometry_at(
            &handle,
            RuntimeTextRangeGeometryRequest {
                page_index: result.page_index,
                start: result.match_range.start,
                end: result.match_range.end,
            },
        )
        .expect("range geometry");
    document
        .resolve_text_caret_at(
            &handle,
            RuntimeTextPointRequest {
                page_index: result.page_index,
                x: 0.0,
                y: 0.0,
            },
        )
        .expect("exact caret capability");
    let address = TextCaretAddress {
        page_index: result.page_index,
        block_index: 0,
        line_index: 0,
        run_index: 0,
        char_index: 0,
        affinity: TextCaretAffinity::Downstream,
    };
    document
        .resolve_same_flow_text_range_at(
            &handle,
            RuntimeSameFlowTextRangeRequest {
                anchor: address,
                focus: address,
            },
        )
        .expect("same-flow range capability");
    document
        .get_footnote_at(&handle, "chapter.xhtml#fn1")
        .expect("footnote");
    document.get_footnotes_at(&handle).expect("footnotes");
    document
        .get_chapter_text_indices_at(&handle)
        .expect("chapter text indices");
    document
        .get_revision_summary_at(&handle)
        .expect("revision summary");
    document
        .revision_navigation_at(&handle)
        .expect("revision navigation");
    let diagnostic = document
        .shape_provenance_diagnostic_at(&handle)
        .expect("shape provenance diagnostic");
    assert_eq!(diagnostic.revision, handle);
    assert_eq!(diagnostic.value.schema_version, 1);
    assert!(diagnostic.value.is_complete);
    assert_eq!(diagnostic.value.known_page_count, revision.page_count);
    assert_eq!(
        diagnostic.value.total_text_runs,
        diagnostic.value.exact_text_runs + diagnostic.value.unavailable_text_runs
    );
    assert_eq!(
        diagnostic.value.total_text_utf16_code_unit_count,
        diagnostic.value.exact_text_utf16_code_unit_count
            + diagnostic.value.unavailable_text_utf16_code_unit_count
    );
    assert_eq!(
        diagnostic
            .value
            .unavailable_reason_utf16_code_unit_counts
            .values()
            .sum::<usize>(),
        diagnostic.value.unavailable_text_utf16_code_unit_count
    );
    assert!(diagnostic.value.unavailable_affected_codepoints.len() <= 256);
    document
        .revision_bundle_at(&handle, true)
        .expect("revision bundle");
}

#[test]
fn revision_presentation_is_exact_and_omits_heavy_aggregates() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let initial = document
        .create_bounded_revision(RuntimeBoundedRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Greedy,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .expect("bounded revision starts");
    let handle = handle_for(&initial.revision);

    let presentation = document
        .revision_presentation_at(&handle)
        .expect("current presentation resolves");
    let bundle = document
        .revision_bundle_at(&handle, true)
        .expect("current bundle resolves");

    assert_eq!(presentation.revision, handle);
    assert_eq!(presentation.value.revision, initial.revision);
    assert_eq!(presentation.value.navigation, bundle.value.navigation);
    assert_eq!(presentation.value.toc_targets, bundle.value.toc_targets);
    assert_eq!(presentation.value.font_families, bundle.value.font_families);
    assert_eq!(
        presentation.value.required_font_faces,
        bundle.value.required_font_faces
    );

    let serialized = serde_json::to_value(&presentation.value)
        .expect("revision presentation serializes")
        .as_object()
        .expect("revision presentation is an object")
        .clone();
    for field in ["revision", "navigation", "tocTargets", "fontFamilies"] {
        assert!(serialized.contains_key(field), "missing {field}");
    }
    assert!(!serialized.contains_key("footnotes"));
    assert!(!serialized.contains_key("chapterTextIndices"));
}

#[test]
fn stale_access_and_release_cannot_observe_or_destroy_a_newer_revision() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("multi-chapter document opens");
    let initial = document
        .create_bounded_revision(RuntimeBoundedRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Greedy,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .expect("bounded revision starts");
    let stale = handle_for(&initial.revision);
    let stable_hash = document
        .get_frame_at(&stale, 0)
        .expect("version zero frame")
        .value
        .command_hash;
    let cursor = initial.continuation.expect("more chapters remain");
    let advanced = document
        .continue_revision(RuntimeContinueRevisionRequest {
            revision_id: cursor.revision_id,
            revision_version: cursor.revision_version,
            cursor: cursor.cursor,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .expect("revision advances");
    let current = handle_for(&advanced.revision);
    assert_eq!(current.revision_version, 1);
    assert_eq!(
        document
            .get_frame_at(&current, 0)
            .expect("stable prefix frame")
            .value
            .command_hash,
        stable_hash
    );

    macro_rules! assert_stale {
        ($result:expr) => {{
            let error = $result.expect_err("stale handle must fail before its operation");
            assert_eq!(
                error.kind,
                RuntimeRevisionAccessErrorKind::StaleRevisionVersion
            );
        }};
    }
    let position = SearchTextPosition {
        block_index: 0,
        line_index: 0,
        run_index: 0,
        char_index: 0,
    };
    assert_stale!(document.get_frame_at(&stale, 0));
    assert_stale!(document.get_frame_summary_at(&stale, 0));
    assert_stale!(document.get_frame_command_buffer_at(&stale, 0));
    assert_stale!(document.prefetch_frames_at(
        &stale,
        RuntimePrefetchRequest {
            spread_indexes: vec![0]
        }
    ));
    assert_stale!(document.initial_frame_decision_at(&stale, RuntimeInitialFrameRequest::default()));
    assert_stale!(document.cached_frame_count_at(&stale));
    assert_stale!(document.frame_resource_warm_plan_at(&stale, 0));
    assert_stale!(document.get_resource_at(&stale, RuntimeResourceKind::Image, "missing.png"));
    assert_stale!(document.search_at(&stale, search_request()));
    assert_stale!(document.resolve_locator_at(
        &stale,
        RuntimeLocatorRequest {
            href: "chapter-1.xhtml".to_owned()
        }
    ));
    assert_stale!(document.resolve_source_locator_at(&stale, source_locator("chapter-1.xhtml")));
    assert_stale!(document.resolve_exact_source_range_at(
        &stale,
        RuntimeExactSourceRangeRequest {
            href: "chapter-1.xhtml".to_owned(),
            source_range: crate::runtime::RuntimeSourceRange {
                start: crate::runtime::RuntimeSourcePoint {
                    node_path: vec![0],
                    text_offset: 0
                },
                end: crate::runtime::RuntimeSourcePoint {
                    node_path: vec![0],
                    text_offset: 1
                }
            }
        }
    ));
    assert_stale!(document.get_page_targets_at(&stale, 0));
    assert_stale!(document.get_page_semantics_at(&stale, 0));
    assert_stale!(document.get_page_text_positions_at(&stale, 0));
    assert_stale!(document.get_text_range_geometry_at(
        &stale,
        RuntimeTextRangeGeometryRequest {
            page_index: 0,
            start: position,
            end: position
        }
    ));
    assert_stale!(document.resolve_text_caret_at(
        &stale,
        RuntimeTextPointRequest {
            page_index: 0,
            x: 0.0,
            y: 0.0
        }
    ));
    let address = TextCaretAddress {
        page_index: 0,
        block_index: 0,
        line_index: 0,
        run_index: 0,
        char_index: 0,
        affinity: TextCaretAffinity::Downstream,
    };
    assert_stale!(document.resolve_same_flow_text_range_at(
        &stale,
        RuntimeSameFlowTextRangeRequest {
            anchor: address,
            focus: address
        }
    ));
    assert_stale!(document.get_footnote_at(&stale, "missing"));
    assert_stale!(document.get_footnotes_at(&stale));
    assert_stale!(document.get_chapter_text_indices_at(&stale));
    assert_stale!(document.get_revision_summary_at(&stale));
    assert_stale!(document.revision_navigation_at(&stale));
    assert_stale!(document.revision_presentation_at(&stale));
    assert_stale!(document.shape_provenance_diagnostic_at(&stale));
    assert_stale!(document.revision_bundle_at(&stale, false));
    assert_stale!(document.release_revision_at(&stale));

    assert!(document.has_revision(&current.revision_id));
    let live_cursor = advanced.continuation.expect("third chapter remains");
    let final_advance = document
        .continue_revision(RuntimeContinueRevisionRequest {
            revision_id: live_cursor.revision_id,
            revision_version: live_cursor.revision_version,
            cursor: live_cursor.cursor,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .expect("stale release preserved the live cursor");
    let final_handle = handle_for(&final_advance.revision);
    assert!(document
        .release_revision_at(&final_handle)
        .expect("current release succeeds"));
    assert!(!document.has_revision(&final_handle.revision_id));
}
