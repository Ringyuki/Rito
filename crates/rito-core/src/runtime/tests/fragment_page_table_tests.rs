//! End-to-end coverage for the fragment-engine page table: an eager
//! whole-book revision on a representable book hands pagination to the
//! fragment engine when the cutover lever is on.

use super::{
    fixture::{fixture_epub_with_chapter_and_stylesheet, multi_chapter_fixture_epub},
    pinned_font_policy_fixtures::{face, font_aware_layout, policy, serif_text_font},
};
use crate::runtime::page_artifact::PageArtifactSemanticRole;
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

#[test]
fn fragment_pages_serve_targets_semantics_and_anchors() {
    let epub = fixture_epub_with_chapter_and_stylesheet(
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><h2 id="start">Title Here</h2><p>Read <a href="https://example.com/next">the next part</a> now.</p></body></html>"#,
        "p { margin: 0; }\n",
    );
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &epub,
        policy(vec![face(
            serif_text_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("target fixture opens");
    document.set_fragment_page_table_enabled(true);
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
    assert!(
        revision.fragment_layout.is_some(),
        "the fixture book routes to the fragment engine: {:?}",
        document.fragment_page_table_rejection_reason(&summary.revision_id),
    );
    let session = revision.chapter_engine_session();

    // The heading anchor resolves to its page.
    let anchors = session
        .anchor_pages(0..session.metadata().page_count)
        .expect("anchor range is known");
    assert_eq!(anchors.get("start"), Some(&0));

    // The link's runs carry its destination.
    let page = session.page(0).expect("page 0 resolves");
    let targets = page.targets();
    let link: Vec<_> = targets
        .entries
        .iter()
        .filter(|entry| entry.href.as_deref() == Some("https://example.com/next"))
        .collect();
    assert!(!link.is_empty(), "the link produced hit targets");
    let link_text: String = link.iter().map(|entry| entry.text.as_str()).collect();
    assert!(
        link_text.contains("the next part"),
        "link targets carry the linked text, got {link_text:?}"
    );
    let plain = targets
        .entries
        .iter()
        .any(|entry| entry.href.is_none() && !entry.text.is_empty());
    assert!(plain, "text outside the link carries no destination");

    // The heading appears in the semantic outline with its text.
    let semantics = page.semantic_nodes();
    let heading = semantics
        .iter()
        .find(|node| node.role == PageArtifactSemanticRole::Heading)
        .expect("the heading is in the outline");
    assert_eq!(heading.level, Some(2));
    assert_eq!(heading.text.as_deref(), Some("Title Here"));
}
