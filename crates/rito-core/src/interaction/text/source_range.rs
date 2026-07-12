use crate::layout::{LayoutRuntimePage, LogicalTextSource, RunShapeCaretAffinity, RunTextMapping};

use super::{
    caret::exact_run_parts,
    collect::{collect_text_runs_in_page_range, CollectedTextRun},
    range::resolve_same_flow_text_range,
    LayoutExactTextRangeResolution, LayoutSourcePoint, TextCaretAddress, TextCaretAffinity,
    TextInteractionUnavailableReason,
};

/// Resolves one durable source range against retained exact shapes. Source
/// boundaries are never interpolated: both endpoints must coincide with real
/// shaped cluster edges in one logical flow.
pub(crate) fn resolve_exact_source_range(
    pages: &[LayoutRuntimePage],
    first_page: usize,
    last_page: usize,
    start: &LayoutSourcePoint,
    end: &LayoutSourcePoint,
) -> LayoutExactTextRangeResolution {
    let runs = collect_text_runs_in_page_range(pages, first_page, last_page);
    let starts = match source_boundary_addresses(&runs, start) {
        Ok(addresses) => addresses,
        Err(reason) => return LayoutExactTextRangeResolution::Unavailable(reason),
    };
    let ends = match source_boundary_addresses(&runs, end) {
        Ok(addresses) => addresses,
        Err(reason) => return LayoutExactTextRangeResolution::Unavailable(reason),
    };

    let mut fallback = TextInteractionUnavailableReason::DifferentLogicalFlow;
    // A start boundary belongs to the following run; an end boundary belongs
    // to the preceding run. This also selects downstream/upstream bidi carets
    // deterministically when one logical boundary has two visual positions.
    for start_address in starts.iter().rev().copied() {
        for end_address in ends.iter().copied() {
            match resolve_same_flow_text_range(pages, start_address, end_address) {
                LayoutExactTextRangeResolution::Resolved(range)
                    if range.source_start == *start && range.source_end == *end =>
                {
                    return LayoutExactTextRangeResolution::Resolved(range);
                }
                LayoutExactTextRangeResolution::Resolved(_) => {}
                LayoutExactTextRangeResolution::Unavailable(reason) => {
                    if reason != TextInteractionUnavailableReason::DifferentLogicalFlow {
                        fallback = reason;
                    }
                }
            }
        }
    }
    LayoutExactTextRangeResolution::Unavailable(fallback)
}

fn source_boundary_addresses(
    runs: &[CollectedTextRun<'_>],
    point: &LayoutSourcePoint,
) -> Result<Vec<TextCaretAddress>, TextInteractionUnavailableReason> {
    let mut addresses = Vec::new();
    let mut matching_failure = None;
    for run in runs {
        if source_run_contains(*run, point)
            && !matches!(run.run.text_mapping, RunTextMapping::Exact(_))
        {
            matching_failure.get_or_insert(TextInteractionUnavailableReason::SourceUnavailable);
        }
        let RunTextMapping::Exact(slice) = &run.run.text_mapping else {
            continue;
        };
        let Some(logical_offset) = source_logical_offset(slice, point) else {
            continue;
        };
        let (_, shape) = match exact_run_parts(run.run) {
            Ok(parts) => parts,
            Err(reason) => {
                matching_failure.get_or_insert(reason);
                continue;
            }
        };
        let local_offset = logical_offset - slice.logical_start;
        let mut found_stop = false;
        for stop in shape
            .caret_stops()
            .into_iter()
            .filter(|stop| stop.logical_offset == local_offset)
        {
            found_stop = true;
            addresses.push(TextCaretAddress {
                page_index: run.page_index,
                block_index: run.block_index,
                line_index: run.line_index,
                run_index: run.run_index,
                char_index: local_offset as usize,
                affinity: caret_affinity(stop.affinity),
            });
        }
        if !found_stop {
            matching_failure.get_or_insert(TextInteractionUnavailableReason::InvalidCaret);
        }
    }
    addresses.sort_unstable_by_key(|address| address_key(*address));
    addresses.dedup();
    if addresses.is_empty() {
        Err(matching_failure.unwrap_or(TextInteractionUnavailableReason::SourceUnavailable))
    } else {
        Ok(addresses)
    }
}

fn source_logical_offset(
    slice: &crate::layout::TextFlowSlice,
    point: &LayoutSourcePoint,
) -> Option<u32> {
    let span = slice.flow.spans().get(slice.span_index as usize)?;
    let LogicalTextSource::ExactLinear {
        node_path,
        source_start,
    } = &span.source
    else {
        return None;
    };
    if node_path.as_ref() != point.node_path || point.text_offset < *source_start {
        return None;
    }
    let relative = u32::try_from(point.text_offset - source_start).ok()?;
    let logical_offset = span.logical_start.checked_add(relative)?;
    (logical_offset >= slice.logical_start && logical_offset <= slice.logical_end)
        .then_some(logical_offset)
}

fn source_run_contains(run: CollectedTextRun<'_>, point: &LayoutSourcePoint) -> bool {
    let Some(path) = run.run.source_path.as_deref() else {
        return false;
    };
    if path != point.node_path {
        return false;
    }
    let start = run.run.source_text_offset.unwrap_or(0);
    let end = start.saturating_add(run.run.text.encode_utf16().count());
    point.text_offset >= start && point.text_offset <= end
}

fn address_key(address: TextCaretAddress) -> (usize, usize, usize, usize, usize, usize) {
    (
        address.page_index,
        address.block_index,
        address.line_index,
        address.run_index,
        address.char_index,
        match address.affinity {
            TextCaretAffinity::Upstream => 0,
            TextCaretAffinity::Downstream => 1,
        },
    )
}

fn caret_affinity(affinity: RunShapeCaretAffinity) -> TextCaretAffinity {
    match affinity {
        RunShapeCaretAffinity::Upstream => TextCaretAffinity::Upstream,
        RunShapeCaretAffinity::Downstream => TextCaretAffinity::Downstream,
    }
}
