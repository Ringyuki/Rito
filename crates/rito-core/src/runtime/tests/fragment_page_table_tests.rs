//! End-to-end coverage for the fragment-engine page table: an eager
//! whole-book revision on a representable book hands pagination to the
//! fragment engine when the cutover lever is on.

use super::{
    fixture::{fixture_epub_with_chapter_and_stylesheet, multi_chapter_fixture_epub},
    pinned_font_policy_fixtures::{face, font_aware_layout, policy, serif_text_font},
};
use crate::interaction::TextSelectionMovement;
use crate::runtime::page_artifact::PageArtifactSemanticRole;
use crate::runtime::{
    RuntimeBoundedRevisionRequest, RuntimeContinueRevisionRequest, RuntimeDocument,
    RuntimePinnedFontGenericRole, RuntimeRevisionHandle, RuntimeRevisionWorkBudget,
    RuntimeTextPointRequest, RuntimeTextRangeFromPointsRequest,
    RuntimeTextRangeFromPointsResolution, RuntimeTextRangeToPointRequest,
    RuntimeTextSelectionGranularity, RuntimeTextSelectionMovementRequest,
    RuntimeTextSelectionMovementResolution,
};
use crate::runtime::{RuntimeExactSourceRangeRequest, RuntimeExactSourceRangeResolution};

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

    // Frames paint fragment commands.
    let frame = session.frame(0).expect("spread 0 has a frame");
    assert!(!frame.commands.is_empty());
    // Words paint as separate commands (runs split at spaces so the
    // canvas never shapes across one); the chapter text arrives as its
    // words rather than one string.
    let painted = frame
        .commands
        .iter()
        .map(|command| format!("{command:?}"))
        .collect::<String>();
    assert!(
        painted.contains("chapter") && painted.contains("one"),
        "spread 0 paints the first chapter's text"
    );
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

