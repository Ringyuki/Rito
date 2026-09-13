//! A revision's page table: the pages the fragment engine paginated per
//! chapter, each with its sealed fragment tree, its query artifact and its
//! paint commands.
//!
//! Page numbers, chapter ranges, frames and page artifacts all come from
//! this store. A table is built for every chapter or not at all: a chapter
//! that fails to build or paginate fails the revision.

use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

use rito_fragment::CancelFlag;

use crate::fragment_pagination::{paginate_chapter, paint_chapter_page};
use crate::fragment_paint::{FragmentPaintContext, PaintFamilyPolicy};
use crate::layout::LayoutConfig;
use crate::render::{
    contract::{ReaderBackgroundPaint, ReaderColor},
    DisplayCommand,
};

use super::frame::{RuntimeChapterStyleTables, RuntimeRevisionInteractions};
use super::page_artifact::FragmentPageArtifact;
use super::RuntimeDocument;

/// One chapter's fragment pagination, in spine order within the layout.
#[derive(Debug)]
pub(super) struct FragmentBackendChapter {
    pub(super) idref: String,
    /// Everything a page needs to paint on demand: the bridged tree the
    /// pages were laid out from and the paint policy of the build.
    pub(super) paint: ChapterPaintSource,
    /// Top-level formatting blocks the chapter paginated from; chapter
    /// ranges report it as the chapter's block count.
    pub(super) block_count: usize,
    /// The chapter body's background color, painted as this chapter's
    /// page wash.
    pub(super) page_background: Option<ReaderColor>,
    /// The body's background image painted across the full page.
    pub(super) page_background_image: Option<ReaderBackgroundPaint>,
    pub(super) pages: Vec<FragmentBackendPage>,
}

