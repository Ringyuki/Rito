use std::collections::BTreeMap;

use crate::{
    epub::{parsed_loaded_chapter_source, LoadedChapter, LoadedEpubDocument},
    layout::{search_runtime_pages, SearchRuntimeMatch, SearchSourcePoint},
};

use super::{
    chapter_text::build_chapter_text_index, navigation::spread_index_for_page,
    page_target::chapter_for_page, source_locator::utf16_slice, RuntimeChapterTextIndex,
    RuntimeRevision, RuntimeSearchRequest, RuntimeSearchResponse, RuntimeSearchResult,
    RuntimeSearchSource, RuntimeSearchSourceUnavailableReason, RuntimeSourcePoint,
    RuntimeSourceRange,
};

pub(super) fn search_revision(
    document: &LoadedEpubDocument,
    revision_id: &str,
    revision: &RuntimeRevision,
    request: RuntimeSearchRequest,
) -> RuntimeSearchResponse {
    if request.query.is_empty() {
        return runtime_search_response(revision_id, request, Vec::new());
    }

    // A fragment page table is the pagination authority; its artifacts
    // carry the page text and run table the retained walk would have
    // derived from `layout.pages` (which stays empty once the handover
    // clears the retained frames — searching it found nothing).
    let matches = if revision.fragment_layout.is_some() {
        let session = revision.chapter_engine_session();
        let index = session.search_page_index();
        crate::layout::search_prebuilt_runtime_pages(
            &index,
            &request.query,
            request.case_sensitive,
            request.whole_word,
            request.limit,
        )
    } else {
        search_runtime_pages(
            &revision.layout.pages,
            &request.query,
            request.case_sensitive,
            request.whole_word,
            request.limit,
        )
    };
    let mut source_indices = BTreeMap::new();
    let results = matches
        .into_iter()
        .map(|result| runtime_search_result(document, revision, result, &mut source_indices))
        .collect::<Vec<_>>();
    runtime_search_response(revision_id, request, results)
}

fn runtime_search_response(
    revision_id: &str,
    request: RuntimeSearchRequest,
    results: Vec<RuntimeSearchResult>,
) -> RuntimeSearchResponse {
    RuntimeSearchResponse {
        revision_id: revision_id.to_owned(),
        query: request.query,
        case_sensitive: request.case_sensitive,
        whole_word: request.whole_word,
        result_count: results.len(),
        results,
    }
}

fn runtime_search_result(
    document: &LoadedEpubDocument,
    revision: &RuntimeRevision,
    matched: SearchRuntimeMatch,
    source_indices: &mut BTreeMap<String, RuntimeChapterTextIndex>,
) -> RuntimeSearchResult {
    let SearchRuntimeMatch {
        result,
        selected_text,
        source_range,
    } = matched;
    let page_index = result.page_index;
    RuntimeSearchResult {
        page_index,
        spread_index: spread_index_for_page(revision, page_index),
        match_range: result,
        source: runtime_search_source(
            document,
            revision,
            page_index,
            source_range,
            &selected_text,
            source_indices,
        ),
    }
}

fn runtime_search_source(
    document: &LoadedEpubDocument,
    revision: &RuntimeRevision,
    page_index: usize,
    source_range: Option<crate::layout::SearchSourceRange>,
    selected_text: &str,
    source_indices: &mut BTreeMap<String, RuntimeChapterTextIndex>,
) -> RuntimeSearchSource {
    let Some(source_range) = source_range else {
        return unavailable_search_source();
    };
    let Some(chapter) = chapter_for_page(document, revision, page_index) else {
        return unavailable_search_source();
    };
    let source_range = RuntimeSourceRange {
        start: runtime_source_point(source_range.start),
        end: runtime_source_point(source_range.end),
    };
    let source_index = source_indices
        .entry(chapter.idref.clone())
        .or_insert_with(|| source_index_for_chapter(chapter));
    if !source_range_matches(source_index, &source_range, selected_text) {
        return unavailable_search_source();
    }
    RuntimeSearchSource::Resolved {
        href: chapter.href.clone(),
        source_range,
    }
}

fn source_index_for_chapter(chapter: &LoadedChapter) -> RuntimeChapterTextIndex {
    let parsed = parsed_loaded_chapter_source(chapter);
    build_chapter_text_index(&chapter.href, &parsed.parsed.nodes)
}

fn source_range_matches(
    index: &RuntimeChapterTextIndex,
    range: &RuntimeSourceRange,
    selected_text: &str,
) -> bool {
    let Some(start) = source_point_offset(index, &range.start) else {
        return false;
    };
    let Some(end) = source_point_offset(index, &range.end) else {
        return false;
    };
    utf16_slice(&index.normalized_text, start, end).is_some_and(|text| text == selected_text)
}

fn source_point_offset(
    index: &RuntimeChapterTextIndex,
    point: &RuntimeSourcePoint,
) -> Option<usize> {
    let span = index
        .spans
        .iter()
        .find(|span| span.node_path == point.node_path)?;
    (point.text_offset >= span.source_start && point.text_offset <= span.source_end)
        .then(|| span.normalized_start + point.text_offset - span.source_start)
}

fn runtime_source_point(point: SearchSourcePoint) -> RuntimeSourcePoint {
    RuntimeSourcePoint {
        node_path: point.node_path,
        text_offset: point.text_offset,
    }
}

fn unavailable_search_source() -> RuntimeSearchSource {
    RuntimeSearchSource::Unavailable {
        reason: RuntimeSearchSourceUnavailableReason::SourceUnavailable,
    }
}
