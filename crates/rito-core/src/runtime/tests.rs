mod access_tests;
mod cleanup_queue_tests;
mod command_hash;
mod continuation_tests;
mod fixture;
mod pinned_font_policy_fixtures;
mod pinned_font_policy_tests;
mod pinned_font_policy_validation_tests;
mod pinned_font_wiring_tests;
mod reading_anchor_tests;
mod reading_anchor_view_tests;
mod text_interaction_tests;

use command_hash::{
    hash_json_value, json_values_match_after_number_round_trip,
    normalize_runtime_commands_for_render_hash,
};
use fixture::{
    double_layout, empty_chapter_fixture_epub, fixture_epub, fixture_epub_with_stylesheet,
    fixture_stylesheet, interaction_target_fixture_epub, layout, malformed_chapter_fixture_epub,
    many_chapter_fixture_epub, minimal_png, multi_chapter_fixture_epub,
    search_source_gap_fixture_epub, source_locator_fixture_epub,
};
use serde_json::Value;

use super::{
    frame::{chapter_window_layout_config, FRAME_CACHE_CAPACITY},
    RuntimeActiveChapterPreviewRevisionRequest, RuntimeChapterTextIndices, RuntimeDocument,
    RuntimeFullRevisionBundleRequest, RuntimeInitialFrameRequest,
    RuntimeInitialPreviewRevisionRequest, RuntimeLocatorRequest, RuntimePageTargetKind,
    RuntimePrefetchRequest, RuntimePreviewRevisionBundleRequest, RuntimeResourceKind,
    RuntimeRevisionExtent, RuntimeRevisionStatus, RuntimeSearchRequest, RuntimeSearchSource,
    RuntimeSemanticNode, RuntimeSemanticRole, RuntimeSourceLocator, RuntimeSourceLocatorErrorKind,
    RuntimeSourceLocatorMatchedBy, RuntimeSourceLocatorPendingReason,
    RuntimeSourceLocatorResolution, RuntimeSourcePoint, RuntimeSourceRange,
    RuntimeTextRangeGeometryRequest, RuntimeViewRevisionDisplay, RuntimeViewRevisionKind,
    RuntimeViewRevisionMetadata, RuntimeViewRevisionMode, RuntimeViewRevisionRequest,
    DEFAULT_DEFERRED_FULL_REFLOW_DELAY_MS,
};
use crate::interaction::FootnoteKind;
use crate::layout::{LayoutConfig, LineBreaking, SpreadMode};

fn chapter_text_index_keys(indices: &RuntimeChapterTextIndices) -> Vec<&str> {
    indices.entries.keys().map(String::as_str).collect()
}

fn owned_layout_allocation_addresses(layout: &LayoutConfig) -> (usize, usize) {
    let family = layout
        .font_family_override
        .as_ref()
        .expect("test layout has a font override")
        .as_ptr() as usize;
    let advance = layout
        .generic_serif_advances
        .get("界")
        .expect("test layout has a generic advance") as *const f64 as usize;
    (family, advance)
}

fn allocation_tracking_layout() -> LayoutConfig {
    let mut layout = layout();
    layout.font_family_override = Some("Owned Revision Serif".repeat(64));
    layout.generic_serif_advances.insert("界".to_owned(), 1.125);
    layout
}

fn source_locator(href: &str) -> RuntimeSourceLocator {
    RuntimeSourceLocator {
        href: href.to_owned(),
        anchor_id: None,
        source_point: None,
        source_range: None,
        progression: None,
    }
}

fn collect_semantic_nodes<'a>(
    nodes: &'a [RuntimeSemanticNode],
    output: &mut Vec<&'a RuntimeSemanticNode>,
) {
    for node in nodes {
        output.push(node);
        collect_semantic_nodes(&node.children, output);
    }
}

fn assert_semantic_node_invariants(node: &RuntimeSemanticNode) {
    match node.role {
        RuntimeSemanticRole::Heading => {
            assert!(matches!(node.level, Some(1..=6)));
            assert!(node.alt.is_none());
            assert!(node.href.is_none());
        }
        RuntimeSemanticRole::Image => {
            assert!(node.level.is_none());
            assert!(node.href.is_none());
        }
        RuntimeSemanticRole::Link => {
            assert!(node.level.is_none());
            assert!(node.alt.is_none());
            assert!(node
                .href
                .as_ref()
                .is_some_and(|href| !href.trim().is_empty()));
        }
        RuntimeSemanticRole::Paragraph
        | RuntimeSemanticRole::List
        | RuntimeSemanticRole::ListItem
        | RuntimeSemanticRole::Blockquote
        | RuntimeSemanticRole::Table
        | RuntimeSemanticRole::Generic => {
            assert!(node.level.is_none());
            assert!(node.alt.is_none());
            assert!(node.href.is_none());
        }
    }
    for child in &node.children {
        assert_semantic_node_invariants(child);
    }
}

#[test]
fn creates_revisions_and_caches_frames() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");

    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let frame = document
        .get_frame(&revision.revision_id, 0)
        .expect("frame is available");
    let cached_again = document
        .get_frame(&revision.revision_id, 0)
        .expect("frame is cached");

    assert_eq!(revision.revision_id, "rev-1");
    assert!(revision.page_count >= 1);
    assert!(revision.spread_count >= 1);
    assert_eq!(frame.revision_id, revision.revision_id);
    assert_eq!(frame.page_indexes, vec![0]);
    assert!(!frame.commands.is_empty());
    assert_eq!(frame.command_count, frame.commands.len());
    assert!(frame.commands.iter().any(|command| {
        command.get("kind").and_then(Value::as_str) == Some("paintText")
            && command.get("text").and_then(Value::as_str).is_some()
    }));
    assert_eq!(frame, cached_again);
    assert_eq!(document.cached_frame_count(&revision.revision_id), Some(1));
}

#[test]
fn eager_revisions_expose_a_complete_versioned_extent() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");

    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let expected_extent = RuntimeRevisionExtent {
        page_count: revision.page_count,
        spread_count: revision.spread_count,
    };

    assert_eq!(revision.revision_version, 0);
    assert_eq!(revision.status, RuntimeRevisionStatus::Complete);
    assert_eq!(revision.known_extent, expected_extent);
    assert_eq!(revision.final_extent, Some(expected_extent));
    assert_eq!(revision.page_count, revision.known_extent.page_count);
    assert_eq!(revision.spread_count, revision.known_extent.spread_count);

    let stored = document
        .revisions
        .get(&revision.revision_id)
        .expect("revision state is retained");
    assert_eq!(stored.revision_version, revision.revision_version);
    assert_eq!(stored.status, revision.status);
    assert_eq!(stored.known_extent, revision.known_extent);
    assert_eq!(stored.final_extent, revision.final_extent);

    let bundle_revision = document
        .revision_bundle(&revision.revision_id, false)
        .expect("revision bundle is available")
        .revision;
    assert_eq!(bundle_revision, revision);
}

#[test]
fn revision_statuses_use_stable_camel_case_wire_values() {
    assert_eq!(
        serde_json::to_value([
            RuntimeRevisionStatus::Warming,
            RuntimeRevisionStatus::Ready,
            RuntimeRevisionStatus::Complete,
            RuntimeRevisionStatus::Cancelled,
            RuntimeRevisionStatus::Failed,
        ])
        .expect("statuses serialize"),
        serde_json::json!(["warming", "ready", "complete", "cancelled", "failed"])
    );
}

#[test]
fn creates_revision_when_chapter_xhtml_is_malformed() {
    let bytes = malformed_chapter_fixture_epub();
    let publication = crate::epub::load_publication_with_layout(&bytes, &layout())
        .expect("formal parsing preserves malformed XHTML as a warning");
    let mut document = RuntimeDocument::open(&bytes).expect("document opens");

    let revision = document
        .create_revision(&layout())
        .expect("image preloading does not bypass XHTML recovery");

    assert_eq!(publication.xhtml.chapters[0].warning_count, 1);
    assert_eq!(publication.xhtml.chapters[0].top_level_count, 0);
    assert!(publication.xhtml.chapters[0].image_sources.is_empty());
    assert_eq!(revision.revision_id, "rev-1");
    assert!(document.has_revision(&revision.revision_id));
}

