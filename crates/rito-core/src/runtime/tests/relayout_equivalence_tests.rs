//! One document laid out again and again — a window dragged narrower and
//! back, single and double pages, larger type, a forced family — must
//! paint exactly what a fresh document paints under each layout. Whatever
//! the engine keeps between layouts is a cache of work already done, never
//! an input: a fresh document has none of it.

use std::{fmt::Write as _, rc::Rc};

use crate::layout::{
    create_layout_config, LayoutConfig, LayoutConfigInput, MarginInput, SpreadMode,
};
use crate::runtime::{
    tests::fixture::relayout_fixture_epub, RuntimeChapterLocalRevisionHandle,
    RuntimeChapterLocalRevisionRequest, RuntimeChapterLocalSourceLocatorResolution,
    RuntimeDocument, RuntimePageReadingAnchor, RuntimePinnedFontFaceInput,
    RuntimePinnedFontGenericRole, RuntimePinnedFontLanguageTag, RuntimePinnedFontPolicyInput,
    RuntimeSourceLocator, RuntimeSourceLocatorResolution, RuntimeSourcePoint,
};

const CHAPTERS: [&str; 3] = ["latin.xhtml", "cjk.xhtml", "viewport.xhtml"];

#[test]
fn a_document_laid_out_again_paints_what_a_fresh_document_paints() {
    let publication = relayout_fixture_epub();
    let steps = steps();
    let locators = locators(&publication, &steps[0].1);

    let mut warm = open(&publication);
    for (step, config) in &steps {
        // Fresh for this layout: it has laid out under no other.
        let mut fresh = open(&publication);
        for (chapter, chapter_locators) in locators.iter().enumerate() {
            for (index, locator) in chapter_locators.iter().enumerate() {
                let label = format!("{step}: {} at {locator:?}", CHAPTERS[chapter]);
                // Every spread is painted for the chapter's first target; the
                // others compare where they land.
                let paint = index == 0;
                assert_eq!(
                    chapter_snapshot(&mut warm, config, chapter, locator, paint),
                    chapter_snapshot(&mut fresh, config, chapter, locator, paint),
                    "{label}"
                );
            }
        }
        assert_eq!(
            book_snapshot(&mut warm, config, &locators),
            book_snapshot(&mut fresh, config, &locators),
            "{step}: whole book"
        );
    }
}

/// A window dragged narrower a pixel at a time and back up in steps that
/// land between pixels: at most widths most paragraphs break into the
/// lines they broke into at the last one, and whatever a layout takes from
/// the last must paint what a fresh document paints.
#[test]
fn a_window_dragged_a_pixel_at_a_time_paints_what_a_fresh_document_paints() {
    let publication = relayout_fixture_epub();
    let narrower = (0..48).map(|step| 420.0 - f64::from(step));
    let wider = (1..24).map(|step| 373.0 + 1.75 * f64::from(step));
    let mut warm = open(&publication);
    for width in narrower.chain(wider) {
        let config = create_layout_config(single(width));
        let mut fresh = open(&publication);
        for (chapter, href) in CHAPTERS.iter().enumerate() {
            assert_eq!(
                chapter_snapshot(&mut warm, &config, chapter, &locator(href), true),
                chapter_snapshot(&mut fresh, &config, chapter, &locator(href), true),
                "{href} at {width}"
            );
        }
    }
}

/// Single pages `width` wide and 640 tall with 24 px margins.
fn single(width: f64) -> LayoutConfigInput {
    LayoutConfigInput {
        width,
        height: 640.0,
        margin: MarginInput::All(24.0),
        spread: SpreadMode::Single,
        first_page_alone: true,
        spread_gap: 0.0,
        root_font_size: 16.0,
        line_height_override: None,
        line_height_force: None,
        font_family_override: None,
        font_family_force: None,
        device_pixel_ratio: 1.0,
    }
}

