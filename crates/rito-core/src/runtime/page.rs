use crate::{
    epub::{EpubError, EpubResult, LoadedEpubDocument},
    layout::{SearchTextPosition, TextRangeRect, TextRunOffset},
};

use super::{
    navigation::spread_index_for_page,
    page_artifact::{
        PageArtifactTextPosition, PageArtifactTextPositions, PageArtifactTextRangeRect,
    },
    page_target::{runtime_page_targets, RuntimePageTargetContext},
    RuntimePageTargets, RuntimePageTextPositions, RuntimeRevision, RuntimeTextRangeGeometry,
    RuntimeTextRangeGeometryRequest,
};

pub(super) fn page_targets(
    document: &LoadedEpubDocument,
    context: &RuntimePageTargetContext,
    revision_id: &str,
    revision: &RuntimeRevision,
    page_index: usize,
) -> EpubResult<RuntimePageTargets> {
    let targets = revision
        .chapter_engine_session()
        .page(page_index)
        .ok_or_else(|| EpubError::new(format!("unknown page index: {page_index}")))?
        .targets();
    let entries = runtime_page_targets(document, context, revision, page_index, targets.entries);
    Ok(RuntimePageTargets {
        revision_id: revision_id.to_owned(),
        page_index,
        spread_index: spread_index_for_page(revision, page_index),
        entry_count: entries.len(),
        text_hash: targets.text_hash,
        entries,
    })
}

pub(super) fn page_text_positions(
    revision_id: &str,
    revision: &RuntimeRevision,
    page_index: usize,
) -> EpubResult<RuntimePageTextPositions> {
    let page = revision
        .chapter_engine_session()
        .page(page_index)
        .ok_or_else(|| EpubError::new(format!("unknown page index: {page_index}")))?;
    Ok(runtime_page_text_positions(
        revision_id,
        page_index,
        spread_index_for_page(revision, page_index),
        page.text_positions(),
    ))
}

pub(super) fn text_range_geometry(
    revision_id: &str,
    revision: &RuntimeRevision,
    request: RuntimeTextRangeGeometryRequest,
) -> EpubResult<RuntimeTextRangeGeometry> {
    let page = revision
        .chapter_engine_session()
        .page(request.page_index)
        .ok_or_else(|| EpubError::new(format!("unknown page index: {}", request.page_index)))?;
    let geometry = page.text_range_geometry(
        artifact_text_position(request.start),
        artifact_text_position(request.end),
    );
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
        rect_count: geometry.rects.len(),
        rects: geometry
            .rects
            .into_iter()
            .map(runtime_text_range_rect)
            .collect(),
    })
}

fn runtime_page_text_positions(
    revision_id: &str,
    page_index: usize,
    spread_index: usize,
    page: PageArtifactTextPositions,
) -> RuntimePageTextPositions {
    RuntimePageTextPositions {
        revision_id: revision_id.to_owned(),
        page_index,
        spread_index,
        text: page.text,
        text_length: page.text_length,
        text_hash: page.text_hash,
        offsets: page
            .offsets
            .into_iter()
            .map(|offset| TextRunOffset {
                start: offset.start,
                end: offset.end,
                block_index: offset.block_index,
                line_index: offset.line_index,
                run_index: offset.run_index,
            })
            .collect(),
    }
}

fn artifact_text_position(position: SearchTextPosition) -> PageArtifactTextPosition {
    PageArtifactTextPosition {
        block_index: position.block_index,
        line_index: position.line_index,
        run_index: position.run_index,
        char_index: position.char_index,
    }
}

fn runtime_text_range_rect(rect: PageArtifactTextRangeRect) -> TextRangeRect {
    TextRangeRect {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        block_index: rect.block_index,
        line_index: rect.line_index,
        run_index: rect.run_index,
        start_char_index: rect.start_char_index,
        end_char_index: rect.end_char_index,
    }
}
