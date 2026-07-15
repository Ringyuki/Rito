use super::{assert_bounded_is_eager_prefix, bounded_request, continue_request};
use crate::layout::LineBreaking;
use crate::runtime::tests::fixture::{
    double_layout, empty_chapter_fixture_epub, layout, long_source_text_fixture_epub,
    many_chapter_fixture_epub, many_empty_chapter_fixture_epub, multi_chapter_fixture_epub,
    nested_transparent_container_fixture_epub, source_locator_fixture_epub,
};
use crate::runtime::{
    RuntimeBoundedRevisionRequest, RuntimeDocument, RuntimeRevisionHandle, RuntimeRevisionStatus,
    RuntimeSourceLocator, RuntimeSourceLocatorPendingReason, RuntimeSourceLocatorResolution,
};

#[test]
fn bounded_optimal_line_breaking_matches_eager() {
    let bytes = multi_chapter_fixture_epub();
    let config = layout();
    let mut eager = RuntimeDocument::open(&bytes).expect("eager document opens");
    let eager_revision = eager
        .create_revision_with_line_breaking(&config, LineBreaking::Optimal)
        .expect("eager optimal revision completes");
    let mut bounded = RuntimeDocument::open(&bytes).expect("bounded document opens");
    let initial = bounded
        .create_bounded_revision(RuntimeBoundedRevisionRequest {
            layout_config: config,
            line_breaking: LineBreaking::Optimal,
            budget: super::budget(1),
        })
        .expect("bounded optimal revision starts");
    let completed = super::complete_revision(&mut bounded, initial);

    assert_eq!(
        bounded.revisions[&completed.revision.revision_id]
            .layout
            .pages,
        eager.revisions[&eager_revision.revision_id].layout.pages
    );
}

#[test]
fn long_greedy_paragraph_advances_versions_without_publishing_partial_layout() {
    let bytes = long_source_text_fixture_epub();
    let config = layout();
    let mut eager = RuntimeDocument::open(&bytes).expect("eager document opens");
    let eager_revision = eager
        .create_revision(&config)
        .expect("eager revision completes");
    let mut bounded = RuntimeDocument::open(&bytes).expect("bounded document opens");
    let mut advance = bounded
        .create_bounded_revision(bounded_request(config, 1))
        .expect("bounded revision starts");

    assert_eq!(advance.revision.status, RuntimeRevisionStatus::Warming);
    assert_eq!(advance.revision.revision_version, 0);
    assert_eq!(advance.processed_top_level_nodes, 1);
    assert_eq!(advance.revision.known_extent.page_count, 0);
    assert_eq!(advance.newly_known_pages.start_page, 0);
    assert_eq!(advance.newly_known_pages.end_page_exclusive, 0);

    let mut continuation_count = 0;
    while let Some(cursor) = advance.continuation.clone() {
        let previous_version = advance.revision.revision_version;
        advance = bounded
            .continue_revision(continue_request(&cursor, 1))
            .expect("paragraph continuation advances");
        continuation_count += 1;
        assert_eq!(advance.revision.revision_version, previous_version + 1);
        assert_eq!(advance.processed_top_level_nodes, 0);
        if advance.revision.status != RuntimeRevisionStatus::Complete {
            assert_eq!(advance.revision.status, RuntimeRevisionStatus::Warming);
            assert_eq!(advance.revision.known_extent.page_count, 0);
            assert_eq!(advance.newly_known_pages.start_page, 0);
            assert_eq!(advance.newly_known_pages.end_page_exclusive, 0);
        }
    }

    assert!(continuation_count > 1);
    assert_eq!(advance.revision.status, RuntimeRevisionStatus::Complete);
    assert_eq!(
        bounded.revisions[&advance.revision.revision_id]
            .layout
            .pages,
        eager.revisions[&eager_revision.revision_id].layout.pages
    );
    assert_eq!(
        bounded.revisions[&advance.revision.revision_id]
            .layout
            .summary,
        eager.revisions[&eager_revision.revision_id].layout.summary
    );
}

