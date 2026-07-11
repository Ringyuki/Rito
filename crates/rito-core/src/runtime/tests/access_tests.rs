use serde_json::json;

use super::fixture::{fixture_epub, layout, multi_chapter_fixture_epub};
use crate::{
    layout::{LineBreaking, SearchTextPosition},
    runtime::{
        RuntimeBoundedRevisionRequest, RuntimeContinueRevisionRequest, RuntimeDocument,
        RuntimeInitialFrameRequest, RuntimeLocatorRequest, RuntimePrefetchRequest,
        RuntimeResourceKind, RuntimeRevisionAccessErrorKind, RuntimeRevisionHandle,
        RuntimeRevisionWorkBudget, RuntimeSearchRequest, RuntimeSourceLocator,
        RuntimeTextRangeGeometryRequest, RuntimeVersioned,
    },
};

fn handle_for(summary: &crate::runtime::RuntimeRevisionSummary) -> RuntimeRevisionHandle {
    RuntimeRevisionHandle::from(summary)
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
    document
        .get_page_targets_at(&handle, result.page_index)
        .expect("page targets");
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
    document
        .revision_bundle_at(&handle, true)
        .expect("revision bundle");
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
    assert_stale!(document.get_page_targets_at(&stale, 0));
    assert_stale!(document.get_page_text_positions_at(&stale, 0));
    assert_stale!(document.get_text_range_geometry_at(
        &stale,
        RuntimeTextRangeGeometryRequest {
            page_index: 0,
            start: position,
            end: position
        }
    ));
    assert_stale!(document.get_footnote_at(&stale, "missing"));
    assert_stale!(document.get_footnotes_at(&stale));
    assert_stale!(document.get_chapter_text_indices_at(&stale));
    assert_stale!(document.get_revision_summary_at(&stale));
    assert_stale!(document.revision_navigation_at(&stale));
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
