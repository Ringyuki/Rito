//! Read-only engine session boundary over a revision's page table.
//!
//! Runtime consumers depend on this façade; no page-table representation
//! escapes this module.

use std::{collections::BTreeMap, ops::Range, rc::Rc};

mod fragment;

use fragment::FragmentChapterEngineSession;

use super::{
    page_artifact::{
        PageArtifact, PageArtifactChapterRange, PageArtifactExactSourceRangeQuery,
        PageArtifactExactTextRangeResolution, PageArtifactFrame, PageArtifactRevisionMetadata,
        PageArtifactSourceRunStart, PageArtifactSpread, PageArtifactTextCaretQuery,
        PageArtifactTextCaretResolution, PageArtifactTextRangeFromPointsQuery,
        PageArtifactTextRangeFromPointsResolution, PageArtifactTextRangeQuery,
        PageArtifactTextRangeToPointQuery, PageArtifactTextSelectionMovementQuery,
        PageArtifactTextSelectionMovementResolution,
    },
    RuntimeRevision,
};

pub(super) struct ChapterEngineSession<'a> {
    backend: FragmentChapterEngineSession<'a>,
}

impl<'a> ChapterEngineSession<'a> {
    fn new(revision: &'a RuntimeRevision) -> Self {
        Self {
            backend: FragmentChapterEngineSession::new(revision, &revision.fragment_layout),
        }
    }

    pub(super) fn metadata(&self) -> PageArtifactRevisionMetadata {
        self.backend.metadata()
    }

    pub(super) fn page(&self, page_index: usize) -> Option<Rc<dyn PageArtifact>> {
        self.backend.page(page_index)
    }

    /// The spread's paint commands at `ratio` device pixels per CSS
    /// pixel; `None` when the spread is not published.
    pub(super) fn frame(
        &self,
        spread_index: usize,
        ratio: f64,
    ) -> crate::epub::EpubResult<Option<PageArtifactFrame>> {
        self.backend.frame(spread_index, ratio)
    }

    /// The page indexes a spread shows, without painting it.
    pub(super) fn spread_pages(&self, spread_index: usize) -> Option<Vec<usize>> {
        self.backend.spread_pages(spread_index)
    }

    pub(super) fn spreads(&self) -> Vec<PageArtifactSpread> {
        self.backend.spreads()
    }

    pub(super) fn known_chapters(&self) -> BTreeMap<String, PageArtifactChapterRange> {
        self.backend.known_chapters()
    }

    pub(super) fn known_chapter(&self, idref: &str) -> Option<PageArtifactChapterRange> {
        self.backend.known_chapter(idref)
    }

    pub(super) fn anchor_pages(&self, range: Range<usize>) -> Option<BTreeMap<String, usize>> {
        self.backend.anchor_pages(range)
    }

    pub(super) fn source_run_starts(
        &self,
        range: Range<usize>,
    ) -> Option<Vec<PageArtifactSourceRunStart>> {
        self.backend.source_run_starts(range)
    }

    pub(super) fn resolve_exact_source_range(
        &self,
        query: PageArtifactExactSourceRangeQuery,
    ) -> PageArtifactExactTextRangeResolution {
        self.backend.resolve_exact_source_range(query)
    }

    /// The page text and run offsets the revision recorded when it
    /// paginated, one entry per page.
    pub(super) fn search_page_index(&self) -> &'a [crate::runtime::search::SearchPageText] {
        self.backend.search_page_index()
    }

    pub(super) fn resolve_text_caret(
        &self,
        query: PageArtifactTextCaretQuery,
    ) -> Option<PageArtifactTextCaretResolution> {
        self.backend.resolve_text_caret(query)
    }

    pub(super) fn resolve_text_range(
        &self,
        query: PageArtifactTextRangeQuery,
    ) -> PageArtifactExactTextRangeResolution {
        self.backend.resolve_text_range(query)
    }

    pub(super) fn resolve_text_range_to_point(
        &self,
        query: PageArtifactTextRangeToPointQuery,
    ) -> PageArtifactTextRangeFromPointsResolution {
        self.backend.resolve_text_range_to_point(query)
    }

    pub(super) fn resolve_text_range_from_points(
        &self,
        query: PageArtifactTextRangeFromPointsQuery<'_>,
    ) -> PageArtifactTextRangeFromPointsResolution {
        self.backend.resolve_text_range_from_points(query)
    }

    pub(super) fn resolve_text_selection_movement(
        &self,
        query: PageArtifactTextSelectionMovementQuery<'_>,
    ) -> PageArtifactTextSelectionMovementResolution {
        self.backend.resolve_text_selection_movement(query)
    }
}

impl RuntimeRevision {
    pub(in crate::runtime) fn chapter_engine_session(&self) -> ChapterEngineSession<'_> {
        ChapterEngineSession::new(self)
    }
}
