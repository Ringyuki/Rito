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

#[cfg(test)]
mod tests {
    use super::*;

    fn chapter(idref: &str, page_count: usize) -> FragmentBackendChapter {
        FragmentBackendChapter {
            idref: idref.to_owned(),
            block_count: 1,
            page_background: None,
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
        let Some(layout) = self.build_fragment_page_table(revision_id) else {
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
    }

    fn build_fragment_page_table(&self, revision_id: &str) -> Option<FragmentBuiltLayout> {
        if !self.fragment_page_table_enabled {
            return None;
        }
        let revision = self.any_revision(revision_id)?;
        if revision.status != RuntimeRevisionStatus::Complete
            || revision.coordinate_space != RuntimeRevisionCoordinateSpace::Absolute
        {
            return None;
        }
        let family_policy = self.fragment_paint_family_policy()?;
        let engine = self.fragment_engine()?;
        let prepared = self.prepared.as_ref()?;
        let config = &revision.layout_config;
        let content_width = config.page_width - config.margin_left - config.margin_right;
        let content_height = config.page_height - config.margin_top - config.margin_bottom;
        if content_width <= 0.0 || content_height <= 0.0 {
            return None;
        }
        let mut chapters = Vec::with_capacity(prepared.chapters.len());
        let mut page_index = 0;
        for chapter in &prepared.chapters {
            let idref = chapter.source.idref.clone();
            // A prefix revision retains style tables only for its window,
            // so partial books fail here and stay retained.
            let built = self.chapter_formatting_tree(revision_id, &idref).ok()?;
            let pages = paginate_chapter(
                &engine.engine,
                &built.tree,
                content_width,
                content_height,
                config.margin_left,
                config.margin_top,
                FragmentPaintContext {
                    family_policy: Some(&family_policy),
                    node_paints: Some(&built.node_paints),
                },
                &CancelFlag::new(),
            )
            .ok()?;
            let block_count = built.tree.node(built.tree.root()).children.len();
            let mut backend_pages = Vec::with_capacity(pages.len());
            for page in pages {
                backend_pages.push(FragmentBackendPage {
                    artifact: FragmentPageArtifact::build(
                        page_index,
                        config.page_width,
                        config.page_height,
                        &page.root,
                        &built,
                        config.margin_left,
                        config.margin_top,
                    ),
                    commands: page.commands,
                });
                page_index += 1;
            }
            chapters.push(FragmentBackendChapter {
                idref,
                block_count,
                page_background: built.page_background.clone(),
                pages: backend_pages,
            });
        }
        Some(FragmentBuiltLayout::new(chapters))
    }
}
