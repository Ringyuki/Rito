use crate::layout::{search_runtime_pages, SearchRuntimeResult};

use super::{
    navigation::spread_index_for_page, RuntimeRevision, RuntimeSearchRequest,
    RuntimeSearchResponse, RuntimeSearchResult,
};

pub(super) fn search_revision(
    revision_id: &str,
    revision: &RuntimeRevision,
    request: RuntimeSearchRequest,
) -> RuntimeSearchResponse {
    if request.query.is_empty() {
        return runtime_search_response(revision_id, request, Vec::new());
    }

    let results = search_runtime_pages(
        &revision.layout.pages,
        &request.query,
        request.case_sensitive,
        request.whole_word,
        request.limit,
    )
    .into_iter()
    .map(|result| runtime_search_result(revision, result))
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
    revision: &RuntimeRevision,
    result: SearchRuntimeResult,
) -> RuntimeSearchResult {
    RuntimeSearchResult {
        page_index: result.page_index,
        spread_index: spread_index_for_page(revision, result.page_index),
        match_range: result,
    }
}
