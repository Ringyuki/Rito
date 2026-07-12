use std::sync::Arc;

use unicode_segmentation::UnicodeSegmentation;

use super::{
    LogicalTextFlow, LogicalTextSource, LogicalTextSpan, RunTextMapping, TextFlowSlice,
    TextMappingCandidate, TextMappingCandidateSource, TextMappingUnavailableReason,
    TextSegmentMapping, TextSourceBasis,
};
use crate::layout::inline_segment::InlineSegment;

impl TextMappingCandidate {
    pub(crate) fn new(
        logical_text: String,
        source_path: Option<Vec<usize>>,
        source_start: usize,
        basis: TextSourceBasis,
        display_text: &str,
    ) -> Self {
        let source = candidate_source(
            source_path,
            source_start,
            basis,
            &logical_text,
            display_text,
        );
        Self {
            logical_text,
            source,
        }
    }
}

impl LogicalTextFlow {
    pub(crate) fn text(&self) -> &str {
        &self.text
    }

    pub(crate) fn spans(&self) -> &[LogicalTextSpan] {
        &self.spans
    }

    pub(crate) fn validate(&self) -> Result<(), &'static str> {
        if utf16_len(self.text()) != self.utf16_len as usize {
            return Err("logical flow UTF-16 length does not match its text");
        }
        let mut cursor = 0;
        for span in self.spans() {
            if span.logical_start != cursor || span.logical_end < span.logical_start {
                return Err("logical flow spans are not contiguous and ordered");
            }
            if !is_utf16_boundary(self.text(), span.logical_start)
                || !is_utf16_boundary(self.text(), span.logical_end)
            {
                return Err("logical flow span is not on a UTF-16 boundary");
            }
            cursor = span.logical_end;
            if let LogicalTextSource::ExactLinear { source_start, .. } = &span.source {
                let span_len = (span.logical_end - span.logical_start) as usize;
                source_start
                    .checked_add(span_len)
                    .ok_or("logical source span overflows its parsed text offset")?;
            }
        }
        (cursor == self.utf16_len)
            .then_some(())
            .ok_or("logical flow spans do not cover its text")
    }

    pub(super) fn is_utf16_boundary(&self, target: u32) -> bool {
        is_utf16_boundary(self.text(), target)
    }
}

pub(crate) fn finalize_inline_text_flow(segments: &mut [InlineSegment]) {
    let draft = match build_flow_draft(segments) {
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
        spans: draft.spans.into_boxed_slice(),
    });
    debug_assert!(flow.validate().is_ok());
    for assignment in draft.assignments {
        assign_segment_mapping(segments, &flow, assignment);
    }
}

pub(crate) fn text_transform_is_linear(logical: &str, display: &str) -> bool {
    logical == display
        || (utf16_boundaries(logical.chars()) == utf16_boundaries(display.chars())
            && utf16_grapheme_boundaries(logical) == utf16_grapheme_boundaries(display))
}

struct FlowDraft {
    text: String,
    utf16_len: u32,
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

fn build_flow_draft(segments: &[InlineSegment]) -> Result<Option<FlowDraft>, ()> {
    let mut draft = FlowDraft {
        text: String::new(),
        utf16_len: 0,
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
        push_candidate(&mut draft, segment_index, candidate)?;
    }
    Ok((!draft.spans.is_empty()).then_some(draft))
}

fn push_candidate(
    draft: &mut FlowDraft,
    segment_index: usize,
    candidate: &TextMappingCandidate,
) -> Result<(), ()> {
    let logical_start = draft.utf16_len;
    let length = u32::try_from(utf16_len(candidate.logical_text())).map_err(|_| ())?;
    let logical_end = logical_start.checked_add(length).ok_or(())?;
    let source = resolved_source(candidate.source());
    let exact = matches!(source, LogicalTextSource::ExactLinear { .. });
    let span_index = u32::try_from(draft.spans.len()).map_err(|_| ())?;
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

fn assign_segment_mapping(
    segments: &mut [InlineSegment],
    flow: &Arc<LogicalTextFlow>,
    assignment: FlowAssignment,
) {
    let Some(segment) = segments
        .get_mut(assignment.segment_index)
        .and_then(InlineSegment::as_text_mut)
    else {
        return;
    };
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

fn candidate_source(
    source_path: Option<Vec<usize>>,
    source_start: usize,
    basis: TextSourceBasis,
    logical_text: &str,
    display_text: &str,
) -> TextMappingCandidateSource {
    if basis == TextSourceBasis::RestoredParserWhitespace {
        return TextMappingCandidateSource::Unavailable(
            TextMappingUnavailableReason::RestoredParserWhitespace,
        );
    }
    if !text_transform_is_linear(logical_text, display_text) {
        return TextMappingCandidateSource::Unavailable(
            TextMappingUnavailableReason::NonLinearTextTransform,
        );
    }
    source_path.map_or(
        TextMappingCandidateSource::Unavailable(TextMappingUnavailableReason::PseudoContent),
        |node_path| TextMappingCandidateSource::ExactLinear {
            node_path,
            source_start,
        },
    )
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

fn unavailable_reason(source: &LogicalTextSource) -> TextMappingUnavailableReason {
    match source {
        LogicalTextSource::Unavailable(reason) => *reason,
        LogicalTextSource::ExactLinear { .. } => TextMappingUnavailableReason::UnfinalizedFlow,
    }
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

fn utf16_boundaries(characters: impl Iterator<Item = char>) -> Vec<usize> {
    let mut boundaries = vec![0];
    for character in characters {
        boundaries.push(boundaries.last().copied().unwrap_or(0) + character.len_utf16());
    }
    boundaries
}

fn utf16_grapheme_boundaries(text: &str) -> Vec<usize> {
    let mut boundaries = vec![0];
    let mut offset = 0;
    for grapheme in text.graphemes(true) {
        offset += utf16_len(grapheme);
        boundaries.push(offset);
    }
    boundaries
}

fn is_utf16_boundary(text: &str, target: u32) -> bool {
    let mut offset = 0_u32;
    if target == 0 {
        return true;
    }
    for character in text.chars() {
        offset += character.len_utf16() as u32;
        if offset == target {
            return true;
        }
        if offset > target {
            return false;
        }
    }
    false
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}
