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
        RuntimeResourceKind, RuntimeSourceLocator, RuntimeSourceLocatorErrorKind,
    },
};

fn open_pinned_document(bytes: &[u8]) -> crate::epub::EpubResult<RuntimeDocument> {
    RuntimeDocument::open_with_pinned_font_policy(
        bytes,
        crate::runtime::tests::fixture::pinned_test_font_policy(),
    )
}

#[test]
fn first_local_artifact_completes_the_footnote_index_and_parses_only_its_chapter() {
    // The chapter-local build filters footnote asides with the WHOLE
    // publication's target index, so creating the first revision
    // completes the index (one light source scan per chapter). DOM
    // parsing stays scoped to the target chapter.
    let mut document = open_pinned_document(&many_chapter_fixture_epub(128)).expect("document");

    document
        .create_bounded_chapter_local_revision(local_request(
            layout(),
            127,
            locator("chapter-127.xhtml"),
            4,
            32,
        ))
        .expect("target chapter publishes");

    assert!(document.publication_footnote_index_is_complete());
    assert_eq!(document.publication_footnote_definition_parse_count(), 0);
    assert_eq!(parsed_chapter_indexes(&document), vec![127]);
}

#[test]
fn exact_revision_copies_only_targets_referenced_by_its_chapter() {
    let mut document =
        open_pinned_document(&cross_chapter_footnote_fixture_epub()).expect("document");
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
    let mut document = open_pinned_document(&many_chapter_fixture_epub(128)).expect("document");
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
    // The whole-publication footnote index loads (unzips and scans)
    // every chapter source once; only the target chapters parse a DOM.
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
    // Foreground creation completes the publication footnote index (a
    // light per-chapter source scan) so aside filtering matches the
    // whole-book table; target DOM parsing stays scoped above.
    assert!(document.publication_footnote_index_is_complete());
}

#[test]
fn wire_shape_and_access_layers_keep_local_coordinates_discriminated() {
    let mut document = open_pinned_document(&many_chapter_fixture_epub(2)).expect("document");
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
    let mut document = open_pinned_document(&source_locator_fixture_epub()).expect("document");
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
fn mismatched_target_fails_before_allocating_a_revision_or_cursor() {
    let mut document = open_pinned_document(&many_chapter_fixture_epub(2)).expect("document");
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
    let mut document = open_pinned_document(&source_locator_fixture_epub()).expect("document");
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
fn double_spread_caps_must_cover_complete_local_spreads() {
    let mut document = open_pinned_document(&source_locator_fixture_epub()).expect("document");
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

#[test]
fn a_chapter_lays_out_the_same_on_a_cold_and_a_book_warmed_engine() {
    // Layout must not depend on which chapters the shared engine laid
    // out before: a `line-height: normal` strut cached under a
    // style-table id (ids restart per chapter) served one chapter's
    // strut to another's unrelated style, so the same chapter measured
    // differently in the whole-book table than in a fresh chapter-local
    // build — and the two page tables could never agree.
    let publication = crate::runtime::tests::fixture::strut_collision_fixture_epub();

    let mut cold = open_pinned_document(&publication).expect("cold document");
    let advance = cold
        .create_bounded_chapter_local_revision(local_request(
            layout(),
            1,
            locator("chapter-2.xhtml"),
            4,
            32,
        ))
        .expect("cold chapter-local builds");
    let cold_frame = cold
        .get_chapter_local_frame(&handle(&advance), 0)
        .expect("cold frame");

    let mut warmed = open_pinned_document(&publication).expect("warmed document");
    warmed.set_fragment_page_table_enabled(true);
    let revision = warmed.create_revision(&layout()).expect("whole-book layout");
    let advance = warmed
        .create_bounded_chapter_local_revision(local_request(
            layout(),
            1,
            locator("chapter-2.xhtml"),
            4,
            32,
        ))
        .expect("warmed chapter-local builds");
    let warmed_frame = warmed
        .get_chapter_local_frame(&handle(&advance), 0)
        .expect("warmed frame");

    let text_rects = |commands: &[serde_json::Value]| -> Vec<String> {
        commands
            .iter()
            .filter(|command| command["kind"] == "paintText")
            .map(|command| format!("{} {}", command["text"], command["rect"]))
            .collect()
    };
    assert_eq!(
        text_rects(&cold_frame.commands),
        text_rects(&warmed_frame.commands),
        "chapter-two text geometry must not depend on engine warm-up"
    );

    // And the whole-book table itself must place the chapter's text on
    // the same rows the cold build does.
    let resolution = warmed
        .resolve_source_locator(&revision.revision_id, locator("chapter-2.xhtml"))
        .expect("chapter resolves");
    let crate::runtime::RuntimeSourceLocatorResolution::Resolved { spread_index, .. } = resolution
    else {
        panic!("chapter-2 did not resolve: {resolution:?}");
    };
    let book_frame = warmed
        .get_frame(&revision.revision_id, spread_index)
        .expect("whole-book frame");
    assert_eq!(
        text_rects(&cold_frame.commands),
        text_rects(&book_frame.commands),
        "whole-book text geometry must match the cold chapter-local build"
    );
}

fn handle(
    advance: &RuntimeChapterLocalRevisionAdvance,
) -> RuntimeChapterLocalRevisionHandle {
    RuntimeChapterLocalRevisionHandle {
        revision_id: advance.revision.revision_id.clone(),
        revision_version: advance.revision.revision_version,
        coordinate: advance.revision.coordinate.clone(),
    }
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
fn quanta_beyond_the_page_cap_are_rejected() {
    let mut document = open_pinned_document(&source_locator_fixture_epub()).expect("document");
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

fn parsed_chapter_indexes(document: &RuntimeDocument) -> Vec<usize> {
    document.parsed_chapters.keys().copied().collect()
}