#[test]
fn fragment_pages_resolve_pointer_selection() {
    let epub = fixture_epub_with_chapter_and_stylesheet(
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>The quick brown fox jumps over the lazy dog.</p></body></html>"#,
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
    .expect("selection fixture opens");
    document.set_fragment_page_table_enabled(true);
    let mut layout = font_aware_layout();
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let summary = document
        .create_revision(&layout)
        .expect("revision is created");
    let handle = RuntimeRevisionHandle::from(&summary);
    let revision = document
        .revisions
        .get(&summary.revision_id)
        .expect("revision is retained");
    assert!(
        revision.fragment_layout.is_some(),
        "the fixture routes to the fragment engine: {:?}",
        document.fragment_page_table_rejection_reason(&summary.revision_id),
    );

    // Locate the word "quick" through the fragment page artifact itself.
    let session = revision.chapter_engine_session();
    let page = session.page(0).expect("page 0 resolves");
    let positions = page.text_positions();
    let word_start = positions.text.find("quick").expect("the word is on page 0");
    let offset = positions.text[..word_start].encode_utf16().count();
    let run = positions
        .offsets
        .iter()
        .find(|run| run.start <= offset && offset < run.end)
        .expect("the word has a run");
    let geometry = page.text_range_geometry(
        crate::runtime::page_artifact::PageArtifactTextPosition {
            block_index: run.block_index,
            line_index: run.line_index,
            run_index: run.run_index,
            char_index: offset - run.start,
        },
        crate::runtime::page_artifact::PageArtifactTextPosition {
            block_index: run.block_index,
            line_index: run.line_index,
            run_index: run.run_index,
            char_index: offset - run.start + 5,
        },
    );
    let rect = geometry.rects.first().expect("the word has geometry");
    let point = RuntimeTextPointRequest {
        page_index: 0,
        x: rect.x + rect.width / 2.0,
        y: rect.y + rect.height / 2.0,
    };

    // Double-tap: word granularity from a single point.
    let response = document
        .resolve_text_range_from_points_at(
            &handle,
            RuntimeTextRangeFromPointsRequest {
                anchor: point,
                focus: point,
                granularity: RuntimeTextSelectionGranularity::Word,
            },
        )
        .expect("word request is valid");
    let RuntimeTextRangeFromPointsResolution::Resolved {
        anchor_caret,
        range,
        ..
    } = response.value.resolution
    else {
        panic!(
            "word selection resolves on a fragment page, got {:?}",
            response.value.resolution
        );
    };
    assert_eq!(range.selected_text, "quick");
    assert!(!range.rects.is_empty());

    // Drag: extend from the word's anchor to a later point on the line.
    let drag = document
        .resolve_text_range_to_point_at(
            &handle,
            RuntimeTextRangeToPointRequest {
                anchor: anchor_caret.address,
                focus: RuntimeTextPointRequest {
                    page_index: 0,
                    x: rect.x + rect.width * 3.0,
                    y: rect.y + rect.height / 2.0,
                },
            },
        )
        .expect("drag request is valid");
    let RuntimeTextRangeFromPointsResolution::Resolved { range, .. } = drag.value.resolution else {
        panic!(
            "drag selection resolves on a fragment page, got {:?}",
            drag.value.resolution
        );
    };
    assert!(
        range.selected_text.starts_with("quick"),
        "the drag keeps its anchor, got {:?}",
        range.selected_text
    );
    assert!(
        range.selected_text.len() > "quick".len(),
        "the drag extends past the word"
    );
}

#[test]
fn a_completed_bounded_session_hands_pagination_to_the_fragment_engine() {
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
    let mut advance = document
        .create_bounded_revision(RuntimeBoundedRevisionRequest {
            layout_config: layout,
            line_breaking: crate::layout::LineBreaking::Greedy,
            budget: RuntimeRevisionWorkBudget {
                max_top_level_nodes: 1,
            },
        })
        .expect("bounded revision starts");
    // Progressive publication stays retained until the book completes.
    while let Some(cursor) = advance.continuation.clone() {
        assert_eq!(
            advance.revision.pagination_backend.as_deref(),
            Some("retained"),
            "an incomplete bounded revision stays retained"
        );
        advance = document
            .continue_revision(RuntimeContinueRevisionRequest {
                revision_id: cursor.revision_id,
                revision_version: cursor.revision_version,
                cursor: cursor.cursor,
                budget: RuntimeRevisionWorkBudget {
                    max_top_level_nodes: 1,
                },
            })
            .expect("bounded revision advances");
    }
    assert_eq!(
        advance.revision.pagination_backend.as_deref(),
        Some("fragment"),
        "the completed bounded session hands over; rejection: {:?}",
        document.fragment_page_table_rejection_reason(&advance.revision.revision_id),
    );
    let revision = document
        .revisions
        .get(&advance.revision.revision_id)
        .expect("revision is retained");
    let table = revision
        .fragment_layout
        .as_ref()
        .expect("the fragment page table attached");
    assert_eq!(advance.revision.page_count, table.page_count());
    assert!(revision.frame_cache.is_empty(), "stale frames were dropped");
}

#[test]
fn fragment_pages_resolve_keyboard_selection_movement() {
    let epub = fixture_epub_with_chapter_and_stylesheet(
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>The quick brown fox jumps over the lazy dog and runs far away home.</p><p>A second paragraph follows the first one here.</p></body></html>"#,
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
    .expect("movement fixture opens");
    document.set_fragment_page_table_enabled(true);
    let mut layout = font_aware_layout();
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let summary = document
        .create_revision(&layout)
        .expect("revision is created");
    let handle = RuntimeRevisionHandle::from(&summary);
    assert_eq!(
        document.revision_pagination_backend(&summary.revision_id),
        Some("fragment"),
        "rejection: {:?}",
        document.fragment_page_table_rejection_reason(&summary.revision_id),
    );

    // Select the word "quick" to obtain a live anchor/focus pair.
    let revision = document
        .revisions
        .get(&summary.revision_id)
        .expect("revision is retained");
    let session = revision.chapter_engine_session();
    let page = session.page(0).expect("page 0 resolves");
    let positions = page.text_positions();
    let word_start = positions.text.find("quick").expect("the word is on page 0");
    let offset = positions.text[..word_start].encode_utf16().count();
    let run = positions
        .offsets
        .iter()
        .find(|run| run.start <= offset && offset < run.end)
        .expect("the word has a run");
    let geometry = page.text_range_geometry(
        crate::runtime::page_artifact::PageArtifactTextPosition {
            block_index: run.block_index,
            line_index: run.line_index,
            run_index: run.run_index,
            char_index: offset - run.start,
        },
        crate::runtime::page_artifact::PageArtifactTextPosition {
            block_index: run.block_index,
            line_index: run.line_index,
            run_index: run.run_index,
            char_index: offset - run.start + 5,
        },
    );
    let rect = geometry.rects.first().expect("the word has geometry");
    let point = RuntimeTextPointRequest {
        page_index: 0,
        x: rect.x + rect.width / 2.0,
        y: rect.y + rect.height / 2.0,
    };
    let selected = document
        .resolve_text_range_from_points_at(
            &handle,
            RuntimeTextRangeFromPointsRequest {
                anchor: point,
                focus: point,
                granularity: RuntimeTextSelectionGranularity::Word,
            },
        )
        .expect("word request is valid");
    let RuntimeTextRangeFromPointsResolution::Resolved {
        anchor_caret,
        focus_caret,
        range,
    } = selected.value.resolution
    else {
        panic!("word selection resolves");
    };
    assert_eq!(range.selected_text, "quick");

    let movement = |anchor: crate::interaction::TextCaretAddress,
                    focus: crate::interaction::TextCaretAddress,
                    movement: TextSelectionMovement| {
        document
            .resolve_text_selection_movement_at(
                &handle,
                RuntimeTextSelectionMovementRequest {
                    anchor,
                    focus,
                    movement,
                    preferred_inline_position: None,
                    preferred_block_position: None,
                },
            )
            .expect("movement request is valid")
            .value
            .resolution
    };

    // Shift+Right: the selection grows by one character.
    let RuntimeTextSelectionMovementResolution::Resolved {
        range: grown,
        focus_caret: after_char,
        ..
    } = movement(
        anchor_caret.address,
        focus_caret.address,
        TextSelectionMovement::CharacterRight,
    )
    else {
        panic!("character movement resolves on a fragment page");
    };
    assert_eq!(grown.selected_text, "quick ");

    // Shift+Down: the focus drops to the next line; the selection spans it.
    let RuntimeTextSelectionMovementResolution::Resolved { range: lines, .. } = movement(
        anchor_caret.address,
        after_char.address,
        TextSelectionMovement::LineDown,
    ) else {
        panic!("line movement resolves on a fragment page");
    };
    assert!(
        lines.selected_text.contains('\n') || lines.selected_text.len() > "quick ".len() + 4,
        "the selection crossed a line, got {:?}",
        lines.selected_text
    );

    // Word right from the original selection lands at the next word edge.
    let RuntimeTextSelectionMovementResolution::Resolved { range: word, .. } = movement(
        anchor_caret.address,
        focus_caret.address,
        TextSelectionMovement::WordRight,
    ) else {
        panic!("word movement resolves on a fragment page");
    };
    assert!(
        word.selected_text.starts_with("quick"),
        "word-right keeps the anchor, got {:?}",
        word.selected_text
    );
    assert!(word.selected_text.len() > "quick".len());
}

#[test]
fn fragment_source_locators_round_trip_across_a_reflow() {
    let epub = fixture_epub_with_chapter_and_stylesheet(
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>The quick brown fox jumps over the lazy dog and keeps running far away.</p></body></html>"#,
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
    .expect("locator fixture opens");
    document.set_fragment_page_table_enabled(true);
    let mut layout = font_aware_layout();
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let summary = document
        .create_revision(&layout)
        .expect("revision is created");
    let handle = RuntimeRevisionHandle::from(&summary);
    assert_eq!(
        document.revision_pagination_backend(&summary.revision_id),
        Some("fragment"),
    );

    // Select "quick" and capture its durable source range.
    let revision = document
        .revisions
        .get(&summary.revision_id)
        .expect("revision is retained");
    let session = revision.chapter_engine_session();
    let page = session.page(0).expect("page 0 resolves");
    let positions = page.text_positions();
    let word_start = positions.text.find("quick").expect("the word is on page 0");
    let offset = positions.text[..word_start].encode_utf16().count();
    let run = positions
        .offsets
        .iter()
        .find(|run| run.start <= offset && offset < run.end)
        .expect("the word has a run");
    let geometry = page.text_range_geometry(
        crate::runtime::page_artifact::PageArtifactTextPosition {
            block_index: run.block_index,
            line_index: run.line_index,
            run_index: run.run_index,
            char_index: offset - run.start,
        },
        crate::runtime::page_artifact::PageArtifactTextPosition {
            block_index: run.block_index,
            line_index: run.line_index,
            run_index: run.run_index,
            char_index: offset - run.start + 5,
        },
    );
    let rect = geometry.rects.first().expect("the word has geometry");
    let point = RuntimeTextPointRequest {
        page_index: 0,
        x: rect.x + rect.width / 2.0,
        y: rect.y + rect.height / 2.0,
    };
    let selected = document
        .resolve_text_range_from_points_at(
            &handle,
            RuntimeTextRangeFromPointsRequest {
                anchor: point,
                focus: point,
                granularity: RuntimeTextSelectionGranularity::Word,
            },
        )
        .expect("word request is valid");
    let RuntimeTextRangeFromPointsResolution::Resolved { range, .. } = selected.value.resolution
    else {
        panic!("word selection resolves");
    };
    assert_eq!(range.selected_text, "quick");
    let locator = range
        .source_locator
        .as_ref()
        .expect("fragment selection carries a durable locator");
    let source_range = locator
        .source_range
        .clone()
        .expect("fragment selection owns an exact source range");
    let href = locator.href.clone();

    // A different font size re-paginates the whole book (still fragment);
    // the durable range must land on the same word.
    let mut reflowed = font_aware_layout();
    reflowed.font_family_override = Some("serif".to_owned());
    reflowed.font_family_force = Some(true);
    reflowed.root_font_size = 22.0;
    let second = document
        .create_revision(&reflowed)
        .expect("reflowed revision is created");
    let second_handle = RuntimeRevisionHandle::from(&second);
    assert_eq!(
        document.revision_pagination_backend(&second.revision_id),
        Some("fragment"),
    );
    let projected = document
        .resolve_exact_source_range_at(
            &second_handle,
            RuntimeExactSourceRangeRequest { href, source_range },
        )
        .expect("durable range resolves on the reflowed revision");
    let RuntimeExactSourceRangeResolution::Resolved { range: projected } =
        projected.value.resolution
    else {
        panic!(
            "durable source range stays exact across a fragment reflow, got {:?}",
            projected.value.resolution
        );
    };
    assert_eq!(projected.selected_text, "quick");
}

#[test]
fn a_forced_sans_serif_override_changes_the_painted_frame() {
    use super::pinned_font_policy_fixtures::illustration_font;
    let open = || {
        RuntimeDocument::open_with_pinned_font_policy(
            &multi_chapter_fixture_epub(),
            policy(vec![
                face(
                    serif_text_font(),
                    RuntimePinnedFontGenericRole::Serif,
                    Some("en"),
                ),
                face(
                    illustration_font(),
                    RuntimePinnedFontGenericRole::SansSerif,
                    Some("en"),
                ),
            ]),
        )
        .expect("document opens")
    };
    let frame_for = |family: &str| {
        let mut document = open();
        document.set_fragment_page_table_enabled(true);
        let mut layout = font_aware_layout();
        layout.font_family_override = Some(family.to_owned());
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
            "fragment page table attaches for the {family} override"
        );
        let frame = revision
            .chapter_engine_session()
            .frame(0)
            .expect("spread 0 has a frame");
        format!("{:?}", frame.commands)
    };
    // The serialized frames differ because the paint family chain carries
    // the override's generic tail. This proves the override reaches the
    // painted frame — NOT that the visible glyphs change: the pinned
    // fallback chain is still applied in policy order, so face selection
    // by generic role is a separate, currently missing behavior.
    let serif = frame_for("serif");
    let sans = frame_for("sans-serif");
    assert_ne!(
        serif, sans,
        "switching the forced family must reach the painted frame"
    );
}

#[test]
fn a_bounded_forced_sans_serif_override_changes_the_painted_frame() {
    use super::pinned_font_policy_fixtures::illustration_font;
    let frame_for = |family: &str| {
        let mut document = RuntimeDocument::open_with_pinned_font_policy(
            &multi_chapter_fixture_epub(),
            policy(vec![
                face(
                    serif_text_font(),
                    RuntimePinnedFontGenericRole::Serif,
                    Some("en"),
                ),
                face(
                    illustration_font(),
                    RuntimePinnedFontGenericRole::SansSerif,
                    Some("en"),
                ),
            ]),
        )
        .expect("document opens");
        document.set_fragment_page_table_enabled(true);
        let mut layout = font_aware_layout();
        layout.font_family_override = Some(family.to_owned());
        layout.font_family_force = Some(true);
        let mut advance = document
            .create_bounded_revision(RuntimeBoundedRevisionRequest {
                layout_config: layout,
                line_breaking: crate::layout::LineBreaking::Greedy,
                budget: RuntimeRevisionWorkBudget {
                    max_top_level_nodes: 1,
                },
            })
            .expect("bounded revision starts");
        while let Some(cursor) = advance.continuation.clone() {
            advance = document
                .continue_revision(RuntimeContinueRevisionRequest {
                    revision_id: cursor.revision_id,
                    revision_version: cursor.revision_version,
                    cursor: cursor.cursor,
                    budget: RuntimeRevisionWorkBudget {
                        max_top_level_nodes: 1,
                    },
                })
                .expect("bounded revision advances");
        }
        assert_eq!(
            advance.revision.pagination_backend.as_deref(),
            Some("fragment"),
            "the completed bounded session hands over for the {family} override"
        );
        let revision = document
            .revisions
            .get(&advance.revision.revision_id)
            .expect("revision is retained");
        let frame = revision
            .chapter_engine_session()
            .frame(0)
            .expect("spread 0 has a frame");
        format!("{:?}", frame.commands)
    };
    let serif = frame_for("serif");
    let sans = frame_for("sans-serif");
    assert_ne!(
        serif, sans,
        "a bounded session forced family switch must reach the painted frame"
    );
}