#[test]
fn exposes_packed_frame_command_buffer_metadata_and_bytes() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let frame = document
        .get_frame(&revision.revision_id, 0)
        .expect("frame is available");
    let buffer = document
        .get_frame_command_buffer(&revision.revision_id, 0)
        .expect("command buffer is available");
    let missing = document
        .get_frame_command_buffer(&revision.revision_id, 99)
        .expect_err("missing spread fails");

    assert_eq!(buffer.metadata.revision_id, revision.revision_id);
    assert_eq!(buffer.metadata.spread_index, 0);
    assert_eq!(buffer.metadata.command_count, frame.command_count);
    assert_eq!(buffer.metadata.command_counts, frame.command_counts);
    assert_eq!(buffer.metadata.command_hash, frame.command_hash);
    assert!(buffer.metadata.record_stats.geometry_records <= frame.command_count);
    assert!(buffer.metadata.record_stats.payload_records <= frame.command_count);
    assert_eq!(buffer.metadata.byte_length, buffer.bytes.len());
    assert_eq!(
        buffer.metadata.resource_ref_count,
        frame.resource_refs.image_refs
    );
    assert_eq!(buffer.metadata.resource_table, frame.resource_refs.images);
    assert_eq!(buffer.metadata.font_families, frame.font_families);
    assert_eq!(&buffer.bytes[0..8], b"RITOFCB2");
    assert!(!buffer.metadata.payload_table.is_empty());
    for payload in &buffer.metadata.payload_table {
        let value: Value = serde_json::from_str(payload).expect("command buffer payload is JSON");
        // A stable JSON number can move by one ULP when parsed back into an f64.
        // Keep object/array structure and non-number leaves exact while allowing
        // only that negligible numeric wire round-trip difference.
        assert!(
            frame
                .commands
                .iter()
                .any(|command| { json_values_match_after_number_round_trip(command, &value) }),
            "command buffer payload should mirror a runtime frame command"
        );
    }
    assert_eq!(missing.message(), "unknown spread index: 99");
}

#[test]
fn runtime_raw_text_commands_normalize_to_render_command_hash() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let frame = document
        .get_frame(&revision.revision_id, 0)
        .expect("frame is available");
    let publication = crate::epub::load_publication_with_layout_and_line_breaking(
        &fixture_epub(),
        &layout(),
        LineBreaking::Greedy,
    )
    .expect("full publication summary is available");
    let display_digest = &publication
        .layout
        .pagination_flow
        .display_list_flow
        .spread_digests[0];

    assert_eq!(
        hash_json_value(&Value::Array(normalize_runtime_commands_for_render_hash(
            &frame.commands
        ))),
        display_digest.render_command_hash
    );
}

#[test]
fn exposes_publication_info_before_revision_creation() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");

    let info = document.publication_info();

    assert_eq!(info.package.metadata.title, "Runtime document");
    assert_eq!(info.package.spine_len(), 1);
    assert_eq!(info.chapters.len(), 1);
    assert_eq!(info.chapters[0].href, "chapter.xhtml");
    assert_eq!(info.resources.stylesheets[0].href, "style.css");
    assert_eq!(info.resources.fonts[0].href, "Fonts/book.otf");
    assert_eq!(info.resources.images[0].href, "Images/cover.png");
    assert_eq!(info.resources.images[0].width, None);
    assert_eq!(info.resources.images[0].height, None);
    assert_eq!(info.font_faces.len(), 1);
    assert_eq!(info.font_faces[0].family, "Fixture");
    assert_eq!(info.font_faces[0].href, "Fonts/book.otf");
    assert_eq!(info.font_faces[0].style.as_deref(), Some("italic"));
    assert_eq!(info.font_faces[0].weight.as_deref(), Some("700"));

    document.create_revision(&layout()).expect("revision");
    let info = document.publication_info();
    assert_eq!(info.resources.images[0].width, Some(2));
    assert_eq!(info.resources.images[0].height, Some(3));
}

#[test]
fn publication_font_faces_preserve_last_occurrence_order_when_deduplicated() {
    let bytes = fixture_epub_with_stylesheet(
        r#"@font-face { font-family: "Zulu"; src: url("Fonts/book.otf"); font-style: italic; font-weight: 700; }
@font-face { font-family: "Alpha"; src: url("Fonts/book.otf"); font-style: normal; font-weight: 400; }
@font-face { font-family: "Zulu"; src: url("Fonts/book.otf"); font-style: italic; font-weight: 700; }"#,
    );
    let document = RuntimeDocument::open(&bytes).expect("document opens");

    let info = document.publication_info();

    assert_eq!(info.font_faces.len(), 2);
    assert_eq!(info.font_faces[0].family, "Alpha");
    assert_eq!(info.font_faces[0].href, "Fonts/book.otf");
    assert_eq!(info.font_faces[1].family, "Zulu");
    assert_eq!(info.font_faces[1].href, "Fonts/book.otf");
}

#[test]
fn exposes_revision_navigation_chapter_ranges() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let navigation = document
        .revision_bundle(&revision.revision_id, true)
        .expect("bundle is available")
        .navigation;
    let unknown_revision = document
        .revision_bundle("rev-missing", true)
        .expect_err("unknown revision fails");

    assert_eq!(navigation.revision_id, revision.revision_id);
    assert_eq!(navigation.page_count, revision.page_count);
    assert_eq!(navigation.spread_count, revision.spread_count);
    assert_eq!(navigation.spreads.len(), revision.spread_count);
    assert_eq!(navigation.spreads[0].spread_index, 0);
    assert_eq!(navigation.spreads[0].page_indexes[0], 0);
    assert_eq!(navigation.chapters.len(), 1);
    assert_eq!(navigation.chapters[0].idref, "chapter");
    assert_eq!(navigation.chapters[0].href, "chapter.xhtml");
    assert_eq!(navigation.chapters[0].start_page, Some(0));
    assert_eq!(navigation.chapter_map["chapter"].start_page, 0);
    assert_eq!(unknown_revision.message(), "unknown revision: rev-missing");
}

#[test]
fn creates_revision_for_chapter_window() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");

    let revision = document
        .create_revision_window_with_line_breaking(&layout(), LineBreaking::Greedy, 1, 1)
        .expect("window revision is created");
    let navigation = document
        .revision_bundle(&revision.revision_id, false)
        .expect("bundle is available")
        .navigation;
    let frame = document
        .get_frame(&revision.revision_id, 0)
        .expect("window frame is available");
    let missing_start = document
        .create_revision_window_with_line_breaking(&layout(), LineBreaking::Greedy, 3, 1)
        .expect_err("invalid chapter start fails");
    let zero_count = document
        .create_revision_window_with_line_breaking(&layout(), LineBreaking::Greedy, 1, 0)
        .expect_err("zero chapter count fails");

    assert_eq!(navigation.chapters.len(), 3);
    assert_eq!(navigation.chapters[0].start_page, None);
    assert_eq!(navigation.chapters[1].idref, "chapter-2");
    assert_eq!(navigation.chapters[1].start_page, Some(0));
    assert_eq!(
        navigation.chapters[1].end_page,
        Some(revision.page_count - 1)
    );
    assert_eq!(navigation.chapters[2].start_page, None);
    assert!(navigation.chapter_map.contains_key("chapter-2"));
    assert!(!navigation.chapter_map.contains_key("chapter-1"));
    assert!(!navigation.chapter_map.contains_key("chapter-3"));
    assert_eq!(frame.page_indexes, vec![0]);
    assert_eq!(
        missing_start.message(),
        "chapter window start out of range: 3"
    );
    assert_eq!(
        zero_count.message(),
        "chapter window count must be greater than zero"
    );
}

#[test]
fn resolves_active_chapter_preview_from_revision_spread() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let preview = document
        .active_chapter_preview(&revision.revision_id, 1)
        .expect("preview resolves")
        .expect("multi chapter spread has preview");
    let missing_spread = document
        .active_chapter_preview(&revision.revision_id, 99)
        .expect("missing spread is not an error");
    let missing_revision = document
        .active_chapter_preview("rev-missing", 0)
        .expect_err("missing revision fails");

    assert_eq!(preview.chapter_index, 1);
    assert!(preview.progress >= 0.0);
    assert!(preview.progress <= 1.0);
    assert!(missing_spread.is_none());
    assert_eq!(missing_revision.message(), "unknown revision: rev-missing");
}

