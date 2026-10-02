//! A revision's page table: how many pages each chapter paginated to,
//! where every chapter and anchor sits in the book, and the inputs each
//! chapter's pages are rebuilt from.
//!
//! The table itself holds no page contents. Page numbers, chapter ranges,
//! anchor targets and each page's searchable text are recorded once when
//! the book paginates; the fragment trees, query artifacts and paint
//! commands behind a page are rebuilt from the recorded inputs when a
//! page is read, and a bounded set of the most recently read chapters
//! stays materialized. A table is built for every chapter or not at all:
//! a chapter that fails to build or paginate fails the revision.

use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
    sync::Arc,
};

use rito_fragment::CancelFlag;

use crate::epub::{EpubError, EpubResult};
use crate::fragment_pagination::{paginate_chapter, paint_chapter_page};
use crate::fragment_paint::{FragmentPaintContext, PaintFamilyPolicy};
use crate::layout::LayoutConfig;
use crate::render::{
    contract::{ReaderBackgroundPaint, ReaderColor},
    DisplayCommand,
};

use super::chapter_tree_report::chapter_formatting_tree;
use super::fragment_frame::RuntimeFragmentEngine;
use super::frame::{RuntimeChapterStyleTables, RuntimeRevisionInteractions};
use super::page_artifact::FragmentPageArtifact;
use super::search::{SearchPageText, SearchPrebuiltRun, SearchPrebuiltRunSource};
use super::RuntimeDocument;

/// How many pages the table keeps materialized across all chapters. A
/// materialized page holds its fragment tree and query artifact, and its
/// chapter holds the bridged formatting tree they were laid out from;
/// evicting them trades memory for one bridge and one pagination pass
/// over that chapter the next time one of its pages is read. 128 pages
/// covers the spread a host is showing plus the ones it reads around it.
const MATERIALIZED_PAGE_BUDGET: usize = 128;

/// Chapters the budget never evicts below. A spread shows up to two
/// pages and they can come from two different chapters; if the budget
/// could drop to one, a spread straddling a chapter boundary would evict
/// one of its own chapters and rebuild both on every frame.
const MATERIALIZED_CHAPTER_FLOOR: usize = 2;

/// A page table always filters footnote asides out of the content flow:
/// the reader's pages are the reader-semantic flow, and an aside left in
/// it would paginate differently from the pages the reader shows.
const FILTER_FOOTNOTES: bool = true;

/// One chapter's place in the book, in spine order within the layout.
/// This is what the table retains for every chapter: page numbers,
/// chapter ranges and the page wash come from here without rebuilding
/// anything.
#[derive(Debug)]
pub(super) struct FragmentBackendChapter {
    pub(super) idref: String,
    /// Pages this chapter paginated to when the book was built. A rebuild
    /// that does not reproduce this count is reported as an error.
    pub(super) page_count: usize,
    /// Top-level formatting blocks the chapter paginated from; chapter
    /// ranges report it as the chapter's block count.
    pub(super) block_count: usize,
    /// The chapter body's background color, painted as this chapter's
    /// page wash.
    pub(super) page_background: Option<ReaderColor>,
    /// The body's background image painted across the full page.
    pub(super) page_background_image: Option<ReaderBackgroundPaint>,
    /// The chapter's own half of its rebuild inputs.
    style_tables: Rc<RuntimeChapterStyleTables>,
    /// Intrinsic image sizes as the first build saw them. Recorded rather
    /// than re-read so a rebuild bridges the same boxes even if the
    /// document decoded more images since.
    image_dimensions: BTreeMap<String, (u32, u32)>,
}

/// The rebuild inputs every chapter of one table shares: the prepared
/// document its chapters are bridged from, the engine that laid them out
/// and the layout they were paginated under. A rebuild reads nothing
/// else, so it cannot pick up state a later chapter left behind.
struct FragmentTableBuildInputs {
    prepared: Rc<crate::epub::PreparedLoadedDocument>,
    engine: Rc<RuntimeFragmentEngine>,
    family_policy: PaintFamilyPolicy,
    config: LayoutConfig,
}

impl std::fmt::Debug for FragmentTableBuildInputs {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The prepared document is the whole publication's parse; naming
        // it keeps a revision's `Debug` readable.
        formatter
            .debug_struct("FragmentTableBuildInputs")
            .field("chapters", &self.prepared.chapters.len())
            .finish_non_exhaustive()
    }
}

