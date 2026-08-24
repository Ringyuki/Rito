//! Read-only engine session boundary for retained revision artifacts.
//!
//! Runtime consumers depend on this façade. The current backend adapter is
//! legacy layout, but no backend representation escapes this module.

use std::{collections::BTreeMap, ops::Range};

mod fragment;
mod legacy;

use fragment::FragmentChapterEngineSession;
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
    backend: Backend<'a>,
}

/// A fragment page table on the revision makes the fragment engine the
/// pagination authority; otherwise the retained backend serves.
enum Backend<'a> {
    Legacy(LegacyChapterEngineSession<'a>),
    Fragment(FragmentChapterEngineSession<'a>),
}

impl<'a> ChapterEngineSession<'a> {
    fn new(revision: &'a RuntimeRevision) -> Self {
        let backend = match &revision.fragment_layout {
            Some(layout) => Backend::Fragment(FragmentChapterEngineSession::new(revision, layout)),
            None => Backend::Legacy(LegacyChapterEngineSession::new(revision)),
        };
        Self { backend }
    }

    pub(super) fn metadata(&self) -> PageArtifactRevisionMetadata {
        match &self.backend {
            Backend::Legacy(backend) => backend.metadata(),
            Backend::Fragment(backend) => backend.metadata(),
        }
    }

    pub(super) fn page(&self, page_index: usize) -> Option<&'a dyn PageArtifact> {
        match &self.backend {
            Backend::Legacy(backend) => backend.page(page_index),
            Backend::Fragment(backend) => backend.page(page_index),
        }
    }

    pub(super) fn frame(&self, spread_index: usize) -> Option<PageArtifactFrame> {
        match &self.backend {
            Backend::Legacy(backend) => backend.frame(spread_index),
            Backend::Fragment(backend) => backend.frame(spread_index),
        }
    }

    pub(super) fn spreads(&self) -> Vec<PageArtifactSpread> {
        match &self.backend {
            Backend::Legacy(backend) => backend.spreads(),
            Backend::Fragment(backend) => backend.spreads(),
        }
    }

    pub(super) fn known_chapters(&self) -> BTreeMap<String, PageArtifactChapterRange> {
        match &self.backend {
            Backend::Legacy(backend) => backend.known_chapters(),
            Backend::Fragment(backend) => backend.known_chapters(),
        }
    }

    pub(super) fn known_chapter(&self, idref: &str) -> Option<PageArtifactChapterRange> {
        match &self.backend {
            Backend::Legacy(backend) => backend.known_chapter(idref),
            Backend::Fragment(backend) => backend.known_chapter(idref),
        }
    }

    pub(super) fn anchor_pages(&self, range: Range<usize>) -> Option<BTreeMap<String, usize>> {
        match &self.backend {
            Backend::Legacy(backend) => backend.anchor_pages(range),
            Backend::Fragment(backend) => backend.anchor_pages(range),
        }
    }

    pub(super) fn source_run_starts(
        &self,
        range: Range<usize>,
    ) -> Option<Vec<PageArtifactSourceRunStart>> {
        match &self.backend {
            Backend::Legacy(backend) => backend.source_run_starts(range),
            Backend::Fragment(backend) => backend.source_run_starts(range),
        }
    }

    pub(super) fn resolve_exact_source_range(
        &self,
        query: PageArtifactExactSourceRangeQuery,
    ) -> PageArtifactExactTextRangeResolution {
        match &self.backend {
            Backend::Legacy(backend) => backend.resolve_exact_source_range(query),
            Backend::Fragment(backend) => backend.resolve_exact_source_range(query),
        }
    }

    /// Search index built from the page artifacts. Only the fragment
    /// backend serves one; retained revisions search their layout pages.
    pub(super) fn search_page_index(&self) -> Vec<crate::layout::SearchPageText> {
        match &self.backend {
            Backend::Legacy(_) => Vec::new(),
            Backend::Fragment(backend) => backend.search_page_index(),
        }
    }

    pub(super) fn resolve_text_caret(
        &self,
        query: PageArtifactTextCaretQuery,
    ) -> Option<PageArtifactTextCaretResolution> {
        match &self.backend {
            Backend::Legacy(backend) => backend.resolve_text_caret(query),
            Backend::Fragment(backend) => backend.resolve_text_caret(query),
        }
    }

    pub(super) fn resolve_text_range(
        &self,
        query: PageArtifactTextRangeQuery,
    ) -> PageArtifactExactTextRangeResolution {
        match &self.backend {
            Backend::Legacy(backend) => backend.resolve_text_range(query),
            Backend::Fragment(backend) => backend.resolve_text_range(query),
        }
    }

    pub(super) fn resolve_text_range_to_point(
        &self,
        query: PageArtifactTextRangeToPointQuery,
    ) -> PageArtifactTextRangeFromPointsResolution {
        match &self.backend {
            Backend::Legacy(backend) => backend.resolve_text_range_to_point(query),
            Backend::Fragment(backend) => backend.resolve_text_range_to_point(query),
        }
    }

    pub(super) fn resolve_text_range_from_points(
        &self,
        query: PageArtifactTextRangeFromPointsQuery<'_>,
    ) -> PageArtifactTextRangeFromPointsResolution {
        match &self.backend {
            Backend::Legacy(backend) => backend.resolve_text_range_from_points(query),
            Backend::Fragment(backend) => backend.resolve_text_range_from_points(query),
        }
    }

    pub(super) fn resolve_text_selection_movement(
        &self,
        query: PageArtifactTextSelectionMovementQuery<'_>,
    ) -> PageArtifactTextSelectionMovementResolution {
        match &self.backend {
            Backend::Legacy(backend) => backend.resolve_text_selection_movement(query),
            Backend::Fragment(backend) => backend.resolve_text_selection_movement(query),
        }
    }
}

impl RuntimeRevision {
    pub(in crate::runtime) fn chapter_engine_session(&self) -> ChapterEngineSession<'_> {
        ChapterEngineSession::new(self)
    }
}