#[test]
fn nested_transparent_container_publishes_stable_frames_before_completion() {
    let bytes = nested_transparent_container_fixture_epub();
    let config = layout();
    let mut eager = RuntimeDocument::open(&bytes).expect("eager document opens");
    let eager_revision = eager
        .create_revision(&config)
        .expect("eager revision completes");
    let mut bounded = RuntimeDocument::open(&bytes).expect("bounded document opens");
    let mut advance = bounded
        .create_bounded_revision(bounded_request(config, 1))
        .expect("bounded revision starts");

    assert_ne!(advance.revision.status, RuntimeRevisionStatus::Complete);
    assert_eq!(advance.processed_top_level_nodes, 1);
    let mut stable_frame_hashes = Vec::new();
    assert_published_frames_stable(&mut bounded, &advance, &mut stable_frame_hashes);
    let mut published_before_completion = advance.revision.known_extent.page_count > 0;

    let mut continuation_count = 0;
    while let Some(cursor) = advance.continuation.clone() {
        advance = bounded
            .continue_revision(continue_request(&cursor, 1))
            .expect("nested container continuation advances");
        continuation_count += 1;
        assert_eq!(advance.processed_top_level_nodes, 0);
        assert_published_frames_stable(&mut bounded, &advance, &mut stable_frame_hashes);
        published_before_completion |= advance.revision.status != RuntimeRevisionStatus::Complete
            && advance.revision.known_extent.page_count > 0;
    }

    assert!(continuation_count > 1);
    assert!(published_before_completion);
    assert_eq!(advance.revision.status, RuntimeRevisionStatus::Complete);
    let eager_layout = &eager.revisions[&eager_revision.revision_id].layout;
    let bounded_layout = &bounded.revisions[&advance.revision.revision_id].layout;
    assert_eq!(bounded_layout.pages, eager_layout.pages);
    assert_eq!(bounded_layout.summary, eager_layout.summary);
    for spread_index in 0..advance.revision.spread_count {
        assert_eq!(
            bounded
                .get_frame(&advance.revision.revision_id, spread_index)
                .expect("bounded frame exists")
                .command_hash,
            eager
                .get_frame(&eager_revision.revision_id, spread_index)
                .expect("eager frame exists")
                .command_hash
        );
    }
}

fn assert_published_frames_stable(
    document: &mut RuntimeDocument,
    advance: &crate::runtime::RuntimeRevisionAdvance,
    stable_hashes: &mut Vec<String>,
) {
    for (spread_index, expected_hash) in stable_hashes.iter().enumerate() {
        assert_eq!(
            document
                .get_frame(&advance.revision.revision_id, spread_index)
                .expect("previously published frame remains available")
                .command_hash,
            *expected_hash,
            "published spread {spread_index} changed after continuation"
        );
    }
    for spread_index in stable_hashes.len()..advance.revision.spread_count {
        stable_hashes.push(
            document
                .get_frame(&advance.revision.revision_id, spread_index)
                .expect("newly published frame exists")
                .command_hash,
        );
    }
}

#[test]
fn bounded_multichapter_completion_exactly_matches_eager_layout_and_frames() {
    let bytes = multi_chapter_fixture_epub();
    let mut eager = RuntimeDocument::open(&bytes).expect("eager document opens");
    let eager_revision = eager
        .create_revision(&layout())
        .expect("eager revision completes");
    let mut bounded = RuntimeDocument::open(&bytes).expect("bounded document opens");

    let mut advance = bounded
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("bounded revision starts");

    assert_ne!(advance.revision.status, RuntimeRevisionStatus::Complete);
    assert!(!bounded.document().chapters[1].source_loaded);
    assert!(!bounded.document().chapters[2].source_loaded);
    let mut previous_extent = advance.previous_known_extent;
    loop {
        assert_eq!(advance.previous_known_extent, previous_extent);
        assert_bounded_is_eager_prefix(
            &bounded,
            &advance.revision.revision_id,
            &eager,
            &eager_revision.revision_id,
        );
        assert!(advance.revision.known_extent.page_count >= previous_extent.page_count);

        let stable_frame = if advance.revision.spread_count > 0 {
            let spread_index = advance.revision.spread_count - 1;
            let hash = if advance.revision.revision_version.is_multiple_of(2) {
                bounded
                    .get_frame_command_buffer_metadata(&advance.revision.revision_id, spread_index)
                    .expect("known packed frame exists")
                    .command_hash
            } else {
                bounded
                    .get_frame(&advance.revision.revision_id, spread_index)
                    .expect("known JSON frame exists")
                    .command_hash
            };
            Some((spread_index, hash))
        } else {
            None
        };
        let Some(cursor) = advance.continuation.clone() else {
            break;
        };
        previous_extent = advance.revision.known_extent;
        advance = bounded
            .continue_revision(continue_request(&cursor, 1))
            .expect("continuation advances");
        assert_eq!(
            bounded.cached_frame_count(&advance.revision.revision_id),
            Some(0),
            "accepted advances invalidate the revision frame cache"
        );
        if let Some((spread_index, hash)) = stable_frame {
            assert_eq!(
                bounded
                    .get_frame_command_buffer_metadata(&advance.revision.revision_id, spread_index)
                    .expect("previously published packed frame remains available")
                    .command_hash,
                hash,
                "a published spread must never change across advances"
            );
        }
    }
    let completed = advance;
    assert_eq!(completed.revision.status, RuntimeRevisionStatus::Complete);
    assert_eq!(
        completed.revision.final_extent,
        Some(completed.revision.known_extent)
    );

    let eager_layout = &eager.revisions[&eager_revision.revision_id].layout;
    let bounded_layout = &bounded.revisions[&completed.revision.revision_id].layout;
    assert_eq!(bounded_layout.pages, eager_layout.pages);
    assert_eq!(
        bounded_layout.chapter_start_pages,
        eager_layout.chapter_start_pages
    );
    assert_eq!(bounded_layout.summary, eager_layout.summary);
    for spread_index in 0..completed.revision.spread_count {
        let eager_frame = eager
            .get_frame(&eager_revision.revision_id, spread_index)
            .expect("eager frame exists");
        let bounded_frame = bounded
            .get_frame(&completed.revision.revision_id, spread_index)
            .expect("bounded frame exists");
        assert_eq!(bounded_frame.command_hash, eager_frame.command_hash);
    }
}