/// One chapter's pages, rebuilt on demand: the paint inputs its pages
/// share and the pages themselves.
#[derive(Debug)]
pub(super) struct MaterializedChapter {
    paint: ChapterPaintSource,
    pages: Vec<FragmentBackendPage>,
}

/// One page of a materialized chapter. Holding it keeps that chapter
/// materialized, so a caller can read a page's geometry and paint it
/// without the chapter being evicted underneath.
#[derive(Debug, Clone)]
pub(super) struct FragmentPageRef {
    chapter: Rc<MaterializedChapter>,
    page: usize,
}

impl FragmentPageRef {
    pub(super) fn artifact(&self) -> &FragmentPageArtifact {
        &self.chapter.pages[self.page].artifact
    }

    /// The page's query artifact as a standalone handle: it carries the
    /// page text, run table and geometry, and outlives its chapter's
    /// eviction.
    pub(super) fn artifact_handle(&self) -> Rc<FragmentPageArtifact> {
        Rc::clone(&self.chapter.pages[self.page].artifact)
    }

    /// The page's paint commands at `ratio` device pixels per CSS pixel.
    pub(super) fn commands_for(&self, ratio: f64) -> EpubResult<Arc<Vec<DisplayCommand>>> {
        self.chapter.pages[self.page].commands_for(ratio, &self.chapter.paint)
    }
}

/// One page: its query artifact and the commands that paint its content
/// (in page coordinates, at the page's content origin).
#[derive(Debug)]
struct FragmentBackendPage {
    artifact: Rc<FragmentPageArtifact>,
    /// The page's sealed fragment tree, in content-box coordinates.
    root: rito_fragment::Fragment,
    /// Paint commands per device ratio (as f64 bits). A reader draws at
    /// one ratio at a time and a zoom or density change is rare, so the
    /// cache keeps the two most recent.
    paint_cache: RefCell<Vec<(u64, Arc<Vec<DisplayCommand>>)>>,
}

impl FragmentBackendPage {
    /// The page's paint commands at `ratio` device pixels per CSS pixel,
    /// painted on first use and cached: pagination geometry is identical
    /// at every ratio, only the glyph baselines' device rounding moves.
    /// The cache dies with its chapter, so it needs no bound of its own.
    fn commands_for(
        &self,
        ratio: f64,
        paint: &ChapterPaintSource,
    ) -> EpubResult<Arc<Vec<DisplayCommand>>> {
        let key = ratio.to_bits();
        if let Some((_, commands)) = self
            .paint_cache
            .borrow()
            .iter()
            .find(|(cached, _)| *cached == key)
        {
            return Ok(Arc::clone(commands));
        }
        let commands = Arc::new(paint_chapter_page(
            &paint.built.tree,
            &self.root,
            paint.content_width,
            paint.origin.0,
            paint.origin.1,
            FragmentPaintContext {
                family_policy: Some(&paint.family_policy),
                node_paints: Some(&paint.built.node_paints),
                image_border_paints: Some(&paint.built.image_border_paints),
                list_markers: Some(&paint.built.list_markers),
                ruby_annotation_runs: Some(&paint.built.ruby_annotation_runs),
                vertical_frame: None,
                flow_item_sources: Some(&paint.built.flow_item_sources),
                ratio,
            },
            paint.vertical,
        )?);
        let mut cache = self.paint_cache.borrow_mut();
        if cache.len() >= 2 {
            cache.remove(0);
        }
        cache.push((key, Arc::clone(&commands)));
        Ok(commands)
    }
}

/// The paint inputs a chapter's pages share: the bridged formatting tree
/// (styles, node paints, item provenance) and the build's family policy,
/// content width, page origin and writing mode.
#[derive(Debug)]
struct ChapterPaintSource {
    built: crate::fragment_bridge::ChapterFormattingTree,
    family_policy: PaintFamilyPolicy,
    vertical: bool,
    content_width: f64,
    origin: (f64, f64),
}

/// The chapters kept materialized, least recently used first.
#[derive(Debug, Default)]
struct MaterializedChapters {
    entries: Vec<(usize, Rc<MaterializedChapter>)>,
    pages: usize,
}

impl MaterializedChapters {
    /// The chapter if it is materialized, promoted to most recently used.
    fn hit(&mut self, chapter_index: usize) -> Option<Rc<MaterializedChapter>> {
        let position = self
            .entries
            .iter()
            .position(|(index, _)| *index == chapter_index)?;
        let entry = self.entries.remove(position);
        let chapter = Rc::clone(&entry.1);
        self.entries.push(entry);
        Some(chapter)
    }

