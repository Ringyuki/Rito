use std::{collections::HashMap, sync::Arc};

use crate::layout::{LayoutRuntimePage, LogicalTextFlow, RunTextMapping};

use super::{
    caret::{exact_run_parts, resolve_address, stop_at, ResolvedRunCaret},
    collect::{collect_text_runs_in_page_range, CollectedTextRun},
    selection::{collect_selected_flows, collect_selected_text, SelectedFlow},
    ExactTextRangeRect, LayoutExactTextRange, LayoutExactTextRangeResolution, TextCaretAddress,
    TextInteractionUnavailableReason,
};

pub(crate) fn resolve_text_range(
    pages: &[LayoutRuntimePage],
    anchor_address: TextCaretAddress,
    focus_address: TextCaretAddress,
) -> LayoutExactTextRangeResolution {
    let first_page = anchor_address.page_index.min(focus_address.page_index);
    let last_page = anchor_address.page_index.max(focus_address.page_index);
    let runs = collect_text_runs_in_page_range(pages, first_page, last_page);
    let anchor = match resolve_address(&runs, anchor_address) {
        Ok(caret) => caret,
        Err(reason) => return LayoutExactTextRangeResolution::Unavailable(reason),
    };
    let focus = match resolve_address(&runs, focus_address) {
        Ok(caret) => caret,
        Err(reason) => return LayoutExactTextRangeResolution::Unavailable(reason),
    };
    let (start, end) = normalize_endpoints(&anchor, &focus);
    let selected_flows = match collect_selected_flows(&runs, start, end) {
        Ok(flows) => flows,
        Err(reason) => return LayoutExactTextRangeResolution::Unavailable(reason),
    };
    let selected_text = match collect_selected_text(&selected_flows) {
        Ok(text) => text,
        Err(reason) => return LayoutExactTextRangeResolution::Unavailable(reason),
    };
    let rects = match range_rects(&runs, &selected_flows, start, end) {
        Ok(rects) => rects,
        Err(reason) => return LayoutExactTextRangeResolution::Unavailable(reason),
    };
    LayoutExactTextRangeResolution::Resolved(Box::new(LayoutExactTextRange {
        anchor: anchor_address,
        focus: focus_address,
        start: start.address,
        end: end.address,
        selected_text: selected_text.host_text,
        exact_source_segments: selected_text.exact_source_segments,
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
    if Arc::ptr_eq(left.flow, right.flow) {
        left.logical_offset < right.logical_offset
            || (left.logical_offset == right.logical_offset
                && address_key(left.address) < address_key(right.address))
    } else {
        address_key(left.address) < address_key(right.address)
    }
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

fn range_rects(
    runs: &[CollectedTextRun<'_>],
    selected: &[SelectedFlow<'_>],
    start: &ResolvedRunCaret<'_>,
    end: &ResolvedRunCaret<'_>,
) -> Result<Vec<ExactTextRangeRect>, TextInteractionUnavailableReason> {
    let selected_by_flow = selected
        .iter()
        .map(|flow| (Arc::as_ptr(flow.flow), *flow))
        .collect::<HashMap<_, _>>();
    let mut intervals_by_flow = HashMap::<*const LogicalTextFlow, Vec<(u32, u32)>>::new();
    let mut rects = Vec::new();
    for collected in runs {
        let RunTextMapping::Exact(slice) = &collected.run.text_mapping else {
            continue;
        };
        let Some(flow) = selected_by_flow.get(&Arc::as_ptr(&slice.flow)).copied() else {
            continue;
        };
        if ranges_intersect(flow.start, flow.end, slice.logical_start, slice.logical_end) {
            intervals_by_flow
                .entry(Arc::as_ptr(&slice.flow))
                .or_default()
                .push((
                    flow.start.max(slice.logical_start),
                    flow.end.min(slice.logical_end),
                ));
            rects.extend(range_rect_for_run(*collected, flow, start, end)?);
        }
    }
    for flow in selected {
        require_exact_text_coverage(
            flow.flow,
            flow.start,
            flow.end,
            intervals_by_flow
                .remove(&Arc::as_ptr(flow.flow))
                .unwrap_or_default(),
        )?;
    }
    Ok(rects)
}

fn require_exact_text_coverage(
    flow: &Arc<LogicalTextFlow>,
    start: u32,
    end: u32,
    mut intervals: Vec<(u32, u32)>,
) -> Result<(), TextInteractionUnavailableReason> {
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
        .all(is_html_collapsible_whitespace)
        .then_some(())
        .ok_or(TextInteractionUnavailableReason::SourceUnavailable)
}

fn is_html_collapsible_whitespace(character: char) -> bool {
    matches!(character, '\t' | '\n' | '\u{000C}' | '\r' | ' ')
}

fn range_rect_for_run(
    collected: CollectedTextRun<'_>,
    selected: SelectedFlow<'_>,
    start: &ResolvedRunCaret<'_>,
    end: &ResolvedRunCaret<'_>,
) -> Result<Option<ExactTextRangeRect>, TextInteractionUnavailableReason> {
    let (slice, shape) = exact_run_parts(collected.run)?;
    if !collected.visual.supports_axis_aligned_interaction() {
        return Err(TextInteractionUnavailableReason::UnsupportedTransform);
    }
    let logical_start = selected.start.max(slice.logical_start);
    let logical_end = selected.end.min(slice.logical_end);
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
    let (source_y, source_height) = collected.interaction_vertical_bounds();
    let Some(bounds) = collected
        .visual
        .resolve_rect(crate::layout::VisualRect::new(
            source_x,
            source_y,
            source_width,
            source_height,
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
