use super::{
    utf16, LogicalTextFlow, LogicalTextSource, LogicalTextSpan, TextMappingCandidate,
    TextMappingCandidateSource, TextMappingUnavailableReason, TextSourceBasis,
};

mod eager;
mod pending;

pub(crate) use eager::finalize_inline_text_flow;
pub(crate) use pending::PendingInlineTextFlowFinalizer;

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

    pub(crate) fn new_prevalidated(
        logical_text: String,
        source_path: Option<Vec<usize>>,
        source_start: usize,
        basis: TextSourceBasis,
        transform_is_linear: bool,
    ) -> Self {
        let source =
            prevalidated_candidate_source(source_path, source_start, basis, transform_is_linear);
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
        if utf16::len(self.text()) != self.utf16_len as usize {
            return Err("logical flow UTF-16 length does not match its text");
        }
        if self.non_boundaries.as_ref() != utf16::non_boundaries(self.text()) {
            return Err("logical flow UTF-16 boundary index does not match its text");
        }
        let mut cursor = 0;
        for span in self.spans() {
            if span.logical_start != cursor || span.logical_end < span.logical_start {
                return Err("logical flow spans are not contiguous and ordered");
            }
            if !self.is_utf16_boundary(span.logical_start)
                || !self.is_utf16_boundary(span.logical_end)
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
        target <= self.utf16_len && self.non_boundaries.binary_search(&target).is_err()
    }

    pub(crate) fn slice_utf16(&self, start: u32, end: u32) -> Option<&str> {
        if start > end || end > self.utf16_len {
            return None;
        }
        let start = utf16::offset_to_byte(self.text(), start)?;
        let end = utf16::offset_to_byte(self.text(), end)?;
        self.text().get(start..end)
    }
}

pub(crate) fn text_transform_is_linear(logical: &str, display: &str) -> bool {
    logical == display
        || (utf16::boundaries(logical.chars()) == utf16::boundaries(display.chars())
            && utf16::grapheme_boundaries(logical) == utf16::grapheme_boundaries(display))
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
    prevalidated_candidate_source(
        source_path,
        source_start,
        basis,
        text_transform_is_linear(logical_text, display_text),
    )
}

fn prevalidated_candidate_source(
    source_path: Option<Vec<usize>>,
    source_start: usize,
    basis: TextSourceBasis,
    transform_is_linear: bool,
) -> TextMappingCandidateSource {
    if basis == TextSourceBasis::RestoredParserWhitespace {
        return TextMappingCandidateSource::Unavailable(
            TextMappingUnavailableReason::RestoredParserWhitespace,
        );
    }
    if !transform_is_linear {
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

pub(super) fn unavailable_reason(source: &LogicalTextSource) -> TextMappingUnavailableReason {
    match source {
        LogicalTextSource::Unavailable(reason) => *reason,
        LogicalTextSource::ExactLinear { .. } => TextMappingUnavailableReason::UnfinalizedFlow,
    }
}

#[cfg(test)]
#[path = "finalize/tests.rs"]
mod tests;