#[test]
fn resolves_toc_targets_from_runtime_navigation() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let targets = document
        .revision_bundle(&revision.revision_id, true)
        .expect("bundle resolves")
        .toc_targets;
    let missing_revision = document
        .revision_bundle("rev-missing", true)
        .expect_err("missing revision fails");

    assert_eq!(targets.revision_id, revision.revision_id);
    assert_eq!(targets.targets.len(), 3);
    assert_eq!(targets.targets[0].entry.href, "chapter-1.xhtml");
    assert_eq!(targets.targets[1].entry.href, "chapter-2.xhtml");
    assert_eq!(targets.targets[2].entry.href, "chapter-3.xhtml");
    assert_eq!(targets.targets[0].page_index, 0);
    assert_eq!(targets.targets[0].spread_index, 0);
    assert_eq!(missing_revision.message(), "unknown revision: rev-missing");
}

#[test]
fn returns_revision_bundle_from_runtime_source_of_truth() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let bundle = document
        .revision_bundle(&revision.revision_id, true)
        .expect("revision bundle resolves");
    let no_toc = document
        .revision_bundle(&revision.revision_id, false)
        .expect("revision bundle can omit toc targets");

    assert_eq!(bundle.revision, revision);
    assert_eq!(bundle.navigation.revision_id, revision.revision_id);
    assert_eq!(bundle.toc_targets.targets.len(), 3);
    assert_eq!(bundle.footnotes.revision_id, revision.revision_id);
    assert_eq!(
        bundle.chapter_text_indices.revision_id,
        revision.revision_id
    );
    assert!(no_toc.toc_targets.targets.is_empty());
}

#[test]
fn revision_bundle_metadata_is_scoped_to_preview_revision() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let prefix_revision = document
        .create_revision_prefix_with_line_breaking(&layout(), LineBreaking::Greedy, Some(1))
        .expect("prefix revision is created");
    let window_revision = document
        .create_revision_window_with_line_breaking(&layout(), LineBreaking::Greedy, 1, 1)
        .expect("window revision is created");

    let prefix_bundle = document
        .revision_bundle(&prefix_revision.revision_id, false)
        .expect("prefix bundle resolves");
    let window_bundle = document
        .revision_bundle(&window_revision.revision_id, false)
        .expect("window bundle resolves");
    let window_indices = document
        .get_chapter_text_indices(&window_revision.revision_id)
        .expect("window text indices resolve");

    assert_eq!(
        chapter_text_index_keys(&prefix_bundle.chapter_text_indices),
        vec!["chapter-1"]
    );
    assert_eq!(
        chapter_text_index_keys(&window_bundle.chapter_text_indices),
        vec!["chapter-2"]
    );
    assert_eq!(chapter_text_index_keys(&window_indices), vec!["chapter-2"]);
}

#[test]
fn creates_initial_preview_bundle_from_runtime_request() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");

    let creation = document
        .create_initial_preview_revision_bundle(RuntimeInitialPreviewRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Greedy,
        })
        .expect("initial preview bundle is created");

    assert_eq!(creation.bundle.revision.revision_id, "rev-1");
    assert!(creation.preview);
    assert!(creation.bundle.toc_targets.targets.is_empty());
    assert_eq!(
        creation
            .initial_frame
            .as_ref()
            .map(|decision| decision.spread_index),
        Some(0)
    );
    assert_eq!(
        chapter_text_index_keys(&creation.bundle.chapter_text_indices),
        vec!["chapter-1", "chapter-2", "chapter-3"]
    );
    assert!(!creation.bundle.font_families.is_empty());
}

#[test]
fn creates_empty_initial_preview_bundle_without_an_initial_frame() {
    let mut document =
        RuntimeDocument::open(&empty_chapter_fixture_epub()).expect("empty document opens");

    let creation = document
        .create_initial_preview_revision_bundle(RuntimeInitialPreviewRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Greedy,
        })
        .expect("empty initial preview bundle is created");

    assert!(creation.preview);
    assert_eq!(creation.bundle.revision.page_count, 0);
    assert_eq!(creation.bundle.revision.spread_count, 0);
    assert!(creation.initial_frame.is_none());
}

#[test]
fn creates_full_revision_bundle_with_clamped_initial_frame() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");

    let creation = document
        .create_full_revision_bundle(RuntimeFullRevisionBundleRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Greedy,
            active_spread_index: 99,
        })
        .expect("full revision bundle is created");

    assert!(!creation.preview);
    assert!(!creation.bundle.toc_targets.targets.is_empty());
    assert!(!creation.bundle.font_families.is_empty());
    assert_eq!(
        creation
            .initial_frame
            .as_ref()
            .map(|decision| (decision.spread_index, decision.display_spread_index)),
        Some((
            creation.bundle.revision.spread_count - 1,
            creation.bundle.revision.spread_count - 1,
        ))
    );
}

#[test]
fn creates_active_chapter_preview_bundle_from_runtime_request() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let full = document
        .create_revision(&layout())
        .expect("full revision is created");

    let preview = document
        .create_active_chapter_preview_revision_bundle(RuntimeActiveChapterPreviewRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Greedy,
            previous_revision_id: full.revision_id,
            active_spread_index: 1,
        })
        .expect("active preview request resolves")
        .expect("active preview is created");
    let missing = document
        .create_active_chapter_preview_revision_bundle(RuntimeActiveChapterPreviewRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Greedy,
            previous_revision_id: preview.bundle.revision.revision_id.clone(),
            active_spread_index: 99,
        })
        .expect("missing active spread is not an error");

    assert!(preview.preview);
    assert_eq!(
        preview
            .initial_frame
            .as_ref()
            .map(|decision| decision.display_spread_index),
        Some(1)
    );
    assert_eq!(
        preview
            .initial_frame
            .as_ref()
            .map(|decision| decision.revision_id.as_str()),
        Some(preview.bundle.revision.revision_id.as_str())
    );
    assert_eq!(
        chapter_text_index_keys(&preview.bundle.chapter_text_indices),
        vec!["chapter-2"]
    );
    assert!(preview.bundle.toc_targets.targets.is_empty());
    assert!(missing.is_none());
}

#[test]
fn creates_preview_bundle_from_unified_runtime_request() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");

    let initial = document
        .create_preview_revision_bundle(RuntimePreviewRevisionBundleRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Greedy,
            previous_revision_id: None,
            active_spread_index: None,
        })
        .expect("initial preview request resolves")
        .expect("initial preview is created");
    let active = document
        .create_preview_revision_bundle(RuntimePreviewRevisionBundleRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Greedy,
            previous_revision_id: Some(initial.bundle.revision.revision_id.clone()),
            active_spread_index: Some(1),
        })
        .expect("active preview request resolves")
        .expect("active preview is created");

    assert_eq!(
        initial
            .initial_frame
            .as_ref()
            .map(|decision| decision.spread_index),
        Some(0)
    );
    assert_eq!(
        active
            .initial_frame
            .as_ref()
            .map(|decision| decision.display_spread_index),
        Some(1)
    );
    assert_eq!(
        chapter_text_index_keys(&active.bundle.chapter_text_indices),
        vec!["chapter-2"]
    );
}

#[test]
fn view_revision_response_declares_display_policy() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");

    let initial = document
        .create_view_revision_bundle(RuntimeViewRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Optimal,
            active_spread_index: 0,
            previous_revision_id: None,
            preserve_locator: None,
            mode: RuntimeViewRevisionMode::Preview,
        })
        .expect("initial preview view resolves");
    let active = document
        .create_view_revision_bundle(RuntimeViewRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Optimal,
            active_spread_index: 1,
            previous_revision_id: Some(initial.revision.bundle.revision.revision_id.clone()),
            preserve_locator: None,
            mode: RuntimeViewRevisionMode::Preview,
        })
        .expect("active preview view resolves");
    let full = document
        .create_view_revision_bundle(RuntimeViewRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Optimal,
            active_spread_index: 1,
            previous_revision_id: Some(initial.revision.bundle.revision.revision_id.clone()),
            preserve_locator: None,
            mode: RuntimeViewRevisionMode::Full,
        })
        .expect("full view resolves");

    assert_eq!(initial.display, RuntimeViewRevisionDisplay::Revision);
    assert_eq!(active.display, RuntimeViewRevisionDisplay::VisualPreview);
    assert_eq!(full.display, RuntimeViewRevisionDisplay::Revision);
    let initial_revision_id = initial.revision.bundle.revision.revision_id.clone();
    assert_eq!(
        initial
            .follow_up
            .as_ref()
            .map(|follow_up| follow_up.delay_ms),
        Some(DEFAULT_DEFERRED_FULL_REFLOW_DELAY_MS)
    );
    assert_eq!(
        initial
            .follow_up
            .as_ref()
            .map(|follow_up| &follow_up.request),
        Some(&RuntimeViewRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Optimal,
            active_spread_index: 0,
            previous_revision_id: Some(initial_revision_id.clone()),
            preserve_locator: None,
            mode: RuntimeViewRevisionMode::Full,
        })
    );
    assert_eq!(
        active
            .follow_up
            .as_ref()
            .map(|follow_up| &follow_up.request),
        Some(&RuntimeViewRevisionRequest {
            layout_config: layout(),
            line_breaking: LineBreaking::Optimal,
            active_spread_index: 1,
            previous_revision_id: Some(initial_revision_id),
            preserve_locator: None,
            mode: RuntimeViewRevisionMode::Full,
        })
    );
    assert!(full.follow_up.is_none());
}

