use crate::{
    layout::LayoutConfig,
    runtime::{
        tests::fixture::{
            cross_chapter_footnote_fixture_epub, layout, many_chapter_fixture_epub,
            source_locator_fixture_epub,
        },
        RuntimeChapterLocalRevisionHandle, RuntimeChapterLocalRevisionRequest,
        RuntimeChapterLocalSourceLocatorResolution, RuntimeCreatedChapterLocalRevision,
        RuntimeDocument, RuntimeResourceKind, RuntimeRevisionErrorKind, RuntimeSourceLocator,
        RuntimeSourceLocatorErrorKind,
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
        .create_chapter_local_revision(local_request(layout(), 127, locator("chapter-127.xhtml")))
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
        .create_chapter_local_revision(local_request(layout(), 0, locator("chapter-1.xhtml")))
        .expect("first chapter publishes");
    let stored = &document.chapter_local_revisions[&local.revision.revision_id]
        .interactions
        .footnotes;

    assert_eq!(stored.len(), 1);
    assert!(stored.contains_key("chapter-2.xhtml#forward"));
    assert!(!stored.contains_key("chapter-1.xhtml#back"));
}

#[test]
fn wire_shape_and_access_layers_keep_local_coordinates_discriminated() {
    let mut document = open_pinned_document(&many_chapter_fixture_epub(2)).expect("document");
    let absolute = document
        .create_revision(&layout())
        .expect("absolute revision");
    let local = document
        .create_chapter_local_revision(local_request(layout(), 1, locator("chapter-1.xhtml")))
        .expect("local revision");
    let owner = owner(&local);
    let json = serde_json::to_value(&local).expect("created revision serializes");

    assert_eq!(json["revision"]["coordinate"]["kind"], "chapterLocal");
    assert!(json["revision"].get("pageCount").is_none());
    assert!(json["revision"].get("spreadCount").is_none());
    assert!(json["revision"].get("localPageCount").is_some());
    assert!(json["revision"].get("localSpreadCount").is_some());
    assert!(json["target"]["owner"].get("coordinate").is_some());
    assert!(document.get_revision_summary(&owner.revision_id).is_err());
    assert!(document
        .get_frame_command_buffer_metadata(&owner.revision_id, 0)
        .is_err());
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
        RuntimeRevisionErrorKind::UnknownRevision
    );
}

#[test]
fn fragment_target_resolves_to_its_exact_local_spread() {
    let mut document = open_pinned_document(&source_locator_fixture_epub()).expect("document");
    let initial = document
        .create_chapter_local_revision(local_request(
            layout(),
            0,
            locator("chapter.xhtml#point-47"),
        ))
        .expect("fragment local target starts");
    let resolved = initial;

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
        .frame_commands_for_tests(&owner(&resolved).revision_id, local_spread_index)
        .expect("resolved local frame");
    assert_eq!(frame.spread_index, local_spread_index);
    assert!(frame.page_indexes.contains(&local_page_index));
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
        .create_chapter_local_revision(local_request(layout(), 0, locator("chapter-1.xhtml")))
        .expect_err("chapter and locator mismatch");

    assert_eq!(
        error.kind,
        RuntimeRevisionErrorKind::InvalidChapterLocalTarget
    );
    assert_eq!(document.next_revision_index, next_revision_index);
    assert_eq!(document.revision_count(), 0);
}

#[test]
fn exact_owner_release_rejects_stale_and_forged_coordinates() {
    let mut document = open_pinned_document(&source_locator_fixture_epub()).expect("document");
    let local = document
        .create_chapter_local_revision(local_request(layout(), 0, locator("chapter.xhtml")))
        .expect("local starts");
    let exact = owner(&local);
    let mut stale = exact.clone();
    stale.revision_version += 1;
    assert_eq!(
        document
            .release_chapter_local_revision(&stale)
            .unwrap_err()
            .kind,
        RuntimeRevisionErrorKind::StaleRevisionVersion
    );
    let mut forged = exact.clone();
    forged.coordinate.href = "other.xhtml".to_owned();
    assert_eq!(
        document
            .release_chapter_local_revision(&forged)
            .unwrap_err()
            .kind,
        RuntimeRevisionErrorKind::ChapterLocalOwnerMismatch
    );
    assert!(!document.has_revision(&exact.revision_id));
    assert!(!document.release_revision(&exact.revision_id));
    assert!(document.get_chapter_local_revision_summary(&exact).is_ok());
    assert!(document.release_chapter_local_revision(&exact).unwrap());
    assert!(!document.has_revision(&exact.revision_id));
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
        .create_chapter_local_revision(local_request(layout(), 1, locator("chapter-2.xhtml")))
        .expect("cold chapter-local builds");
    let cold_frame = cold
        .frame_commands_for_tests(&handle(&advance).revision_id, 0)
        .expect("cold frame");

    let mut warmed = open_pinned_document(&publication).expect("warmed document");
    let revision = warmed
        .create_revision(&layout())
        .expect("whole-book layout");
    let advance = warmed
        .create_chapter_local_revision(local_request(layout(), 1, locator("chapter-2.xhtml")))
        .expect("warmed chapter-local builds");
    let warmed_frame = warmed
        .frame_commands_for_tests(&handle(&advance).revision_id, 0)
        .expect("warmed frame");

    let text_rects = |commands: &[crate::render::DisplayCommand]| -> Vec<String> {
        commands
            .iter()
            .filter_map(|command| match command {
                crate::render::DisplayCommand::PaintText(input) => {
                    Some(format!("{} {:?}", input.text, input.rect))
                }
                _ => None,
            })
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
        .frame_commands_for_tests(&revision.revision_id, spread_index)
        .expect("whole-book frame");
    assert_eq!(
        text_rects(&cold_frame.commands),
        text_rects(&book_frame.commands),
        "whole-book text geometry must match the cold chapter-local build"
    );
}

fn handle(created: &RuntimeCreatedChapterLocalRevision) -> RuntimeChapterLocalRevisionHandle {
    RuntimeChapterLocalRevisionHandle {
        revision_id: created.revision.revision_id.clone(),
        revision_version: created.revision.revision_version,
        coordinate: created.revision.coordinate.clone(),
    }
}

fn local_request(
    layout_config: LayoutConfig,
    target_chapter_index: usize,
    target_locator: RuntimeSourceLocator,
) -> RuntimeChapterLocalRevisionRequest {
    RuntimeChapterLocalRevisionRequest {
        layout_config,
        target_chapter_index,
        target_locator,
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

fn owner(created: &RuntimeCreatedChapterLocalRevision) -> RuntimeChapterLocalRevisionHandle {
    RuntimeChapterLocalRevisionHandle {
        revision_id: created.revision.revision_id.clone(),
        revision_version: created.revision.revision_version,
        coordinate: created.revision.coordinate.clone(),
    }
}

fn parsed_chapter_indexes(document: &RuntimeDocument) -> Vec<usize> {
    document.parsed_chapters.keys().copied().collect()
}
