//! Retained storage for a revision paginated by the fragment engine.
//!
//! When a revision carries a `FragmentBuiltLayout`, the fragment engine is
//! the pagination authority: page numbers, chapter ranges, frames, and
//! page artifacts all come from this store, and the retained layout on the
//! same revision is inert scaffolding. There is no mixed page table — a
//! book routes here only when every chapter is representable.

use std::collections::{BTreeMap, BTreeSet};

use rito_fragment::CancelFlag;

use crate::fragment_pagination::paginate_chapter;
use crate::fragment_paint::FragmentPaintContext;
use crate::layout::build_spread_slots;
use crate::render::DisplayCommand;

use super::frame::RuntimeRevisionCoordinateSpace;
use super::page_artifact::FragmentPageArtifact;
use super::types::{RuntimeRevisionExtent, RuntimeRevisionStatus};
use super::RuntimeDocument;

/// One chapter's fragment pagination, in spine order within the layout.
#[derive(Debug)]
pub(super) struct FragmentBackendChapter {
    pub(super) idref: String,
    /// Top-level formatting blocks the chapter paginated from; chapter
    /// ranges report this where the retained backend reports its block
    /// count.
    pub(super) block_count: usize,
    /// The chapter body's background color, painted as this chapter's
    /// page wash.
    pub(super) page_background: Option<String>,
    /// The body's background image painted across the full page.
    pub(super) page_background_image: Option<serde_json::Value>,
    pub(super) pages: Vec<FragmentBackendPage>,
}

/// One page: its query artifact and the commands that paint its content
/// (in page coordinates, at the page's content origin).
#[derive(Debug)]
pub(super) struct FragmentBackendPage {
    pub(super) artifact: FragmentPageArtifact,
    pub(super) commands: Vec<DisplayCommand>,
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

impl RuntimeDocument {
    /// Which backend owns a revision's pagination: `"fragment"` when the
    /// fragment page table attached, `"retained"` otherwise, `None` for
    /// an unknown revision. Diagnostic surface for probes and hosts.
    pub fn revision_pagination_backend(&self, revision_id: &str) -> Option<&'static str> {
        let revision = self.any_revision(revision_id)?;
        Some(match revision.fragment_layout {
            Some(_) => "fragment",
            None => "retained",
        })
    }

    /// Makes the fragment engine the pagination authority for a freshly
    /// completed whole-book revision, when it can represent every
    /// chapter. All-or-nothing: any chapter that fails to build or
    /// paginate leaves the retained page table (and the spread-frame
    /// bridge) in charge, so there is never a mixed page table.
    pub(super) fn try_attach_fragment_page_table(&mut self, revision_id: &str) {
        if !self.fragment_page_table_enabled {
            return;
        }
        // The bounded pipeline consumes its prepared chapters quantum by
        // quantum and leaves no whole-book preparation behind; rebuilding
        // the page table needs every chapter's arena.
        if self.prepared.is_none() && self.document.chapters.iter().all(|c| c.source_loaded) {
            self.ensure_prepared_all();
        }
        let Ok(layout) = self.build_fragment_page_table(revision_id) else {
            return;
        };
        let page_count = layout.page_count();
        if page_count == 0 {
            return;
        }
        let Some(revision) = self.any_revision_mut(revision_id) else {
            return;
        };
        let spread_count = build_spread_slots(
            page_count,
            layout.chapter_start_pages(),
            &revision.layout_config,
        )
        .len();
        revision.fragment_layout = Some(layout);
        // The revision's advertised extent must be the fragment page
        // table's: hosts navigate by these numbers.
        revision.known_extent = RuntimeRevisionExtent {
            page_count,
            spread_count,
        };
        revision.final_extent = Some(revision.known_extent);
        // Frames cached while the retained engine paginated (a bounded
        // session publishing progressively) describe the old page table.
        revision.frame_cache.clear();
        revision.frame_cache_order.clear();
    }