#[test]
fn one_public_quantum_shares_private_work_limits_across_chapters() {
    let bytes = many_chapter_fixture_epub(40);
    let mut eager = RuntimeDocument::open(&bytes).expect("eager document opens");
    let eager_revision = eager
        .create_revision(&layout())
        .expect("eager revision completes");
    let mut bounded = RuntimeDocument::open(&bytes).expect("bounded document opens");
    let initial = bounded
        .create_bounded_revision(bounded_request(layout(), 64))
        .expect("bounded revision starts");

    assert_ne!(initial.revision.status, RuntimeRevisionStatus::Complete);
    assert!(initial.processed_top_level_nodes > 0);
    assert!(initial.processed_top_level_nodes < 40);

    let completed = super::complete_revision(&mut bounded, initial);
    let eager_layout = &eager.revisions[&eager_revision.revision_id].layout;
    let bounded_layout = &bounded.revisions[&completed.revision.revision_id].layout;
    assert_eq!(bounded_layout.pages, eager_layout.pages);
    assert_eq!(
        bounded_layout.chapter_start_pages,
        eager_layout.chapter_start_pages
    );
    assert_eq!(bounded_layout.summary, eager_layout.summary);
    for spread_index in 0..completed.revision.spread_count {
        assert_eq!(
            bounded
                .get_frame(&completed.revision.revision_id, spread_index)
                .expect("bounded frame exists")
                .command_hash,
            eager
                .get_frame(&eager_revision.revision_id, spread_index)
                .expect("eager frame exists")
                .command_hash
        );
    }
}

#[test]
fn empty_chapter_completion_keeps_its_synthetic_public_budget_slot() {
    let bytes = many_empty_chapter_fixture_epub(3);
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let mut advance = document
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("bounded revision starts");

    assert_ne!(advance.revision.status, RuntimeRevisionStatus::Complete);
    assert_eq!(advance.processed_top_level_nodes, 0);
    assert!(document.document().chapters[0].source_loaded);
    assert!(!document.document().chapters[1].source_loaded);

    let mut quantum_count = 1;
    while let Some(cursor) = advance.continuation.clone() {
        advance = document
            .continue_revision(continue_request(&cursor, 1))
            .expect("empty chapter continuation advances");
        quantum_count += 1;
        assert_eq!(advance.processed_top_level_nodes, 0);
    }

    assert_eq!(quantum_count, 3);
    assert_eq!(advance.revision.status, RuntimeRevisionStatus::Complete);
    assert_eq!(advance.revision.known_extent.page_count, 0);
}

#[test]
fn shape_diagnostic_marks_ready_as_prefix_and_complete_as_final() {
    let bytes = multi_chapter_fixture_epub();
    let mut eager = RuntimeDocument::open(&bytes).expect("eager document opens");
    let eager_revision = eager
        .create_revision(&layout())
        .expect("eager revision completes");
    let eager_diagnostic = eager
        .shape_provenance_diagnostic_at(&RuntimeRevisionHandle::from(&eager_revision))
        .expect("eager diagnostic");
    assert!(eager_diagnostic.value.is_complete);

    let mut bounded = RuntimeDocument::open(&bytes).expect("bounded document opens");
    let mut advance = bounded
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("bounded revision starts");
    assert_eq!(advance.revision.status, RuntimeRevisionStatus::Ready);
    let ready_diagnostic = bounded
        .shape_provenance_diagnostic_at(&RuntimeRevisionHandle::from(&advance.revision))
        .expect("ready diagnostic");
    assert!(!ready_diagnostic.value.is_complete);
    assert_eq!(
        ready_diagnostic.value.known_page_count,
        advance.revision.known_extent.page_count
    );

    while let Some(cursor) = advance.continuation.clone() {
        advance = bounded
            .continue_revision(continue_request(&cursor, 1))
            .expect("bounded continuation advances");
    }
    assert_eq!(advance.revision.status, RuntimeRevisionStatus::Complete);
    let complete_diagnostic = bounded
        .shape_provenance_diagnostic_at(&RuntimeRevisionHandle::from(&advance.revision))
        .expect("complete diagnostic");
    assert!(complete_diagnostic.value.is_complete);
    assert_eq!(complete_diagnostic.value, eager_diagnostic.value);
}

