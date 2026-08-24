use std::sync::Arc;

use super::super::{
    utf16, LogicalTextFlow, LogicalTextSource, LogicalTextSpan, RunTextMapping, TextFlowSlice,
    TextMappingCandidate, TextMappingCandidateSource, TextMappingUnavailableReason,
    TextSegmentMapping,
};
use super::unavailable_reason;
use crate::layout::inline_segment::InlineSegment;

pub(crate) fn finalize_inline_text_flow(segments: &mut [InlineSegment]) {
    finalize_with_limits(segments, FlowLimits::production());
}

fn finalize_with_limits(segments: &mut [InlineSegment], limits: FlowLimits) {
    let draft = match build_flow_draft(segments, limits) {
        Ok(Some(draft)) => draft,
        Ok(None) => return,
        Err(()) => {
            mark_flow_too_long(segments);
            return;
        }
    };
    let flow = Arc::new(LogicalTextFlow {
        text: draft.text.into_boxed_str(),
        utf16_len: draft.utf16_len,
        non_boundaries: draft.non_boundaries.into_boxed_slice(),
        spans: draft.spans.into_boxed_slice(),
    });
    debug_assert!(flow.validate().is_ok());
    for assignment in draft.assignments {
        assign_segment_mapping(segments, &flow, assignment);
    }
}

#[cfg(test)]
pub(super) fn finalize_inline_text_flow_with_limits(
    segments: &mut [InlineSegment],
    max_utf16_len: u32,
    max_span_index: u32,
) {
    finalize_with_limits(
        segments,
        FlowLimits {
            max_utf16_len,
            max_span_index,
        },
    );
}

#[derive(Clone, Copy)]
struct FlowLimits {
    max_utf16_len: u32,
    max_span_index: u32,
}

impl FlowLimits {
    const fn production() -> Self {
        Self {
            max_utf16_len: u32::MAX,
            max_span_index: u32::MAX,
        }
    }
}

struct FlowDraft {
    text: String,
    utf16_len: u32,
    non_boundaries: Vec<u32>,
    spans: Vec<LogicalTextSpan>,
    assignments: Vec<FlowAssignment>,
}

#[derive(Clone, Copy)]
struct FlowAssignment {
    segment_index: usize,
    span_index: u32,
    logical_start: u32,
    logical_end: u32,
    exact: bool,
}

fn build_flow_draft(
    segments: &[InlineSegment],
    limits: FlowLimits,
) -> Result<Option<FlowDraft>, ()> {
    let mut draft = FlowDraft {
        text: String::new(),
        utf16_len: 0,
        non_boundaries: Vec::new(),
        spans: Vec::new(),
        assignments: Vec::new(),
    };
    for (segment_index, segment) in segments.iter().enumerate() {
        let InlineSegment::Text(segment) = segment else {
            continue;
        };
        let TextSegmentMapping::Candidate(candidate) = &segment.mapping else {
            continue;
        };
        push_candidate(&mut draft, segment_index, candidate, limits)?;
    }
    Ok((!draft.spans.is_empty()).then_some(draft))
}

fn push_candidate(
    draft: &mut FlowDraft,
    segment_index: usize,
    candidate: &TextMappingCandidate,
    limits: FlowLimits,
) -> Result<(), ()> {
    let logical_start = draft.utf16_len;
    let logical_end = utf16::append_metadata(
        candidate.logical_text(),
        logical_start,
        &mut draft.non_boundaries,
    )?;
    if logical_end > limits.max_utf16_len {
        return Err(());
    }
    if let TextMappingCandidateSource::ExactLinear { source_start, .. } = candidate.source() {
        let span_len = (logical_end - logical_start) as usize;
        source_start.checked_add(span_len).ok_or(())?;
    }
    let span_index = u32::try_from(draft.spans.len()).map_err(|_| ())?;
    if span_index > limits.max_span_index {
        return Err(());
    }
    let source = resolved_source(candidate.source());
    let exact = matches!(source, LogicalTextSource::ExactLinear { .. });
    draft.text.push_str(candidate.logical_text());
    draft.utf16_len = logical_end;
    draft.spans.push(LogicalTextSpan {
        logical_start,
        logical_end,
        source,
    });
    draft.assignments.push(FlowAssignment {
        segment_index,
        span_index,
        logical_start,
        logical_end,
        exact,
    });
    Ok(())
}

fn resolved_source(source: &TextMappingCandidateSource) -> LogicalTextSource {
    match source {
        TextMappingCandidateSource::ExactLinear {
            node_path,
            source_start,
        } => LogicalTextSource::ExactLinear {
            node_path: node_path.clone().into_boxed_slice(),
            source_start: *source_start,
        },
        TextMappingCandidateSource::Unavailable(reason) => LogicalTextSource::Unavailable(*reason),
    }
}

fn assign_segment_mapping(
    segments: &mut [InlineSegment],
    flow: &Arc<LogicalTextFlow>,
    assignment: FlowAssignment,
) {
    let segment = segments[assignment.segment_index]
        .as_text_mut()
        .expect("flow assignment must reference a text segment");
    let mapping = if assignment.exact {
        let slice = TextFlowSlice {
            flow: Arc::clone(flow),
            span_index: assignment.span_index,
            logical_start: assignment.logical_start,
            logical_end: assignment.logical_end,
        };
        debug_assert!(slice.validate().is_ok());
        RunTextMapping::Exact(slice)
    } else {
        let span = &flow.spans[assignment.span_index as usize];
        RunTextMapping::Unavailable(unavailable_reason(&span.source))
    };
    segment.mapping = TextSegmentMapping::Resolved(mapping);
}

fn mark_flow_too_long(segments: &mut [InlineSegment]) {
    for segment in segments.iter_mut().filter_map(InlineSegment::as_text_mut) {
        if matches!(segment.mapping, TextSegmentMapping::Candidate(_)) {
            segment.mapping = TextSegmentMapping::Resolved(RunTextMapping::Unavailable(
                TextMappingUnavailableReason::FlowTooLong,
            ));
        }
    }
}