#[test]
fn omitted_full_view_metadata_materializes_chapter_text_indices_on_demand() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let request = RuntimeViewRevisionRequest {
        layout_config: layout(),
        line_breaking: LineBreaking::Greedy,
        active_spread_index: 0,
        previous_revision_id: None,
        preserve_locator: None,
        mode: RuntimeViewRevisionMode::Full,
    };
    let first = document
        .create_view_revision_bundle_with_metadata(
            request.clone(),
            RuntimeViewRevisionMetadata::OmitFullChapterTextIndices,
        )
        .expect("first projected full view resolves");
    let second = document
        .create_view_revision_bundle_with_metadata(
            request,
            RuntimeViewRevisionMetadata::OmitFullChapterTextIndices,
        )
        .expect("second projected full view resolves");
    let revision_id = first.revision.bundle.revision.revision_id.clone();

    assert_eq!(first.kind, RuntimeViewRevisionKind::Full);
    assert!(first
        .revision
        .bundle
        .chapter_text_indices
        .entries
        .is_empty());
    assert!(second
        .revision
        .bundle
        .chapter_text_indices
        .entries
        .is_empty());
    assert!(document.full_chapter_text_indices.get().is_none());

    let indices = document
        .get_chapter_text_indices(&revision_id)
        .expect("omitted indices remain revision-readable");

    assert_eq!(chapter_text_index_keys(&indices).len(), 3);
    assert!(document.full_chapter_text_indices.get().is_some());
}

#[test]
fn metadata_projection_keeps_previews_inline_and_omits_full_fallbacks() {
    let mut document =
        RuntimeDocument::open(&many_chapter_fixture_epub(10)).expect("many-chapter document opens");
    let preview = document
        .create_view_revision_bundle_with_metadata(
            RuntimeViewRevisionRequest {
                layout_config: layout(),
                line_breaking: LineBreaking::Greedy,
                active_spread_index: 0,
                previous_revision_id: None,
                preserve_locator: None,
                mode: RuntimeViewRevisionMode::Preview,
            },
            RuntimeViewRevisionMetadata::OmitFullChapterTextIndices,
        )
        .expect("preview view resolves");

    assert_eq!(preview.kind, RuntimeViewRevisionKind::Preview);
    assert_eq!(
        chapter_text_index_keys(&preview.revision.bundle.chapter_text_indices).len(),
        8
    );
    assert!(document.full_chapter_text_indices.get().is_none());

    let fallback = document
        .create_view_revision_bundle_with_metadata(
            RuntimeViewRevisionRequest {
                layout_config: layout(),
                line_breaking: LineBreaking::Greedy,
                active_spread_index: usize::MAX,
                previous_revision_id: Some(preview.revision.bundle.revision.revision_id.clone()),
                preserve_locator: None,
                mode: RuntimeViewRevisionMode::Preview,
            },
            RuntimeViewRevisionMetadata::OmitFullChapterTextIndices,
        )
        .expect("preview fallback resolves");

    assert_eq!(fallback.kind, RuntimeViewRevisionKind::Full);
    assert!(fallback
        .revision
        .bundle
        .chapter_text_indices
        .entries
        .is_empty());
    assert!(document.full_chapter_text_indices.get().is_none());
}

#[test]
fn resolves_initial_frame_decision_in_runtime() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let explicit = document
        .initial_frame_decision(
            &revision.revision_id,
            RuntimeInitialFrameRequest {
                spread_index: Some(1),
                anchor_progress: Some(0.0),
            },
        )
        .expect("explicit spread resolves")
        .expect("explicit spread returns decision");
    let anchored = document
        .initial_frame_decision(
            &revision.revision_id,
            RuntimeInitialFrameRequest {
                spread_index: None,
                anchor_progress: Some(1.0),
            },
        )
        .expect("anchor progress resolves")
        .expect("anchor progress returns decision");
    let none = document
        .initial_frame_decision(
            &revision.revision_id,
            RuntimeInitialFrameRequest {
                spread_index: None,
                anchor_progress: None,
            },
        )
        .expect("missing request is not an error");
    let invalid = document
        .initial_frame_decision(
            &revision.revision_id,
            RuntimeInitialFrameRequest {
                spread_index: Some(99),
                anchor_progress: None,
            },
        )
        .expect_err("invalid spread fails");

    assert_eq!(explicit.revision_id, revision.revision_id);
    assert_eq!(explicit.spread_index, 1);
    assert_eq!(explicit.display_spread_index, 1);
    assert_eq!(anchored.spread_index, revision.spread_count - 1);
    assert_eq!(anchored.display_spread_index, revision.spread_count - 1);
    assert!(none.is_none());
    assert_eq!(invalid.message(), "unknown spread index: 99");
}

#[test]
fn chapter_window_layout_does_not_treat_window_start_as_publication_cover() {
    let layout = double_layout();
    let window_layout = chapter_window_layout_config(&layout);

    assert!(layout.first_page_alone);
    assert!(!window_layout.first_page_alone);
    assert_eq!(window_layout.spread_mode, SpreadMode::Double);
    assert_eq!(window_layout.page_width, layout.page_width);
    assert_eq!(window_layout.spread_gap, layout.spread_gap);
}

#[test]
fn owned_prefix_revision_request_reuses_layout_config_allocations() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let config = allocation_tracking_layout();
    let expected_addresses = owned_layout_allocation_addresses(&config);

    let creation = document
        .create_full_revision_bundle(RuntimeFullRevisionBundleRequest {
            layout_config: config,
            line_breaking: LineBreaking::Greedy,
            active_spread_index: 0,
        })
        .expect("owned full revision is created");
    let retained = &document
        .revisions
        .get(&creation.bundle.revision.revision_id)
        .expect("revision remains stored")
        .layout_config;

    assert_eq!(
        owned_layout_allocation_addresses(retained),
        expected_addresses
    );
}

#[test]
fn owned_window_revision_request_reuses_and_normalizes_layout_config() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let full = document
        .create_revision(&layout())
        .expect("full revision is created");
    let config = allocation_tracking_layout();
    let expected_addresses = owned_layout_allocation_addresses(&config);

    let creation = document
        .create_active_chapter_preview_revision_bundle(RuntimeActiveChapterPreviewRevisionRequest {
            layout_config: config,
            line_breaking: LineBreaking::Greedy,
            previous_revision_id: full.revision_id,
            active_spread_index: 1,
        })
        .expect("active preview request resolves")
        .expect("owned window revision is created");
    let retained = &document
        .revisions
        .get(&creation.bundle.revision.revision_id)
        .expect("revision remains stored")
        .layout_config;

    assert!(!retained.first_page_alone);
    assert_eq!(
        owned_layout_allocation_addresses(retained),
        expected_addresses
    );
}

#[test]
fn layout_key_is_stable_across_revisions() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");

    let first = document
        .create_revision(&layout())
        .expect("first revision is created");
    let second = document
        .create_revision(&layout())
        .expect("second revision is created");

    assert_eq!(first.revision_id, "rev-1");
    assert_eq!(second.revision_id, "rev-2");
    assert_eq!(first.layout_key, second.layout_key);
}