    /// Adds a freshly built chapter and evicts the least recently used
    /// ones until the page budget holds, never below the chapter floor:
    /// the chapters a spread is reading stay even when they alone are
    /// over budget, because evicting one of them would rebuild it on the
    /// next frame.
    fn insert(&mut self, chapter_index: usize, chapter: Rc<MaterializedChapter>) {
        self.pages += chapter.pages.len();
        self.entries.push((chapter_index, chapter));
        while self.pages > MATERIALIZED_PAGE_BUDGET
            && self.entries.len() > MATERIALIZED_CHAPTER_FLOOR
        {
            let (_, evicted) = self.entries.remove(0);
            self.pages -= evicted.pages.len();
        }
    }
}

/// A whole-book page table owned by the fragment engine.
#[derive(Debug)]
pub(super) struct FragmentBuiltLayout {
    chapters: Vec<FragmentBackendChapter>,
    /// Global page index each chapter starts on; parallel to `chapters`.
    chapter_starts: Vec<usize>,
    page_count: usize,
    chapter_start_pages: BTreeSet<usize>,
    /// Anchor id → global page index, for jump navigation. Populated by
    /// the revision builder from the chapters' source nodes.
    pub(super) anchors: BTreeMap<String, usize>,
    /// One search record per page, in page order: the page text and its
    /// run offsets, taken while the build pass had the chapter in hand.
    /// A query reads this slice and materializes no chapter.
    search_index: Vec<SearchPageText>,
    /// What the chapters are rebuilt from; absent only for a table with
    /// no chapters.
    build: Option<FragmentTableBuildInputs>,
    materialized: RefCell<MaterializedChapters>,
}

impl FragmentBuiltLayout {
    /// A page table with no pages.
    #[cfg(test)]
    pub(super) fn empty() -> Self {
        Self::new(Vec::new(), None)
    }

    fn new(chapters: Vec<FragmentBackendChapter>, build: Option<FragmentTableBuildInputs>) -> Self {
        let mut chapter_starts = Vec::with_capacity(chapters.len());
        let mut chapter_start_pages = BTreeSet::new();
        let mut page_count = 0;
        for chapter in &chapters {
            chapter_starts.push(page_count);
            chapter_start_pages.insert(page_count);
            page_count += chapter.page_count;
        }
        Self {
            chapters,
            chapter_starts,
            page_count,
            chapter_start_pages,
            anchors: BTreeMap::new(),
            search_index: Vec::new(),
            build,
            materialized: RefCell::new(MaterializedChapters::default()),
        }
    }

    pub(super) fn page_count(&self) -> usize {
        self.page_count
    }

    /// Every page's searchable text and run offsets, in page order.
    pub(super) fn search_page_index(&self) -> &[SearchPageText] {
        &self.search_index
    }

    pub(super) fn chapter_start_pages(&self) -> &BTreeSet<usize> {
        &self.chapter_start_pages
    }

    pub(super) fn chapters(&self) -> impl Iterator<Item = (&FragmentBackendChapter, usize)> {
        self.chapters
            .iter()
            .zip(self.chapter_starts.iter().copied())
    }

    pub(super) fn chapter(&self, idref: &str) -> Option<(&FragmentBackendChapter, usize)> {
        self.chapters().find(|(chapter, _)| chapter.idref == idref)
    }

    /// The page, materializing its chapter if it is not already. `None`
    /// for a page index outside the table or a chapter that no longer
    /// rebuilds; `page_with_chapter` reports the rebuild's reason.
    pub(super) fn page(&self, page_index: usize) -> Option<FragmentPageRef> {
        self.page_with_chapter(page_index)
            .ok()
            .flatten()
            .map(|(page, _)| page)
    }

    /// The page and the record of the chapter it belongs to. `Ok(None)`
    /// for a page index outside the table; an error when the chapter's
    /// pages could not be rebuilt.
    pub(super) fn page_with_chapter(
        &self,
        page_index: usize,
    ) -> EpubResult<Option<(FragmentPageRef, &FragmentBackendChapter)>> {
        let Some((chapter_index, page_in_chapter)) = self.locate(page_index) else {
            return Ok(None);
        };
        let materialized = self.materialize(chapter_index)?;
        Ok(Some((
            FragmentPageRef {
                chapter: materialized,
                page: page_in_chapter,
            },
            &self.chapters[chapter_index],
        )))
    }

