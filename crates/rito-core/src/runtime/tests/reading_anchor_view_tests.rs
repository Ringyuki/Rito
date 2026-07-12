use super::fixture::{layout, long_source_text_fixture_epub, multi_chapter_fixture_epub};
use crate::{
    layout::{LayoutConfig, LineBreaking},
    runtime::{
        RuntimeDocument, RuntimePageReadingAnchor, RuntimeRevisionHandle, RuntimeSourceLocator,
        RuntimeSourceLocatorResolution, RuntimeViewRevisionDisplay, RuntimeViewRevisionMode,
        RuntimeViewRevisionRequest,
    },
};

#[test]
fn full_view_projects_the_preserve_locator_before_selecting_its_frame() {
    let mut document = RuntimeDocument::open(&long_source_text_fixture_epub())
        .expect("long source document opens");
    let first = document
        .create_view_revision_bundle(view_request(layout(), 0, None, None))
        .expect("first full view is created");
    let first_handle = RuntimeRevisionHandle::from(&first.revision.bundle.revision);
    let locator = (0..first.revision.bundle.revision.page_count)
        .rev()
        .find_map(|page_index| {
            let response = document
                .get_page_reading_anchor_at(&first_handle, page_index)
                .expect("known page anchor is returned");
            let RuntimePageReadingAnchor::Resolved {
                spread_index,
                locator,
                ..
            } = response.value
            else {
                return None;
            };
            (spread_index > 0).then_some(locator)
        })
        .expect("fixture has a durable anchor beyond the first spread");
    let mut compact = layout();
    compact.viewport_height = 320.0;
    compact.page_height = 320.0;

    let replacement = document
        .create_view_revision_bundle(view_request(compact, 0, None, Some(locator.clone())))
        .expect("replacement view resolves its source anchor");
    let replacement_handle = RuntimeRevisionHandle::from(&replacement.revision.bundle.revision);
    let projection = document
        .resolve_source_locator_at(&replacement_handle, locator)
        .expect("preserved locator remains resolvable");
    let RuntimeSourceLocatorResolution::Resolved { spread_index, .. } = projection.value else {
        panic!("preserved locator should resolve in a full view");
    };

    assert_ne!(
        spread_index, 0,
        "test must distinguish anchor from fallback"
    );
    assert_eq!(
        replacement
            .revision
            .initial_frame
            .as_ref()
            .map(|frame| frame.spread_index),
        Some(spread_index)
    );
}

#[test]
fn visual_preview_and_follow_up_keep_the_same_preserve_locator() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("multi-chapter document opens");
    let initial = document
        .create_view_revision_bundle(RuntimeViewRevisionRequest {
            mode: RuntimeViewRevisionMode::Preview,
            ..view_request(layout(), 0, None, None)
        })
        .expect("initial preview is created");
    let initial_handle = RuntimeRevisionHandle::from(&initial.revision.bundle.revision);
    let (active_spread_index, locator) = (0..initial.revision.bundle.revision.page_count)
        .find_map(|page_index| {
            let response = document
                .get_page_reading_anchor_at(&initial_handle, page_index)
                .expect("initial preview page anchor is returned");
            let RuntimePageReadingAnchor::Resolved {
                spread_index,
                locator,
                ..
            } = response.value
            else {
                return None;
            };
            (locator.href == "chapter-2.xhtml").then_some((spread_index, locator))
        })
        .expect("initial preview exposes chapter two");
    let previous_revision_id = initial.revision.bundle.revision.revision_id.clone();

    let preview = document
        .create_view_revision_bundle(RuntimeViewRevisionRequest {
            mode: RuntimeViewRevisionMode::Preview,
            ..view_request(
                layout(),
                active_spread_index,
                Some(previous_revision_id),
                Some(locator.clone()),
            )
        })
        .expect("active chapter preview preserves its locator");
    let preview_handle = RuntimeRevisionHandle::from(&preview.revision.bundle.revision);
    let projection = document
        .resolve_source_locator_at(&preview_handle, locator.clone())
        .expect("locator resolves inside preview");
    let RuntimeSourceLocatorResolution::Resolved { spread_index, .. } = projection.value else {
        panic!("preserved locator should resolve in its chapter preview");
    };

    assert_eq!(preview.display, RuntimeViewRevisionDisplay::VisualPreview);
    assert_eq!(
        preview
            .revision
            .initial_frame
            .as_ref()
            .map(|frame| (frame.spread_index, frame.display_spread_index)),
        Some((spread_index, active_spread_index))
    );
    assert_eq!(
        preview
            .follow_up
            .as_ref()
            .and_then(|follow_up| follow_up.request.preserve_locator.as_ref()),
        Some(&locator)
    );
}

#[test]
fn invalid_preserve_locator_rejects_and_releases_the_replacement_revision() {
    let mut document = RuntimeDocument::open(&long_source_text_fixture_epub())
        .expect("long source document opens");
    let revision_count = document.revision_count();
    let invalid = RuntimeSourceLocator {
        href: "missing.xhtml".to_owned(),
        anchor_id: None,
        source_point: None,
        source_range: None,
        progression: None,
    };

    let error = document
        .create_view_revision_bundle(view_request(layout(), 0, None, Some(invalid)))
        .expect_err("invalid preserve intent must reject the replacement view");

    assert!(error.message().contains("invalid preserve locator"));
    assert_eq!(document.revision_count(), revision_count);
}

fn view_request(
    layout_config: LayoutConfig,
    active_spread_index: usize,
    previous_revision_id: Option<String>,
    preserve_locator: Option<RuntimeSourceLocator>,
) -> RuntimeViewRevisionRequest {
    RuntimeViewRevisionRequest {
        layout_config,
        line_breaking: LineBreaking::Greedy,
        active_spread_index,
        previous_revision_id,
        preserve_locator,
        mode: RuntimeViewRevisionMode::Full,
    }
}