#[test]
fn releases_obsolete_revisions() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let first = document
        .create_revision(&layout())
        .expect("first revision is created");
    let second = document
        .create_revision(&layout())
        .expect("second revision is created");

    assert_eq!(document.revision_count(), 2);
    assert!(document.release_revision(&first.revision_id));
    assert_eq!(document.revision_count(), 1);
    assert!(!document.has_revision(&first.revision_id));
    assert!(document.has_revision(&second.revision_id));
    assert!(!document.release_revision(&first.revision_id));
    assert_eq!(
        document
            .get_chapter_text_indices(&first.revision_id)
            .expect_err("released revision indices stay unavailable")
            .message(),
        format!("unknown revision: {}", first.revision_id)
    );
    assert!(!document
        .get_chapter_text_indices(&second.revision_id)
        .expect("remaining revision lazily materializes indices")
        .entries
        .is_empty());
}

#[test]
fn bounds_and_refreshes_the_revision_frame_cache() {
    let mut document = RuntimeDocument::open(&many_chapter_fixture_epub(FRAME_CACHE_CAPACITY + 4))
        .expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    assert!(revision.spread_count > FRAME_CACHE_CAPACITY);

    for spread_index in 0..revision.spread_count {
        document
            .get_frame(&revision.revision_id, spread_index)
            .expect("frame is available");
    }

    assert_eq!(
        document.cached_frame_count(&revision.revision_id),
        Some(FRAME_CACHE_CAPACITY)
    );
    let revision_state = &document.revisions[&revision.revision_id];
    assert!(!revision_state.frame_cache.contains_key(&0));

    let oldest_cached = revision.spread_count - FRAME_CACHE_CAPACITY;
    document
        .get_frame(&revision.revision_id, oldest_cached)
        .expect("oldest cached frame is refreshed");
    document
        .get_frame(&revision.revision_id, 0)
        .expect("evicted frame is regenerated");
    let revision_state = &document.revisions[&revision.revision_id];
    assert!(revision_state.frame_cache.contains_key(&oldest_cached));
    assert!(revision_state.frame_cache.contains_key(&0));
    assert_eq!(revision_state.frame_cache.len(), FRAME_CACHE_CAPACITY);
    assert!(document.cleanup_queue.is_empty());
    assert_eq!(document.cleanup_queue.pending_frame_owner_count(), 0);
}

#[test]
fn creates_optimal_line_breaking_revisions() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");

    let revision = document
        .create_revision_with_line_breaking(&layout(), LineBreaking::Optimal)
        .expect("optimal revision is created");
    let frame = document
        .get_frame(&revision.revision_id, 0)
        .expect("optimal frame is available");

    assert_eq!(revision.revision_id, "rev-1");
    assert!(revision.page_count > 0);
    assert_eq!(frame.revision_id, revision.revision_id);
    assert!(!frame.commands.is_empty());
}

#[test]
fn rejects_unknown_revision_and_spread() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let missing_revision = document
        .get_frame("rev-missing", 0)
        .expect_err("unknown revision fails");
    let missing_spread = document
        .get_frame(&revision.revision_id, 99)
        .expect_err("unknown spread fails");

    assert_eq!(missing_revision.message(), "unknown revision: rev-missing");
    assert_eq!(missing_spread.message(), "unknown spread index: 99");
}

#[test]
fn reads_revision_scoped_resources_without_kind_fallback() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let image = document
        .get_resource(
            &revision.revision_id,
            RuntimeResourceKind::Image,
            "Images/cover.png",
        )
        .expect("image is available");
    let font = document
        .get_resource(
            &revision.revision_id,
            RuntimeResourceKind::Font,
            "Fonts/book.otf",
        )
        .expect("font is available");
    let stylesheet = document
        .get_resource(
            &revision.revision_id,
            RuntimeResourceKind::Stylesheet,
            "style.css",
        )
        .expect("stylesheet is available");
    let relative_image = document
        .get_resource(
            &revision.revision_id,
            RuntimeResourceKind::Image,
            "../Images/cover.png",
        )
        .expect("relative image is available");
    let wrong_kind = document
        .get_resource(
            &revision.revision_id,
            RuntimeResourceKind::Image,
            "Fonts/book.otf",
        )
        .expect_err("kind mismatch is not accepted");
    let unknown_revision = document
        .get_resource(
            "rev-missing",
            RuntimeResourceKind::Image,
            "Images/cover.png",
        )
        .expect_err("unknown revision fails");

    assert_eq!(image.revision_id, revision.revision_id);
    assert_eq!(image.kind, RuntimeResourceKind::Image);
    assert_eq!(image.media_type, "image/png");
    assert_eq!(image.bytes, minimal_png().as_slice());
    assert_eq!(image.width, Some(2));
    assert_eq!(image.height, Some(3));
    assert_eq!(font.media_type, "font/otf");
    assert_eq!(font.bytes, b"font-bytes");
    assert_eq!(stylesheet.media_type, "text/css");
    assert_eq!(stylesheet.bytes, fixture_stylesheet().as_bytes());
    assert_eq!(relative_image.href, "Images/cover.png");
    assert_eq!(
        wrong_kind.message(),
        "resource not found: Image Fonts/book.otf"
    );
    assert_eq!(unknown_revision.message(), "unknown revision: rev-missing");
}

#[test]
fn reads_revision_scoped_footnotes() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let footnote = document
        .get_footnote(&revision.revision_id, "chapter.xhtml#fn1")
        .expect("footnote is available");
    let footnotes = document
        .get_footnotes(&revision.revision_id)
        .expect("footnote map is available");
    let missing = document
        .get_footnote(&revision.revision_id, "chapter.xhtml#missing")
        .expect_err("missing footnote fails");
    let unknown_revision = document
        .get_footnote("rev-missing", "chapter.xhtml#fn1")
        .expect_err("unknown revision fails");

    assert_eq!(footnote.revision_id, revision.revision_id);
    assert_eq!(footnote.key, "chapter.xhtml#fn1");
    assert_eq!(footnote.kind, FootnoteKind::Footnote);
    assert_eq!(footnote.text, "Runtime note");
    assert_eq!(footnote.html, "<p>Runtime note</p>");
    assert_eq!(footnotes.revision_id, revision.revision_id);
    assert_eq!(
        footnotes
            .entries
            .get("chapter.xhtml#fn1")
            .map(|entry| entry.text.as_str()),
        Some("Runtime note")
    );
    assert_eq!(missing.message(), "unknown footnote: chapter.xhtml#missing");
    assert_eq!(unknown_revision.message(), "unknown revision: rev-missing");
}

#[test]
fn reads_revision_scoped_chapter_text_indices() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let indices = document
        .get_chapter_text_indices(&revision.revision_id)
        .expect("chapter text indices are available");
    let chapter = indices
        .entries
        .get("chapter")
        .expect("chapter index exists");

    assert_eq!(indices.revision_id, revision.revision_id);
    assert_eq!(chapter.href, "chapter.xhtml");
    assert_eq!(chapter.normalized_text, "Hello runtime1");
    assert!(!chapter.normalized_text.contains("Runtime note"));
    assert!(chapter
        .spans
        .iter()
        .any(|span| span.normalized_end > span.normalized_start));
}

#[test]
fn searches_revision_scoped_typed_page_text() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let response = document
        .search(
            &revision.revision_id,
            RuntimeSearchRequest {
                query: "runtime".to_owned(),
                case_sensitive: false,
                whole_word: false,
                limit: Some(4),
            },
        )
        .expect("search succeeds");
    let missing = document
        .search(
            &revision.revision_id,
            RuntimeSearchRequest {
                query: "missing".to_owned(),
                case_sensitive: false,
                whole_word: false,
                limit: None,
            },
        )
        .expect("missing search succeeds");
    let unknown_revision = document
        .search(
            "rev-missing",
            RuntimeSearchRequest {
                query: "runtime".to_owned(),
                case_sensitive: false,
                whole_word: false,
                limit: None,
            },
        )
        .expect_err("unknown revision fails");

    assert_eq!(response.revision_id, revision.revision_id);
    assert_eq!(response.query, "runtime");
    assert_eq!(response.result_count, 1);
    assert_eq!(response.results[0].page_index, 0);
    assert_eq!(response.results[0].spread_index, 0);
    let RuntimeSearchSource::Resolved { href, source_range } = &response.results[0].source else {
        panic!("runtime search match must retain its durable source range");
    };
    assert_eq!(href, "chapter.xhtml");
    assert!(source_range.end.text_offset > source_range.start.text_offset);
    assert!(response.results[0]
        .match_range
        .context
        .contains("Hello runtime"));
    assert_eq!(missing.result_count, 0);
    assert_eq!(unknown_revision.message(), "unknown revision: rev-missing");
}

