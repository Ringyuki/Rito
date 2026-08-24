use super::{bounded_request, budget};
use crate::{
    layout::{LayoutConfig, LineBreaking},
    runtime::{
        tests::fixture::{
            cross_chapter_footnote_fixture_epub, double_layout, layout, many_chapter_fixture_epub,
            source_locator_fixture_epub,
        },
        RuntimeBoundedChapterLocalRevisionRequest, RuntimeChapterLocalCoordinateKind,
        RuntimeChapterLocalRevisionAdvance, RuntimeChapterLocalRevisionHandle,
        RuntimeChapterLocalSourceLocatorResolution, RuntimeContinuationErrorKind, RuntimeDocument,
        RuntimeResourceKind, RuntimeRolloverChapterLocalRevisionRequest, RuntimeSourceLocator,
        RuntimeSourceLocatorErrorKind, RuntimeSourceLocatorPendingReason,
    },
};

#[test]
fn first_local_artifact_scans_only_its_target_chapter() {
    let mut document = RuntimeDocument::open(&many_chapter_fixture_epub(128)).expect("document");

    document
        .create_bounded_chapter_local_revision(local_request(
            layout(),
            127,
            locator("chapter-127.xhtml"),
            4,
            32,
        ))
        .expect("target chapter publishes");

    assert_eq!(document.publication_footnote_source_scan_count(), 1);
    assert_eq!(document.publication_footnote_definition_parse_count(), 0);
    assert!(!document.publication_footnote_index_is_complete());

    let before = document.publication_footnote_source_scan_count();
    assert!(!document
        .advance_publication_footnote_index_once()
        .expect("one background index quantum"));
    assert_eq!(
        document.publication_footnote_source_scan_count(),
        before + 1,
        "one continuation quantum may inspect at most one additional chapter"
    );
}

#[test]
fn exact_revision_copies_only_targets_referenced_by_its_chapter() {
    let mut document =
        RuntimeDocument::open(&cross_chapter_footnote_fixture_epub()).expect("document");
    document
        .publication_footnote_index()
        .expect("publication index completes explicitly");

    let local = document
        .create_bounded_chapter_local_revision(local_request(
            layout(),
            0,
            locator("chapter-1.xhtml"),
            4,
            32,
        ))
        .expect("first chapter publishes");
    let stored = &document.chapter_local_revisions[&local.revision.revision_id]
        .interactions
        .footnotes;

    assert_eq!(stored.len(), 1);
    assert!(stored.contains_key("chapter-2.xhtml#forward"));
    assert!(!stored.contains_key("chapter-1.xhtml#back"));
}

#[test]
fn far_target_starts_at_target_without_materializing_preceding_chapters_or_main_state() {
    let mut document = RuntimeDocument::open(&many_chapter_fixture_epub(128)).expect("document");
    let main = document
        .create_bounded_revision(bounded_request(layout(), 1))
        .expect("main prefix starts");
    let main_cursor = main.continuation.clone().expect("main remains active");
    let main_summary = main.revision.clone();
    let main_pages = document.revisions[&main.revision.revision_id]
        .layout
        .pages
        .clone();

    let local = document
        .create_bounded_chapter_local_revision(local_request(
            layout(),
            127,
            locator("chapter-127.xhtml"),
            4,
            32,
        ))
        .expect("far local target starts");

    assert_eq!(
        local.revision.coordinate.kind,
        RuntimeChapterLocalCoordinateKind::ChapterLocal
    );
    assert_eq!(local.revision.coordinate.chapter_index, 127);
    assert_eq!(loaded_chapter_indexes(&document), vec![0, 127]);
    assert_eq!(parsed_chapter_indexes(&document), vec![0, 127]);
    assert_eq!(
        document
            .get_revision_summary(&main.revision.revision_id)
            .unwrap(),
        main_summary
    );
    assert_eq!(
        document.revisions[&main.revision.revision_id].layout.pages,
        main_pages
    );
    assert!(document.continuations.contains_cursor(&main_cursor.cursor));
    // Foreground creation scans only its target chapters; the publication
    // footnote index completes in background quanta, never during a far seek.
    assert_eq!(document.publication_footnote_scan_count(), 0);
}

