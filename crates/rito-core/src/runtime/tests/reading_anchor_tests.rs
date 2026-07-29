use serde_json::json;

use super::fixture::{
    image_only_fixture_epub, layout, long_source_text_fixture_epub, multi_chapter_fixture_epub,
};
use crate::{
    layout::LineBreaking,
    runtime::{
        RuntimeBoundedRevisionRequest, RuntimeDocument, RuntimePageReadingAnchor,
        RuntimePageReadingAnchorUnavailableReason, RuntimeRevisionAccessErrorKind,
        RuntimeRevisionHandle, RuntimeRevisionWorkBudget, RuntimeSourceLocator,
        RuntimeSourceLocatorMatchedBy, RuntimeSourceLocatorPendingReason,
        RuntimeSourceLocatorResolution,
    },
};

#[test]
fn exact_page_anchor_round_trips_to_the_same_source_after_reflow() {
    let mut document = RuntimeDocument::open(&long_source_text_fixture_epub())
        .expect("long source document opens");
    let first = document
        .create_revision(&layout())
        .expect("first revision is created");
    let first_handle = RuntimeRevisionHandle::from(&first);
    let captured = (1..first.page_count)
        .find_map(|page_index| {
            let response = document
                .get_page_reading_anchor_at(&first_handle, page_index)
                .expect("known page anchor is returned");
            let RuntimePageReadingAnchor::Resolved { locator, .. } = &response.value else {
                return None;
            };
            locator
                .source_point
                .as_ref()
                .is_some_and(|point| point.text_offset > 0)
                .then_some(response)
        })
        .expect("fixture exposes a page that starts inside one source text node");
    assert_eq!(captured.revision, first_handle);
    let (captured_page, captured_spread, locator) = resolved_anchor(captured.value);
    let point = locator
        .source_point
        .as_ref()
        .expect("exact visible slice supplies a source point");
    assert!(point.text_offset > 0);
    assert!(locator
        .progression
        .is_some_and(|progression| progression > 0.0 && progression < 1.0));

    let first_projection = document
        .resolve_source_locator_at(&first_handle, locator.clone())
        .expect("captured locator resolves in its source revision");
    assert_resolved_projection(
        first_projection.value,
        captured_page,
        captured_spread,
        &locator,
    );

    let mut compact = layout();
    compact.viewport_height = 320.0;
    compact.page_height = 320.0;
    let second = document
        .create_revision(&compact)
        .expect("compact revision is created");
    let second_handle = RuntimeRevisionHandle::from(&second);
    let second_projection = document
        .resolve_source_locator_at(&second_handle, locator.clone())
        .expect("captured locator resolves after reflow");
    let RuntimeSourceLocatorResolution::Resolved {
        locator: projected_locator,
        page_index,
        matched_by,
        ..
    } = second_projection.value
    else {
        panic!("captured source point should resolve after reflow");
    };
    assert_eq!(matched_by, RuntimeSourceLocatorMatchedBy::SourcePoint);
    assert_eq!(projected_locator, locator);
    assert_ne!(page_index, captured_page);
}

#[test]
fn image_only_page_resolves_a_durable_fallback_anchor() {
    // Text-free pages used to answer Unavailable, which dead-ended both
    // progress persistence and publication spread publishing (a book
    // with plates could not be turned past them). The anchor now
    // degrades like the chapter-local reader: paint-target source
    // identity when the page carries it, else chapter-relative
    // progression — and must resolve back to the same page.
    let mut document =
        RuntimeDocument::open(&image_only_fixture_epub()).expect("image-only document opens");
    let revision = document
        .create_revision(&layout())
        .expect("image-only revision is created");
    let handle = RuntimeRevisionHandle::from(&revision);

    let response = document
        .get_page_reading_anchor_at(&handle, 0)
        .expect("known image page returns an authoritative response");

    let RuntimePageReadingAnchor::Resolved {
        locator,
        page_index: 0,
        ..
    } = response.value
    else {
        panic!("image-only page must resolve a durable fallback anchor");
    };
    let projection = document
        .resolve_source_locator_at(&handle, locator)
        .expect("fallback anchor resolves on its own revision");
    let RuntimeSourceLocatorResolution::Resolved { page_index, .. } = projection.value else {
        panic!("fallback anchor should project onto a page");
    };
    assert_eq!(page_index, 0);
    let invalid = document
        .get_page_reading_anchor_at(&handle, revision.page_count)
        .expect_err("an unknown page remains a request error");
    assert_eq!(
        invalid.kind,
        RuntimeRevisionAccessErrorKind::OperationFailed
    );
}

#[test]
fn durable_anchor_is_pending_when_the_new_revision_has_not_paginated_its_source() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("multi-chapter document opens");
    let full = document
        .create_revision(&layout())
        .expect("full revision is created");
    let full_handle = RuntimeRevisionHandle::from(&full);
    let locator = (0..full.page_count)
        .find_map(|page_index| {
            let response = document
                .get_page_reading_anchor_at(&full_handle, page_index)
                .expect("full page anchor is returned");
            let RuntimePageReadingAnchor::Resolved { locator, .. } = response.value else {
                return None;
            };
            (locator.href == "chapter-3.xhtml").then_some(locator)
        })
        .expect("full revision exposes chapter three source identity");
    let partial = document
        .create_bounded_revision(RuntimeBoundedRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Greedy,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .expect("partial revision starts");
    let partial_handle = RuntimeRevisionHandle::from(&partial.revision);

    let projection = document
        .resolve_source_locator_at(&partial_handle, locator)
        .expect("durable locator remains valid before its pages exist");

    assert!(matches!(
        projection.value,
        RuntimeSourceLocatorResolution::Pending {
            reason: RuntimeSourceLocatorPendingReason::NotPaginated,
            matched_by: RuntimeSourceLocatorMatchedBy::SourcePoint,
            ..
        }
    ));
}

fn resolved_anchor(anchor: RuntimePageReadingAnchor) -> (usize, usize, RuntimeSourceLocator) {
    let RuntimePageReadingAnchor::Resolved {
        page_index,
        spread_index,
        locator,
        ..
    } = anchor
    else {
        panic!("page should have an exact reading anchor");
    };
    (page_index, spread_index, locator)
}

fn assert_resolved_projection(
    resolution: RuntimeSourceLocatorResolution,
    expected_page: usize,
    expected_spread: usize,
    expected_locator: &RuntimeSourceLocator,
) {
    let RuntimeSourceLocatorResolution::Resolved {
        locator,
        page_index,
        spread_index,
        matched_by,
        ..
    } = resolution
    else {
        panic!("source locator should resolve");
    };
    assert_eq!(locator, *expected_locator);
    assert_eq!(page_index, expected_page);
    assert_eq!(spread_index, expected_spread);
    assert_eq!(matched_by, RuntimeSourceLocatorMatchedBy::SourcePoint);
}
