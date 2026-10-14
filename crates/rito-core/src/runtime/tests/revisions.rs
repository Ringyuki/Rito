//! The interaction entry points take the revision they answer for, the way
//! a reader session calls them with the revision it holds. A test names a
//! whole-book revision by the id `create_revision` reported.

use crate::epub::EpubResult;
use crate::runtime::{
    frame::RuntimeRevision,
    page,
    search::search_revision,
    source_locator::{active_toc_entries_by_page, TocTargetPosition},
    RuntimeDocument, RuntimeExactSourceRangeRequest, RuntimeExactSourceRangeResolution,
    RuntimeSearchRequest, RuntimeSearchResponse, RuntimeSourceLocatorError,
    RuntimeTextRangeGeometry, RuntimeTextRangeGeometryRequest,
};

/// The whole-book revision `revision_id` names.
pub(in crate::runtime) fn revision_by_id<'a>(
    document: &'a RuntimeDocument,
    revision_id: &str,
) -> &'a RuntimeRevision {
    document
        .revisions
        .get(revision_id)
        .expect("the document holds the revision")
}

/// Projects a durable source range onto a revision's pages: prepared
/// against the chapter source first, then resolved on the revision.
pub(in crate::runtime) fn exact_source_range(
    document: &mut RuntimeDocument,
    revision_id: &str,
    request: RuntimeExactSourceRangeRequest,
) -> Result<RuntimeExactSourceRangeResolution, RuntimeSourceLocatorError> {
    let prepared = document.prepare_exact_source_range(request)?;
    document.resolve_prepared_in(revision_by_id(document, revision_id), prepared)
}

/// Searches a whole-book revision the way a session searches the one it
/// holds.
pub(in crate::runtime) fn search(
    document: &RuntimeDocument,
    revision_id: &str,
    request: RuntimeSearchRequest,
) -> RuntimeSearchResponse {
    search_revision(
        &document.document,
        revision_id,
        revision_by_id(document, revision_id),
        request,
    )
}

/// The rectangles of a text range on one page of a whole-book revision.
pub(in crate::runtime) fn text_range_geometry(
    document: &RuntimeDocument,
    revision_id: &str,
    request: RuntimeTextRangeGeometryRequest,
) -> EpubResult<RuntimeTextRangeGeometry> {
    page::text_range_geometry(revision_id, revision_by_id(document, revision_id), request)
}

/// One spine item of a whole-book revision and the pages it lays out.
pub(in crate::runtime) struct WholeBookChapter {
    pub(in crate::runtime) href: String,
    pub(in crate::runtime) start_page: usize,
    pub(in crate::runtime) end_page: usize,
}

/// The page table of a whole-book revision, read straight from the
/// engine: what a session's answer about the same book is checked against.
pub(in crate::runtime) struct WholeBookPages {
    pub(in crate::runtime) page_count: usize,
    /// Each spread's left page and, where two pages are drawn, its right.
    pub(in crate::runtime) spreads: Vec<(usize, Option<usize>)>,
    /// In spine order; a whole book lays every chapter out.
    pub(in crate::runtime) chapters: Vec<WholeBookChapter>,
    /// Each placed TOC entry's preorder index and the page it lands on.
    pub(in crate::runtime) toc_pages: Vec<(usize, usize)>,
    pub(in crate::runtime) active_toc_entry_by_page: Vec<Option<usize>>,
}

pub(in crate::runtime) fn whole_book_pages(
    document: &mut RuntimeDocument,
    revision_id: &str,
) -> WholeBookPages {
    let prepared = document.prepare_toc_targets(|_| true);
    let revision = revision_by_id(document, revision_id);
    let positions = document.toc_target_positions_in(revision_id, revision, &prepared);
    let engine = revision.chapter_engine_session();
    let page_count = engine.metadata().page_count;
    let known = engine.known_chapters();
    WholeBookPages {
        page_count,
        spreads: engine
            .spreads()
            .into_iter()
            .map(|spread| (spread.left_page_index, spread.right_page_index))
            .collect(),
        chapters: document
            .document
            .chapters
            .iter()
            .map(|chapter| {
                let range = known
                    .get(&chapter.idref)
                    .expect("a whole book lays every chapter out");
                WholeBookChapter {
                    href: chapter.href.clone(),
                    start_page: range.start_page,
                    end_page: range.end_page,
                }
            })
            .collect(),
        toc_pages: positions
            .iter()
            .enumerate()
            .filter_map(|(toc_index, position)| match position {
                TocTargetPosition::Page(page_index) => Some((toc_index, *page_index)),
                _ => None,
            })
            .collect(),
        active_toc_entry_by_page: active_toc_entries_by_page(&positions, page_count),
    }
}

/// The text of one page of a whole-book revision, as its page artifact
/// holds it.
pub(in crate::runtime) fn page_text(
    document: &RuntimeDocument,
    revision_id: &str,
    page_index: usize,
) -> String {
    revision_by_id(document, revision_id)
        .chapter_engine_session()
        .page(page_index)
        .expect("the revision has the page")
        .text_positions()
        .text
}