#[test]
fn source_locator_changes_from_pending_to_resolved_as_pages_grow() {
    let bytes = multi_chapter_fixture_epub();
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let mut advance = document
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("bounded revision starts");
    let locator = RuntimeSourceLocator {
        href: "chapter-3.xhtml".to_owned(),
        anchor_id: None,
        source_point: None,
        source_range: None,
        progression: None,
    };

    let pending = document
        .resolve_source_locator(&advance.revision.revision_id, locator.clone())
        .expect("source locator is valid");
    assert!(matches!(
        pending,
        RuntimeSourceLocatorResolution::Pending {
            reason: RuntimeSourceLocatorPendingReason::NotPaginated,
            ..
        }
    ));

    loop {
        let Some(cursor) = advance.continuation else {
            panic!("chapter three should resolve before completion is lost");
        };
        advance = document
            .continue_revision(continue_request(&cursor, 1))
            .expect("continuation advances");
        let resolution = document
            .resolve_source_locator(&advance.revision.revision_id, locator.clone())
            .expect("source locator remains valid");
        if matches!(resolution, RuntimeSourceLocatorResolution::Resolved { .. }) {
            break;
        }
    }
}

#[test]
fn double_spread_keeps_dangling_tail_out_of_the_published_layout() {
    let bytes = source_locator_fixture_epub();
    let mut config = double_layout();
    config.page_width = 180.0;
    config.page_height = 80.0;
    config.margin_top = 10.0;
    config.margin_right = 10.0;
    config.margin_bottom = 10.0;
    config.margin_left = 10.0;
    config.first_page_alone = false;
    let mut eager = RuntimeDocument::open(&bytes).expect("eager document opens");
    let eager_revision = eager
        .create_revision(&config)
        .expect("eager double revision completes");
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");
    let mut advance = document
        .create_bounded_revision(bounded_request(config, 1))
        .expect("bounded double revision starts");
    let mut saw_withheld_tail = false;
    loop {
        assert_bounded_is_eager_prefix(
            &document,
            &advance.revision.revision_id,
            &eager,
            &eager_revision.revision_id,
        );
        let revision = &document.revisions[&advance.revision.revision_id];
        assert_eq!(
            revision.layout.pages.len(),
            advance.revision.known_extent.page_count
        );
        assert_eq!(
            revision.layout.summary.pagination_flow.page_count,
            advance.revision.known_extent.page_count
        );
        assert_eq!(
            revision
                .layout
                .summary
                .pagination_flow
                .display_list_flow
                .spread_count,
            advance.revision.known_extent.spread_count
        );
        assert!(document
            .get_frame(
                &advance.revision.revision_id,
                advance.revision.known_extent.spread_count,
            )
            .is_err());

        let Some(cursor) = advance.continuation.clone() else {
            break;
        };
        if document
            .continuation_unpublished_page_count(&cursor.cursor)
            .is_some_and(|count| count > 0)
        {
            saw_withheld_tail = true;
            assert!(document
                .get_page_targets(
                    &advance.revision.revision_id,
                    advance.revision.known_extent.page_count,
                )
                .is_err());
        }
        advance = document
            .continue_revision(continue_request(&cursor, 1))
            .expect("double continuation advances");
    }
    assert!(
        saw_withheld_tail,
        "fixture must exercise a provisional tail"
    );
    assert_eq!(advance.revision.status, RuntimeRevisionStatus::Complete);
}

#[test]
fn empty_bounded_revision_has_no_warm_spread_zero() {
    let mut document =
        RuntimeDocument::open(&empty_chapter_fixture_epub()).expect("document opens");
    let advance = document
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("empty revision completes");
    let plan = document
        .frame_resource_warm_plan(&advance.revision.revision_id, 0)
        .expect("empty warm plan exists");

    assert_eq!(advance.revision.status, RuntimeRevisionStatus::Complete);
    assert_eq!(advance.processed_top_level_nodes, 0);
    assert_eq!(advance.revision.known_extent.spread_count, 0);
    assert!(plan.spread_indexes.is_empty());
}
