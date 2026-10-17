//! How far a chapter must paginate before a locator's page is the page a
//! pagination of the whole chapter would give it.
//!
//! A source point projects onto the page of the nearest run of its text
//! node (see `projection`). A text node's runs follow one another through
//! the flow, and a float the flow cannot place is carried to a later page
//! by the break token that page resumes from. So once a page holds runs
//! only of text after the point's node, and nothing is carried past it, no
//! later page holds a run of the node, and the pages so far project the
//! point exactly as all of them would.

use rito_fragment::BreakToken;

use super::{
    matched_by, CanonicalSourceLocator, RuntimeSourceChapterIndex, RuntimeSourceLocator,
    RuntimeSourceLocatorMatchedBy,
};
use crate::runtime::{page_artifact::PageArtifactSourceRunStart, RuntimeDocument};

/// How far a chapter-local revision's chapter paginates before the
/// revision's target is settled.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::runtime) enum PaginationTarget {
    /// The whole chapter: a page fraction, an anchor or the chapter's end
    /// is placed against all of its pages.
    Whole,
    /// The chapter's first page.
    Start,
    /// A source point in the text span of this index.
    Point { span: usize },
}

impl PaginationTarget {
    /// Whether the target is settled by the pages through one whose run
    /// starts are `starts` and after which the chapter resumes at
    /// `resumes_at`.
    pub(in crate::runtime) fn settled_after(
        &self,
        starts: &[PageArtifactSourceRunStart],
        resumes_at: Option<&BreakToken>,
        index: Option<&RuntimeSourceChapterIndex>,
    ) -> bool {
        match self {
            Self::Whole => false,
            Self::Start => true,
            Self::Point { span } => index.is_some_and(|index| {
                !starts.is_empty()
                    && starts.iter().all(|start| {
                        index
                            .span_index(&start.node_path)
                            .is_some_and(|start_span| start_span > *span)
                    })
                    && resumes_at.is_none_or(|token| token.pending_floats.is_empty())
            }),
        }
    }
}

impl RuntimeDocument {
    /// How far a chapter-local revision for `locator` paginates before its
    /// target page is settled.
    pub(in crate::runtime) fn pagination_target(
        &mut self,
        locator: &RuntimeSourceLocator,
    ) -> PaginationTarget {
        let Ok(canonical) = self.canonicalize_source_locator(locator.clone()) else {
            return PaginationTarget::Whole;
        };
        let CanonicalSourceLocator {
            chapter_index,
            spine_idref,
            locator,
        } = canonical;
        let point = match matched_by(&locator) {
            RuntimeSourceLocatorMatchedBy::Href => return PaginationTarget::Start,
            RuntimeSourceLocatorMatchedBy::SourcePoint => locator.source_point,
            RuntimeSourceLocatorMatchedBy::SourceRange => {
                locator.source_range.map(|range| range.start)
            }
            RuntimeSourceLocatorMatchedBy::Anchor | RuntimeSourceLocatorMatchedBy::Progression => {
                None
            }
        };
        let Some(point) = point else {
            return PaginationTarget::Whole;
        };
        if self.ensure_source_chapter_index(chapter_index).is_err() {
            return PaginationTarget::Whole;
        }
        self.source_chapter_indices
            .get(&spine_idref)
            .and_then(|index| index.span_index(&point.node_path))
            .map_or(PaginationTarget::Whole, |span| PaginationTarget::Point {
                span,
            })
    }

    /// The source index of a chapter, when it has been built.
    pub(in crate::runtime) fn source_chapter_index(
        &self,
        spine_idref: &str,
    ) -> Option<&RuntimeSourceChapterIndex> {
        self.source_chapter_indices.get(spine_idref)
    }
}