    /// The chapter a global page index falls in, and the page's offset
    /// within it.
    fn locate(&self, page_index: usize) -> Option<(usize, usize)> {
        let position = self
            .chapter_starts
            .partition_point(|start| *start <= page_index);
        let chapter_index = position.checked_sub(1)?;
        let page_in_chapter = page_index - self.chapter_starts[chapter_index];
        (page_in_chapter < self.chapters.get(chapter_index)?.page_count)
            .then_some((chapter_index, page_in_chapter))
    }

    /// The chapters currently materialized, least recently used first.
    #[cfg(test)]
    pub(super) fn materialized_chapter_indexes(&self) -> Vec<usize> {
        self.materialized
            .borrow()
            .entries
            .iter()
            .map(|(index, _)| *index)
            .collect()
    }

    fn materialize(&self, chapter_index: usize) -> EpubResult<Rc<MaterializedChapter>> {
        if let Some(chapter) = self.materialized.borrow_mut().hit(chapter_index) {
            return Ok(chapter);
        }
        let chapter = Rc::new(self.build_chapter(chapter_index)?);
        self.materialized
            .borrow_mut()
            .insert(chapter_index, Rc::clone(&chapter));
        Ok(chapter)
    }

    /// Rebuilds one chapter's pages from the inputs the table recorded:
    /// bridge the chapter, paginate it, and build every page's artifact.
    fn build_chapter(&self, chapter_index: usize) -> EpubResult<MaterializedChapter> {
        let record = &self.chapters[chapter_index];
        let build = self.build.as_ref().ok_or_else(|| {
            EpubError::new(format!(
                "chapter {} has no build inputs recorded",
                record.idref
            ))
        })?;
        let built = chapter_formatting_tree(
            &build.prepared,
            &record.style_tables,
            &record.idref,
            FILTER_FOOTNOTES,
            &record.image_dimensions,
        )?;
        let paginated = paginate_built_chapter(
            &build.engine,
            build.family_policy.clone(),
            built,
            &build.config,
            &record.idref,
        )
        .map_err(EpubError::new)?;
        if paginated.roots.len() != record.page_count {
            // The page table's numbers would be lies: report it instead of
            // serving a page that is not the page the book paginated.
            return Err(EpubError::new(format!(
                "chapter {} rebuilt to {} pages, the page table recorded {}",
                record.idref,
                paginated.roots.len(),
                record.page_count
            )));
        }
        let page_index_base = self.chapter_starts[chapter_index];
        let pages = paginated
            .roots
            .into_iter()
            .enumerate()
            .map(|(offset, root)| FragmentBackendPage {
                artifact: Rc::new(page_artifact(
                    page_index_base + offset,
                    &root,
                    &paginated.paint,
                    &build.config,
                )),
                root,
                paint_cache: RefCell::new(Vec::new()),
            })
            .collect();
        Ok(MaterializedChapter {
            paint: paginated.paint,
            pages,
        })
    }
}

/// One chapter paginated for a chapter-local revision, with the style
/// tables and interaction state the revision retains beside its pages.
pub(super) struct ChapterLocalFragmentBuild {
    pub(super) layout: FragmentBuiltLayout,
    pub(super) idref: String,
    pub(super) style_tables: Rc<RuntimeChapterStyleTables>,
    pub(super) interactions: RuntimeRevisionInteractions,
}

