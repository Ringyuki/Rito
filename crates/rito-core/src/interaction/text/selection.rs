use std::{collections::HashSet, sync::Arc};

use crate::layout::{LogicalTextFlow, LogicalTextSource};

use super::{
    caret::{exact_run_parts, ResolvedRunCaret},
    collect::CollectedTextRun,
    TextCaretAddress, TextInteractionUnavailableReason,
};

#[derive(Clone, Copy)]
pub(super) struct SelectedFlow<'a> {
    pub(super) flow: &'a Arc<LogicalTextFlow>,
    pub(super) start: u32,
    pub(super) end: u32,
    semantic_tag: Option<&'a str>,
}

pub(super) struct SelectedText {
    pub(super) host_text: String,
    pub(super) exact_source_segments: Vec<String>,
}

pub(super) fn collect_selected_flows<'a>(
    runs: &'a [CollectedTextRun<'a>],
    start: &ResolvedRunCaret<'a>,
    end: &ResolvedRunCaret<'a>,
) -> Result<Vec<SelectedFlow<'a>>, TextInteractionUnavailableReason> {
    if Arc::ptr_eq(start.flow, end.flow) {
        let semantic_tag = runs
            .iter()
            .find(|run| run.matches_address(start.address))
            .and_then(|run| run.semantic_tag);
        return Ok(vec![SelectedFlow {
            flow: start.flow,
            start: start.logical_offset,
            end: end.logical_offset,
            semantic_tag,
        }]);
    }
    let start_index = endpoint_run_index(runs, start.address)?;
    let end_index = endpoint_run_index(runs, end.address)?;
    if start_index > end_index {
        return Err(TextInteractionUnavailableReason::InvalidCaret);
    }
    collect_distinct_flows(&runs[start_index..=end_index], start, end)
}

pub(super) fn collect_selected_text(
    selected: &[SelectedFlow<'_>],
) -> Result<SelectedText, TextInteractionUnavailableReason> {
    let mut host_text = String::new();
    let mut exact_source_segments = Vec::with_capacity(selected.len());
    for (index, flow) in selected.iter().enumerate() {
        if !range_has_exact_source(flow.flow, flow.start, flow.end) {
            return Err(TextInteractionUnavailableReason::SourceUnavailable);
        }
        let slice = flow
            .flow
            .slice_utf16(flow.start, flow.end)
            .ok_or(TextInteractionUnavailableReason::InvalidCaret)?;
        if let Some(previous) = index.checked_sub(1).and_then(|index| selected.get(index)) {
            host_text.push_str(native_flow_separator(
                previous.semantic_tag,
                flow.semantic_tag,
            ));
        }
        host_text.push_str(slice);
        exact_source_segments.push(slice.to_owned());
    }
    Ok(SelectedText {
        host_text,
        exact_source_segments,
    })
}

fn endpoint_run_index(
    runs: &[CollectedTextRun<'_>],
    address: TextCaretAddress,
) -> Result<usize, TextInteractionUnavailableReason> {
    runs.iter()
        .position(|run| run.matches_address(address))
        .ok_or(TextInteractionUnavailableReason::InvalidCaret)
}

fn collect_distinct_flows<'a>(
    runs: &'a [CollectedTextRun<'a>],
    start: &ResolvedRunCaret<'a>,
    end: &ResolvedRunCaret<'a>,
) -> Result<Vec<SelectedFlow<'a>>, TextInteractionUnavailableReason> {
    let mut selected = Vec::<SelectedFlow<'a>>::new();
    let mut seen = HashSet::new();
    for run in runs {
        let (slice, _) = exact_run_parts(run.run)?;
        if selected
            .last()
            .is_some_and(|current| Arc::ptr_eq(current.flow, &slice.flow))
        {
            continue;
        }
        if !seen.insert(Arc::as_ptr(&slice.flow)) {
            return Err(TextInteractionUnavailableReason::InvalidCaret);
        }
        selected.push(SelectedFlow {
            flow: &slice.flow,
            start: if Arc::ptr_eq(&slice.flow, start.flow) {
                start.logical_offset
            } else {
                0
            },
            end: if Arc::ptr_eq(&slice.flow, end.flow) {
                end.logical_offset
            } else {
                flow_end(&slice.flow)
            },
            semantic_tag: run.semantic_tag,
        });
    }
    let endpoints_match = selected
        .first()
        .is_some_and(|flow| Arc::ptr_eq(flow.flow, start.flow))
        && selected
            .last()
            .is_some_and(|flow| Arc::ptr_eq(flow.flow, end.flow));
    endpoints_match
        .then_some(selected)
        .ok_or(TextInteractionUnavailableReason::InvalidCaret)
}

fn flow_end(flow: &LogicalTextFlow) -> u32 {
    flow.spans().last().map_or(0, |span| span.logical_end)
}

fn range_has_exact_source(flow: &LogicalTextFlow, start: u32, end: u32) -> bool {
    flow.spans().iter().all(|span| {
        !ranges_intersect(start, end, span.logical_start, span.logical_end)
            || matches!(span.source, LogicalTextSource::ExactLinear { .. })
    })
}

fn native_flow_separator(previous: Option<&str>, current: Option<&str>) -> &'static str {
    if previous.is_some_and(|tag| tag.eq_ignore_ascii_case("p"))
        && current.is_some_and(|tag| tag.eq_ignore_ascii_case("p"))
    {
        "\n\n"
    } else {
        // Other retained block semantics conservatively preserve one visible
        // boundary. Lists, headings and table cells need their own DOM oracle
        // matrix before this policy becomes more specific.
        "\n"
    }
}

fn ranges_intersect(left_start: u32, left_end: u32, right_start: u32, right_end: u32) -> bool {
    left_start < right_end && right_start < left_end
}