#[test]
fn wire_shape_and_access_layers_keep_local_coordinates_discriminated() {
    let mut document = RuntimeDocument::open(&many_chapter_fixture_epub(2)).expect("document");
    let absolute = document
        .create_revision(&layout())
        .expect("absolute revision");
    let local = document
        .create_bounded_chapter_local_revision(local_request(
            layout(),
            1,
            locator("chapter-1.xhtml"),
            4,
            32,
        ))
        .expect("local revision");
    let owner = owner(&local);
    let json = serde_json::to_value(&local).expect("advance serializes");

    assert_eq!(json["revision"]["coordinate"]["kind"], "chapterLocal");
    assert!(json["revision"].get("pageCount").is_none());
    assert!(json["revision"].get("spreadCount").is_none());
    assert!(json["revision"]["knownExtent"]
        .get("localPageCount")
        .is_some());
    assert!(document.get_revision_summary(&owner.revision_id).is_err());
    assert!(document.get_frame(&owner.revision_id, 0).is_err());
    assert!(document
        .get_resource(
            &owner.revision_id,
            RuntimeResourceKind::Stylesheet,
            "style.css",
        )
        .is_err());
    let ordinary_locator = document
        .resolve_source_locator(&owner.revision_id, locator("chapter-1.xhtml"))
        .expect_err("absolute locator API cannot see local revision");
    assert_eq!(
        ordinary_locator.kind,
        RuntimeSourceLocatorErrorKind::UnknownRevision
    );

    let forged_local_owner = RuntimeChapterLocalRevisionHandle {
        revision_id: absolute.revision_id,
        revision_version: absolute.revision_version,
        coordinate: owner.coordinate,
    };
    assert_eq!(
        document
            .get_chapter_local_revision_summary(&forged_local_owner)
            .expect_err("local API cannot see absolute revision")
            .kind,
        RuntimeContinuationErrorKind::UnknownRevision
    );
}

#[test]
fn fragment_target_resolves_to_its_exact_local_spread() {
    let mut document = RuntimeDocument::open(&source_locator_fixture_epub()).expect("document");
    let initial = document
        .create_bounded_chapter_local_revision(local_request(
            layout(),
            0,
            locator("chapter.xhtml#point-47"),
            16,
            32,
        ))
        .expect("fragment local target starts");
    let resolved = advance_until_settled(&mut document, initial);

    let (local_page_index, local_spread_index) = match &resolved.target {
        RuntimeChapterLocalSourceLocatorResolution::Resolved {
            locator,
            local_page_index,
            local_spread_index,
            ..
        } => {
            assert_eq!(locator.anchor_id.as_deref(), Some("point-47"));
            (*local_page_index, *local_spread_index)
        }
        pending => panic!("fragment must resolve exactly, got {pending:?}"),
    };
    assert!(
        local_page_index > 0,
        "target must not collapse to chapter start"
    );
    let frame = document
        .get_chapter_local_frame(&owner(&resolved), local_spread_index)
        .expect("resolved local frame");
    assert_eq!(frame.local_spread_index, local_spread_index);
    assert!(frame.local_page_indexes.contains(&local_page_index));
    let metadata = document
        .get_chapter_local_frame_command_buffer_metadata(&owner(&resolved), local_spread_index)
        .expect("local packed metadata");
    let bytes = document
        .read_chapter_local_frame_command_buffer(&owner(&resolved), local_spread_index)
        .expect("local packed bytes");
    let image_hrefs = document
        .get_chapter_local_frame_image_resource_hrefs(&owner(&resolved), local_spread_index)
        .expect("local image hrefs");
    let stylesheet = document
        .get_chapter_local_resource(
            &owner(&resolved),
            RuntimeResourceKind::Stylesheet,
            "style.css",
        )
        .expect("local resource");
    assert_eq!(metadata.revision_id, resolved.revision.revision_id);
    assert_eq!(metadata.spread_index, local_spread_index);
    assert_eq!(metadata.byte_length, bytes.len());
    assert!(image_hrefs.is_empty());
    assert_eq!(stylesheet.revision_id, resolved.revision.revision_id);
}