impl RuntimeDocument {
    /// Paginates every chapter of the prepared publication under
    /// `layout_config`, laying each out from its typed style tables.
    /// Page indexes are book-wide. Any chapter that fails to build or
    /// paginate fails the whole table, so a revision never holds a
    /// partial one.
    ///
    /// Each chapter's pages are dropped as soon as its record, anchors and
    /// search text are taken, so the pass peaks at one chapter's contents
    /// rather than the book's.
    pub(super) fn build_fragment_page_table(
        &self,
        layout_config: &LayoutConfig,
        chapter_style_tables: &BTreeMap<String, Rc<RuntimeChapterStyleTables>>,
    ) -> Result<FragmentBuiltLayout, String> {
        let prepared = self
            .prepared
            .clone()
            .ok_or_else(|| "document is not prepared".to_owned())?;
        let build = self.fragment_table_build_inputs(prepared, layout_config)?;
        let mut chapters = Vec::with_capacity(build.prepared.chapters.len());
        let mut anchors = BTreeMap::new();
        let mut search_index = Vec::new();
        let mut page_index = 0;
        let idrefs: Vec<String> = build
            .prepared
            .chapters
            .iter()
            .map(|chapter| chapter.source.idref.clone())
            .collect();
        for idref in idrefs {
            let style_tables = chapter_style_tables.get(&idref).ok_or_else(|| {
                format!("chapter {idref}: revision retains no style tables for chapter {idref}")
            })?;
            let image_dimensions = self
                .chapter_image_dimensions(&build.prepared, &idref, FILTER_FOOTNOTES)
                .map_err(|error| format!("chapter {idref}: {}", error.message()))?;
            let built = chapter_formatting_tree(
                &build.prepared,
                style_tables,
                &idref,
                FILTER_FOOTNOTES,
                &image_dimensions,
            )
            .map_err(|error| format!("chapter {idref}: {}", error.message()))?;
            let paginated = paginate_built_chapter(
                &build.engine,
                build.family_policy.clone(),
                built,
                layout_config,
                &idref,
            )?;
            for (offset, root) in paginated.roots.iter().enumerate() {
                collect_page_anchors(
                    root,
                    &paginated.paint.built.node_anchors,
                    page_index + offset,
                    &mut anchors,
                );
                search_index.push(search_page_text(
                    page_index + offset,
                    &page_artifact(page_index + offset, root, &paginated.paint, layout_config),
                ));
            }
            page_index += paginated.roots.len();
            chapters.push(FragmentBackendChapter {
                idref,
                page_count: paginated.roots.len(),
                block_count: paginated.block_count,
                page_background: paginated.paint.built.page_background,
                page_background_image: paginated.paint.built.page_background_image.clone(),
                style_tables: Rc::clone(style_tables),
                image_dimensions,
            });
            // The chapter's fragment trees and bridged tree die here; the
            // table rebuilds them for the pages a host actually reads.
            drop(paginated);
        }
        let mut layout = FragmentBuiltLayout::new(chapters, Some(build));
        layout.anchors = anchors;
        layout.search_index = search_index;
        Ok(layout)
    }

