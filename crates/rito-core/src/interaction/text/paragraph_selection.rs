use std::sync::Arc;

use crate::layout::{LogicalTextFlow, LogicalTextSource, RunTextMapping, TextFlowSlice};

use super::{
    caret::exact_run_parts, collect::CollectedTextRun, selection::native_flow_separator,
    TextInteractionUnavailableReason,
};

pub(super) fn paragraph_bounds(
    runs: &[CollectedTextRun<'_>],
    flow: &LogicalTextFlow,
) -> Result<(u32, u32), TextInteractionUnavailableReason> {
    let owned = runs
        .iter()
        .filter(|run| run_owns_flow(run, flow))
        .collect::<Vec<_>>();
    let Some(first_run) = owned.first() else {
        return Err(TextInteractionUnavailableReason::SourceUnavailable);
    };
    let owned_blocks = owned
        .iter()
        .map(|run| run.block_identity())
        .collect::<std::collections::HashSet<_>>();
    for run in runs {
        if owned_blocks.contains(&run.block_identity()) && !run_owns_flow(run, flow) {
            return Err(TextInteractionUnavailableReason::SourceUnavailable);
        }
    }
    let first = run_slice(first_run).expect("owned flow run has exact mapping");
    let mut start = first.logical_start;
    let mut end = first.logical_end;
    for run in owned {
        exact_run_parts(run.run)?;
        let slice = run_slice(run).expect("owned flow run has exact mapping");
        start = start.min(slice.logical_start);
        end = end.max(slice.logical_end);
    }
    require_trimmed_outer_gap(flow, 0, start)?;
    require_trimmed_outer_gap(flow, end, flow_end(flow))?;
    Ok((start, end))
}

pub(super) fn paragraph_trailing_separator(
    runs: &[CollectedTextRun<'_>],
    flow: &LogicalTextFlow,
) -> Result<Option<&'static str>, TextInteractionUnavailableReason> {
    let last_current = runs
        .iter()
        .rposition(|run| run_owns_flow(run, flow))
        .ok_or(TextInteractionUnavailableReason::SourceUnavailable)?;
    let current_tag = runs[last_current].semantic_tag;
    let current_block = runs[last_current].block_identity();
    let Some(run) = runs.get(last_current + 1) else {
        return Ok(None);
    };
    if run.block_identity() == current_block {
        return Err(TextInteractionUnavailableReason::SourceUnavailable);
    }
    Ok(Some(native_flow_separator(current_tag, run.semantic_tag)))
}

fn run_owns_flow(run: &CollectedTextRun<'_>, flow: &LogicalTextFlow) -> bool {
    run_slice(run).is_some_and(|slice| std::ptr::eq(Arc::as_ptr(&slice.flow), flow))
}

fn run_slice<'a>(run: &'a CollectedTextRun<'a>) -> Option<&'a TextFlowSlice> {
    match &run.run.text_mapping {
        RunTextMapping::Exact(slice) => Some(slice),
        RunTextMapping::Unavailable(_) => None,
    }
}

fn require_trimmed_outer_gap(
    flow: &LogicalTextFlow,
    start: u32,
    end: u32,
) -> Result<(), TextInteractionUnavailableReason> {
    if start >= end {
        return Ok(());
    }
    let exact = flow.spans().iter().all(|span| {
        !ranges_intersect(start, end, span.logical_start, span.logical_end)
            || matches!(span.source, LogicalTextSource::ExactLinear { .. })
    });
    let collapsible = flow
        .slice_utf16(start, end)
        .is_some_and(|text| text.chars().all(is_html_collapsible_whitespace));
    (exact && collapsible)
        .then_some(())
        .ok_or(TextInteractionUnavailableReason::SourceUnavailable)
}

fn flow_end(flow: &LogicalTextFlow) -> u32 {
    flow.spans().last().map_or(0, |span| span.logical_end)
}

fn is_html_collapsible_whitespace(character: char) -> bool {
    matches!(character, '\t' | '\n' | '\u{000C}' | '\r' | ' ')
}

fn ranges_intersect(left_start: u32, left_end: u32, right_start: u32, right_end: u32) -> bool {
    left_start < right_end && right_start < left_end
}
