//! End-to-end coverage for the fragment-engine page table: a whole-book
//! revision paginates every chapter through the fragment engine, and the
//! page numbers, chapter ranges, frames and locators all come from it.

use super::{
    fixture::{
        chapter_eviction_fixture_epub, fixture_epub_with_chapter_and_stylesheet, layout,
        multi_chapter_fixture_epub,
    },
    pinned_font_policy_fixtures::{face, policy, serif_text_font},
};
use crate::interaction::TextSelectionMovement;
use crate::layout::{create_layout_config, LayoutConfigInput, MarginInput, SpreadMode};
use crate::runtime::page_artifact::PageArtifactSemanticRole;
use crate::runtime::{
    RuntimeDocument, RuntimePinnedFontGenericRole, RuntimeRevisionHandle, RuntimeTextPointRequest,
    RuntimeTextRangeFromPointsRequest, RuntimeTextRangeFromPointsResolution,
    RuntimeTextRangeToPointRequest, RuntimeTextSelectionGranularity,
    RuntimeTextSelectionMovementRequest, RuntimeTextSelectionMovementResolution,
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
    let mut layout = layout();
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
    let layout = &revision.fragment_layout;

    // The advertised extent is the fragment page table's.
    assert!(layout.page_count() > 0);
    assert_eq!(revision.extent.page_count, layout.page_count());

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
    let frame = session
        .frame(0, 1.0)
        .expect("frame paints")
        .expect("spread 0 has a frame");
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
    let mut layout = layout();
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let summary = document
        .create_revision(&layout)
        .expect("revision is created");
    let revision = document
        .revisions
        .get(&summary.revision_id)
        .expect("revision is retained");
    assert!(revision.fragment_layout.page_count() > 0);
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
    let mut layout = layout();
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
    assert!(revision.fragment_layout.page_count() > 0);

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
fn a_revision_reports_the_extent_of_its_fragment_page_table() {
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &multi_chapter_fixture_epub(),
        policy(vec![face(
            serif_text_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("multi-chapter document opens");
    let mut layout = layout();
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let summary = document
        .create_revision(&layout)
        .expect("revision is created");
    let revision = document
        .revisions
        .get(&summary.revision_id)
        .expect("revision is retained");
    let table = &revision.fragment_layout;
    assert_eq!(summary.page_count, table.page_count());
    assert_eq!(summary.spread_count, revision.extent.spread_count);
    assert!(
        revision.frame_cache.is_empty(),
        "a new revision has no cached frames"
    );
}

#[test]
fn a_book_that_cannot_paginate_fails_creation_and_leaves_no_revision() {
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &multi_chapter_fixture_epub(),
        policy(vec![face(
            serif_text_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("multi-chapter document opens");
    // Margins that leave no content box: the first chapter cannot
    // paginate, so the whole page table is refused with that reason.
    let mut layout = layout();
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    layout.margin_left = layout.page_width;

    let error = document
        .create_revision(&layout)
        .expect_err("a layout without a content box is refused");
    assert_eq!(
        error.kind,
        crate::runtime::RuntimeRevisionErrorKind::EngineFailure
    );
    assert!(
        error.message.starts_with("fragment pagination failed: "),
        "{}",
        error.message
    );
    assert!(
        error.message.contains("page content box is empty"),
        "{}",
        error.message
    );
    assert_eq!(
        document.revision_count(),
        0,
        "a refused revision is never inserted"
    );
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
    let mut layout = layout();
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let summary = document
        .create_revision(&layout)
        .expect("revision is created");
    let handle = RuntimeRevisionHandle::from(&summary);

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
    let mut layout = layout();
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let summary = document
        .create_revision(&layout)
        .expect("revision is created");
    let handle = RuntimeRevisionHandle::from(&summary);

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
    let mut reflowed = layout.clone();
    reflowed.root_font_size = 22.0;
    let second = document
        .create_revision(&reflowed)
        .expect("reflowed revision is created");
    let second_handle = RuntimeRevisionHandle::from(&second);
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
        let mut layout = layout();
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
            revision.fragment_layout.page_count() > 0,
            "fragment page table attaches for the {family} override"
        );
        let frame = revision
            .chapter_engine_session()
            .frame(0, 1.0)
            .expect("frame paints")
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
fn search_finds_text_after_the_fragment_page_table_attaches() {
    let (document, revision_id) = fragment_routed_document();
    let revision = document
        .revisions
        .get(&revision_id)
        .expect("revision is retained");
    assert!(revision.fragment_layout.page_count() > 0);
    let handle = RuntimeRevisionHandle {
        revision_id: revision_id.clone(),
        revision_version: revision.revision_version,
    };
    let response = document
        .search_at(
            &handle,
            crate::runtime::RuntimeSearchRequest {
                query: "chapter".to_owned(),
                case_sensitive: false,
                whole_word: false,
                limit: Some(50),
            },
        )
        .expect("search resolves");
    assert!(
        response.value.result_count > 0,
        "search must find chapter text under the fragment page table, got {:?}",
        response.value.result_count
    );
}

fn painted_image_rects(css: &str) -> Vec<(f64, f64)> {
    let epub = fixture_epub_with_chapter_and_stylesheet(
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p><img src="Images/cover.png" alt="plate"/></p></body></html>"#,
        css,
    );
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &epub,
        policy(vec![face(
            serif_text_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("image fixture opens");
    let mut layout = layout();
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let summary = document
        .create_revision(&layout)
        .expect("revision is created");
    let revision = document
        .revisions
        .get(&summary.revision_id)
        .expect("revision is retained");
    assert!(revision.fragment_layout.page_count() > 0);
    let session = revision.chapter_engine_session();
    let frame = session
        .frame(0, 1.0)
        .expect("frame paints")
        .expect("spread 0 has a frame");
    frame
        .commands
        .iter()
        .filter_map(|command| {
            let crate::render::DisplayCommand::PaintImage { rect, .. } = command else {
                return None;
            };
            Some((rect.width, rect.height))
        })
        .collect()
}

#[test]
fn the_ua_stylesheet_letterboxes_an_author_box_off_the_raster_ratio() {
    // The fixture raster is 2x3 (portrait); the author forces a 30x20
    // landscape box. The UA `img { object-fit: contain }` letterboxes
    // the raster inside it at its own ratio.
    let rects = painted_image_rects("img { width: 30px; height: 20px; }\n");
    assert_eq!(rects.len(), 1);
    let (width, height) = rects[0];
    assert!(
        (height - 20.0).abs() < 0.6 && (width / height - 2.0 / 3.0).abs() < 0.01,
        "the raster keeps its 2:3 ratio inside the 30x20 box, got {width}x{height}"
    );
}

#[test]
fn an_author_object_fit_fill_overrides_the_ua_default() {
    let rects = painted_image_rects("img { width: 30px; height: 20px; object-fit: fill; }\n");
    assert_eq!(rects.len(), 1);
    let (width, height) = rects[0];
    assert!(
        (width - 30.0).abs() < 0.6 && (height - 20.0).abs() < 0.6,
        "author fill stretches into the authored box, got {width}x{height}"
    );
}

fn pointer_selection_document_with_css(
    chapter: &[u8],
    css: &str,
) -> (RuntimeDocument, RuntimeRevisionHandle, String) {
    let epub = fixture_epub_with_chapter_and_stylesheet(chapter, css);
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &epub,
        policy(vec![face(
            serif_text_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("selection fixture opens");
    let mut layout = layout();
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let summary = document
        .create_revision(&layout)
        .expect("revision is created");
    let handle = RuntimeRevisionHandle::from(&summary);
    let revision_id = summary.revision_id.clone();
    assert!(
        document
            .revisions
            .get(&revision_id)
            .expect("revision is retained")
            .fragment_layout
            .page_count()
            > 0,
        "the fixture routes to the fragment engine",
    );
    (document, handle, revision_id)
}

fn pointer_selection_document(chapter: &[u8]) -> (RuntimeDocument, RuntimeRevisionHandle, String) {
    pointer_selection_document_with_css(chapter, "p { margin: 0; }\n")
}

fn word_center_point(
    document: &RuntimeDocument,
    revision_id: &str,
    word: &str,
) -> RuntimeTextPointRequest {
    let revision = document
        .revisions
        .get(revision_id)
        .expect("revision is retained");
    let session = revision.chapter_engine_session();
    let page = session.page(0).expect("page 0 resolves");
    let positions = page.text_positions();
    let word_start = positions.text.find(word).expect("the word is on page 0");
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
            char_index: offset - run.start + word.encode_utf16().count(),
        },
    );
    let rect = geometry.rects.first().expect("the word has geometry");
    RuntimeTextPointRequest {
        page_index: 0,
        x: rect.x + rect.width / 2.0,
        y: rect.y + rect.height / 2.0,
    }
}

fn resolved_text(
    document: &RuntimeDocument,
    handle: &RuntimeRevisionHandle,
    anchor: RuntimeTextPointRequest,
    focus: RuntimeTextPointRequest,
    granularity: RuntimeTextSelectionGranularity,
) -> String {
    let response = document
        .resolve_text_range_from_points_at(
            handle,
            RuntimeTextRangeFromPointsRequest {
                anchor,
                focus,
                granularity,
            },
        )
        .expect("granular request is valid");
    let RuntimeTextRangeFromPointsResolution::Resolved { range, .. } = response.value.resolution
    else {
        panic!(
            "granular selection resolves, got {:?}",
            response.value.resolution
        );
    };
    range.selected_text.clone()
}

#[test]
fn a_word_granularity_drag_spans_from_the_anchor_word_to_the_focus_word() {
    // A word-granularity drag (double-click and drag) covers whole words
    // from the anchor word through the word under the pointer, in either
    // drag direction — one word interval never contains a multi-word
    // span, so per-endpoint expansion is what keeps the drag alive.
    let (document, handle, revision_id) = pointer_selection_document(
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>The quick brown fox jumps over the lazy dog.</p></body></html>"#,
    );
    let anchor = word_center_point(&document, &revision_id, "quick");
    let focus = word_center_point(&document, &revision_id, "fox");
    assert_eq!(
        resolved_text(
            &document,
            &handle,
            anchor,
            focus,
            RuntimeTextSelectionGranularity::Word
        ),
        "quick brown fox"
    );
    assert_eq!(
        resolved_text(
            &document,
            &handle,
            focus,
            anchor,
            RuntimeTextSelectionGranularity::Word
        ),
        "quick brown fox"
    );
}

#[test]
fn a_paragraph_selection_copies_the_trailing_paragraph_separator() {
    // A triple-click copies the paragraph WITH its trailing separator —
    // a blank line before the next element, one line break before a
    // <br/>-split sibling — and nothing after the document's last block.
    let (document, handle, revision_id) = pointer_selection_document(
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>ALPHA one<br/>BRAVO two</p><p>CHARLIE tail</p></body></html>"#,
    );
    let first = word_center_point(&document, &revision_id, "ALPHA");
    assert_eq!(
        resolved_text(
            &document,
            &handle,
            first,
            first,
            RuntimeTextSelectionGranularity::Paragraph
        ),
        "ALPHA one\nBRAVO two\n\n"
    );
    let last = word_center_point(&document, &revision_id, "CHARLIE");
    assert_eq!(
        resolved_text(
            &document,
            &handle,
            last,
            last,
            RuntimeTextSelectionGranularity::Paragraph
        ),
        "CHARLIE tail"
    );
    // A paragraph drag spans whole blocks from anchor to focus.
    assert_eq!(
        resolved_text(
            &document,
            &handle,
            first,
            last,
            RuntimeTextSelectionGranularity::Paragraph
        ),
        "ALPHA one\nBRAVO two\n\nCHARLIE tail"
    );
}

#[test]
fn fragment_selection_rects_span_the_injected_font_grid_box() {
    // A selection rect spans the run's font box (host grid ascent +
    // descent hung from the baseline) the way a Chromium native
    // selection does; the 48px line box only serves hosts that inject
    // no grid metric.
    let chapter: &[u8] = br#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p style="font-size: 32px; line-height: 48px">HELLO GRID WORLD</p></body></html>"#;
    let rect_height = |with_grid: bool| -> f64 {
        let mut known: Vec<(String, f64, String)> = Vec::new();
        for round in 0..6 {
            let epub = fixture_epub_with_chapter_and_stylesheet(chapter, "p { margin: 0; }\n");
            let mut document = RuntimeDocument::open_with_pinned_font_policy(
                &epub,
                policy(vec![face(
                    serif_text_font(),
                    RuntimePinnedFontGenericRole::Serif,
                    Some("en"),
                )]),
            )
            .expect("selection fixture opens");
            for (family, size, sample) in &known {
                document.set_host_line_metric(
                    family,
                    *size,
                    sample,
                    rito_inline::HostNormalLineMetric {
                        height: (1.15 * size).round(),
                        baseline: (0.9 * size).round(),
                        grid: with_grid
                            .then(|| ((0.90625 * size).round(), (0.21875 * size).round())),
                        advance: None,
                    },
                );
            }
            let mut layout = layout();
            layout.font_family_override = Some("serif".to_owned());
            layout.font_family_force = Some(true);
            let summary = document
                .create_revision(&layout)
                .expect("revision is created");
            let requests = document.take_host_line_metric_requests();
            if !requests.is_empty() {
                for (family, _measure, size, sample) in requests {
                    known.push((family, size, sample));
                }
                assert!(round < 5, "metric requests must converge");
                continue;
            }
            let handle = RuntimeRevisionHandle::from(&summary);
            let point = word_center_point(&document, &summary.revision_id, "HELLO");
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
            let RuntimeTextRangeFromPointsResolution::Resolved { range, .. } =
                response.value.resolution
            else {
                panic!(
                    "word selection resolves, got {:?}",
                    response.value.resolution
                );
            };
            return range.rects.first().expect("a selection rect").height;
        }
        unreachable!("loop returns once requests drain");
    };
    let grid = rect_height(true);
    assert!(
        (grid - 36.0).abs() < 1e-9,
        "with a host grid the rect spans the font box (29 + 7), got {grid}"
    );
    let fallback = rect_height(false);
    assert!(
        (fallback - 48.0).abs() < 1e-9,
        "without a grid the rect falls back to the 48px line box, got {fallback}"
    );
}

fn pointer_selection_document_cjk(
    chapter: &[u8],
) -> (RuntimeDocument, RuntimeRevisionHandle, String) {
    let epub = fixture_epub_with_chapter_and_stylesheet(chapter, "p { margin: 0; }\n");
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &epub,
        policy(vec![
            face(serif_text_font(), RuntimePinnedFontGenericRole::Serif, None),
            face(
                std::fs::read(
                    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"),
                )
                .expect("source han reads"),
                RuntimePinnedFontGenericRole::Serif,
                Some("zh-Hans"),
            ),
        ]),
    )
    .expect("selection fixture opens");
    let mut layout = layout();
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let summary = document
        .create_revision(&layout)
        .expect("revision is created");
    let handle = RuntimeRevisionHandle::from(&summary);
    let revision_id = summary.revision_id.clone();
    (document, handle, revision_id)
}

#[test]
fn a_selection_crossing_a_hard_break_copies_the_line_break() {
    // A <br/> leaves a newline in the flow text. A same-font run keeps it
    // inside the preceding run's text; a fallback-font break (CJK under a
    // Latin-first pin) shapes it into its own run, which the trailing
    // trim drops — the artifact's hard-break ledger restores the "\n" a
    // browser copy carries, while soft wraps stay seamless.
    for (label, chapter, from, to) in [
        (
            "latin",
            br#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>ALPHA FIRST LINE<br/>BRAVO SECOND LINE</p></body></html>"# as &[u8],
            "ALPHA",
            "SECOND",
        ),
        (
            "cjk",
            br#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>&#x72EC;&#x5C45;&#x751F;&#x6D3B;&#x5F00;&#x59CB;<br/>&#x5E2E;&#x4ED6;&#x505A;&#x996D;&#x6253;&#x626B;</p></body></html>"# as &[u8],
            "\u{72EC}\u{5C45}",
            "\u{6253}\u{626B}",
        ),
    ] {
        let (document, handle, revision_id) = pointer_selection_document_cjk(chapter);
        let start = word_center_point(&document, &revision_id, from);
        let end = word_center_point(&document, &revision_id, to);
        let response = document
            .resolve_text_range_from_points_at(
                &handle,
                RuntimeTextRangeFromPointsRequest {
                    anchor: start,
                    focus: end,
                    granularity: RuntimeTextSelectionGranularity::Word,
                },
            )
            .expect("word request is valid");
        let RuntimeTextRangeFromPointsResolution::Resolved { range, .. } = response.value.resolution
        else {
            panic!("selection resolves");
        };
        assert!(
            range.selected_text.contains('\n'),
            "{label}: the hard break survives the copy, got {:?}",
            range.selected_text
        );
        assert!(
            !range.selected_text.contains("\n\n"),
            "{label}: a <br/> is one line break, not a paragraph gap, got {:?}",
            range.selected_text
        );
    }
}

#[test]
fn painted_commands_carry_link_targets_and_image_alt() {
    // A host resolves taps against the display list alone: every painted
    // text run inside an <a> carries the link's target, and an image
    // command carries its alt text plus the enclosing link. The fragment
    // cutover shipped these as None and taps on links and note anchors
    // fell through to the image viewer.
    let epub = crate::runtime::tests::fixture::interaction_target_fixture_epub();
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &epub,
        policy(vec![face(
            serif_text_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("interaction fixture opens");
    let mut layout = layout();
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
        revision.fragment_layout.page_count() > 0,
        "the fixture routes to the fragment engine",
    );
    let session = revision.chapter_engine_session();
    let frame = session
        .frame(0, 1.0)
        .expect("frame paints")
        .expect("first spread frame");

    let mut text_hrefs = Vec::new();
    let mut images = Vec::new();
    for command in &frame.commands {
        match command {
            crate::render::DisplayCommand::PaintText(input) => {
                if let Some(href) = &input.href {
                    text_hrefs.push((format!("{:?}", input.text), href.clone()));
                }
            }
            crate::render::DisplayCommand::PaintImage { src, alt, href, .. } => {
                images.push((src.clone(), alt.clone(), href.clone()));
            }
            _ => {}
        }
    }
    assert!(
        text_hrefs.iter().any(|(_, href)| href == "#intro"),
        "an internal link's text run carries its target, got {text_hrefs:?}"
    );
    assert!(
        text_hrefs
            .iter()
            .any(|(_, href)| href == "https://example.com/help#reader"),
        "an external link's text run carries its target, got {text_hrefs:?}"
    );
    assert!(
        text_hrefs.iter().any(|(_, href)| href == "#fn1"),
        "a noteref's text run carries its target, got {text_hrefs:?}"
    );
    assert!(
        images
            .iter()
            .any(|(_, alt, href)| alt.as_deref() == Some("linked cover")
                && href.as_deref() == Some("#intro")),
        "a linked image carries alt and the enclosing link, got {images:?}"
    );
    assert!(
        images
            .iter()
            .any(|(_, alt, href)| alt.as_deref() == Some("standalone cover") && href.is_none()),
        "a bare image carries alt and no link, got {images:?}"
    );
}

#[test]
fn render_ratio_moves_raster_snaps_without_re_paginating() {
    // A quarter-pixel line top: at ratio 1 the baseline snap rounds it
    // down to the row; at ratio 2 the device row sits at the half pixel.
    // Pagination is identical either way — only the raster snaps move.
    let (document, _handle, revision_id) = pointer_selection_document_with_css(
        br#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><p class="a">Snap grid</p></body></html>"#,
        "p { margin: 0; }\n.a { margin-top: 0.25px; font-size: 16px; line-height: 20px; }\n",
    );
    let revision = document
        .revisions
        .get(&revision_id)
        .expect("revision is retained");
    let session = revision.chapter_engine_session();
    let first_text_y = |ratio: f64| -> f64 {
        let frame = session
            .frame(0, ratio)
            .expect("frame paints")
            .expect("spread 0 exists");
        frame
            .commands
            .iter()
            .find_map(|command| match command {
                crate::render::DisplayCommand::PaintText(input) => Some(input.rect.y),
                _ => None,
            })
            .expect("a text command")
    };
    let at_one = first_text_y(1.0);
    let at_two = first_text_y(2.0);
    assert!(
        ((at_one + 0.8 * 16.0) * 1.0).fract().abs() < 1e-9,
        "ratio 1 baseline lands on a whole CSS pixel, got {at_one}"
    );
    assert!(
        ((at_two + 0.8 * 16.0) * 2.0).fract().abs() < 1e-9,
        "ratio 2 baseline lands on a half CSS pixel, got {at_two}"
    );
    // Both snap stages (line top, then the within-line baseline) move
    // to the finer grid, so the painted baseline differs from the
    // ratio-1 one by up to a whole CSS pixel — never by nothing.
    assert!(
        (at_two - at_one).abs() > 1e-9 && (at_two - at_one).abs() <= 1.0 + 1e-9,
        "the quarter-pixel top snaps differently on the finer grid: {at_one} vs {at_two}"
    );
    assert_eq!(
        session
            .frame(0, 1.0)
            .expect("frame paints")
            .expect("spread")
            .commands,
        session
            .frame(0, 1.0)
            .expect("frame paints")
            .expect("spread")
            .commands,
        "a repainted ratio is served from the page's paint cache"
    );
    assert_eq!(
        revision.fragment_layout.page_count(),
        1,
        "the ratio never re-paginates"
    );
}

#[test]
fn a_chapter_rebuilds_to_the_same_pages_after_it_is_evicted() {
    // The page table keeps page contents for a bounded set of chapters.
    // Reading past a chapter big enough to fill that budget drops the
    // chapter read before it, and reading the dropped chapter again
    // rebuilds it: the rebuilt artifacts and painted geometry must be the
    // pages the book paginated, not a second opinion about them.
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &chapter_eviction_fixture_epub(),
        policy(vec![face(
            serif_text_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("eviction fixture opens");
    // A small page makes the middle chapter paginate past the budget
    // without laying out a book's worth of text.
    let mut layout = create_layout_config(LayoutConfigInput {
        width: 200.0,
        height: 96.0,
        margin: MarginInput::All(8.0),
        spread: SpreadMode::Single,
        first_page_alone: true,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
    });
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let summary = document
        .create_revision(&layout)
        .expect("revision is created");
    let revision = document
        .revisions
        .get(&summary.revision_id)
        .expect("revision is retained");
    let table = &revision.fragment_layout;
    assert!(
        table.materialized_chapter_indexes().is_empty(),
        "the whole-book pass keeps no chapter materialized"
    );

    let session = revision.chapter_engine_session();
    let chapters = session.known_chapters();
    let start_page = |idref: &str| {
        chapters
            .get(idref)
            .unwrap_or_else(|| panic!("{idref} has a range"))
            .start_page
    };
    let middle_page = start_page("chapter-1");
    let last_page = start_page("chapter-2");

    let page_state = |page_index: usize| {
        let page = session.page(page_index).expect("page resolves");
        format!(
            "{:?}|{:?}|{:?}",
            page.metadata(),
            page.text_positions(),
            page.targets()
        )
    };
    // Single-page spreads, so a spread index is its page index.
    let frame_state = |spread_index: usize| {
        format!(
            "{:?}",
            session
                .frame(spread_index, 1.0)
                .expect("frame paints")
                .expect("the spread is published")
                .commands
        )
    };

    let first_page = page_state(0);
    let first_frame = frame_state(0);
    assert_eq!(table.materialized_chapter_indexes(), vec![0]);

    let middle_state = page_state(middle_page);
    let middle_frame = frame_state(middle_page);
    page_state(last_page);
    assert_eq!(
        table.materialized_chapter_indexes(),
        vec![1, 2],
        "the middle chapter alone fills the budget, so chapter 0 is dropped"
    );

    assert_eq!(
        page_state(0),
        first_page,
        "the rebuilt artifact is the same"
    );
    assert_eq!(
        frame_state(0),
        first_frame,
        "the rebuilt geometry is the same"
    );
    assert_eq!(
        table.materialized_chapter_indexes(),
        vec![2, 0],
        "reading chapter 0 again rebuilt it and dropped the middle chapter"
    );

    assert_eq!(
        page_state(middle_page),
        middle_state,
        "the middle chapter's artifact survives its own eviction round trip"
    );
    assert_eq!(frame_state(middle_page), middle_frame);
}

#[test]
fn search_and_a_movement_step_rebuild_no_chapter_they_do_not_read() {
    // The build pass records every page's text and run offsets, so a
    // query reads that slice; a movement builds only the pages it steps
    // onto. Neither may re-bridge and re-paginate the whole book, which
    // is what walking the page table page by page would do.
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &chapter_eviction_fixture_epub(),
        policy(vec![face(
            serif_text_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("eviction fixture opens");
    let mut layout = create_layout_config(LayoutConfigInput {
        width: 200.0,
        height: 96.0,
        margin: MarginInput::All(8.0),
        spread: SpreadMode::Single,
        first_page_alone: true,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
    });
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    let summary = document
        .create_revision(&layout)
        .expect("revision is created");
    let handle = RuntimeRevisionHandle {
        revision_id: summary.revision_id.clone(),
        revision_version: document
            .revisions
            .get(&summary.revision_id)
            .expect("revision is retained")
            .revision_version,
    };

    let response = document
        .search_at(
            &handle,
            crate::runtime::RuntimeSearchRequest {
                query: "paragraph 2.".to_owned(),
                case_sensitive: false,
                whole_word: false,
                limit: Some(50),
            },
        )
        .expect("search resolves");
    assert_eq!(
        response.value.result_count, 3,
        "every chapter of the fixture carries the phrase once"
    );
    let pages: Vec<usize> = response
        .value
        .results
        .iter()
        .map(|result| result.page_index)
        .collect();
    assert!(
        pages.iter().any(|page| *page > 0),
        "the hits span the book, got {pages:?}"
    );
    let table = &document
        .revisions
        .get(&summary.revision_id)
        .expect("revision is retained")
        .fragment_layout;
    assert!(
        table.materialized_chapter_indexes().is_empty(),
        "search reads the recorded page text, so it rebuilds no chapter"
    );

    let caret = |page_index| crate::interaction::TextCaretAddress {
        page_index,
        block_index: 0,
        line_index: 0,
        run_index: 0,
        char_index: 0,
        affinity: crate::interaction::TextCaretAffinity::Downstream,
    };
    let moved = document
        .resolve_text_selection_movement_at(
            &handle,
            RuntimeTextSelectionMovementRequest {
                anchor: caret(0),
                focus: caret(0),
                movement: TextSelectionMovement::CharacterRight,
                preferred_inline_position: None,
                preferred_block_position: None,
            },
        )
        .expect("movement request is valid");
    let RuntimeTextSelectionMovementResolution::Resolved { range, .. } = moved.value.resolution
    else {
        panic!("a character step on page 0 resolves");
    };
    assert_eq!(range.selected_text.chars().count(), 1);
    let table = &document
        .revisions
        .get(&summary.revision_id)
        .expect("revision is retained")
        .fragment_layout;
    assert_eq!(
        table.materialized_chapter_indexes(),
        vec![0],
        "a step inside page 0 builds page 0's chapter and no other"
    );
}
