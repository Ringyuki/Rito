use serde_json::json;

use super::fixture::{fixture_epub, layout, multi_chapter_fixture_epub};
use crate::{
    interaction::{TextCaretAddress, TextCaretAffinity},
    runtime::{
        RuntimeDocument, RuntimeInitialFrameRequest, RuntimeLocatorRequest, RuntimePageTargetKind,
        RuntimePrefetchRequest, RuntimeResourceKind, RuntimeRevisionAccessErrorKind,
        RuntimeRevisionHandle, RuntimeSearchRequest, RuntimeSemanticRole, RuntimeSourceLocator,
        RuntimeTextPointRequest, RuntimeTextRangeGeometryRequest, RuntimeTextRangeRequest,
        RuntimeVersioned,
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

    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
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
        .get_frame_command_buffer_metadata_at(&current, revision.spread_count)
        .expect_err("operation failure is typed");
    assert_eq!(failed.kind, RuntimeRevisionAccessErrorKind::OperationFailed);
    assert!(failed.message.contains("unknown spread index"));
}

#[test]
fn eager_version_zero_supports_all_versioned_read_surfaces() {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision exists");
    let handle = handle_for(&revision);
    assert_eq!(handle.revision_version, 0);

    let frame = document
        .get_frame_command_buffer_metadata_at(&handle, 0)
        .expect("command buffer metadata");
    assert_eq!(frame.revision, handle);
    document
        .get_frame_command_buffer_at(&handle, 0)
        .expect("command buffer");
    document
        .read_frame_command_buffer_at(&handle, 0)
        .expect("command buffer bytes");
    document
        .get_frame_image_resource_hrefs_at(&handle, 0)
        .expect("frame image refs");
    for error in [
        document
            .get_frame_command_buffer_metadata_at(&handle, revision.spread_count)
            .expect_err("missing metadata spread fails"),
        document
            .read_frame_command_buffer_at(&handle, revision.spread_count)
            .expect_err("missing byte spread fails"),
        document
            .get_frame_image_resource_hrefs_at(&handle, revision.spread_count)
            .expect_err("missing image-resource spread fails"),
    ] {
        assert_eq!(error.kind, RuntimeRevisionAccessErrorKind::OperationFailed);
    }
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
        .resolve_text_range_at(
            &handle,
            RuntimeTextRangeRequest {
                anchor: address,
                focus: address,
            },
        )
        .expect("text-range range capability");
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
fn revision_presentation_is_exact_and_omits_heavy_aggregates() {
    let mut document = RuntimeDocument::open_pinned_for_tests(&multi_chapter_fixture_epub())
        .expect("document opens");
    let initial = document
        .create_revision(&layout())
        .expect("revision is created");
    let handle = handle_for(&initial);

    let presentation = document
        .revision_presentation_at(&handle)
        .expect("current presentation resolves");
    let bundle = document
        .revision_bundle_at(&handle, true)
        .expect("current bundle resolves");

    assert_eq!(presentation.revision, handle);
    assert_eq!(presentation.value.revision, initial);
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
    assert!(!serialized.contains_key("fontVerticalMetricDemands"));
    assert!(!serde_json::to_value(&bundle.value)
        .expect("revision bundle serializes")
        .as_object()
        .expect("revision bundle is an object")
        .contains_key("fontVerticalMetricDemands"));
}