#[test]
fn late_fragment_beyond_cap_keeps_a_rollover_break_token() {
    let mut document = RuntimeDocument::open(&source_locator_fixture_epub()).expect("document");
    let initial = document
        .create_bounded_chapter_local_revision(local_request(
            layout(),
            0,
            locator("chapter.xhtml#point-47"),
            1,
            64,
        ))
        .expect("capped local target");
    let capped = advance_until_page_cap(&mut document, initial);

    assert!(capped.revision.page_cap_reached);
    assert!(capped.continuation.is_some());
    assert_eq!(capped.revision.known_extent.local_page_count, 1);
    assert!(matches!(
        capped.target,
        RuntimeChapterLocalSourceLocatorResolution::Pending {
            reason: RuntimeSourceLocatorPendingReason::NotPaginated,
            ..
        }
    ));
    assert_eq!(
        document.chapter_local_revisions[&capped.revision.revision_id]
            .layout
            .pages
            .len(),
        1
    );
}

#[test]
fn rollover_moves_the_layout_cursor_without_mutating_the_sealed_window() {
    let mut document = RuntimeDocument::open(&source_locator_fixture_epub()).expect("document");
    let initial = document
        .create_bounded_chapter_local_revision(local_request(
            layout(),
            0,
            locator("chapter.xhtml#point-47"),
            2,
            64,
        ))
        .expect("bounded local target starts");
    let mut capped = advance_until_page_cap(&mut document, initial);
    let sealed_owner = owner(&capped);
    let sealed_summary = capped.revision.clone();
    let sealed_frame = document
        .get_chapter_local_frame(&sealed_owner, 0)
        .expect("sealed frame remains readable");

    let rolled = document
        .rollover_chapter_local_revision(RuntimeRolloverChapterLocalRevisionRequest {
            continuation: capped.continuation.take().expect("break token"),
            budget: budget(64),
        })
        .expect("rollover resumes the existing layout session");

    assert_ne!(rolled.revision.revision_id, sealed_owner.revision_id);
    assert!(rolled.revision.known_extent.local_page_count <= 2);
    assert_eq!(
        document
            .get_chapter_local_revision_summary(&sealed_owner)
            .expect("sealed source remains immutable"),
        sealed_summary
    );
    assert_eq!(
        document
            .get_chapter_local_frame(&sealed_owner, 0)
            .expect("old frame remains readable after rollover"),
        sealed_frame
    );
    assert!(document
        .release_chapter_local_revision_immediately(&sealed_owner)
        .expect("skipped provisional source releases independently"));
    assert!(
        document.cleanup_queue.is_empty(),
        "provisional scans must not retain skipped window owners"
    );
    assert!(document
        .release_chapter_local_revision(&owner(&rolled))
        .expect("rollover destination releases independently"));
}

#[test]
fn mismatched_target_fails_before_allocating_a_revision_or_cursor() {
    let mut document = RuntimeDocument::open(&many_chapter_fixture_epub(2)).expect("document");
    let next_revision_index = document.next_revision_index;
    let error = document
        .create_bounded_chapter_local_revision(local_request(
            layout(),
            0,
            locator("chapter-1.xhtml"),
            4,
            1,
        ))
        .expect_err("chapter and locator mismatch");

    assert_eq!(
        error.kind,
        RuntimeContinuationErrorKind::InvalidChapterLocalTarget
    );
    assert_eq!(document.next_revision_index, next_revision_index);
    assert_eq!(document.revision_count(), 0);
    assert!(document.continuations.is_empty());
}

#[test]
fn exact_owner_release_rejects_stale_and_forged_coordinates() {
    let mut document = RuntimeDocument::open(&source_locator_fixture_epub()).expect("document");
    let local = document
        .create_bounded_chapter_local_revision(local_request(
            layout(),
            0,
            locator("chapter.xhtml"),
            16,
            1,
        ))
        .expect("local starts");
    let exact = owner(&local);
    let mut stale = exact.clone();
    stale.revision_version += 1;
    assert_eq!(
        document
            .release_chapter_local_revision(&stale)
            .unwrap_err()
            .kind,
        RuntimeContinuationErrorKind::StaleRevisionVersion
    );
    let mut forged = exact.clone();
    forged.coordinate.href = "other.xhtml".to_owned();
    assert_eq!(
        document
            .release_chapter_local_revision(&forged)
            .unwrap_err()
            .kind,
        RuntimeContinuationErrorKind::ChapterLocalOwnerMismatch
    );
    assert!(!document.has_revision(&exact.revision_id));
    assert!(!document.release_revision(&exact.revision_id));
    assert!(document.get_chapter_local_revision_summary(&exact).is_ok());
    assert!(document.release_chapter_local_revision(&exact).unwrap());
    assert!(!document.has_revision(&exact.revision_id));
    assert!(document.continuations.is_empty());
}

