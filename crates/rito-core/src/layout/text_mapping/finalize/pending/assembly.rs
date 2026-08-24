use super::{FlowAssignment, FlowDraft, PendingScalar};
use crate::layout::{
    inline_segment::InlineSegment,
    text_mapping::{
        LogicalTextSource, LogicalTextSpan, TextMappingCandidateSource,
        TextMappingUnavailableReason, TextSegmentMapping,
    },
    text_work::{TextWorkMeter, TextWorkYield},
};

#[derive(Debug)]
pub(super) struct PendingAssembly {
    segment_index: usize,
    segment_active: bool,
    byte_cursor: usize,
    logical_start: u32,
    pending_scalar: Option<PendingScalar>,
    draft: Option<FlowDraft>,
    complete: bool,
}

impl PendingAssembly {
    pub(super) fn new(draft: FlowDraft) -> Self {
        Self {
            segment_index: 0,
            segment_active: false,
            byte_cursor: 0,
            logical_start: 0,
            pending_scalar: None,
            draft: Some(draft),
            complete: false,
        }
    }

    pub(super) fn advance(
        &mut self,
        segments: &mut [InlineSegment],
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        while self.segment_index < segments.len() {
            if !self.segment_active && !self.begin_segment(&segments[self.segment_index], work)? {
                continue;
            }
            let text = candidate_text(&segments[self.segment_index])
                .expect("active assembly segment must be a candidate");
            if self.byte_cursor == text.len() {
                self.finish_candidate(&mut segments[self.segment_index]);
                continue;
            }
            if self.pending_scalar.is_none() {
                self.pending_scalar = Some(PendingScalar::at(text, self.byte_cursor));
            }
            self.pending_scalar
                .as_mut()
                .expect("assembly scalar is initialized")
                .advance(work)?;
            self.commit_scalar();
        }
        self.complete = true;
        Ok(())
    }

    pub(super) const fn is_complete(&self) -> bool {
        self.complete
    }

    pub(super) fn take_draft(&mut self) -> FlowDraft {
        assert!(self.complete, "flow assembly must be complete");
        self.draft.take().expect("assembly draft is owned")
    }

    fn begin_segment(
        &mut self,
        segment: &InlineSegment,
        work: &mut TextWorkMeter,
    ) -> Result<bool, TextWorkYield> {
        super::require_unit(work)?;
        if candidate_text(segment).is_none() {
            self.segment_index += 1;
            return Ok(false);
        }
        self.segment_active = true;
        self.logical_start = self.draft().utf16_len;
        Ok(true)
    }

    fn commit_scalar(&mut self) {
        let scalar = self.pending_scalar.take().expect("scalar is complete");
        let absolute_offset = self.draft().utf16_len;
        if scalar.utf16_len == 2 {
            self.draft_mut().non_boundaries.push(absolute_offset + 1);
        }
        self.draft_mut().text.push(scalar.character);
        self.draft_mut().utf16_len = absolute_offset + scalar.utf16_len as u32;
        self.byte_cursor += scalar.utf8_len;
    }

    fn finish_candidate(&mut self, segment: &mut InlineSegment) {
        let segment = segment
            .as_text_mut()
            .expect("flow candidate must be a text segment");
        let TextSegmentMapping::Candidate(candidate) = &mut segment.mapping else {
            unreachable!("flow candidate must remain pending during assembly");
        };
        let source = std::mem::replace(
            &mut candidate.source,
            TextMappingCandidateSource::Unavailable(TextMappingUnavailableReason::UnfinalizedFlow),
        );
        let source = move_source(source);
        let exact = matches!(source, LogicalTextSource::ExactLinear { .. });
        let logical_end = self.draft().utf16_len;
        let span_index =
            u32::try_from(self.draft().spans.len()).expect("preflight validated the span index");
        let logical_start = self.logical_start;
        let segment_index = self.segment_index;
        self.draft_mut().spans.push(LogicalTextSpan {
            logical_start,
            logical_end,
            source,
        });
        self.draft_mut().assignments.push(FlowAssignment {
            segment_index,
            span_index,
            logical_start,
            logical_end,
            exact,
        });
        self.segment_index += 1;
        self.segment_active = false;
        self.byte_cursor = 0;
    }

    fn draft(&self) -> &FlowDraft {
        self.draft.as_ref().expect("assembly draft is owned")
    }

    fn draft_mut(&mut self) -> &mut FlowDraft {
        self.draft.as_mut().expect("assembly draft is owned")
    }
}

fn candidate_text(segment: &InlineSegment) -> Option<&str> {
    let InlineSegment::Text(segment) = segment else {
        return None;
    };
    let TextSegmentMapping::Candidate(candidate) = &segment.mapping else {
        return None;
    };
    Some(candidate.logical_text())
}

fn move_source(source: TextMappingCandidateSource) -> LogicalTextSource {
    match source {
        TextMappingCandidateSource::ExactLinear {
            node_path,
            source_start,
        } => LogicalTextSource::ExactLinear {
            node_path: node_path.into_boxed_slice(),
            source_start,
        },
        TextMappingCandidateSource::Unavailable(reason) => LogicalTextSource::Unavailable(reason),
    }
}