    /// Paginates ONE chapter for a chapter-local revision: parse and
    /// style the chapter in a single-chapter prepared window (the
    /// whole-book preparation is untouched), bridge it, and paginate the
    /// entire chapter in one pass. Page indexes are chapter-local
    /// (base 0).
    pub(super) fn build_chapter_local_fragment_layout(
        &mut self,
        config: &LayoutConfig,
        chapter_index: usize,
    ) -> Result<ChapterLocalFragmentBuild, String> {
        self.document
            .ensure_chapter_loaded(chapter_index)
            .map_err(|error| format!("chapter source load: {}", error.message()))?;
        // Image intrinsic dimensions must load before the bridge, exactly
        // like every whole-book build: without them each image lays out as
        // the broken-image placeholder (16×16 icon + inline alt text), the
        // chapter paginates differently from the same chapter in the book
        // table, and the background candidate's painted pages never match
        // the visible ones.
        self.document
            .ensure_chapter_image_dimensions_loaded(chapter_index, 1)
            .map_err(|error| format!("chapter image dimensions: {}", error.message()))?;
        // Footnote filtering must use the WHOLE publication's target
        // index, exactly like the whole-book fragment build: a chapter's
        // aside can be referenced from another chapter, and filtering
        // with a partial prefix leaves it in the flow — the chapter then
        // paginates differently from the same chapter in the book table,
        // and the background candidate's painted pages never match the
        // visible ones.
        self.publication_footnote_index()
            .map_err(|error| format!("publication footnote index: {}", error.message()))?;
        let footnote_targets = self
            .prepare_chapter_footnote_targets(chapter_index)
            .map_err(|error| format!("chapter footnote index: {}", error.message()))?;
        let mut prepared = self
            .prepare_cached_document_window(chapter_index, 1, &footnote_targets)
            .map_err(|error| format!("chapter window preparation: {}", error.message()))?;
        // Chapter interactions (footnote entries and their pending
        // cross-chapter targets) are assembled here: without them,
        // artifact hits carry no footnote keys.
        let mut interactions =
            crate::runtime::revision::runtime_chapter_revision_interactions(&prepared);
        self.record_prepared_chapter_footnotes(std::mem::take(&mut prepared.interaction.footnotes));
        let (resolved_footnotes, pending_footnote_keys, footnote_index_complete) =
            self.chapter_footnote_interactions(chapter_index);
        interactions.footnotes = resolved_footnotes;
        interactions.pending_footnote_keys =
            crate::interaction::FootnoteTargetSet::new(pending_footnote_keys);
        interactions.footnote_index_complete = footnote_index_complete;
        let chapter = crate::epub::prepare_runtime_layout_chapter(&prepared, config)
            .map_err(|error| format!("chapter style resolution: {}", error.message()))?
            .ok_or_else(|| "prepared runtime chapter is unavailable".to_owned())?;
        let idref = chapter.idref;
        let style_tables = Rc::new(RuntimeChapterStyleTables {
            layout: chapter.layout_style_table,
            inline: chapter.inline_style_table,
        });
        let prepared = Rc::new(prepared);
        let build = self.fragment_table_build_inputs(Rc::clone(&prepared), config)?;
        let image_dimensions = self
            .chapter_image_dimensions(&prepared, &idref, FILTER_FOOTNOTES)
            .map_err(|error| format!("chapter {idref}: {}", error.message()))?;
        let built = chapter_formatting_tree(
            &prepared,
            &style_tables,
            &idref,
            FILTER_FOOTNOTES,
            &image_dimensions,
        )
        .map_err(|error| format!("chapter {idref}: {}", error.message()))?;
        let paginated = paginate_built_chapter(
            &build.engine,
            build.family_policy.clone(),
            built,
            config,
            &idref,
        )?;
        let mut anchors = BTreeMap::new();
        let mut search_index = Vec::with_capacity(paginated.roots.len());
        for (offset, root) in paginated.roots.iter().enumerate() {
            collect_page_anchors(
                root,
                &paginated.paint.built.node_anchors,
                offset,
                &mut anchors,
            );
            search_index.push(search_page_text(
                offset,
                &page_artifact(offset, root, &paginated.paint, config),
            ));
        }
        let chapter = FragmentBackendChapter {
            idref: idref.clone(),
            page_count: paginated.roots.len(),
            block_count: paginated.block_count,
            page_background: paginated.paint.built.page_background,
            page_background_image: paginated.paint.built.page_background_image.clone(),
            style_tables: Rc::clone(&style_tables),
            image_dimensions,
        };
        drop(paginated);
        let mut layout = FragmentBuiltLayout::new(vec![chapter], Some(build));
        layout.anchors = anchors;
        layout.search_index = search_index;
        Ok(ChapterLocalFragmentBuild {
            layout,
            idref,
            style_tables,
            interactions,
        })
    }

    /// The rebuild inputs a page table over `prepared` shares.
    fn fragment_table_build_inputs(
        &self,
        prepared: Rc<crate::epub::PreparedLoadedDocument>,
        config: &LayoutConfig,
    ) -> Result<FragmentTableBuildInputs, String> {
        let family_policy = self
            .fragment_paint_family_policy()
            .ok_or_else(|| "pinned-alias collision or no fragment engine".to_owned())?;
        let engine = self
            .fragment_engine_handle()
            .ok_or_else(|| "no fragment engine (no pinned faces)".to_owned())?;
        Ok(FragmentTableBuildInputs {
            prepared,
            engine,
            family_policy,
            config: config.clone(),
        })
    }
}

/// One chapter laid out into pages: the page roots, the paint inputs they
/// share and the block count chapter ranges report.
struct PaginatedChapter {
    roots: Vec<rito_fragment::Fragment>,
    paint: ChapterPaintSource,
    block_count: usize,
}

