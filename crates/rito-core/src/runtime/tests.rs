mod access_tests;
mod chapter_local_tests;
pub(crate) mod fixture;
mod fragment_page_table_tests;
pub(crate) mod pinned_font_policy_fixtures;
mod pinned_font_policy_tests;
mod pinned_font_policy_validation_tests;
mod pinned_font_wiring_tests;
mod reading_anchor_tests;
pub(crate) mod revisions;
mod text_granularity_tests;
mod text_interaction_tests;
mod text_movement_tests;

use fixture::{
    double_layout, empty_chapter_fixture_epub, fixture_epub, fixture_stylesheet,
    interaction_target_fixture_epub, layout, malformed_chapter_fixture_epub, minimal_png,
    search_source_gap_fixture_epub, source_locator_fixture_epub,
};

use revisions::{revision_by_id, search, text_range_geometry};

use super::{
    frame::chapter_window_layout_config,
    page_artifact::{PageArtifactSemanticNode, PageArtifactSemanticRole},
    RuntimeDocument, RuntimePageTargetKind, RuntimeResourceKind, RuntimeRevisionExtent,
    RuntimeSearchRequest, RuntimeSearchSource, RuntimeSourceLocator, RuntimeSourceLocatorErrorKind,
    RuntimeSourceLocatorMatchedBy, RuntimeSourceLocatorPendingReason,
    RuntimeSourceLocatorResolution, RuntimeSourcePoint, RuntimeSourceRange,
    RuntimeTextRangeGeometryRequest,
};
use crate::interaction::FootnoteKind;
use crate::layout::SpreadMode;
fn source_locator(href: &str) -> RuntimeSourceLocator {
    RuntimeSourceLocator {
        href: href.to_owned(),
        anchor_id: None,
        source_point: None,
        source_range: None,
        progression: None,
    }
}

/// The semantic nodes of one page, as the page artifact a session reads
/// them from holds them.
fn page_semantic_nodes(
    document: &RuntimeDocument,
    revision_id: &str,
    page_index: usize,
) -> Option<Vec<PageArtifactSemanticNode>> {
    revision_by_id(document, revision_id)
        .chapter_engine_session()
        .page(page_index)
        .map(|page| page.semantic_nodes())
}

fn collect_semantic_nodes<'a>(
    nodes: &'a [PageArtifactSemanticNode],
    output: &mut Vec<&'a PageArtifactSemanticNode>,
) {
    for node in nodes {
        output.push(node);
        collect_semantic_nodes(&node.children, output);
    }
}