/// The page content box goes 372 → 352 → 332 → 312 px wide and back:
/// the fixture's `@media (min-width: 340px)` flips on the way down and
/// back up. Then double pages, larger type and a forced family.
fn steps() -> Vec<(&'static str, LayoutConfig)> {
    vec![
        ("420", create_layout_config(single(420.0))),
        ("400", create_layout_config(single(400.0))),
        ("380", create_layout_config(single(380.0))),
        ("360", create_layout_config(single(360.0))),
        ("380 again", create_layout_config(single(380.0))),
        ("420 again", create_layout_config(single(420.0))),
        (
            "taller",
            create_layout_config(LayoutConfigInput {
                height: 700.0,
                ..single(420.0)
            }),
        ),
        (
            "double",
            create_layout_config(LayoutConfigInput {
                spread: SpreadMode::Double,
                spread_gap: 20.0,
                ..single(900.0)
            }),
        ),
        (
            "larger type",
            create_layout_config(LayoutConfigInput {
                root_font_size: 20.0,
                ..single(400.0)
            }),
        ),
        (
            "forced family and line height",
            create_layout_config(LayoutConfigInput {
                font_family_override: Some("serif".to_owned()),
                font_family_force: Some(true),
                line_height_override: Some(1.8),
                line_height_force: Some(true),
                ..single(400.0)
            }),
        ),
        ("400 again", create_layout_config(single(400.0))),
    ]
}

/// Where each chapter is laid out from: the Latin chapter from its start
/// and from the reading anchor of its third page in the whole book (a
/// source point, resolved through the chapter's text runs), the Chinese
/// chapter from such an anchor, the viewport chapter from its start.
fn locators(publication: &[u8], config: &LayoutConfig) -> Vec<Vec<RuntimeSourceLocator>> {
    let mut document = open(publication);
    let book = document.create_revision(config).expect("the book lays out");
    let mut anchor_in = |href: &str| {
        let RuntimeSourceLocatorResolution::Resolved { page_index, .. } = document
            .resolve_source_locator(&book.revision_id, locator(href))
            .expect("the chapter start resolves")
        else {
            panic!("{href} has no page in the book");
        };
        let page = (page_index + 2).min(book.page_count - 1);
        match document
            .get_page_reading_anchor(&book.revision_id, page)
            .expect("the page has an anchor")
        {
            RuntimePageReadingAnchor::Resolved { locator, .. } => {
                assert!(locator.source_point.is_some(), "{href}: {locator:?}");
                locator
            }
            other => panic!("{href} page {page} has no anchor: {other:?}"),
        }
    };
    let latin = anchor_in(CHAPTERS[0]);
    let cjk = anchor_in(CHAPTERS[1]);
    vec![
        vec![locator(CHAPTERS[0]), latin],
        vec![cjk],
        vec![locator(CHAPTERS[2])],
    ]
}

fn chapter_snapshot(
    document: &mut RuntimeDocument,
    config: &LayoutConfig,
    chapter: usize,
    locator: &RuntimeSourceLocator,
    paint: bool,
) -> String {
    let created = document
        .create_chapter_local_revision(RuntimeChapterLocalRevisionRequest {
            layout_config: config.clone(),
            target_chapter_index: chapter,
            target_locator: locator.clone(),
        })
        .expect("the chapter lays out");
    let revision = &created.revision;
    let mut snapshot = format!(
        "{} pages, {} spreads, target {}\n",
        revision.local_page_count,
        revision.local_spread_count,
        match &created.target {
            RuntimeChapterLocalSourceLocatorResolution::Resolved {
                local_page_index,
                local_spread_index,
                matched_by,
                ..
            } => format!("page {local_page_index} spread {local_spread_index} {matched_by:?}"),
            RuntimeChapterLocalSourceLocatorResolution::Pending { reason, .. } => {
                format!("pending {reason:?}")
            }
        }
    );
    for spread in (0..revision.local_spread_count).filter(|_| paint) {
        let frame = document
            .frame_commands_for_tests(&revision.revision_id, spread)
            .expect("the spread paints");
        let _ = writeln!(
            snapshot,
            "{spread} {:?} {:?}",
            frame.page_indexes, frame.commands
        );
    }
    document
        .release_chapter_local_revision(&RuntimeChapterLocalRevisionHandle {
            revision_id: revision.revision_id.clone(),
            revision_version: revision.revision_version,
            coordinate: revision.coordinate.clone(),
        })
        .expect("the chapter releases");
    snapshot
}

