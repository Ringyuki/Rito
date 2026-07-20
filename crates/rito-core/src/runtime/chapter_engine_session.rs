//! Read-only engine session boundary for retained revision artifacts.
//!
//! Runtime consumers depend on this façade. The current backend adapter is
//! legacy layout, but no backend representation escapes this module.

use std::{collections::BTreeMap, ops::Range};

mod legacy;

use legacy::LegacyChapterEngineSession;

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
    backend: LegacyChapterEngineSession<'a>,
}

impl<'a> ChapterEngineSession<'a> {
    fn new(revision: &'a RuntimeRevision) -> Self {
        Self {
            backend: LegacyChapterEngineSession::new(revision),
        }
    }

    pub(super) fn metadata(&self) -> PageArtifactRevisionMetadata {
        self.backend.metadata()
    }

    pub(super) fn page(&self, page_index: usize) -> Option<&'a dyn PageArtifact> {
        self.backend.page(page_index)
    }

    pub(super) fn frame(&self, spread_index: usize) -> Option<PageArtifactFrame> {
        self.backend.frame(spread_index)
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
