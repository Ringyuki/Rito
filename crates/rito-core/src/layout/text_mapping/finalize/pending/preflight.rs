use super::{FlowCounts, FlowLimits, PendingScalar};
use crate::layout::{
    inline_segment::InlineSegment,
    text_mapping::{TextMappingCandidate, TextMappingCandidateSource, TextSegmentMapping},
    text_work::{TextWorkMeter, TextWorkYield},
};

#[derive(Debug, Default)]
pub(super) struct PendingPreflight {
    segment_index: usize,
    segment_active: bool,
    byte_cursor: usize,
    candidate_utf16_len: usize,
    pending_scalar: Option<PendingScalar>,
    counts: FlowCounts,
}

pub(super) enum PreflightOutcome {
    Complete(FlowCounts),
    TooLong,
}

impl PendingPreflight {
    pub(super) fn advance(
        &mut self,
        segments: &[InlineSegment],
        limits: FlowLimits,
        work: &mut TextWorkMeter,
    ) -> Result<PreflightOutcome, TextWorkYield> {
        loop {
            if self.segment_index == segments.len() {
                return Ok(PreflightOutcome::Complete(self.counts));
            }
            if !self.segment_active {
                match self.begin_segment(&segments[self.segment_index], limits, work)? {
                    BeginOutcome::Active => {}
                    BeginOutcome::Skip => continue,
                    BeginOutcome::TooLong => return Ok(PreflightOutcome::TooLong),
                }
            }
            let candidate = candidate(&segments[self.segment_index])
                .expect("active preflight segment must be a candidate");
            if self.byte_cursor == candidate.logical_text().len() {
                if !self.finish_candidate(candidate) {
                    return Ok(PreflightOutcome::TooLong);
                }
                continue;
            }
            if self.pending_scalar.is_none() {
                self.pending_scalar = Some(PendingScalar::at(
                    candidate.logical_text(),
                    self.byte_cursor,
                ));
            }
            self.pending_scalar
                .as_mut()
                .expect("preflight scalar is initialized")
                .advance(work)?;
            if !self.commit_scalar(limits) {
                return Ok(PreflightOutcome::TooLong);
            }
        }
    }

    fn begin_segment(
        &mut self,
        segment: &InlineSegment,
        limits: FlowLimits,
        work: &mut TextWorkMeter,
    ) -> Result<BeginOutcome, TextWorkYield> {
        super::require_unit(work)?;
        if candidate(segment).is_none() {
            self.segment_index += 1;
            return Ok(BeginOutcome::Skip);
        }
        let Ok(span_index) = u32::try_from(self.counts.candidate_count) else {
            return Ok(BeginOutcome::TooLong);
        };
        if span_index > limits.max_span_index {
            return Ok(BeginOutcome::TooLong);
        }
        self.segment_active = true;
        let Some(candidate_count) = self.counts.candidate_count.checked_add(1) else {
            return Ok(BeginOutcome::TooLong);
        };
        self.counts.candidate_count = candidate_count;
        Ok(BeginOutcome::Active)
    }

    fn commit_scalar(&mut self, limits: FlowLimits) -> bool {
        let scalar = self.pending_scalar.take().expect("scalar is complete");
        let Some(text_bytes) = self.counts.text_bytes.checked_add(scalar.utf8_len) else {
            return false;
        };
        let Some(utf16_len) = self.counts.utf16_len.checked_add(scalar.utf16_len as u32) else {
            return false;
        };
        let Some(candidate_utf16_len) = self.candidate_utf16_len.checked_add(scalar.utf16_len)
        else {
            return false;
        };
        let Some(non_boundaries) = self
            .counts
            .non_boundaries
            .checked_add(usize::from(scalar.utf16_len == 2))
        else {
            return false;
        };
        if utf16_len > limits.max_utf16_len {
            return false;
        }
        self.counts.text_bytes = text_bytes;
        self.counts.utf16_len = utf16_len;
        self.counts.non_boundaries = non_boundaries;
        self.candidate_utf16_len = candidate_utf16_len;
        self.byte_cursor += scalar.utf8_len;
        true
    }

    fn finish_candidate(&mut self, candidate: &TextMappingCandidate) -> bool {
        let source_fits = match candidate.source() {
            TextMappingCandidateSource::ExactLinear { source_start, .. } => {
                source_start.checked_add(self.candidate_utf16_len).is_some()
            }
            TextMappingCandidateSource::Unavailable(_) => true,
        };
        self.segment_index += 1;
        self.segment_active = false;
        self.byte_cursor = 0;
        self.candidate_utf16_len = 0;
        source_fits
    }
}

enum BeginOutcome {
    Active,
    Skip,
    TooLong,
}

fn candidate(segment: &InlineSegment) -> Option<&TextMappingCandidate> {
    let InlineSegment::Text(segment) = segment else {
        return None;
    };
    let TextSegmentMapping::Candidate(candidate) = &segment.mapping else {
        return None;
    };
    Some(candidate)
}