#[test]
fn continuation_rejects_a_forged_same_chapter_target_without_side_effects() {
    let mut document = RuntimeDocument::open(&source_locator_fixture_epub()).expect("document");
    let initial = document
        .create_bounded_chapter_local_revision(local_request(
            layout(),
            0,
            locator("chapter.xhtml"),
            16,
            1,
        ))
        .expect("local starts");
    let continuation = initial.continuation.expect("local continuation exists");
    assert!(document.source_chapter_indices.is_empty());
    let mut stale_owner = continuation.owner.clone();
    stale_owner.revision_version += 1;
    let stale = document
        .resolve_chapter_local_source_locator(&stale_owner, locator("chapter.xhtml#point-1"))
        .expect_err("stale owner is rejected before locator validation");
    assert_eq!(
        stale.kind,
        RuntimeContinuationErrorKind::StaleRevisionVersion
    );
    assert!(document.source_chapter_indices.is_empty());
    let mut forged = continuation.clone();
    forged.target_locator = locator("chapter.xhtml#point-1");

    let error = document
        .continue_chapter_local_revision(
            crate::runtime::RuntimeContinueChapterLocalRevisionRequest {
                continuation: forged,
                budget: budget(1),
                max_quanta: None,
            },
        )
        .expect_err("same-chapter retarget is not implicit");
    assert_eq!(
        error.kind,
        RuntimeContinuationErrorKind::ChapterLocalTargetMismatch
    );
    assert!(document.source_chapter_indices.is_empty());
    document
        .continue_chapter_local_revision(
            crate::runtime::RuntimeContinueChapterLocalRevisionRequest {
                continuation,
                budget: budget(1),
                max_quanta: None,
            },
        )
        .expect("original cursor and target remain valid");
}

#[test]
fn double_spread_caps_must_cover_complete_local_spreads() {
    let mut document = RuntimeDocument::open(&source_locator_fixture_epub()).expect("document");
    for cap in [1, 3] {
        let error = document
            .create_bounded_chapter_local_revision(local_request(
                double_layout(),
                0,
                locator("chapter.xhtml"),
                cap,
                1,
            ))
            .expect_err("partial double spread cap is rejected");
        assert_eq!(error.kind, RuntimeContinuationErrorKind::InvalidPageCap);
    }
    assert_eq!(document.revision_count(), 0);
}

fn local_request(
    layout_config: LayoutConfig,
    target_chapter_index: usize,
    target_locator: RuntimeSourceLocator,
    local_page_cap: usize,
    max_top_level_nodes: usize,
) -> RuntimeBoundedChapterLocalRevisionRequest {
    RuntimeBoundedChapterLocalRevisionRequest {
        layout_config,
        line_breaking: LineBreaking::Greedy,
        target_chapter_index,
        target_locator,
        local_page_cap,
        budget: budget(max_top_level_nodes),
        max_quanta: None,
    }
}

fn locator(href: &str) -> RuntimeSourceLocator {
    RuntimeSourceLocator {
        href: href.to_owned(),
        anchor_id: None,
        source_point: None,
        source_range: None,
        progression: None,
    }
}

fn owner(advance: &RuntimeChapterLocalRevisionAdvance) -> RuntimeChapterLocalRevisionHandle {
    RuntimeChapterLocalRevisionHandle {
        revision_id: advance.revision.revision_id.clone(),
        revision_version: advance.revision.revision_version,
        coordinate: advance.revision.coordinate.clone(),
    }
}

#[test]
fn packed_quanta_resolve_a_deep_fragment_in_far_fewer_mutations() {
    let unpacked = count_mutations_until_settled(None);
    let packed = count_mutations_until_settled(std::num::NonZeroUsize::new(16));
    assert!(
        packed.mutations * 4 <= unpacked.mutations,
        "packed quanta must cut round trips: packed {} vs unpacked {}",
        packed.mutations,
        unpacked.mutations
    );
    // Early exit: the resolving request stops at the target instead of
    // filling the whole 16-page window.
    assert!(!packed.advance.revision.page_cap_reached);
    assert!(packed.advance.revision.known_extent.local_page_count < 16);
    let (unpacked_page, packed_page) = match (&unpacked.advance.target, &packed.advance.target) {
        (
            RuntimeChapterLocalSourceLocatorResolution::Resolved {
                local_page_index: unpacked_page,
                ..
            },
            RuntimeChapterLocalSourceLocatorResolution::Resolved {
                local_page_index: packed_page,
                ..
            },
        ) => (*unpacked_page, *packed_page),
        other => panic!("both runs must resolve the same fragment, got {other:?}"),
    };
    assert_eq!(packed_page, unpacked_page, "resolution must be identical");
}