#[test]
fn resolves_href_locators_through_spine_and_anchor_pages() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let chapter = document
        .resolve_locator(
            &revision.revision_id,
            RuntimeLocatorRequest {
                href: "chapter.xhtml".to_owned(),
            },
        )
        .expect("chapter href resolves");
    let anchor = document
        .resolve_locator(
            &revision.revision_id,
            RuntimeLocatorRequest {
                href: "chapter.xhtml#intro".to_owned(),
            },
        )
        .expect("anchor href resolves");
    let missing_anchor = document
        .resolve_locator(
            &revision.revision_id,
            RuntimeLocatorRequest {
                href: "chapter.xhtml#missing".to_owned(),
            },
        )
        .expect_err("missing anchor fails");

    assert_eq!(chapter.revision_id, revision.revision_id);
    assert_eq!(chapter.spine_idref, "chapter");
    assert_eq!(chapter.page_index, 0);
    assert_eq!(chapter.spread_index, 0);
    assert_eq!(chapter.fragment, None);
    assert_eq!(anchor.page_index, 0);
    assert_eq!(anchor.fragment.as_deref(), Some("intro"));
    assert_eq!(
        missing_anchor.message(),
        "locator not found: chapter.xhtml#missing"
    );
}

#[test]
fn resolves_source_locators_by_href_anchor_point_range_and_progression() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let index = document
        .get_chapter_text_indices(&revision.revision_id)
        .expect("chapter text index resolves")
        .entries
        .get("chapter")
        .expect("chapter index exists")
        .clone();
    let span = index.spans.first().expect("chapter has source text");
    let point = RuntimeSourcePoint {
        node_path: span.node_path.clone(),
        text_offset: 6,
    };
    let range = RuntimeSourceRange {
        start: point.clone(),
        end: RuntimeSourcePoint {
            node_path: span.node_path.clone(),
            text_offset: 13,
        },
    };

    let href = document
        .resolve_source_locator(&revision.revision_id, source_locator("chapter.xhtml"))
        .expect("href locator resolves");
    let mut anchor_locator = source_locator("chapter.xhtml#%69ntro");
    anchor_locator.progression = Some(0.95);
    let anchor = document
        .resolve_source_locator(&revision.revision_id, anchor_locator)
        .expect("legacy href fragment resolves");
    let mut point_locator = source_locator("chapter.xhtml");
    point_locator.source_point = Some(point.clone());
    point_locator.progression = Some(0.95);
    let point_result = document
        .resolve_source_locator(&revision.revision_id, point_locator)
        .expect("source point resolves");
    let mut range_locator = source_locator("chapter.xhtml");
    range_locator.source_range = Some(range);
    let range_result = document
        .resolve_source_locator(&revision.revision_id, range_locator)
        .expect("source range resolves");
    let mut progression_locator = source_locator("chapter.xhtml");
    progression_locator.progression = Some(0.5);
    let progression = document
        .resolve_source_locator(&revision.revision_id, progression_locator)
        .expect("progression resolves");
    let footnote = document
        .resolve_source_locator(&revision.revision_id, source_locator("chapter.xhtml#fn1"))
        .expect("raw source footnote remains a valid locator");

    assert_resolved_source_locator(
        &href,
        RuntimeSourceLocatorMatchedBy::Href,
        "chapter.xhtml",
        0,
    );
    assert_resolved_source_locator(
        &anchor,
        RuntimeSourceLocatorMatchedBy::Anchor,
        "chapter.xhtml",
        0,
    );
    assert_resolved_source_locator(
        &point_result,
        RuntimeSourceLocatorMatchedBy::SourcePoint,
        "chapter.xhtml",
        0,
    );
    assert_resolved_source_locator(
        &range_result,
        RuntimeSourceLocatorMatchedBy::SourceRange,
        "chapter.xhtml",
        0,
    );
    assert_resolved_source_locator(
        &progression,
        RuntimeSourceLocatorMatchedBy::Progression,
        "chapter.xhtml",
        0,
    );
    let RuntimeSourceLocatorResolution::Resolved { locator, .. } = anchor else {
        panic!("anchor should be resolved");
    };
    assert_eq!(locator.href, "chapter.xhtml");
    assert_eq!(locator.anchor_id.as_deref(), Some("intro"));
    assert!(matches!(
        footnote,
        RuntimeSourceLocatorResolution::Pending {
            reason: RuntimeSourceLocatorPendingReason::NoPageProjection,
            matched_by: RuntimeSourceLocatorMatchedBy::Anchor,
            ..
        }
    ));
    assert_eq!(
        serde_json::to_value(&href).expect("resolution serializes")["status"],
        "resolved"
    );
}

#[test]
fn reports_no_page_projection_for_a_completed_empty_chapter() {
    let mut document =
        RuntimeDocument::open(&empty_chapter_fixture_epub()).expect("empty document opens");
    let revision = document
        .create_revision(&layout())
        .expect("empty revision is created");

    let resolution = document
        .resolve_source_locator(&revision.revision_id, source_locator("chapter.xhtml"))
        .expect("empty chapter href is a valid source locator");

    assert!(matches!(
        &resolution,
        RuntimeSourceLocatorResolution::Pending {
            reason: RuntimeSourceLocatorPendingReason::NoPageProjection,
            matched_by: RuntimeSourceLocatorMatchedBy::Href,
            ..
        }
    ));
    let serialized = serde_json::to_value(&resolution).expect("pending resolution serializes");
    assert_eq!(serialized["status"], "pending");
    assert_eq!(serialized["reason"], "noPageProjection");
}

#[test]
fn rejects_invalid_source_locator_hrefs_and_selectors() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let index = document
        .get_chapter_text_indices(&revision.revision_id)
        .expect("chapter text index resolves")
        .entries
        .get("chapter")
        .expect("chapter index exists")
        .clone();
    let point = RuntimeSourcePoint {
        node_path: index.spans[0].node_path.clone(),
        text_offset: 1,
    };

    let missing_href = document
        .resolve_source_locator(&revision.revision_id, source_locator("missing.xhtml"))
        .expect_err("missing href fails");
    let mut mutually_exclusive = source_locator("chapter.xhtml");
    mutually_exclusive.source_point = Some(point.clone());
    mutually_exclusive.source_range = Some(RuntimeSourceRange {
        start: point.clone(),
        end: point.clone(),
    });
    let mutually_exclusive = document
        .resolve_source_locator(&revision.revision_id, mutually_exclusive)
        .expect_err("mutually exclusive selectors fail");
    let mut invalid_point = source_locator("chapter.xhtml");
    invalid_point.source_point = Some(RuntimeSourcePoint {
        node_path: point.node_path,
        text_offset: usize::MAX,
    });
    let invalid_point = document
        .resolve_source_locator(&revision.revision_id, invalid_point)
        .expect_err("invalid source offset fails");
    let mut missing_anchor = source_locator("chapter.xhtml");
    missing_anchor.anchor_id = Some("missing".to_owned());
    let missing_anchor = document
        .resolve_source_locator(&revision.revision_id, missing_anchor)
        .expect_err("missing source anchor fails");
    let mut invalid_progression = source_locator("chapter.xhtml");
    invalid_progression.progression = Some(1.01);
    let invalid_progression = document
        .resolve_source_locator(&revision.revision_id, invalid_progression)
        .expect_err("out of range progression fails");

    assert_eq!(
        missing_href.kind,
        RuntimeSourceLocatorErrorKind::HrefNotFound
    );
    for error in [
        mutually_exclusive,
        invalid_point,
        missing_anchor,
        invalid_progression,
    ] {
        assert_eq!(error.kind, RuntimeSourceLocatorErrorKind::InvalidSelector);
    }
}

