//! End-to-end coverage for the fragment-engine page table: an eager
//! whole-book revision on a representable book hands pagination to the
//! fragment engine when the cutover lever is on.

use super::{
    fixture::multi_chapter_fixture_epub,
    pinned_font_policy_fixtures::{face, font_aware_layout, policy, serif_text_font},
};
use crate::runtime::{RuntimeDocument, RuntimePinnedFontGenericRole};

fn fragment_routed_document() -> (RuntimeDocument, String) {
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &multi_chapter_fixture_epub(),
        policy(vec![face(
            serif_text_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("multi-chapter document opens");
    document.set_fragment_page_table_enabled(true);
    let mut layout = font_aware_layout();
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let summary = document
        .create_revision(&layout)
        .expect("revision is created");
    (document, summary.revision_id)
}

#[test]
fn a_representable_book_hands_pagination_to_the_fragment_engine() {
    let (document, revision_id) = fragment_routed_document();
    let revision = document
        .revisions
        .get(&revision_id)
        .expect("revision is retained");
    let layout = revision
        .fragment_layout
        .as_ref()
        .expect("the fragment page table attaches");

    // The advertised extent is the fragment page table's.
    assert!(layout.page_count() > 0);
    assert_eq!(revision.known_extent.page_count, layout.page_count());
    assert_eq!(revision.final_extent, Some(revision.known_extent));

    let session = revision.chapter_engine_session();
    assert_eq!(session.metadata().page_count, layout.page_count());

    // Chapter ranges cover the whole spine, in fragment page numbers.
    let chapters = session.known_chapters();
    assert!(
        chapters.len() >= 2,
        "the fixture spine has multiple chapters"
    );
    let mut covered = 0;
    for range in chapters.values() {
        covered += range.page_count;
    }
    assert_eq!(covered, layout.page_count());

    // Page artifacts serve interaction text straight from the fragments.
    let first_page = session.page(0).expect("page 0 resolves");
    let positions = first_page.text_positions();
    assert!(
        positions.text.contains("chapter one"),
        "page 0 text comes from the fragment tree, got {:?}",
        positions.text
    );

    // Frames paint fragment commands; the spread-frame bridge stays idle.
    let frame = session.frame(0).expect("spread 0 has a frame");
    assert!(!frame.commands.is_empty());
    let painted_text = frame
        .commands
        .iter()
        .any(|command| format!("{command:?}").contains("chapter one"));
    assert!(painted_text, "spread 0 paints the first chapter's text");
    assert!(revision.fragment_chapter_frames.is_empty());
}

#[test]
fn the_page_table_stays_retained_without_the_lever() {
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &multi_chapter_fixture_epub(),
        policy(vec![face(
            serif_text_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("multi-chapter document opens");
    let mut layout = font_aware_layout();
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let summary = document
        .create_revision(&layout)
        .expect("revision is created");
    let revision = document
        .revisions
        .get(&summary.revision_id)
        .expect("revision is retained");
    assert!(revision.fragment_layout.is_none());
}