struct SettledLocalRun {
    advance: RuntimeChapterLocalRevisionAdvance,
    mutations: usize,
}

fn count_mutations_until_settled(max_quanta: Option<std::num::NonZeroUsize>) -> SettledLocalRun {
    let mut document = RuntimeDocument::open(&source_locator_fixture_epub()).expect("document");
    let mut request = local_request(layout(), 0, locator("chapter.xhtml#point-47"), 16, 32);
    request.max_quanta = max_quanta;
    let mut advance = document
        .create_bounded_chapter_local_revision(request)
        .expect("local create");
    let mut mutations = 1_usize;
    while matches!(
        advance.target,
        RuntimeChapterLocalSourceLocatorResolution::Pending { .. }
    ) {
        let continuation = advance
            .continuation
            .take()
            .expect("unsettled local revision remains continuable");
        advance = document
            .continue_chapter_local_revision(
                crate::runtime::RuntimeContinueChapterLocalRevisionRequest {
                    continuation,
                    budget: budget(32),
                    max_quanta,
                },
            )
            .expect("local continuation advances");
        mutations += 1;
        assert!(mutations < 256, "local locator did not settle");
    }
    SettledLocalRun { advance, mutations }
}

#[test]
fn quanta_beyond_the_page_cap_are_rejected() {
    let mut document = RuntimeDocument::open(&source_locator_fixture_epub()).expect("document");
    let mut request = local_request(layout(), 0, locator("chapter.xhtml#point-1"), 16, 32);
    request.max_quanta = std::num::NonZeroUsize::new(17);
    let error = document
        .create_bounded_chapter_local_revision(request)
        .expect_err("oversized quantum cap fails closed");
    assert_eq!(error.kind, RuntimeContinuationErrorKind::InvalidBudget);
}

fn advance_until_settled(
    document: &mut RuntimeDocument,
    mut advance: RuntimeChapterLocalRevisionAdvance,
) -> RuntimeChapterLocalRevisionAdvance {
    for _ in 0..128 {
        if matches!(
            advance.target,
            RuntimeChapterLocalSourceLocatorResolution::Resolved { .. }
        ) {
            return advance;
        }
        let Some(continuation) = advance.continuation.take() else {
            return advance;
        };
        advance = document
            .continue_chapter_local_revision(
                crate::runtime::RuntimeContinueChapterLocalRevisionRequest {
                    continuation,
                    budget: budget(32),
                    max_quanta: None,
                },
            )
            .expect("local continuation advances");
    }
    panic!("local locator did not settle within the test bound")
}

fn advance_until_page_cap(
    document: &mut RuntimeDocument,
    mut advance: RuntimeChapterLocalRevisionAdvance,
) -> RuntimeChapterLocalRevisionAdvance {
    for _ in 0..128 {
        if advance.revision.page_cap_reached {
            return advance;
        }
        let continuation = advance
            .continuation
            .take()
            .expect("uncapped local revision remains continuable");
        advance = document
            .continue_chapter_local_revision(
                crate::runtime::RuntimeContinueChapterLocalRevisionRequest {
                    continuation,
                    budget: budget(32),
                    max_quanta: None,
                },
            )
            .expect("local continuation advances to its page cap");
    }
    panic!("local revision did not reach its page cap within the test bound")
}

fn loaded_chapter_indexes(document: &RuntimeDocument) -> Vec<usize> {
    document
        .document
        .chapters
        .iter()
        .enumerate()
        .filter_map(|(index, chapter)| chapter.source_loaded.then_some(index))
        .collect()
}

fn parsed_chapter_indexes(document: &RuntimeDocument) -> Vec<usize> {
    document.parsed_chapters.keys().copied().collect()
}