#[test]
fn returns_pending_for_valid_source_targets_outside_a_preview_revision() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let revision = document
        .create_revision_window_with_line_breaking(&layout(), LineBreaking::Greedy, 1, 1)
        .expect("chapter window revision is created");
    let window_index = document
        .get_chapter_text_indices(&revision.revision_id)
        .expect("window chapter index resolves")
        .entries
        .get("chapter-2")
        .expect("window chapter index exists")
        .clone();
    let mut point_locator = source_locator("chapter-3.xhtml");
    point_locator.source_point = Some(RuntimeSourcePoint {
        node_path: window_index.spans[0].node_path.clone(),
        text_offset: 1,
    });

    let pending = document
        .resolve_source_locator(&revision.revision_id, point_locator)
        .expect("valid unpaginated point is pending");
    let pending_href = document
        .resolve_source_locator(&revision.revision_id, source_locator("chapter-1.xhtml"))
        .expect("valid unpaginated href is pending");
    let mut invalid_point = source_locator("chapter-3.xhtml");
    invalid_point.source_point = Some(RuntimeSourcePoint {
        node_path: vec![999],
        text_offset: 0,
    });
    let invalid_point = document
        .resolve_source_locator(&revision.revision_id, invalid_point)
        .expect_err("invalid unpaginated point is rejected after lazy parsing");

    let RuntimeSourceLocatorResolution::Pending {
        locator,
        spine_idref,
        reason,
        matched_by,
        ..
    } = pending
    else {
        panic!("source point outside the preview should be pending");
    };
    assert_eq!(locator.href, "chapter-3.xhtml");
    assert_eq!(spine_idref, "chapter-3");
    assert_eq!(reason, RuntimeSourceLocatorPendingReason::NotPaginated);
    assert_eq!(matched_by, RuntimeSourceLocatorMatchedBy::SourcePoint);
    assert!(matches!(
        pending_href,
        RuntimeSourceLocatorResolution::Pending {
            matched_by: RuntimeSourceLocatorMatchedBy::Href,
            ..
        }
    ));
    assert_eq!(
        invalid_point.kind,
        RuntimeSourceLocatorErrorKind::InvalidSelector
    );
    assert!(document.source_chapter_indices.contains_key("chapter-3"));
}

#[test]
fn source_locator_projection_changes_across_reflow_without_changing_source_identity() {
    let mut document =
        RuntimeDocument::open(&source_locator_fixture_epub()).expect("document opens");
    let first = document
        .create_revision(&layout())
        .expect("first revision is created");
    let index = document
        .get_chapter_text_indices(&first.revision_id)
        .expect("chapter text index resolves")
        .entries
        .get("chapter")
        .expect("chapter index exists")
        .clone();
    let span = &index.spans[index.spans.len() * 3 / 4];
    let mut locator = source_locator("chapter.xhtml");
    locator.source_point = Some(RuntimeSourcePoint {
        node_path: span.node_path.clone(),
        text_offset: span.source_start,
    });
    let mut compact_layout = layout();
    compact_layout.viewport_height = 320.0;
    compact_layout.page_height = 320.0;
    let second = document
        .create_revision(&compact_layout)
        .expect("second revision is created");

    let first_projection = document
        .resolve_source_locator(&first.revision_id, locator.clone())
        .expect("first projection resolves");
    let second_projection = document
        .resolve_source_locator(&second.revision_id, locator.clone())
        .expect("second projection resolves");
    let (first_page, first_locator) = resolved_page_and_locator(first_projection);
    let (second_page, second_locator) = resolved_page_and_locator(second_projection);

    assert_ne!(first_page, second_page);
    assert_eq!(first_locator, locator);
    assert_eq!(second_locator, locator);
}

fn assert_resolved_source_locator(
    resolution: &RuntimeSourceLocatorResolution,
    expected_match: RuntimeSourceLocatorMatchedBy,
    expected_href: &str,
    expected_page: usize,
) {
    let RuntimeSourceLocatorResolution::Resolved {
        locator,
        spine_idref,
        page_index,
        spread_index,
        matched_by,
        ..
    } = resolution
    else {
        panic!("source locator should be resolved");
    };
    assert_eq!(locator.href, expected_href);
    assert_eq!(spine_idref, "chapter");
    assert_eq!(*page_index, expected_page);
    assert_eq!(*spread_index, 0);
    assert_eq!(*matched_by, expected_match);
}

fn resolved_page_and_locator(
    resolution: RuntimeSourceLocatorResolution,
) -> (usize, RuntimeSourceLocator) {
    let RuntimeSourceLocatorResolution::Resolved {
        page_index,
        locator,
        matched_by,
        ..
    } = resolution
    else {
        panic!("source locator should be resolved");
    };
    assert_eq!(matched_by, RuntimeSourceLocatorMatchedBy::SourcePoint);
    (page_index, locator)
}

#[test]
fn prefetches_frames_into_revision_cache() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let response = document
        .prefetch_frames(
            &revision.revision_id,
            RuntimePrefetchRequest {
                spread_indexes: vec![0, 0, 99],
            },
        )
        .expect("prefetch succeeds");
    let frame = document
        .get_frame(&revision.revision_id, 0)
        .expect("warmed frame remains available");

    assert_eq!(response.revision_id, revision.revision_id);
    assert_eq!(response.warmed_spread_indexes, vec![0]);
    assert_eq!(response.missing_spread_indexes, vec![99]);
    assert_eq!(response.cached_frame_count, 1);
    assert_eq!(frame.spread_index, 0);
    assert_eq!(document.cached_frame_count(&revision.revision_id), Some(1));
}

