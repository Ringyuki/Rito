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
    RuntimeSourceLocator, RuntimeSourceLocatorResolution,
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

/// The page content box goes 372 → 352 → 332 → 312 px wide and back:
/// the fixture's `@media (min-width: 340px)` flips on the way down and
/// back up. Then double pages, larger type and a forced family.
fn steps() -> Vec<(&'static str, LayoutConfig)> {
    let single = |width: f64| LayoutConfigInput {
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
    };
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
