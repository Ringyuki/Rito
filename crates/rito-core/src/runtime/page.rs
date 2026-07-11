use crate::{
    epub::{EpubError, EpubResult, LoadedEpubDocument},
    layout::{
        build_hit_targets, build_text_position_page, build_text_range_geometry,
        RuntimeTextPositionPage,
    },
};

use super::{
    navigation::spread_index_for_page, page_target::runtime_page_targets, RuntimePageTargets,
    RuntimePageTextPositions, RuntimeRevision, RuntimeTextRangeGeometry,
    RuntimeTextRangeGeometryRequest,
};

pub(super) fn page_targets(
    document: &LoadedEpubDocument,
    revision_id: &str,
    revision: &RuntimeRevision,
    page_index: usize,
) -> EpubResult<RuntimePageTargets> {
    let page = revision
        .layout
        .pages
        .get(page_index)
        .ok_or_else(|| EpubError::new(format!("unknown page index: {page_index}")))?;
    let (entries, text_hash) = build_hit_targets(page);
    let entries = runtime_page_targets(document, revision, page_index, entries);
    Ok(RuntimePageTargets {
        revision_id: revision_id.to_owned(),
        page_index,
        spread_index: spread_index_for_page(revision, page_index),
        entry_count: entries.len(),
        text_hash,
        entries,
    })
}

pub(super) fn page_text_positions(
    revision_id: &str,
    revision: &RuntimeRevision,
    page_index: usize,
) -> EpubResult<RuntimePageTextPositions> {
    let page = revision
        .layout
        .pages
        .get(page_index)
        .ok_or_else(|| EpubError::new(format!("unknown page index: {page_index}")))?;
    Ok(runtime_page_text_positions(
        revision_id,
        page_index,
        spread_index_for_page(revision, page_index),
        build_text_position_page(page),
    ))
}

pub(super) fn text_range_geometry(
    revision_id: &str,
    revision: &RuntimeRevision,
    request: RuntimeTextRangeGeometryRequest,
) -> EpubResult<RuntimeTextRangeGeometry> {
    let page = revision
        .layout
        .pages
        .get(request.page_index)
        .ok_or_else(|| EpubError::new(format!("unknown page index: {}", request.page_index)))?;
    let geometry = build_text_range_geometry(page, request.start, request.end);
    if geometry.rects.is_empty() {
        return Err(EpubError::new(format!(
            "text range not found on page: {}",
            request.page_index
        )));
    }
    Ok(RuntimeTextRangeGeometry {
        revision_id: revision_id.to_owned(),
        page_index: request.page_index,
        spread_index: spread_index_for_page(revision, request.page_index),
        rect_count: geometry.rect_count,
        rects: geometry.rects,
    })
}

fn runtime_page_text_positions(
    revision_id: &str,
    page_index: usize,
    spread_index: usize,
    page: RuntimeTextPositionPage,
) -> RuntimePageTextPositions {
    RuntimePageTextPositions {
        revision_id: revision_id.to_owned(),
        page_index,
        spread_index,
        text: page.text,
        text_length: page.text_length,
        text_hash: page.text_hash,
        offsets: page.offsets,
    }
}
