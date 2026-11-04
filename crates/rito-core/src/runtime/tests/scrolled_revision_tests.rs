//! A scrolled revision: every chapter one strip, its pages the strip's
//! windows, painted by the strip and moved onto their own origins.

use super::fixture::{
    layout, long_paragraphs_fixture_epub, multi_chapter_fixture_epub, pinned_test_font_policy,
};
use super::pinned_font_policy_fixtures::{face, policy, serif_text_font};
use crate::interaction::{TextCaretAddress, TextCaretAffinity};
use crate::layout::{LayoutConfig, SpreadMode};
use crate::runtime::page_artifact::{
    FragmentPageArtifact, PageArtifactSourcePoint, PageArtifactTextCaretQuery,
    PageArtifactTextCaretResolution,
};
use crate::runtime::source_locator::PaginationTarget;
use crate::runtime::{
    RuntimeDocument, RuntimePageReadingAnchor, RuntimePinnedFontGenericRole, RuntimeSourceLocator,
    RuntimeSourceLocatorResolution, RuntimeSourcePoint,
};

fn scrolled() -> LayoutConfig {
    let mut layout = layout();
    layout.spread_mode = SpreadMode::Scrolled;
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = Some(true);
    layout
}

fn document() -> RuntimeDocument {
    RuntimeDocument::open_with_pinned_font_policy(
        &multi_chapter_fixture_epub(),
        policy(vec![face(
            serif_text_font(),
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .expect("multi-chapter document opens")
}

/// The text of each run an artifact records, in order.
fn run_texts(artifact: &FragmentPageArtifact) -> Vec<String> {
    let text: Vec<u16> = artifact.page_text().encode_utf16().collect();
    artifact
        .interaction_runs()
        .iter()
        .map(|run| String::from_utf16_lossy(&text[run.start..run.end]))
        .collect()
}

#[test]
fn a_scrolled_revision_pages_each_chapter_as_the_windows_of_its_strip() {
    let mut document = document();
    let summary = document
        .create_revision(&scrolled())
        .expect("scrolled revision is created");
    let revision = document
        .revisions
        .get(&summary.revision_id)
        .expect("revision is retained");
    let layout = &revision.fragment_layout;
    let chapters: Vec<(usize, usize)> = layout
        .chapters()
        .map(|(chapter, start)| (start, chapter.page_count))
        .collect();
    assert!(chapters.len() > 1);
    for (chapter_index, (start, page_count)) in chapters.into_iter().enumerate() {
        let strip = layout.chapter_strip(chapter_index).expect("strip lays out");
        assert_eq!(page_count, strip.windows().count());
        let recorded: Vec<String> = (start..start + page_count)
            .flat_map(|page| {
                run_texts(
                    &layout
                        .page(page)
                        .expect("page is published")
                        .artifact_handle(),
                )
            })
            .collect();
        assert_eq!(recorded, run_texts(&strip.whole_artifact()));
    }
}

#[test]
fn a_scrolled_spread_is_its_window_framed_by_the_strip() {
    let mut document = document();
    let summary = document
        .create_revision(&scrolled())
        .expect("scrolled revision is created");
    let revision = document
        .revisions
        .get(&summary.revision_id)
        .expect("revision is retained");
    let layout = &revision.fragment_layout;
    let strip = layout.chapter_strip(0).expect("strip lays out");
    let session = revision.chapter_engine_session();
    for ratio in [1.0, 2.625] {
        for window in 0..strip.windows().count() {
            let frame = session
                .frame(window, ratio)
                .expect("frame paints")
                .expect("spread is published");
            assert_eq!(frame.page_indexes, [window]);
            assert_eq!(
                frame.device_origin,
                strip.windows().device_origin(window, ratio)
            );
            let (commands, _) = strip
                .window_frame(strip.whole(), window..window + 1, ratio)
                .expect("window paints");
            assert_eq!(frame.commands.to_vec(), commands);
        }
    }
}

#[test]
fn a_scrolled_chapter_is_laid_out_whole_for_its_first_window() {
    let mut document = document();
    let build = document
        .build_chapter_local_fragment_layout(&scrolled(), 0, &PaginationTarget::Start)
        .expect("chapter builds");
    let layout = &build.layout;
    let strip = layout.chapter_strip(0).expect("strip lays out");
    assert!(layout.is_complete(), "nothing of a strip is left to resume");
    assert_eq!(layout.page_count(), strip.windows().count());
}

/// Each line start of every window: its source point, and the window's
/// content-box point at the start of its first run.
fn line_starts(
    revision: &crate::runtime::RuntimeRevision,
) -> Vec<(usize, PageArtifactSourcePoint, (f64, f64))> {
    let session = revision.chapter_engine_session();
    let layout = &revision.fragment_layout;
    let mut starts = Vec::new();
    for page in 0..layout.page_count() {
        let artifact = layout
            .page(page)
            .expect("page is published")
            .artifact_handle();
        for run in artifact
            .interaction_runs()
            .iter()
            .filter(|run| run.run_index == 0)
        {
            let Some(caret) = session.text_caret(TextCaretAddress {
                page_index: page,
                block_index: run.block_index,
                line_index: run.line_index,
                run_index: 0,
                char_index: 0,
                affinity: TextCaretAffinity::Downstream,
            }) else {
                continue;
            };
            starts.push((page, caret.source_point, (run.x, run.y)));
        }
    }
    starts
}

/// The source point a reader reads at the reading line of `page` shown from
/// `offset`, at the inline position `x`.
fn read_at_reading_line(
    revision: &crate::runtime::RuntimeRevision,
    page: usize,
    offset: f64,
    x: f64,
) -> PageArtifactSourcePoint {
    let reading_line = offset - revision.layout_config.margin_top;
    match revision
        .chapter_engine_session()
        .resolve_text_caret(PageArtifactTextCaretQuery {
            page_index: page,
            x: x + 0.5,
            y: reading_line + 0.5,
        }) {
        Some(PageArtifactTextCaretResolution::Resolved(caret)) => caret.source_point,
        other => panic!("page {page}: nothing at the reading line {reading_line}: {other:?}"),
    }
}

fn locator(href: &str, point: &PageArtifactSourcePoint) -> RuntimeSourceLocator {
    RuntimeSourceLocator {
        href: href.to_owned(),
        anchor_id: None,
        source_point: Some(RuntimeSourcePoint {
            node_path: point.node_path.clone(),
            text_offset: point.text_offset,
        }),
        source_range: None,
        progression: None,
    }
}

fn resolved_page(
    document: &mut RuntimeDocument,
    revision_id: &str,
    locator: RuntimeSourceLocator,
) -> usize {
    match document
        .resolve_source_locator(revision_id, locator)
        .expect("locator resolves")
    {
        RuntimeSourceLocatorResolution::Resolved { page_index, .. } => page_index,
        pending => panic!("locator is pending: {pending:?}"),
    }
}

fn chapter_href(document: &mut RuntimeDocument, revision_id: &str) -> String {
    match document
        .get_page_reading_anchor(revision_id, 0)
        .expect("anchor request is valid")
    {
        RuntimePageReadingAnchor::Resolved { locator, .. } => locator.href,
        other => panic!("first page has no reading anchor: {other:?}"),
    }
}

#[test]
fn every_line_start_resolves_to_its_window_and_reads_back_at_the_reading_line() {
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &long_paragraphs_fixture_epub(),
        pinned_test_font_policy(),
    )
    .expect("fixture opens");
    let revision_id = document
        .create_revision(&scrolled())
        .expect("scrolled revision is created")
        .revision_id;
    let href = chapter_href(&mut document, &revision_id);
    let starts = line_starts(&document.revisions[&revision_id]);
    assert!(starts.len() > 100);
    for (page, point, _) in &starts {
        let resolved = resolved_page(&mut document, &revision_id, locator(&href, point));
        assert_eq!(
            resolved, *page,
            "{point:?} resolves to the window it starts in"
        );
    }
    let revision = &document.revisions[&revision_id];
    for (page, point, (x, _)) in &starts {
        let offset = revision
            .chapter_engine_session()
            .target_block_offset(*page, point, 1.0)
            .expect("the window draws the point");
        assert_eq!(read_at_reading_line(revision, *page, offset, *x), *point);
    }
}

#[test]
fn a_pages_reading_point_lands_in_a_window_and_reads_back_to_the_page() {
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &long_paragraphs_fixture_epub(),
        pinned_test_font_policy(),
    )
    .expect("fixture opens");
    let mut paged = layout();
    paged.font_family_override = Some("serif".to_owned());
    paged.font_family_force = Some(true);
    let paged_id = document
        .create_revision(&paged)
        .expect("paged revision")
        .revision_id;
    let scrolled_id = document
        .create_revision(&scrolled())
        .expect("scrolled revision")
        .revision_id;
    let page_count = document.revisions[&paged_id].fragment_layout.page_count();
    for page in 0..page_count {
        let RuntimePageReadingAnchor::Resolved {
            locator: anchor, ..
        } = document
            .get_page_reading_anchor(&paged_id, page)
            .expect("anchor request is valid")
        else {
            panic!("page {page} has a reading anchor");
        };
        let point = anchor
            .source_point
            .clone()
            .expect("the anchor is a source point");
        let point = PageArtifactSourcePoint {
            node_path: point.node_path,
            text_offset: point.text_offset,
        };
        let window = resolved_page(&mut document, &scrolled_id, anchor.clone());
        let revision = &document.revisions[&scrolled_id];
        let offset = revision
            .chapter_engine_session()
            .target_block_offset(window, &point, 1.0)
            .expect("the window draws the anchor");
        let read = read_at_reading_line(revision, window, offset, 0.0);
        let back = resolved_page(&mut document, &paged_id, locator(&anchor.href, &read));
        assert_eq!(back, page, "page {page} reads back from window {window}");
    }
}

#[test]
fn a_kept_locator_stays_on_the_reading_line_through_ten_relayouts() {
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &long_paragraphs_fixture_epub(),
        pinned_test_font_policy(),
    )
    .expect("fixture opens");
    let first = document
        .create_revision(&scrolled())
        .expect("scrolled revision")
        .revision_id;
    let href = chapter_href(&mut document, &first);
    let starts = line_starts(&document.revisions[&first]);
    let (_, kept, _) = starts[starts.len() / 2].clone();
    for relayout in 0..10 {
        let mut config = scrolled();
        if relayout % 2 == 1 {
            config.viewport_width = 360.0;
            config.page_width = 360.0;
        }
        let revision_id = document
            .create_revision(&config)
            .expect("relayout")
            .revision_id;
        let window = resolved_page(&mut document, &revision_id, locator(&href, &kept));
        let revision = &document.revisions[&revision_id];
        let session = revision.chapter_engine_session();
        let offset = session
            .target_block_offset(window, &kept, 1.0)
            .expect("the window draws the kept point");
        let read = read_at_reading_line(revision, window, offset, 0.0);
        assert_eq!(
            session.target_block_offset(window, &read, 1.0),
            Some(offset),
            "relayout {relayout}: the reading line holds the kept point's line"
        );
        assert!(
            read.node_path <= kept.node_path
                && (read.node_path < kept.node_path || read.text_offset <= kept.text_offset)
        );
    }
}

#[test]
fn a_whole_book_table_warms_each_scrolled_chapter_before_it_lays_its_strip_out() {
    use crate::runtime::revision::RevisionProgress;

    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &long_paragraphs_fixture_epub(),
        pinned_test_font_policy(),
    )
    .expect("fixture opens");
    let whole = document
        .create_revision(&scrolled())
        .expect("scrolled revision is created")
        .revision_id;
    let pages = document.revisions[&whole].fragment_layout.page_count();
    let mut build = document.begin_revision(&scrolled()).expect("build begins");
    let mut steps = 0;
    let stepped = loop {
        steps += 1;
        match document
            .advance_revision(build, 1)
            .expect("a step lays out")
        {
            RevisionProgress::Pending(next) => build = *next,
            RevisionProgress::Done(summary) => break summary.revision_id,
        }
    };
    // A chapter paginates a page a step, pages shorter than its windows,
    // before its windows are taken one a step: at least twice the steps a
    // table of windows alone would take.
    assert!(steps >= 2 * pages, "{steps} steps for {pages} windows");
    let layout = &document.revisions[&stepped].fragment_layout;
    assert_eq!(layout.page_count(), pages);
    for page in 0..pages {
        assert_eq!(
            run_texts(
                &layout
                    .page(page)
                    .expect("page is published")
                    .artifact_handle()
            ),
            run_texts(
                &document.revisions[&whole]
                    .fragment_layout
                    .page(page)
                    .expect("page is published")
                    .artifact_handle()
            ),
        );
    }
    // Each chapter says how long its strip runs once the strip is laid out.
    for (index, (chapter, _)) in layout.chapters().enumerate() {
        let strip = layout.chapter_strip(index).expect("strip lays out");
        assert_eq!(chapter.extent, Some(strip.windows().extent()));
    }
}
