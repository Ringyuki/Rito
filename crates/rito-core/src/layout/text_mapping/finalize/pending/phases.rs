use std::sync::Arc;

use super::{require_unit, FlowAssignment, FlowCounts, FlowDraft, Transition};
use crate::layout::{
    inline_segment::InlineSegment,
    text_mapping::{
        finalize::unavailable_reason, LogicalTextFlow, RunTextMapping, TextFlowSlice,
        TextMappingUnavailableReason, TextSegmentMapping,
    },
    text_work::{TextWorkMeter, TextWorkYield},
};

#[derive(Debug)]
pub(super) struct PendingReserve {
    counts: FlowCounts,
    draft: Option<FlowDraft>,
    step: ReserveStep,
}

#[derive(Debug, Clone, Copy)]
enum ReserveStep {
    Text,
    NonBoundaries,
    Spans,
    Assignments,
}

impl PendingReserve {
    pub(super) fn new(counts: FlowCounts) -> Self {
        Self {
            counts,
            draft: Some(FlowDraft {
                expected: counts,
                ..FlowDraft::default()
            }),
            step: ReserveStep::Text,
        }
    }

    pub(super) fn advance(
        &mut self,
        work: &mut TextWorkMeter,
    ) -> Result<Transition, TextWorkYield> {
        require_unit(work)?;
        let draft = self.draft.as_mut().expect("reserve draft is owned");
        let result = match self.step {
            ReserveStep::Text => draft.text.try_reserve_exact(self.counts.text_bytes),
            ReserveStep::NonBoundaries => draft
                .non_boundaries
                .try_reserve_exact(self.counts.non_boundaries),
            ReserveStep::Spans => draft.spans.try_reserve_exact(self.counts.candidate_count),
            ReserveStep::Assignments => draft
                .assignments
                .try_reserve_exact(self.counts.candidate_count),
        };
        if result.is_err() {
            return Ok(Transition::Fail);
        }
        if matches!(self.step, ReserveStep::Assignments) {
            return Ok(Transition::Assemble(
                self.draft.take().expect("reserve draft is owned"),
            ));
        }
        self.step = self.step.next();
        Ok(Transition::Stay)
    }
}

impl ReserveStep {
    const fn next(self) -> Self {
        match self {
            Self::Text => Self::NonBoundaries,
            Self::NonBoundaries => Self::Spans,
            Self::Spans => Self::Assignments,
            Self::Assignments => Self::Assignments,
        }
    }
}

pub(super) fn seal_flow(
    draft: &mut Option<FlowDraft>,
    work: &mut TextWorkMeter,
) -> Result<Transition, TextWorkYield> {
    require_unit(work)?;
    let mut draft = draft.take().expect("flow draft is owned");
    assert_completed_draft(&draft);
    let assignments = std::mem::take(&mut draft.assignments);
    let flow = Arc::new(LogicalTextFlow {
        text: draft.text.into_boxed_str(),
        utf16_len: draft.utf16_len,
        non_boundaries: draft.non_boundaries.into_boxed_slice(),
        spans: draft.spans.into_boxed_slice(),
    });
    Ok(Transition::Commit(PendingCommit {
        flow,
        assignments: assignments.into_iter(),
    }))
}

fn assert_completed_draft(draft: &FlowDraft) {
    debug_assert_eq!(draft.text.len(), draft.expected.text_bytes);
    debug_assert_eq!(draft.utf16_len, draft.expected.utf16_len);
    debug_assert_eq!(draft.non_boundaries.len(), draft.expected.non_boundaries);
    debug_assert_eq!(draft.spans.len(), draft.expected.candidate_count);
    debug_assert_eq!(draft.assignments.len(), draft.expected.candidate_count);
    debug_assert!(draft.text.capacity() >= draft.text.len());
    debug_assert!(draft.non_boundaries.capacity() >= draft.non_boundaries.len());
    debug_assert!(draft.spans.capacity() >= draft.spans.len());
    debug_assert!(draft.assignments.capacity() >= draft.assignments.len());
}

#[derive(Debug)]
pub(super) struct PendingCommit {
    flow: Arc<LogicalTextFlow>,
    assignments: std::vec::IntoIter<FlowAssignment>,
}

impl PendingCommit {
    pub(super) fn advance(
        &mut self,
        segments: &mut [InlineSegment],
        work: &mut TextWorkMeter,
    ) -> Result<bool, TextWorkYield> {
        let Some(assignment) = self.assignments.as_slice().first().copied() else {
            return Ok(true);
        };
        require_unit(work)?;
        self.assignments.next();
        assign_segment_mapping(segments, &self.flow, assignment);
        Ok(self.assignments.as_slice().is_empty())
    }
}

#[derive(Debug, Default)]
pub(super) struct PendingFailure {
    segment_index: usize,
}

impl PendingFailure {
    pub(super) fn advance(
        &mut self,
        segments: &mut [InlineSegment],
        work: &mut TextWorkMeter,
    ) -> Result<bool, TextWorkYield> {
        if self.segment_index == segments.len() {
            return Ok(true);
        }
        require_unit(work)?;
        mark_candidate_too_long(&mut segments[self.segment_index]);
        self.segment_index += 1;
        Ok(self.segment_index == segments.len())
    }
}

fn mark_candidate_too_long(segment: &mut InlineSegment) {
    let Some(segment) = segment.as_text_mut() else {
        return;
    };
    if matches!(segment.mapping, TextSegmentMapping::Candidate(_)) {
        segment.mapping = TextSegmentMapping::Resolved(RunTextMapping::Unavailable(
            TextMappingUnavailableReason::FlowTooLong,
        ));
    }
}

fn assign_segment_mapping(
    segments: &mut [InlineSegment],
    flow: &Arc<LogicalTextFlow>,
    assignment: FlowAssignment,
) {
    let segment = segments[assignment.segment_index]
        .as_text_mut()
        .expect("flow assignment must reference text");
    let mapping = if assignment.exact {
        RunTextMapping::Exact(TextFlowSlice {
            flow: Arc::clone(flow),
            span_index: assignment.span_index,
            logical_start: assignment.logical_start,
            logical_end: assignment.logical_end,
        })
    } else {
        let span = &flow.spans[assignment.span_index as usize];
        RunTextMapping::Unavailable(unavailable_reason(&span.source))
    };
    segment.mapping = TextSegmentMapping::Resolved(mapping);
}