fn book_snapshot(
    document: &mut RuntimeDocument,
    config: &LayoutConfig,
    locators: &[Vec<RuntimeSourceLocator>],
) -> String {
    let summary = document.create_revision(config).expect("the book lays out");
    let id = &summary.revision_id;
    let mut snapshot = format!(
        "{} pages, {} spreads\n",
        summary.page_count, summary.spread_count
    );
    for locator in locators.iter().flatten() {
        let resolved = match document
            .resolve_source_locator(id, locator.clone())
            .expect("the locator resolves")
        {
            RuntimeSourceLocatorResolution::Resolved {
                page_index,
                spread_index,
                matched_by,
                ..
            } => format!("page {page_index} spread {spread_index} {matched_by:?}"),
            other => format!("{other:?}"),
        };
        let _ = writeln!(snapshot, "{locator:?} -> {resolved}");
    }
    for spread in 0..summary.spread_count {
        let frame = document
            .frame_commands_for_tests(id, spread)
            .expect("the spread paints");
        let _ = writeln!(
            snapshot,
            "{spread} {:?} {:?}",
            frame.page_indexes, frame.commands
        );
    }
    let anchors = (0..summary.page_count)
        .map(|page| anchor(document, id, page))
        .collect::<Vec<_>>();
    let _ = writeln!(snapshot, "anchors {anchors:?}");
    assert!(document.release_revision(id), "the book releases");
    snapshot
}

