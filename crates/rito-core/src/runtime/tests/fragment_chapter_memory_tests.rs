use super::{
    fixture,
    pinned_font_policy_fixtures::{face, font_aware_layout, policy, serif_text_font},
};
use crate::layout::LineBreaking;
use crate::runtime::{
    RuntimeBoundedRevisionRequest, RuntimeDocument, RuntimePinnedFontGenericRole,
    RuntimeRevisionWorkBudget,
};

fn document(bytes: &[u8]) -> RuntimeDocument {
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        bytes,
        policy(vec![face(
            serif_text_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("und"),
        )]),
    )
    .unwrap();
    document.set_fragment_page_table_enabled(true);
    document
}

#[test]
fn chapter_scoped_build_matches_eager_pages_interactions_and_reflow() {
    for bytes in [
        fixture::multi_chapter_fixture_epub(),
        fixture::cross_chapter_footnote_fixture_epub(),
    ] {
        let mut scoped = document(&bytes);
        let mut eager = document(&bytes);
        let initial_loaded: Vec<_> = scoped
            .document
            .chapters
            .iter()
            .map(|c| c.source_loaded)
            .collect();
        for config in [font_aware_layout(), fixture::double_layout()] {
            let expected = eager
                .create_fragment_revision_eager_reference(config.clone(), LineBreaking::Greedy)
                .unwrap();
            let actual = scoped.create_revision(&config).unwrap();
            assert_eq!(actual.known_extent, expected.known_extent);
            assert_eq!(actual.pagination_backend.as_deref(), Some("fragment"));
            assert!(scoped.prepared.is_none());
            assert!(scoped.parsed_chapters.is_empty());
            assert_eq!(
                scoped
                    .document
                    .chapters
                    .iter()
                    .map(|c| c.source_loaded)
                    .collect::<Vec<_>>(),
                initial_loaded
            );
            for spread in 0..actual.spread_count {
                let actual_frame = scoped.get_frame(&actual.revision_id, spread).unwrap();
                let expected_frame = eager.get_frame(&expected.revision_id, spread).unwrap();
                assert_eq!(actual_frame.commands, expected_frame.commands);
                assert_eq!(actual_frame.page_indexes, expected_frame.page_indexes);
            }
            // Compare complete per-page interaction records, including UTF-16
            // source mappings, after the source preparation has been released.
            let actual_table = scoped.revisions[&actual.revision_id]
                .fragment_layout
                .as_ref()
                .unwrap();
            let expected_table = eager.revisions[&expected.revision_id]
                .fragment_layout
                .as_ref()
                .unwrap();
            for page in 0..actual.page_count {
                assert_eq!(
                    format!("{:?}", actual_table.page(page).unwrap().artifact),
                    format!("{:?}", expected_table.page(page).unwrap().artifact)
                );
            }
            assert_eq!(
                scoped.revisions[&actual.revision_id]
                    .interactions
                    .owned_footnotes(),
                eager.revisions[&expected.revision_id]
                    .interactions
                    .owned_footnotes()
            );
            assert_eq!(
                scoped
                    .get_chapter_text_indices(&actual.revision_id)
                    .unwrap()
                    .entries,
                eager
                    .get_chapter_text_indices(&expected.revision_id)
                    .unwrap()
                    .entries
            );
            assert!(scoped.prepared.is_none());
            assert!(scoped.parsed_chapters.is_empty());
            let last_idref = scoped.document.chapters.last().unwrap().idref.clone();
            scoped
                .chapter_formatting_tree(&actual.revision_id, &last_idref)
                .unwrap();
            assert!(scoped.prepared.is_none());
        }
    }
}

#[test]
fn bounded_fragment_still_returns_the_entire_book_in_one_call() {
    let mut document = document(&fixture::many_chapter_fixture_epub(24));
    let advance = document
        .create_bounded_revision(RuntimeBoundedRevisionRequest {
            layout_config: font_aware_layout(),
            line_breaking: LineBreaking::Greedy,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .unwrap();
    assert!(advance.continuation.is_none());
    assert!(advance.revision.page_count >= 24);
    assert!(document.prepared.is_none());
    assert!(document.parsed_chapters.is_empty());
    assert_eq!(
        document
            .document
            .chapters
            .iter()
            .filter(|c| c.source_loaded)
            .count(),
        1
    );
    assert!(document
        .document
        .chapters
        .iter()
        .skip(1)
        .all(|c| c.xhtml_source.capacity() == 0));
}

#[test]
fn failed_book_build_keeps_existing_revision_and_discards_temporary_sources() {
    let mut document = document(&fixture::multi_chapter_fixture_epub());
    let revision = document.create_revision(&font_aware_layout()).unwrap();
    let before = document
        .get_frame(&revision.revision_id, 0)
        .unwrap()
        .commands;
    // Failure after processing chapter zero must not publish a partial revision.
    document.document.chapters[1].href = "missing.xhtml".to_owned();
    assert!(document.create_revision(&font_aware_layout()).is_err());
    assert_eq!(document.revision_count(), 1);
    assert!(document.prepared.is_none());
    assert!(document.parsed_chapters.is_empty());
    assert_eq!(
        document
            .get_frame(&revision.revision_id, 0)
            .unwrap()
            .commands,
        before
    );
}