/// The pagination half of a chapter build: lays a bridged formatting tree
/// out into page roots under the given layout config.
fn paginate_built_chapter(
    engine: &RuntimeFragmentEngine,
    family_policy: PaintFamilyPolicy,
    mut built: crate::fragment_bridge::ChapterFormattingTree,
    config: &LayoutConfig,
    idref: &str,
) -> Result<PaginatedChapter, String> {
    // Outside markers and ruby annotations are painted, never laid
    // out: shape them once here with the same context the chapter
    // lays out with, so their boxes and clusters come from the
    // engine's own advances.
    built
        .measure_painted_runs(engine.engine.inline())
        .map_err(|error| format!("chapter {idref} markers: {}", error.message()))?;
    let content_width = config.page_width - config.margin_left - config.margin_right;
    let content_height = config.page_height - config.margin_top - config.margin_bottom;
    if content_width <= 0.0 || content_height <= 0.0 {
        return Err("page content box is empty".to_owned());
    }
    let pages = paginate_chapter(
        &engine.engine,
        &built.tree,
        content_width,
        content_height,
        &CancelFlag::new(),
    )
    .map_err(|error| format!("chapter {idref} pagination: {}", error.message()))?;
    let block_count = built.tree.node(built.tree.root()).children.len();
    let vertical = crate::fragment_pagination::chapter_is_vertical(&built.tree);
    Ok(PaginatedChapter {
        roots: pages.into_iter().map(|page| page.root).collect(),
        block_count,
        paint: ChapterPaintSource {
            built,
            family_policy,
            vertical,
            content_width,
            origin: (config.margin_left, config.margin_top),
        },
    })
}

/// One page's query artifact. Its geometry is in page-content space:
/// every consumer — the selection mapper, tap targets, search bounds —
/// translates it to the viewport, so page margins must not be baked in
/// here.
fn page_artifact(
    page_index: usize,
    root: &rito_fragment::Fragment,
    paint: &ChapterPaintSource,
    config: &LayoutConfig,
) -> FragmentPageArtifact {
    FragmentPageArtifact::build(
        page_index,
        config.page_width,
        config.page_height,
        root,
        &paint.built,
        0.0,
        0.0,
    )
}

/// One page's search record: its text and the run offsets a query walks.
/// Taken during the build pass while the chapter is in hand, so a query
/// reads the recorded slice instead of rebuilding the book's chapters.
fn search_page_text(page_index: usize, artifact: &FragmentPageArtifact) -> SearchPageText {
    let runs = artifact
        .interaction_runs()
        .iter()
        .map(|run| SearchPrebuiltRun {
            start: run.start,
            end: run.end,
            block_index: run.block_index,
            line_index: run.line_index,
            run_index: run.run_index,
            source: run.source.as_ref().map(|source| SearchPrebuiltRunSource {
                node_path: source.path.clone(),
                segments: source.segments.clone(),
            }),
        })
        .collect();
    SearchPageText::from_parts(page_index, artifact.page_text().to_owned(), runs)
}

/// Records each anchored node's first page. Anchors are block-level ids
/// from the bridge; the first fragment of a split block wins, which is
/// where a jump should land.
fn collect_page_anchors(
    fragment: &rito_fragment::Fragment,
    node_anchors: &BTreeMap<u32, String>,
    page_index: usize,
    out: &mut BTreeMap<String, usize>,
) {
    if let Some(anchor) = node_anchors.get(&fragment.source().0) {
        out.entry(anchor.clone()).or_insert(page_index);
    }
    if let rito_fragment::Fragment::Box(inner) = fragment {
        for child in &inner.children {
            collect_page_anchors(child, node_anchors, page_index, out);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chapter(idref: &str, page_count: usize) -> FragmentBackendChapter {
        FragmentBackendChapter {
            idref: idref.to_owned(),
            page_count,
            block_count: 1,
            page_background: None,
            page_background_image: None,
            style_tables: Rc::new(RuntimeChapterStyleTables {
                layout: rito_style_contract::LayoutStyleTable::new(0),
                inline: rito_style_contract::InlineStyleTable::new(0),
            }),
            image_dimensions: BTreeMap::new(),
        }
    }

    #[test]
    fn page_lookup_spans_chapter_boundaries() {
        let layout = FragmentBuiltLayout::new(
            vec![chapter("a", 2), chapter("b", 0), chapter("c", 3)],
            None,
        );

        assert_eq!(layout.page_count(), 5);
        assert_eq!(layout.locate(1), Some((0, 1)));
        assert_eq!(
            layout.locate(2),
            Some((2, 0)),
            "page 2 opens the third chapter"
        );
        assert_eq!(layout.locate(4), Some((2, 2)));
        assert_eq!(layout.locate(5), None);
        assert_eq!(
            layout
                .chapter_start_pages()
                .iter()
                .copied()
                .collect::<Vec<_>>(),
            // An empty chapter and its successor share a start page.
            vec![0, 2],
        );
        let (found, start) = layout.chapter("c").expect("chapter c exists");
        assert_eq!(found.page_count, 3);
        assert_eq!(start, 2);
    }
}