    /// Why a revision cannot hand pagination to the fragment engine, or
    /// `None` when it can (or already has). Rebuilds the page table to
    /// find out, so this is a diagnostic surface, not a hot path.
    pub fn fragment_page_table_rejection_reason(&self, revision_id: &str) -> Option<String> {
        self.build_fragment_page_table(revision_id).err()
    }

    fn build_fragment_page_table(&self, revision_id: &str) -> Result<FragmentBuiltLayout, String> {
        if !self.fragment_page_table_enabled {
            return Err("the fragment page table lever is off".to_owned());
        }
        let revision = self
            .any_revision(revision_id)
            .ok_or_else(|| format!("unknown revision: {revision_id}"))?;
        if revision.status != RuntimeRevisionStatus::Complete
            || revision.coordinate_space != RuntimeRevisionCoordinateSpace::Absolute
        {
            return Err("only completed whole-book revisions route".to_owned());
        }
        let prepared = self
            .prepared
            .as_ref()
            .ok_or_else(|| "document is not prepared".to_owned())?;
        let mut chapters = Vec::with_capacity(prepared.chapters.len());
        let mut anchors = BTreeMap::new();
        let mut page_index = 0;
        let chapter_idrefs: Vec<String> = prepared
            .chapters
            .iter()
            .map(|chapter| chapter.source.idref.clone())
            .collect();
        for idref in chapter_idrefs {
            let chapter =
                self.build_fragment_chapter(revision_id, &idref, page_index, &mut anchors)?;
            page_index += chapter.pages.len();
            chapters.push(chapter);
        }
        let mut layout = FragmentBuiltLayout::new(chapters);
        layout.anchors = anchors;
        Ok(layout)
    }

    /// Builds ONE chapter's complete fragment page table for a
    /// chapter-local revision: parse and style the chapter in a
    /// single-chapter prepared window (the whole-book preparation is
    /// untouched), bridge it, and paginate the entire chapter in one
    /// pass. Page indexes are chapter-local (base 0).
    pub(super) fn build_chapter_local_fragment_layout(
        &mut self,
        revision_id: &str,
        chapter_index: usize,
    ) -> Result<FragmentBuiltLayout, String> {
        let config = self
            .any_revision(revision_id)
            .ok_or_else(|| format!("unknown revision: {revision_id}"))?
            .layout_config
            .clone();
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
        // cross-chapter targets) assemble exactly like the retained
        // pipeline's chapter start: without them, artifact hits carry no
        // footnote keys.
        let mut interactions =
            crate::runtime::revision::runtime_chapter_revision_interactions(&prepared);
        self.record_prepared_chapter_footnotes(std::mem::take(&mut prepared.interaction.footnotes));
        let (resolved_footnotes, pending_footnote_keys, footnote_index_complete) =
            self.chapter_footnote_interactions(chapter_index);
        interactions.footnotes = resolved_footnotes;
        interactions.pending_footnote_keys =
            crate::interaction::FootnoteTargetSet::new(pending_footnote_keys);
        interactions.footnote_index_complete = footnote_index_complete;
        let font_fallbacks = {
            let mut font_fallbacks = self
                .pinned_font_policy
                .family_fallbacks_for_layout(&config, &self.document.package.metadata.language);
            if let Some(policy) = font_fallbacks.as_mut() {
                let pinned_faces = self
                    .pinned_font_policy
                    .measurement_faces_for_layout(&config);
                let available_families =
                    crate::epub::shapeable_publication_families_for_layout_with_sources(
                        &self.document,
                        self.resolved_font_face_sources(),
                        &config,
                        &pinned_faces,
                    );
                policy.set_available_publication_families(available_families);
            }
            font_fallbacks
        };
        let chapter = crate::epub::prepare_runtime_layout_chapter(
            &prepared,
            &config,
            font_fallbacks.as_ref(),
        )
        .map_err(|error| format!("chapter style resolution: {}", error.message()))?
        .ok_or_else(|| "prepared runtime chapter is unavailable".to_owned())?;
        let idref = chapter.idref.clone();
        let tables = super::frame::RuntimeChapterStyleTables {
            layout: chapter.layout_style_table,
            inline: chapter.inline_style_table,
        };
        let built = self
            .formatting_tree_from_prepared(&prepared, &tables, &idref, true)
            .map_err(|error| format!("chapter {idref}: {}", error.message()))?;
        let revision = self
            .any_revision_mut(revision_id)
            .ok_or_else(|| format!("unknown revision: {revision_id}"))?;
        revision.chapter_style_tables.insert(idref.clone(), tables);
        let publication_footnotes =
            std::mem::take(&mut revision.interactions.publication_footnotes);
        revision.interactions = interactions;
        revision.interactions.publication_footnotes = publication_footnotes;
        let mut anchors = BTreeMap::new();
        let backend_chapter =
            self.paginate_built_chapter(&built, &config, &idref, 0, &mut anchors)?;
        let mut layout = FragmentBuiltLayout::new(vec![backend_chapter]);
        layout.anchors = anchors;
        Ok(layout)
    }