fn assert_semantic_node_invariants(node: &PageArtifactSemanticNode) {
    match node.role {
        PageArtifactSemanticRole::Heading => {
            assert!(matches!(node.level, Some(1..=6)));
            assert!(node.alt.is_none());
            assert!(node.href.is_none());
        }
        PageArtifactSemanticRole::Image => {
            assert!(node.level.is_none());
            assert!(node.href.is_none());
        }
        PageArtifactSemanticRole::Link => {
            assert!(node.level.is_none());
            assert!(node.alt.is_none());
            assert!(node
                .href
                .as_ref()
                .is_some_and(|href| !href.trim().is_empty()));
        }
        PageArtifactSemanticRole::Paragraph
        | PageArtifactSemanticRole::List
        | PageArtifactSemanticRole::ListItem
        | PageArtifactSemanticRole::Blockquote
        | PageArtifactSemanticRole::Table
        | PageArtifactSemanticRole::Generic => {
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
fn creates_revisions_and_paints_their_spreads() {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");

    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let frame = document
        .frame_commands_for_tests(&revision.revision_id, 0)
        .expect("frame commands paint");

    assert_eq!(revision.revision_id, "rev-1");
    assert!(revision.page_count >= 1);
    assert!(revision.spread_count >= 1);
    assert_eq!(frame.page_indexes, vec![0]);
    assert!(!frame.commands.is_empty());
    assert!(frame.commands.iter().any(|command| {
        matches!(command, crate::render::DisplayCommand::PaintText(input) if !input.text.is_empty())
    }));
}

#[test]
fn a_created_revision_reports_the_extent_of_its_page_table() {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");

    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    assert_eq!(revision.revision_version, 0);
    assert!(revision.page_count >= 1);
    assert!(revision.spread_count >= 1);
    assert!(revision.spread_count <= revision.page_count);

    let stored = document
        .revisions
        .get(&revision.revision_id)
        .expect("revision state is retained");
    assert_eq!(stored.revision_version, revision.revision_version);
    assert_eq!(
        stored.extent,
        RuntimeRevisionExtent {
            page_count: revision.page_count,
            spread_count: revision.spread_count,
        }
    );
    assert_eq!(stored.fragment_layout.page_count(), revision.page_count);
}

#[test]
fn creates_revision_when_chapter_xhtml_is_malformed() {
    let bytes = malformed_chapter_fixture_epub();
    let loaded = crate::epub::open_document(&bytes)
        .expect("formal parsing preserves malformed XHTML as a warning");
    let prepared = crate::epub::prepare_loaded_document(&loaded);
    let mut document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("document opens");

    let revision = document
        .create_revision(&layout())
        .expect("image preloading does not bypass XHTML recovery");

    // The unclosed <p> closes implicitly under tag-pairing recovery —
    // the chapter lays with its content instead of degrading.
    assert!(prepared.chapters[0].parsed.warnings.is_empty());
    assert_eq!(prepared.chapters[0].parsed.nodes.len(), 1);
    assert_eq!(revision.revision_id, "rev-1");
    assert!(document.has_revision(&revision.revision_id));
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
fn layout_key_is_stable_across_revisions() {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");

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
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
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
            .get_footnote(&first.revision_id, "chapter.xhtml#fn1")
            .expect_err("released revision stays unavailable")
            .message(),
        format!("unknown revision: {}", first.revision_id)
    );
}

#[test]
fn rejects_unknown_revision_and_spread() {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let missing_revision = document
        .frame_commands_for_tests("rev-missing", 0)
        .expect_err("unknown revision fails");
    let missing_spread = document
        .frame_commands_for_tests(&revision.revision_id, 99)
        .expect_err("unknown spread fails");

    assert_eq!(missing_revision.message(), "unknown revision: rev-missing");
    assert_eq!(missing_spread.message(), "unknown spread index: 99");
}

#[test]
fn reads_revision_scoped_resources_without_kind_fallback() {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
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
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let footnote = document
        .get_footnote(&revision.revision_id, "chapter.xhtml#fn1")
        .expect("footnote is available");
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
    assert_eq!(missing.message(), "unknown footnote: chapter.xhtml#missing");
    assert_eq!(unknown_revision.message(), "unknown revision: rev-missing");
}

#[test]
fn searches_revision_scoped_typed_page_text() {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let response = search(
        &document,
        &revision.revision_id,
        RuntimeSearchRequest {
            query: "runtime".to_owned(),
            case_sensitive: false,
            whole_word: false,
            limit: Some(4),
        },
    );
    let missing = search(
        &document,
        &revision.revision_id,
        RuntimeSearchRequest {
            query: "missing".to_owned(),
            case_sensitive: false,
            whole_word: false,
            limit: None,
        },
    );

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
}

#[test]
fn resolves_source_locators_by_href_anchor_point_range_and_progression() {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let index = document.source_chapter_text_for_tests("chapter");
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
    let RuntimeSourceLocatorResolution::Resolved {
        matched_by: progression_match,
        page_index: progression_page,
        ..
    } = progression
    else {
        panic!("progression locator should be resolved");
    };
    assert_eq!(
        progression_match,
        RuntimeSourceLocatorMatchedBy::Progression
    );
    // A progression is a page-position fraction: 0.5 lands on the middle
    // of the chapter's page grid, not wherever half the text sits.
    assert_eq!(
        progression_page,
        ((revision.page_count - 1) as f64 * 0.5).round() as usize
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
fn resolves_an_empty_chapter_href_to_its_page() {
    let mut document = RuntimeDocument::open_pinned_for_tests(&empty_chapter_fixture_epub())
        .expect("empty document opens");
    let revision = document
        .create_revision(&layout())
        .expect("empty revision is created");

    let resolution = document
        .resolve_source_locator(&revision.revision_id, source_locator("chapter.xhtml"))
        .expect("empty chapter href is a valid source locator");

    // An empty chapter still owns a page in the page table, so its href
    // resolves there instead of waiting for a projection.
    assert!(matches!(
        &resolution,
        RuntimeSourceLocatorResolution::Resolved {
            page_index: 0,
            matched_by: RuntimeSourceLocatorMatchedBy::Href,
            ..
        }
    ));
}

#[test]
fn rejects_invalid_source_locator_hrefs_and_selectors() {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let index = document.source_chapter_text_for_tests("chapter");
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
fn source_locator_projection_changes_across_reflow_without_changing_source_identity() {
    let mut document = RuntimeDocument::open_pinned_for_tests(&source_locator_fixture_epub())
        .expect("document opens");
    let first = document
        .create_revision(&layout())
        .expect("first revision is created");
    let index = document.source_chapter_text_for_tests("chapter");
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
fn exposes_typed_page_targets_with_canonical_footnote_and_image_semantics() {
    let mut document = RuntimeDocument::open_pinned_for_tests(&interaction_target_fixture_epub())
        .expect("document opens");
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
#[ignore = "the fragment engine's page targets carry no click-source locator; the tapped run's source point is a follow-up"]
fn text_targets_keep_their_click_source_locator() {
    let mut document = RuntimeDocument::open_pinned_for_tests(&interaction_target_fixture_epub())
        .expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let entries = (0..revision.page_count)
        .flat_map(|page_index| {
            document
                .get_page_targets(&revision.revision_id, page_index)
                .expect("all page targets are available")
                .entries
        })
        .collect::<Vec<_>>();
    let footnote = entries
        .iter()
        .find(|entry| entry.kind == RuntimePageTargetKind::Footnote)
        .expect("same-page noteref is promoted by the current revision");
    let source = footnote
        .source_locator
        .as_ref()
        .expect("text target keeps its click-source locator");
    assert_eq!(source.href, "chapter.xhtml");
    assert!(source.source_point.is_some());
}

#[test]
fn every_page_exposes_semantic_nodes_inside_its_own_bounds() {
    let mut document = RuntimeDocument::open_pinned_for_tests(&interaction_target_fixture_epub())
        .expect("document opens");
    let layout = layout();
    let revision = document
        .create_revision(&layout)
        .expect("revision is created");
    let pages = (0..revision.page_count)
        .map(|page_index| {
            page_semantic_nodes(&document, &revision.revision_id, page_index)
                .expect("page semantics are available")
        })
        .collect::<Vec<_>>();

    let mut nodes = Vec::new();
    for page in &pages {
        collect_semantic_nodes(page, &mut nodes);
        for node in page {
            assert_semantic_node_invariants(node);
        }
    }
    assert!(nodes
        .iter()
        .any(|node| node.role == PageArtifactSemanticRole::Paragraph));
    for node in nodes {
        assert!(node.bounds.x >= 0.0);
        assert!(node.bounds.y >= 0.0);
        assert!(node.bounds.x + node.bounds.width <= layout.page_width);
        assert!(node.bounds.y + node.bounds.height <= layout.page_height);
    }
    assert!(
        page_semantic_nodes(&document, &revision.revision_id, revision.page_count).is_none(),
        "a page outside the revision has no semantics"
    );
}

#[test]
#[ignore = "the fragment engine's page semantics expose paragraphs only; link and image nodes are a follow-up"]
fn page_semantics_expose_link_and_image_nodes() {
    let mut document = RuntimeDocument::open_pinned_for_tests(&interaction_target_fixture_epub())
        .expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let pages = (0..revision.page_count)
        .map(|page_index| {
            page_semantic_nodes(&document, &revision.revision_id, page_index)
                .expect("page semantics are available")
        })
        .collect::<Vec<_>>();
    let mut nodes = Vec::new();
    for page in &pages {
        collect_semantic_nodes(page, &mut nodes);
    }
    assert!(nodes.iter().any(|node| {
        matches!(node.role, PageArtifactSemanticRole::Link)
            && node.href.as_deref() == Some("#intro")
    }));
    assert!(nodes.iter().any(|node| {
        matches!(node.role, PageArtifactSemanticRole::Image)
            && node.alt.as_deref() == Some("standalone cover")
    }));
}

#[test]
fn double_spread_page_targets_keep_page_content_coordinates() {
    let mut document = RuntimeDocument::open_pinned_for_tests(&source_locator_fixture_epub())
        .expect("document opens");
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
    let left_semantics =
        page_semantic_nodes(&document, &revision.revision_id, 1).expect("left page semantics");
    let right_semantics =
        page_semantic_nodes(&document, &revision.revision_id, 2).expect("right page semantics");

    assert_eq!(left.spread_index, 1);
    assert_eq!(right.spread_index, 1);
    assert!(!left.entries.is_empty());
    assert!(!right.entries.is_empty());
    for target in left.entries.iter().chain(&right.entries) {
        assert!(target.bounds.x >= 0.0);
        assert!(target.bounds.x + target.bounds.width <= layout.page_width);
        assert!(target.bounds.y >= 0.0);
        assert!(target.bounds.y + target.bounds.height <= layout.page_height);
    }
    let mut semantic_nodes = Vec::new();
    collect_semantic_nodes(&left_semantics, &mut semantic_nodes);
    collect_semantic_nodes(&right_semantics, &mut semantic_nodes);
    assert!(!semantic_nodes.is_empty());
    for node in semantic_nodes {
        assert!(node.bounds.x >= 0.0);
        assert!(node.bounds.x + node.bounds.width <= layout.page_width);
        assert!(node.bounds.y >= 0.0);
        assert!(node.bounds.y + node.bounds.height <= layout.page_height);
    }
}

#[test]
fn a_page_exposes_its_text_and_where_each_run_sits_in_it() {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let engine = revision_by_id(&document, &revision.revision_id).chapter_engine_session();

    let positions = engine
        .page(0)
        .expect("the first page exists")
        .text_positions();

    assert!(positions.text.contains("Hello runtime"));
    assert_eq!(positions.text_length, positions.text.encode_utf16().count());
    assert!(!positions.text_hash.is_empty());
    assert!(positions
        .offsets
        .iter()
        .any(|offset| offset.end > offset.start));
    assert!(engine.page(99).is_none(), "a page outside the revision");
}

#[test]
#[ignore = "the fragment engine maps a match that spans a hidden gap to the first run's source range only; the exact span across the gap is a follow-up"]
fn search_source_is_unavailable_when_raw_parsed_text_has_a_hidden_gap() {
    let mut document = RuntimeDocument::open_pinned_for_tests(&search_source_gap_fixture_epub())
        .expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");

    let response = search(
        &document,
        &revision.revision_id,
        RuntimeSearchRequest {
            query: "visiblematch".to_owned(),
            case_sensitive: true,
            whole_word: false,
            limit: Some(1),
        },
    );

    assert_eq!(response.result_count, 1);
    assert!(matches!(
        response.results[0].source,
        RuntimeSearchSource::Unavailable { .. }
    ));
}

#[test]
fn resolves_text_range_geometry_from_search_positions() {
    let mut document =
        RuntimeDocument::open_pinned_for_tests(&fixture_epub()).expect("document opens");
    let revision = document
        .create_revision(&layout())
        .expect("revision is created");
    let search = search(
        &document,
        &revision.revision_id,
        RuntimeSearchRequest {
            query: "runtime".to_owned(),
            case_sensitive: false,
            whole_word: false,
            limit: Some(1),
        },
    );
    let result = &search.results[0];

    let geometry = text_range_geometry(
        &document,
        &revision.revision_id,
        RuntimeTextRangeGeometryRequest {
            page_index: result.page_index,
            start: result.match_range.start,
            end: result.match_range.end,
        },
    )
    .expect("text geometry is available");
    let wrong_page = text_range_geometry(
        &document,
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