/// One page: its query artifact and the commands that paint its content
/// (in page coordinates, at the page's content origin).
#[derive(Debug)]
pub(super) struct FragmentBackendPage {
    pub(super) artifact: FragmentPageArtifact,
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
    pub(super) fn commands_for(
        &self,
        ratio: f64,
        paint: &ChapterPaintSource,
    ) -> crate::epub::EpubResult<Arc<Vec<DisplayCommand>>> {
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
pub(super) struct ChapterPaintSource {
    built: crate::fragment_bridge::ChapterFormattingTree,
    family_policy: PaintFamilyPolicy,
    vertical: bool,
    content_width: f64,
    origin: (f64, f64),
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
}

impl FragmentBuiltLayout {
    /// A page table with no pages.
    #[cfg(test)]
    pub(super) fn empty() -> Self {
        Self::new(Vec::new())
    }

    pub(super) fn new(chapters: Vec<FragmentBackendChapter>) -> Self {
        let mut chapter_starts = Vec::with_capacity(chapters.len());
        let mut chapter_start_pages = BTreeSet::new();
        let mut page_count = 0;
        for chapter in &chapters {
            chapter_starts.push(page_count);
            chapter_start_pages.insert(page_count);
            page_count += chapter.pages.len();
        }
        Self {
            chapters,
            chapter_starts,
            page_count,
            chapter_start_pages,
            anchors: BTreeMap::new(),
        }
    }

    pub(super) fn page_count(&self) -> usize {
        self.page_count
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

    pub(super) fn page(&self, page_index: usize) -> Option<&FragmentBackendPage> {
        self.page_with_chapter(page_index).map(|(page, _)| page)
    }

    pub(super) fn page_with_chapter(
        &self,
        page_index: usize,
    ) -> Option<(&FragmentBackendPage, &FragmentBackendChapter)> {
        let position = self
            .chapter_starts
            .partition_point(|start| *start <= page_index);
        let chapter = self.chapters.get(position.checked_sub(1)?)?;
        chapter
            .pages
            .get(page_index - self.chapter_starts[position - 1])
            .map(|page| (page, chapter))
    }
}

/// One chapter paginated for a chapter-local revision, with the style
/// tables and interaction state the revision retains beside its pages.
pub(super) struct ChapterLocalFragmentBuild {
    pub(super) layout: FragmentBuiltLayout,
    pub(super) idref: String,
    pub(super) style_tables: RuntimeChapterStyleTables,
    pub(super) interactions: RuntimeRevisionInteractions,
}

impl RuntimeDocument {
    /// Paginates every chapter of the prepared publication under
    /// `layout_config`, laying each out from its typed style tables.
    /// Page indexes are book-wide. Any chapter that fails to build or
    /// paginate fails the whole table, so a revision never holds a
    /// partial one.
    pub(super) fn build_fragment_page_table(
        &self,
        layout_config: &LayoutConfig,
        chapter_style_tables: &BTreeMap<String, RuntimeChapterStyleTables>,
    ) -> Result<FragmentBuiltLayout, String> {
        let prepared = self
            .prepared
            .as_ref()
            .ok_or_else(|| "document is not prepared".to_owned())?;
        let mut chapters = Vec::with_capacity(prepared.chapters.len());
        let mut anchors = BTreeMap::new();
        let mut page_index = 0;
        for chapter in &prepared.chapters {
            let idref = chapter.source.idref.as_str();
            let built = self
                .prepared_chapter_formatting_tree(chapter_style_tables, idref, true)
                .map_err(|error| format!("chapter {idref}: {}", error.message()))?;
            let chapter =
                self.paginate_built_chapter(built, layout_config, idref, page_index, &mut anchors)?;
            page_index += chapter.pages.len();
            chapters.push(chapter);
        }
        let mut layout = FragmentBuiltLayout::new(chapters);
        layout.anchors = anchors;
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
        let style_tables = RuntimeChapterStyleTables {
            layout: chapter.layout_style_table,
            inline: chapter.inline_style_table,
        };
        let built = self
            .formatting_tree_from_prepared(&prepared, &style_tables, &idref, true)
            .map_err(|error| format!("chapter {idref}: {}", error.message()))?;
        let mut anchors = BTreeMap::new();
        let backend_chapter =
            self.paginate_built_chapter(built, config, &idref, 0, &mut anchors)?;
        let mut layout = FragmentBuiltLayout::new(vec![backend_chapter]);
        layout.anchors = anchors;
        Ok(ChapterLocalFragmentBuild {
            layout,
            idref,
            style_tables,
            interactions,
        })
    }

    /// The pagination half of a chapter build: lays a bridged formatting
    /// tree out into backend pages under the given layout config, with
    /// `page_index_base` as the first page's index and this chapter's
    /// anchors merged into `anchors`.
    fn paginate_built_chapter(
        &self,
        mut built: crate::fragment_bridge::ChapterFormattingTree,
        config: &LayoutConfig,
        idref: &str,
        page_index_base: usize,
        anchors: &mut BTreeMap<String, usize>,
    ) -> Result<FragmentBackendChapter, String> {
        let family_policy = self
            .fragment_paint_family_policy()
            .ok_or_else(|| "pinned-alias collision or no fragment engine".to_owned())?;
        let engine = self
            .fragment_engine()
            .ok_or_else(|| "no fragment engine (no pinned faces)".to_owned())?;
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
        let page_width = config.page_width;
        let page_height = config.page_height;
        let margin_left = config.margin_left;
        let margin_top = config.margin_top;
        let pages = paginate_chapter(
            &engine.engine,
            &built.tree,
            content_width,
            content_height,
            &CancelFlag::new(),
        )
        .map_err(|error| format!("chapter {idref} pagination: {}", error.message()))?;
        let block_count = built.tree.node(built.tree.root()).children.len();
        let mut backend_pages = Vec::with_capacity(pages.len());
        for (offset, page) in pages.into_iter().enumerate() {
            let page_index = page_index_base + offset;
            collect_page_anchors(&page.root, &built.node_anchors, page_index, anchors);
            backend_pages.push(FragmentBackendPage {
                // Artifact geometry is in spread-content space: every
                // consumer — the selection mapper, tap targets, search
                // bounds — translates it to the viewport, so page margins
                // must not be baked in here.
                artifact: FragmentPageArtifact::build(
                    page_index,
                    page_width,
                    page_height,
                    &page.root,
                    &built,
                    0.0,
                    0.0,
                ),
                root: page.root,
                paint_cache: RefCell::new(Vec::new()),
            });
        }
        let vertical = crate::fragment_pagination::chapter_is_vertical(&built.tree);
        Ok(FragmentBackendChapter {
            idref: idref.to_owned(),
            block_count,
            page_background: built.page_background,
            page_background_image: built.page_background_image.clone(),
            pages: backend_pages,
            paint: ChapterPaintSource {
                built,
                family_policy,
                vertical,
                content_width,
                origin: (margin_left, margin_top),
            },
        })
    }
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
            block_count: 1,
            page_background: None,
            page_background_image: None,
            pages: (0..page_count)
                .map(|_| FragmentBackendPage {
                    artifact: FragmentPageArtifact::empty_for_tests(0, 100.0, 200.0),
                    root: rito_fragment::Fragment::Box(rito_fragment::BoxFragment {
                        source: rito_fragment::FormattingNodeId(0),
                        rect: rito_fragment::FragmentRect {
                            x: 0.0,
                            y: 0.0,
                            width: 100.0,
                            height: 200.0,
                        },
                        children: Vec::new(),
                    }),
                    paint_cache: RefCell::new(Vec::new()),
                })
                .collect(),
            paint: ChapterPaintSource {
                built: crate::fragment_bridge::tests_chapter_tree("stub"),
                family_policy: PaintFamilyPolicy::default(),
                vertical: false,
                content_width: 100.0,
                origin: (0.0, 0.0),
            },
        }
    }

    #[test]
    fn page_lookup_spans_chapter_boundaries() {
        let layout =
            FragmentBuiltLayout::new(vec![chapter("a", 2), chapter("b", 0), chapter("c", 3)]);

        assert_eq!(layout.page_count(), 5);
        assert!(layout.page(1).is_some());
        assert!(layout.page(2).is_some(), "page 2 opens the third chapter");
        assert!(layout.page(4).is_some());
        assert!(layout.page(5).is_none());
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
        assert_eq!(found.pages.len(), 3);
        assert_eq!(start, 2);
    }
}
