use std::sync::Arc;

use crate::layout::{LayoutRuntimePage, LogicalTextFlow, LogicalTextSource, RunTextMapping};

use super::{
    caret::{exact_run_parts, resolve_address, stop_at, ResolvedRunCaret},
    collect::{collect_page_text_runs, collect_text_runs_in_page_range, CollectedTextRun},
    ExactTextRangeRect, LayoutExactTextRange, LayoutExactTextRangeResolution, TextCaretAddress,
    TextInteractionUnavailableReason,
};

pub(crate) fn resolve_same_flow_text_range(
    pages: &[LayoutRuntimePage],
    anchor_address: TextCaretAddress,
    focus_address: TextCaretAddress,
) -> LayoutExactTextRangeResolution {
    let first_page = anchor_address.page_index.min(focus_address.page_index);
    let last_page = anchor_address.page_index.max(focus_address.page_index);
    let anchor_runs = pages
        .get(anchor_address.page_index)
        .map(|page| collect_page_text_runs(anchor_address.page_index, page))
        .unwrap_or_default();
    let focus_runs = (focus_address.page_index != anchor_address.page_index).then(|| {
        pages
            .get(focus_address.page_index)
            .map(|page| collect_page_text_runs(focus_address.page_index, page))
            .unwrap_or_default()
    });
    let anchor = match resolve_address(&anchor_runs, anchor_address) {
        Ok(caret) => caret,
        Err(reason) => return LayoutExactTextRangeResolution::Unavailable(reason),
    };
    let focus = match resolve_address(focus_runs.as_deref().unwrap_or(&anchor_runs), focus_address)
    {
        Ok(caret) => caret,
        Err(reason) => return LayoutExactTextRangeResolution::Unavailable(reason),
    };
    if !Arc::ptr_eq(anchor.flow, focus.flow) {
        return LayoutExactTextRangeResolution::Unavailable(
            TextInteractionUnavailableReason::DifferentLogicalFlow,
        );
    }
    let (start, end) = normalize_endpoints(&anchor, &focus);
    if !range_has_exact_source(start.flow, start.logical_offset, end.logical_offset) {
        return LayoutExactTextRangeResolution::Unavailable(
            TextInteractionUnavailableReason::SourceUnavailable,
        );
    }
    let Some(selected_text) = start
        .flow
        .slice_utf16(start.logical_offset, end.logical_offset)
    else {
        return LayoutExactTextRangeResolution::Unavailable(
            TextInteractionUnavailableReason::InvalidCaret,
        );
    };
    let range_runs = (first_page != last_page)
        .then(|| collect_text_runs_in_page_range(pages, first_page, last_page));
    let rects = match range_rects(range_runs.as_deref().unwrap_or(&anchor_runs), start, end) {
        Ok(rects) => rects,
        Err(reason) => return LayoutExactTextRangeResolution::Unavailable(reason),
    };
    LayoutExactTextRangeResolution::Resolved(Box::new(LayoutExactTextRange {
        anchor: anchor_address,
        focus: focus_address,
        start: start.address,
        end: end.address,
        selected_text: selected_text.to_owned(),
        source_start: start.source_point.clone(),
        source_end: end.source_point.clone(),
        rects,
    }))
}

fn normalize_endpoints<'a>(
    anchor: &'a ResolvedRunCaret<'a>,
    focus: &'a ResolvedRunCaret<'a>,
) -> (&'a ResolvedRunCaret<'a>, &'a ResolvedRunCaret<'a>) {
    if endpoint_precedes(focus, anchor) {
        (focus, anchor)
    } else {
        (anchor, focus)
    }
}

fn endpoint_precedes(left: &ResolvedRunCaret<'_>, right: &ResolvedRunCaret<'_>) -> bool {
    left.logical_offset < right.logical_offset
        || (left.logical_offset == right.logical_offset
            && address_key(left.address) < address_key(right.address))
}

fn address_key(address: TextCaretAddress) -> (usize, usize, usize, usize, usize, usize) {
    (
        address.page_index,
        address.block_index,
        address.line_index,
        address.run_index,
        address.char_index,
        match address.affinity {
            super::TextCaretAffinity::Upstream => 0,
            super::TextCaretAffinity::Downstream => 1,
        },
    )
}

fn range_has_exact_source(flow: &LogicalTextFlow, start: u32, end: u32) -> bool {
    flow.spans().iter().all(|span| {
        !ranges_intersect(start, end, span.logical_start, span.logical_end)
            || matches!(span.source, LogicalTextSource::ExactLinear { .. })
    })
}