    /// Paginates ONE chapter with the fragment engine and returns its
    /// backend pages, with `page_index_base` as the first page's global
    /// index and this chapter's anchors merged into `anchors`. The
    /// revision must retain the chapter's style tables (a prefix
    /// revision retains them only for its window, so partial books fail
    /// here and stay retained).
    pub(super) fn build_fragment_chapter(
        &self,
        revision_id: &str,
        idref: &str,
        page_index_base: usize,
        anchors: &mut BTreeMap<String, usize>,
    ) -> Result<FragmentBackendChapter, String> {
        let revision = self
            .any_revision(revision_id)
            .ok_or_else(|| format!("unknown revision: {revision_id}"))?;
        let config = revision.layout_config.clone();
        let built = self
            .chapter_formatting_tree(revision_id, idref)
            .map_err(|error| format!("chapter {idref}: {}", error.message()))?;
        self.paginate_built_chapter(&built, &config, idref, page_index_base, anchors)
    }

    /// The pagination half of a chapter build: lays a bridged formatting
    /// tree out into backend pages under the given layout config.
    pub(super) fn paginate_built_chapter(
        &self,
        built: &crate::fragment_bridge::ChapterFormattingTree,
        config: &crate::layout::LayoutConfig,
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
            margin_left,
            margin_top,
            FragmentPaintContext {
                family_policy: Some(&family_policy),
                node_paints: Some(&built.node_paints),
                image_border_paints: Some(&built.image_border_paints),
                list_markers: Some(&built.list_markers),
                vertical_frame: None,
                flow_item_sources: Some(&built.flow_item_sources),
            },
            &CancelFlag::new(),
        )
        .map_err(|error| format!("chapter {idref} pagination: {}", error.message()))?;
        let block_count = built.tree.node(built.tree.root()).children.len();
        let mut backend_pages = Vec::with_capacity(pages.len());
        for (offset, page) in pages.into_iter().enumerate() {
            let page_index = page_index_base + offset;
            collect_page_anchors(&page.root, &built.node_anchors, page_index, anchors);
            backend_pages.push(FragmentBackendPage {
                // Artifact geometry is spread-content space (the
                // legacy backend's convention, which every consumer —
                // the selection mapper, tap targets, search bounds —
                // translates to the viewport). Page margins must not
                // be baked in here.
                artifact: FragmentPageArtifact::build(
                    page_index,
                    page_width,
                    page_height,
                    &page.root,
                    built,
                    0.0,
                    0.0,
                ),
                commands: page.commands,
            });
        }
        Ok(FragmentBackendChapter {
            idref: idref.to_owned(),
            block_count,
            page_background: built.page_background.clone(),
            page_background_image: built.page_background_image.clone(),
            pages: backend_pages,
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
                    commands: Vec::new(),
                })
                .collect(),
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