fn anchor(document: &mut RuntimeDocument, revision_id: &str, page: usize) -> String {
    match document.get_page_reading_anchor(revision_id, page) {
        Ok(RuntimePageReadingAnchor::Resolved { locator, .. }) => format!("{locator:?}"),
        Ok(other) => format!("{other:?}"),
        Err(error) => format!("error {}", error.message()),
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

fn open(publication: &[u8]) -> RuntimeDocument {
    RuntimeDocument::open_with_pinned_font_policy(publication, policy().clone())
        .expect("the fixture opens")
}

/// Tinos and Source Han Serif, hashed once for every document the test opens.
fn policy() -> &'static RuntimePinnedFontPolicyInput {
    static POLICY: std::sync::OnceLock<RuntimePinnedFontPolicyInput> = std::sync::OnceLock::new();
    POLICY.get_or_init(|| {
        let font = |file: &str| {
            std::fs::read(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../../apps/reader/src/assets/fonts")
                    .join(file),
            )
            .expect("the pinned face reads")
        };
        let face = |bytes: Vec<u8>, language: &str| RuntimePinnedFontFaceInput {
            expected_sha256: {
                use sha2::{Digest, Sha256};
                format!("{:x}", Sha256::digest(&bytes))
            },
            bytes,
            generic_role: RuntimePinnedFontGenericRole::Serif,
            language: Some(RuntimePinnedFontLanguageTag::parse(language).expect("language parses")),
        };
        RuntimePinnedFontPolicyInput {
            faces: vec![
                face(font("Tinos-Regular.ttf"), "und"),
                face(font("SourceHanSerifCN-Regular.otf"), "zh-Hans"),
            ],
        }
    })
}

#[test]
fn a_chapter_is_styled_once_for_every_layout_its_styles_hold_under() {
    let publication = relayout_fixture_epub();
    let config = |name: &str| {
        steps()
            .into_iter()
            .find(|(step, _)| *step == name)
            .map(|(_, config)| config)
            .expect("the step exists")
    };
    let mut document = open(&publication);
    let mut styled = |config: &LayoutConfig, chapter: usize| {
        let created = document
            .create_chapter_local_revision(RuntimeChapterLocalRevisionRequest {
                layout_config: config.clone(),
                target_chapter_index: chapter,
                target_locator: locator(CHAPTERS[chapter]),
            })
            .expect("the chapter lays out");
        let revision = &created.revision;
        let tables = document
            .chapter_local_revisions
            .get(&revision.revision_id)
            .and_then(|kept| {
                kept.chapter_style_tables
                    .get(CHAPTERS[chapter].trim_end_matches(".xhtml"))
            })
            .cloned()
            .expect("the revision keeps its chapter's tables");
        document
            .release_chapter_local_revision(&RuntimeChapterLocalRevisionHandle {
                revision_id: revision.revision_id.clone(),
                revision_version: revision.revision_version,
                coordinate: revision.coordinate.clone(),
            })
            .expect("the chapter releases");
        tables
    };

    // Content boxes 372 and 352 px wide: every media query answers alike.
    let latin_420 = styled(&config("420"), 0);
    let latin_400 = styled(&config("400"), 0);
    assert!(Rc::ptr_eq(&latin_420, &latin_400), "narrower, same styles");
    // 332 px: `(min-width: 340px)` stops matching.
    let latin_380 = styled(&config("380"), 0);
    assert!(!Rc::ptr_eq(&latin_400, &latin_380), "a media query flipped");
    // Larger type is another cascade.
    let latin_larger = styled(&config("larger type"), 0);
    assert!(!Rc::ptr_eq(&latin_380, &latin_larger), "larger type");
    // A length in viewport units reads the width itself.
    let viewport_420 = styled(&config("420"), 2);
    let viewport_400 = styled(&config("400"), 2);
    assert!(!Rc::ptr_eq(&viewport_420, &viewport_400), "vw");

    // The whole book takes the tables the chapter already has.
    let latin_again = styled(&config("400"), 0);
    let book = document
        .create_revision(&config("400"))
        .expect("the book lays out");
    let book_latin = document
        .revisions
        .get(&book.revision_id)
        .and_then(|kept| kept.chapter_style_tables.get("latin"))
        .cloned()
        .expect("the book keeps the chapter's tables");
    assert!(
        Rc::ptr_eq(&latin_again, &book_latin),
        "book and chapter share"
    );
}

#[test]
fn a_chapter_is_bridged_once_for_every_layout_its_tree_holds_under() {
    let publication = relayout_fixture_epub();
    let config = |name: &str| {
        steps()
            .into_iter()
            .find(|(step, _)| *step == name)
            .map(|(_, config)| config)
            .expect("the step exists")
    };
    let mut document = open(&publication);
    let mut tree = |config: &LayoutConfig| {
        let created = document
            .create_chapter_local_revision(RuntimeChapterLocalRevisionRequest {
                layout_config: config.clone(),
                target_chapter_index: 0,
                target_locator: locator(CHAPTERS[0]),
            })
            .expect("the chapter lays out");
        let revision = &created.revision;
        let tree = document
            .chapter_local_revisions
            .get(&revision.revision_id)
            .and_then(|kept| kept.fragment_layout.materialized_tree(0))
            .expect("the chapter's pages are kept");
        document
            .release_chapter_local_revision(&RuntimeChapterLocalRevisionHandle {
                revision_id: revision.revision_id.clone(),
                revision_version: revision.revision_version,
                coordinate: revision.coordinate.clone(),
            })
            .expect("the chapter releases");
        tree
    };

    // Same styles at 420 and 400: the tree reads nothing of the page size.
    let at_420 = tree(&config("420"));
    let at_400 = tree(&config("400"));
    assert!(Rc::ptr_eq(&at_420, &at_400), "narrower, same tree");
    // A taller page with the same styles: still the same tree.
    assert!(
        Rc::ptr_eq(&at_420, &tree(&config("taller"))),
        "taller, same tree"
    );
    // Larger type restyles the chapter, and its tree is bridged again.
    assert!(
        !Rc::ptr_eq(&at_400, &tree(&config("larger type"))),
        "larger type"
    );
}

#[test]
fn a_chapter_builds_the_query_artifacts_of_the_pages_read_only() {
    let publication = relayout_fixture_epub();
    let config = &steps()[0].1;
    let mut document = open(&publication);
    let created = document
        .create_chapter_local_revision(RuntimeChapterLocalRevisionRequest {
            layout_config: config.clone(),
            target_chapter_index: 0,
            target_locator: locator(CHAPTERS[0]),
        })
        .expect("the chapter lays out");
    let revision_id = created.revision.revision_id.clone();
    let built = |document: &RuntimeDocument| {
        document
            .chapter_local_revisions
            .get(&revision_id)
            .and_then(|kept| kept.fragment_layout.built_artifacts(0))
            .expect("the chapter's pages are kept")
    };
    assert!(
        created.revision.local_page_count > 2,
        "the chapter spans pages"
    );
    // Laid out and its target found: no page was read.
    assert_eq!(built(&document), 0);
    document
        .frame_commands_for_tests(&revision_id, 1)
        .expect("the spread paints");
    assert!(
        built(&document) <= 2,
        "only the spread's pages, got {}",
        built(&document)
    );
}

#[test]
fn a_chapter_takes_its_search_records_when_first_searched() {
    let publication = relayout_fixture_epub();
    let config = &steps()[0].1;
    let mut document = open(&publication);
    let created = document
        .create_chapter_local_revision(RuntimeChapterLocalRevisionRequest {
            layout_config: config.clone(),
            target_chapter_index: 0,
            target_locator: locator(CHAPTERS[0]),
        })
        .expect("the chapter lays out");
    let book = document.create_revision(config).expect("the book lays out");
    let request = || crate::runtime::RuntimeSearchRequest {
        query: "Paragraph 12.".to_owned(),
        case_sensitive: true,
        whole_word: false,
        limit: Some(10),
    };
    let chapter_revision = document
        .chapter_local_revisions
        .get(&created.revision.revision_id)
        .expect("the chapter is kept");
    let in_chapter = crate::runtime::search::search_revision(
        &document.document,
        &created.revision.revision_id,
        chapter_revision,
        request(),
    );
    let in_book = super::revisions::search(&document, &book.revision_id, request());
    let RuntimeSourceLocatorResolution::Resolved {
        page_index: chapter_start,
        ..
    } = document
        .resolve_source_locator(&book.revision_id, locator(CHAPTERS[0]))
        .expect("the chapter resolves")
    else {
        panic!("the chapter has no page in the book");
    };
    let pages = |response: &crate::runtime::RuntimeSearchResponse, base: usize| {
        response
            .results
            .iter()
            .map(|result| result.page_index + base)
            .collect::<Vec<_>>()
    };
    assert_eq!(in_chapter.result_count, 1);
    assert_eq!(pages(&in_chapter, chapter_start), pages(&in_book, 0));
}

#[test]
fn every_text_run_resolves_to_the_page_that_shows_it() {
    // What a source point resolves to is read from where each run starts:
    // every run a page shows, its own first mapped character included,
    // must resolve to that page.
    let publication = relayout_fixture_epub();
    let mut document = open(&publication);
    let mut checked = 0;
    let mut unindexed = 0;
    for (_, config) in steps().into_iter().step_by(3) {
        for (chapter, href) in CHAPTERS.iter().enumerate().take(2) {
            let created = document
                .create_chapter_local_revision(RuntimeChapterLocalRevisionRequest {
                    layout_config: config.clone(),
                    target_chapter_index: chapter,
                    target_locator: locator(href),
                })
                .expect("the chapter lays out");
            let revision = &created.revision;
            let handle = RuntimeChapterLocalRevisionHandle {
                revision_id: revision.revision_id.clone(),
                revision_version: revision.revision_version,
                coordinate: revision.coordinate.clone(),
            };
            for page in 0..revision.local_page_count {
                let artifact = document
                    .chapter_local_revisions
                    .get(&revision.revision_id)
                    .and_then(|kept| kept.fragment_layout.page(page))
                    .expect("the page resolves")
                    .artifact_handle();
                let points: Vec<RuntimeSourcePoint> = artifact
                    .interaction_runs()
                    .iter()
                    .filter_map(|run| {
                        let source = run.source.as_ref()?;
                        let (_, source_start, _) = source.segments.first()?;
                        Some(RuntimeSourcePoint {
                            node_path: source.path.clone(),
                            text_offset: *source_start as usize,
                        })
                    })
                    .collect();
                for point in points {
                    let resolved = document.resolve_chapter_local_source_locator(
                        &handle,
                        RuntimeSourceLocator {
                            href: (*href).to_owned(),
                            anchor_id: None,
                            source_point: Some(point.clone()),
                            source_range: None,
                            progression: None,
                        },
                    );
                    // A node the chapter's text index does not hold (an
                    // annotation's) is no locator target at all.
                    let Ok(resolved) = resolved else {
                        unindexed += 1;
                        continue;
                    };
                    let RuntimeChapterLocalSourceLocatorResolution::Resolved {
                        local_page_index,
                        ..
                    } = resolved
                    else {
                        panic!("{point:?} on page {page} did not resolve to a page");
                    };
                    assert_eq!(local_page_index, page, "{point:?} of {href}");
                    checked += 1;
                }
            }
            document
                .release_chapter_local_revision(&handle)
                .expect("the chapter releases");
        }
    }
    assert!(
        checked > 500 && unindexed * 10 < checked,
        "{checked} runs checked, {unindexed} outside the text index"
    );
}
