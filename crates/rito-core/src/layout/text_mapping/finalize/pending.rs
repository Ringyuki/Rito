use super::super::LogicalTextSpan;
use crate::layout::{
    inline_segment::InlineSegment,
    text_work::{TextWorkMeter, TextWorkYield},
};

mod assembly;
mod phases;
mod preflight;

use assembly::PendingAssembly;
use phases::{seal_flow, PendingCommit, PendingFailure, PendingReserve};
use preflight::{PendingPreflight, PreflightOutcome};

/// Owns its segments so a yielded finalization can never expose a partial
/// successful commit or a partial `FlowTooLong` failure.
#[derive(Debug)]
pub(crate) struct PendingInlineTextFlowFinalizer {
    segments: Option<Vec<InlineSegment>>,
    phase: Phase,
    limits: FlowLimits,
}

impl PendingInlineTextFlowFinalizer {
    pub(crate) fn new(segments: Vec<InlineSegment>) -> Self {
        Self::with_limits(segments, FlowLimits::production())
    }

    fn with_limits(segments: Vec<InlineSegment>, limits: FlowLimits) -> Self {
        Self {
            segments: Some(segments),
            phase: Phase::Preflight(PendingPreflight::default()),
            limits,
        }
    }

    pub(crate) fn advance(
        &mut self,
        work: &mut TextWorkMeter,
    ) -> Result<Vec<InlineSegment>, TextWorkYield> {
        assert!(self.segments.is_some(), "completed text flow cannot resume");
        loop {
            let transition = self.advance_phase(work)?;
            match transition {
                Transition::Stay => {}
                Transition::Reserve(counts) => {
                    self.phase = Phase::Reserve(PendingReserve::new(counts));
                }
                Transition::Assemble(draft) => {
                    self.phase = Phase::Assemble(PendingAssembly::new(draft));
                }
                Transition::Seal(draft) => self.phase = Phase::Seal(Some(draft)),
                Transition::Commit(commit) => self.phase = Phase::Commit(commit),
                Transition::Fail => self.phase = Phase::Fail(PendingFailure::default()),
                Transition::Return => {
                    self.phase = Phase::Returned;
                    return Ok(self.segments.take().expect("segments are owned"));
                }
            }
        }
    }

    fn advance_phase(&mut self, work: &mut TextWorkMeter) -> Result<Transition, TextWorkYield> {
        let segments = self.segments.as_mut().expect("segments are owned");
        match &mut self.phase {
            Phase::Preflight(state) => match state.advance(segments, self.limits, work)? {
                PreflightOutcome::Complete(counts) if counts.candidate_count == 0 => {
                    Ok(Transition::Return)
                }
                PreflightOutcome::Complete(counts) => Ok(Transition::Reserve(counts)),
                PreflightOutcome::TooLong => Ok(Transition::Fail),
            },
            Phase::Reserve(state) => state.advance(work),
            Phase::Assemble(state) => {
                state.advance(segments, work)?;
                if state.is_complete() {
                    Ok(Transition::Seal(state.take_draft()))
                } else {
                    Ok(Transition::Stay)
                }
            }
            Phase::Seal(draft) => seal_flow(draft, work),
            Phase::Commit(state) => Ok(if state.advance(segments, work)? {
                Transition::Return
            } else {
                Transition::Stay
            }),
            Phase::Fail(state) => Ok(if state.advance(segments, work)? {
                Transition::Return
            } else {
                Transition::Stay
            }),
            Phase::Returned => panic!("completed text flow cannot resume"),
        }
    }

    #[cfg(test)]
    pub(super) fn with_test_limits(
        segments: Vec<InlineSegment>,
        max_utf16_len: u32,
        max_span_index: u32,
    ) -> Self {
        Self::with_limits(
            segments,
            FlowLimits {
                max_utf16_len,
                max_span_index,
            },
        )
    }
}

#[derive(Debug)]
enum Phase {
    Preflight(PendingPreflight),
    Reserve(PendingReserve),
    Assemble(PendingAssembly),
    Seal(Option<FlowDraft>),
    Commit(PendingCommit),
    Fail(PendingFailure),
    Returned,
}

enum Transition {
    Stay,
    Reserve(FlowCounts),
    Assemble(FlowDraft),
    Seal(FlowDraft),
    Commit(PendingCommit),
    Fail,
    Return,
}

#[derive(Debug, Clone, Copy, Default)]
struct FlowCounts {
    text_bytes: usize,
    utf16_len: u32,
    non_boundaries: usize,
    candidate_count: usize,
}

#[derive(Debug, Clone, Copy)]
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

#[derive(Debug, Default)]
struct FlowDraft {
    expected: FlowCounts,
    text: String,
    utf16_len: u32,
    non_boundaries: Vec<u32>,
    spans: Vec<LogicalTextSpan>,
    assignments: Vec<FlowAssignment>,
}

#[derive(Debug, Clone, Copy)]
struct FlowAssignment {
    segment_index: usize,
    span_index: u32,
    logical_start: u32,
    logical_end: u32,
    exact: bool,
}

fn require_unit(work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
    if work.take_utf16_units(1) == 1 {
        Ok(())
    } else {
        Err(TextWorkYield)
    }
}

#[derive(Debug)]
struct PendingScalar {
    character: char,
    utf8_len: usize,
    utf16_len: usize,
    utf16_units_remaining: usize,
}

impl PendingScalar {
    fn at(text: &str, byte_cursor: usize) -> Self {
        let character = text[byte_cursor..]
            .chars()
            .next()
            .expect("scalar cursor precedes text end");
        Self {
            character,
            utf8_len: character.len_utf8(),
            utf16_len: character.len_utf16(),
            utf16_units_remaining: character.len_utf16(),
        }
    }

    fn advance(&mut self, work: &mut TextWorkMeter) -> Result<(), TextWorkYield> {
        let taken = work.take_utf16_units(self.utf16_units_remaining);
        self.utf16_units_remaining -= taken;
        if self.utf16_units_remaining == 0 {
            Ok(())
        } else {
            Err(TextWorkYield)
        }
    }
}