fn range_rects(
    runs: &[CollectedTextRun<'_>],
    start: &ResolvedRunCaret<'_>,
    end: &ResolvedRunCaret<'_>,
) -> Result<Vec<ExactTextRangeRect>, TextInteractionUnavailableReason> {
    if start.logical_offset == end.logical_offset {
        return Ok(Vec::new());
    }
    require_exact_text_coverage(runs, start.flow, start.logical_offset, end.logical_offset)?;
    let mut rects = Vec::new();
    for collected in runs {
        let RunTextMapping::Exact(slice) = &collected.run.text_mapping else {
            continue;
        };
        if !Arc::ptr_eq(&slice.flow, start.flow)
            || !ranges_intersect(
                start.logical_offset,
                end.logical_offset,
                slice.logical_start,
                slice.logical_end,
            )
        {
            continue;
        }
        rects.extend(range_rect_for_run(*collected, start, end)?);
    }
    Ok(rects)
}

fn require_exact_text_coverage(
    runs: &[CollectedTextRun<'_>],
    flow: &Arc<LogicalTextFlow>,
    start: u32,
    end: u32,
) -> Result<(), TextInteractionUnavailableReason> {
    let mut intervals = runs
        .iter()
        .filter_map(|collected| match &collected.run.text_mapping {
            RunTextMapping::Exact(slice) if Arc::ptr_eq(&slice.flow, flow) => {
                Some((start.max(slice.logical_start), end.min(slice.logical_end)))
            }
            RunTextMapping::Exact(_) | RunTextMapping::Unavailable(_) => None,
        })
        .filter(|(interval_start, interval_end)| interval_start < interval_end)
        .collect::<Vec<_>>();
    intervals.sort_unstable();

    let mut cursor = start;
    for (interval_start, interval_end) in intervals {
        require_ignorable_unpainted_text(flow, cursor, interval_start)?;
        cursor = cursor.max(interval_end);
    }
    require_ignorable_unpainted_text(flow, cursor, end)
}

fn require_ignorable_unpainted_text(
    flow: &LogicalTextFlow,
    start: u32,
    end: u32,
) -> Result<(), TextInteractionUnavailableReason> {
    if start >= end {
        return Ok(());
    }
    let Some(text) = flow.slice_utf16(start, end) else {
        return Err(TextInteractionUnavailableReason::InvalidCaret);
    };
    // Current layout producers omit source whitespace only at wrap and forced
    // break boundaries. A non-whitespace hole means a visible fragment lost
    // its exact mapping (for example, a discretionary-hyphen run).
    text.chars()
        .all(char::is_whitespace)
        .then_some(())
        .ok_or(TextInteractionUnavailableReason::SourceUnavailable)
}

fn range_rect_for_run(
    collected: CollectedTextRun<'_>,
    start: &ResolvedRunCaret<'_>,
    end: &ResolvedRunCaret<'_>,
) -> Result<Option<ExactTextRangeRect>, TextInteractionUnavailableReason> {
    let (slice, shape) = exact_run_parts(collected.run)?;
    if !collected.visual.supports_axis_aligned_interaction() {
        return Err(TextInteractionUnavailableReason::UnsupportedTransform);
    }
    let logical_start = start.logical_offset.max(slice.logical_start);
    let logical_end = end.logical_offset.min(slice.logical_end);
    if logical_start >= logical_end {
        return Ok(None);
    }
    let local_start = logical_start - slice.logical_start;
    let local_end = logical_end - slice.logical_start;
    let start_stop = endpoint_stop(collected, shape, local_start, logical_start, start)?;
    let end_stop = endpoint_stop(collected, shape, local_end, logical_end, end)?;
    let start_x = collected.x + f64::from(start_stop.visual_offset);
    let end_x = collected.x + f64::from(end_stop.visual_offset);
    let source_x = start_x.min(end_x);
    let source_width = (end_x - start_x).abs();
    let Some(bounds) = collected
        .visual
        .resolve_rect(crate::layout::VisualRect::new(
            source_x,
            collected.y,
            source_width,
            collected.run.height,
        ))
    else {
        return Ok(None);
    };
    Ok(Some(ExactTextRangeRect {
        page_index: collected.page_index,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        block_index: collected.block_index,
        line_index: collected.line_index,
        run_index: collected.run_index,
        start_char_index: local_start as usize,
        end_char_index: local_end as usize,
    }))
}

fn endpoint_stop(
    collected: CollectedTextRun<'_>,
    shape: &crate::layout::ExactRunShape,
    local_offset: u32,
    logical_offset: u32,
    endpoint: &ResolvedRunCaret<'_>,
) -> Result<crate::layout::RunShapeCaretStop, TextInteractionUnavailableReason> {
    if logical_offset == endpoint.logical_offset && collected.matches_address(endpoint.address) {
        Ok(endpoint.stop)
    } else {
        stop_at(shape, local_offset)
    }
}

fn ranges_intersect(left_start: u32, left_end: u32, right_start: u32, right_end: u32) -> bool {
    left_start < right_end && right_start < left_end
}