#[test]
fn plans_frame_resource_warm_window_in_runtime() {
    let mut document =
        RuntimeDocument::open(&multi_chapter_fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let middle = document
        .frame_resource_warm_plan(&revision.revision_id, 1)
        .expect("middle warm plan resolves");
    let start = document
        .frame_resource_warm_plan(&revision.revision_id, 0)
        .expect("start warm plan resolves");

    assert_eq!(middle.revision_id, revision.revision_id);
    assert_eq!(middle.center_spread_index, 1);
    assert_eq!(middle.display_spread_index, 1);
    assert_eq!(middle.spread_indexes, vec![1, 2, 0]);
    assert_eq!(start.display_spread_index, 0);
    assert_eq!(start.spread_indexes, vec![0, 1, 2]);
}

#[test]
fn exposes_typed_page_targets_with_canonical_footnote_and_image_semantics() {
    let mut document =
        RuntimeDocument::open(&interaction_target_fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let targets = document
        .get_page_targets(&revision.revision_id, 0)
        .expect("targets are available");
    let entries = (0..revision.page_count)
        .flat_map(|page_index| {
            document
                .get_page_targets(&revision.revision_id, page_index)
                .expect("all page targets are available")
                .entries
        })
        .collect::<Vec<_>>();
    let missing = document
        .get_page_targets(&revision.revision_id, 99)
        .expect_err("missing page fails");

    assert_eq!(targets.revision_id, revision.revision_id);
    assert_eq!(targets.page_index, 0);
    assert_eq!(targets.spread_index, 0);
    assert_eq!(targets.entry_count, targets.entries.len());
    assert!(targets.entry_count >= 1);
    assert!(entries.iter().any(|entry| entry.text.length > 0));
    let footnote = entries
        .iter()
        .find(|entry| entry.kind == RuntimePageTargetKind::Footnote)
        .expect("same-page noteref is promoted by the current revision");
    assert_eq!(footnote.label, "note");
    assert_eq!(footnote.href.as_deref(), Some("#fn1"));
    assert_eq!(footnote.footnote_key.as_deref(), Some("chapter.xhtml#fn1"));
    let source = footnote
        .source_locator
        .as_ref()
        .expect("text target keeps its click-source locator");
    assert_eq!(source.href, "chapter.xhtml");
    assert!(source.source_point.is_some());
    let destination = footnote
        .target_locator
        .as_ref()
        .expect("internal footnote keeps its canonical target locator");
    assert_eq!(destination.href, "chapter.xhtml");
    assert_eq!(destination.anchor_id.as_deref(), Some("fn1"));

    let internal = entries
        .iter()
        .find(|entry| entry.label == "internal")
        .expect("internal link target");
    assert_eq!(internal.kind, RuntimePageTargetKind::Link);
    assert_eq!(internal.href.as_deref(), Some("#intro"));
    assert_eq!(
        internal
            .target_locator
            .as_ref()
            .and_then(|locator| locator.anchor_id.as_deref()),
        Some("intro")
    );

    let current = entries
        .iter()
        .find(|entry| entry.label == "current")
        .expect("empty href remains a current-document link");
    assert_eq!(current.kind, RuntimePageTargetKind::Link);
    assert_eq!(current.href.as_deref(), Some(""));
    let current_destination = current
        .target_locator
        .as_ref()
        .expect("empty href resolves to the current chapter");
    assert_eq!(current_destination.href, "chapter.xhtml");
    assert!(current_destination.anchor_id.is_none());

    let external = entries
        .iter()
        .find(|entry| entry.label == "external")
        .expect("external link target");
    assert_eq!(external.kind, RuntimePageTargetKind::Link);
    assert_eq!(
        external.href.as_deref(),
        Some("https://example.com/help#reader")
    );
    assert!(external.target_locator.is_none());

    let linked_image = entries
        .iter()
        .find(|entry| entry.image_alt.as_deref() == Some("linked cover"))
        .expect("linked image target");
    assert_eq!(linked_image.kind, RuntimePageTargetKind::Link);
    assert_eq!(linked_image.href.as_deref(), Some("#intro"));
    assert!(linked_image.target_locator.is_some());

    let image = entries
        .iter()
        .find(|entry| entry.image_alt.as_deref() == Some("standalone cover"))
        .expect("standalone image is typed");
    assert_eq!(image.kind, RuntimePageTargetKind::Image);
    assert_eq!(image.label, "standalone cover");
    assert_eq!(image.image_src.as_deref(), Some("Images/cover.png"));
    assert!(image.href.is_none());
    assert!(image.source_locator.is_none());
    assert!(image.target_locator.is_none());
    assert_eq!(missing.message(), "unknown page index: 99");
}

#[test]
fn exposes_typed_page_semantics_owned_by_the_requested_revision_page() {
    let mut document =
        RuntimeDocument::open(&interaction_target_fixture_epub()).expect("document opens");
    let layout = layout();
    let revision = document
        .create_revision(&layout)
        .expect("revision is created");
    let pages = (0..revision.page_count)
        .map(|page_index| {
            document
                .get_page_semantics(&revision.revision_id, page_index)
                .expect("page semantics are available")
        })
        .collect::<Vec<_>>();
    let semantics = &pages[0];
    let missing = document
        .get_page_semantics(&revision.revision_id, revision.page_count)
        .expect_err("a page outside the revision is rejected");
    let unknown = document
        .get_page_semantics("rev-missing", 0)
        .expect_err("an unknown revision is rejected");

    assert_eq!(semantics.revision_id, revision.revision_id);
    assert_eq!(semantics.page_index, 0);
    assert_eq!(semantics.spread_index, 0);
    let mut nodes = Vec::new();
    for (page_index, semantics) in pages.iter().enumerate() {
        assert_eq!(semantics.revision_id, revision.revision_id);
        assert_eq!(semantics.page_index, page_index);
        collect_semantic_nodes(&semantics.nodes, &mut nodes);
        for node in &semantics.nodes {
            assert_semantic_node_invariants(node);
        }
    }
    assert!(nodes
        .iter()
        .any(|node| node.role == RuntimeSemanticRole::Paragraph));
    assert!(nodes.iter().any(|node| {
        node.role == RuntimeSemanticRole::Link && node.href.as_deref() == Some("#intro")
    }));
    assert!(nodes.iter().any(|node| {
        node.role == RuntimeSemanticRole::Image && node.alt.as_deref() == Some("standalone cover")
    }));
    for node in nodes {
        assert!(node.bounds.x >= 0.0);
        assert!(node.bounds.y >= 0.0);
        assert!(node.bounds.x + node.bounds.width <= layout.page_width);
        assert!(node.bounds.y + node.bounds.height <= layout.page_height);
    }
    assert_eq!(
        missing.message(),
        format!("unknown page index: {}", revision.page_count)
    );
    assert_eq!(unknown.message(), "unknown revision: rev-missing");
}

#[test]
fn double_spread_page_targets_keep_page_content_coordinates() {
    let mut document =
        RuntimeDocument::open(&source_locator_fixture_epub()).expect("document opens");
    let layout = double_layout();
    let revision = document
        .create_revision(&layout)
        .expect("double-page revision is created");
    assert!(revision.page_count >= 3);

    let left = document
        .get_page_targets(&revision.revision_id, 1)
        .expect("left page targets");
    let right = document
        .get_page_targets(&revision.revision_id, 2)
        .expect("right page targets");
    let left_semantics = document
        .get_page_semantics(&revision.revision_id, 1)
        .expect("left page semantics");
    let right_semantics = document
        .get_page_semantics(&revision.revision_id, 2)
        .expect("right page semantics");

    assert_eq!(left.spread_index, 1);
    assert_eq!(right.spread_index, 1);
    assert_eq!(left_semantics.spread_index, 1);
    assert_eq!(right_semantics.spread_index, 1);
    assert!(!left.entries.is_empty());
    assert!(!right.entries.is_empty());
    for target in left.entries.iter().chain(&right.entries) {
        assert!(target.bounds.x >= 0.0);
        assert!(target.bounds.x + target.bounds.width <= layout.page_width);
        assert!(target.bounds.y >= 0.0);
        assert!(target.bounds.y + target.bounds.height <= layout.page_height);
    }
    let mut semantic_nodes = Vec::new();
    collect_semantic_nodes(&left_semantics.nodes, &mut semantic_nodes);
    collect_semantic_nodes(&right_semantics.nodes, &mut semantic_nodes);
    assert!(!semantic_nodes.is_empty());
    for node in semantic_nodes {
        assert!(node.bounds.x >= 0.0);
        assert!(node.bounds.x + node.bounds.width <= layout.page_width);
        assert!(node.bounds.y >= 0.0);
        assert!(node.bounds.y + node.bounds.height <= layout.page_height);
    }
}

#[test]
fn exposes_page_text_positions_from_typed_page_content() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let positions = document
        .get_page_text_positions(&revision.revision_id, 0)
        .expect("text positions are available");
    let missing = document
        .get_page_text_positions(&revision.revision_id, 99)
        .expect_err("missing page fails");

    assert_eq!(positions.revision_id, revision.revision_id);
    assert_eq!(positions.page_index, 0);
    assert_eq!(positions.spread_index, 0);
    assert!(positions.text.contains("Hello runtime"));
    assert_eq!(positions.text_length, positions.text.encode_utf16().count());
    assert!(!positions.text_hash.is_empty());
    assert!(positions
        .offsets
        .iter()
        .any(|offset| offset.end > offset.start));
    assert_eq!(missing.message(), "unknown page index: 99");
}

#[test]
fn search_source_is_unavailable_when_raw_parsed_text_has_a_hidden_gap() {
    let mut document =
        RuntimeDocument::open(&search_source_gap_fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let response = document
        .search(
            &revision.revision_id,
            RuntimeSearchRequest {
                query: "visiblematch".to_owned(),
                case_sensitive: true,
                whole_word: false,
                limit: Some(1),
            },
        )
        .expect("search succeeds");

    assert_eq!(response.result_count, 1);
    assert!(matches!(
        response.results[0].source,
        RuntimeSearchSource::Unavailable { .. }
    ));
}

#[test]
fn resolves_text_range_geometry_from_search_positions() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let search = document
        .search(
            &revision.revision_id,
            RuntimeSearchRequest {
                query: "runtime".to_owned(),
                case_sensitive: false,
                whole_word: false,
                limit: Some(1),
            },
        )
        .expect("search succeeds");
    let result = &search.results[0];

    let geometry = document
        .get_text_range_geometry(
            &revision.revision_id,
            RuntimeTextRangeGeometryRequest {
                page_index: result.page_index,
                start: result.match_range.start,
                end: result.match_range.end,
            },
        )
        .expect("text geometry is available");
    let wrong_page = document
        .get_text_range_geometry(
            &revision.revision_id,
            RuntimeTextRangeGeometryRequest {
                page_index: 99,
                start: result.match_range.start,
                end: result.match_range.end,
            },
        )
        .expect_err("missing page fails");

    assert_eq!(geometry.revision_id, revision.revision_id);
    assert_eq!(geometry.page_index, result.page_index);
    assert_eq!(geometry.spread_index, result.spread_index);
    assert!(geometry.rect_count >= 1);
    assert_eq!(geometry.rect_count, geometry.rects.len());
    assert!(geometry.rects.iter().all(|rect| rect.width > 0.0));
    assert_eq!(wrong_page.message(), "unknown page index: 99");
}
