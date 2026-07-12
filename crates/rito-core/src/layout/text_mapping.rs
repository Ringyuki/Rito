use std::sync::Arc;

mod finalize;

pub(crate) use finalize::finalize_inline_text_flow;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TextSourceBasis {
    ParsedText,
    RestoredParserWhitespace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TextMappingUnavailableReason {
    RestoredParserWhitespace,
    NonLinearTextTransform,
    PseudoContent,
    SyntheticLayoutText,
    UnfinalizedFlow,
    FlowTooLong,
    InvalidTextBoundary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LogicalTextSource {
    ExactLinear {
        node_path: Box<[usize]>,
        source_start: usize,
    },
    Unavailable(TextMappingUnavailableReason),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LogicalTextSpan {
    pub(crate) logical_start: u32,
    pub(crate) logical_end: u32,
    pub(crate) source: LogicalTextSource,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LogicalTextFlow {
    text: Box<str>,
    utf16_len: u32,
    spans: Box<[LogicalTextSpan]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TextFlowSlice {
    pub(crate) flow: Arc<LogicalTextFlow>,
    pub(crate) span_index: u32,
    pub(crate) logical_start: u32,
    pub(crate) logical_end: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RunTextMapping {
    Exact(TextFlowSlice),
    Unavailable(TextMappingUnavailableReason),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TextMappingCandidateSource {
    ExactLinear {
        node_path: Vec<usize>,
        source_start: usize,
    },
    Unavailable(TextMappingUnavailableReason),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TextMappingCandidate {
    logical_text: String,
    source: TextMappingCandidateSource,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TextSegmentMapping {
    Candidate(TextMappingCandidate),
    Resolved(RunTextMapping),
}

impl TextMappingCandidate {
    pub(super) fn logical_text(&self) -> &str {
        &self.logical_text
    }

    pub(super) fn source(&self) -> &TextMappingCandidateSource {
        &self.source
    }
}

impl TextSegmentMapping {
    pub(crate) fn synthetic() -> Self {
        Self::Resolved(RunTextMapping::synthetic())
    }

    pub(crate) fn run_mapping(&self, start: usize, end: usize) -> RunTextMapping {
        match self {
            Self::Candidate(_) => {
                RunTextMapping::Unavailable(TextMappingUnavailableReason::UnfinalizedFlow)
            }
            Self::Resolved(mapping) => mapping.subslice(start, end),
        }
    }
}

impl RunTextMapping {
    pub(crate) const fn synthetic() -> Self {
        Self::Unavailable(TextMappingUnavailableReason::SyntheticLayoutText)
    }

    pub(crate) fn subslice(&self, start: usize, end: usize) -> Self {
        let Self::Exact(slice) = self else {
            return self.clone();
        };
        if slice.validate().is_err() {
            return Self::Unavailable(TextMappingUnavailableReason::InvalidTextBoundary);
        }
        let Ok(start) = u32::try_from(start) else {
            return Self::Unavailable(TextMappingUnavailableReason::FlowTooLong);
        };
        let Ok(end) = u32::try_from(end) else {
            return Self::Unavailable(TextMappingUnavailableReason::FlowTooLong);
        };
        let Some(logical_start) = slice.logical_start.checked_add(start) else {
            return Self::Unavailable(TextMappingUnavailableReason::FlowTooLong);
        };
        let Some(logical_end) = slice.logical_start.checked_add(end) else {
            return Self::Unavailable(TextMappingUnavailableReason::FlowTooLong);
        };
        if start > end || logical_end > slice.logical_end {
            return Self::Unavailable(TextMappingUnavailableReason::UnfinalizedFlow);
        }
        let slice = TextFlowSlice {
            flow: Arc::clone(&slice.flow),
            span_index: slice.span_index,
            logical_start,
            logical_end,
        };
        if slice.validate().is_err() {
            Self::Unavailable(TextMappingUnavailableReason::InvalidTextBoundary)
        } else {
            Self::Exact(slice)
        }
    }

    pub(crate) fn truncate(&self, utf16_len: usize) -> Self {
        self.subslice(0, utf16_len)
    }

    /// Returns logical break whitespace retained between consecutive painted
    /// slices.
    ///
    /// Line layout deliberately omits break whitespace and forced newlines
    /// from painted runs. Consumers that preserve logical reading order can
    /// recover that gap only when both runs prove ownership of the same
    /// finalized text flow. Non-whitespace holes are not line-break metadata
    /// and must never be smuggled back into visible or accessible content.
    pub(crate) fn line_break_gap_after<'a>(&'a self, previous: &Self) -> Option<&'a str> {
        let (Self::Exact(current), Self::Exact(previous)) = (self, previous) else {
            return None;
        };
        debug_assert!(current.validate().is_ok());
        debug_assert!(previous.validate().is_ok());
        if !Arc::ptr_eq(&current.flow, &previous.flow)
            || previous.logical_end > current.logical_start
        {
            return None;
        }
        let gap = current
            .flow
            .slice_utf16(previous.logical_end, current.logical_start)?;
        gap.chars().all(char::is_whitespace).then_some(gap)
    }
}

impl TextFlowSlice {
    pub(crate) fn validate(&self) -> Result<(), &'static str> {
        let span = self
            .flow
            .spans
            .get(self.span_index as usize)
            .ok_or("text flow slice references an unknown span")?;
        if !matches!(span.source, LogicalTextSource::ExactLinear { .. }) {
            return Err("exact text flow slice references an unavailable source span");
        }
        if self.logical_start < span.logical_start
            || self.logical_end < self.logical_start
            || self.logical_end > span.logical_end
        {
            return Err("text flow slice lies outside its source span");
        }
        if !self.flow.is_utf16_boundary(self.logical_start)
            || !self.flow.is_utf16_boundary(self.logical_end)
        {
            return Err("text flow slice is not on a UTF-16 boundary");
        }
        Ok(())
    }
}

#[cfg(test)]
type FixtureLogicalTextSpan = (u32, u32, Option<(Vec<usize>, usize)>);

#[cfg(test)]
pub(crate) fn fixture_logical_text_flow(
    text: &str,
    spans: Vec<FixtureLogicalTextSpan>,
) -> Arc<LogicalTextFlow> {
    let spans = spans
        .into_iter()
        .map(|(logical_start, logical_end, source)| LogicalTextSpan {
            logical_start,
            logical_end,
            source: source.map_or(
                LogicalTextSource::Unavailable(TextMappingUnavailableReason::PseudoContent),
                |(node_path, source_start)| LogicalTextSource::ExactLinear {
                    node_path: node_path.into_boxed_slice(),
                    source_start,
                },
            ),
        })
        .collect::<Vec<_>>();
    let flow = Arc::new(LogicalTextFlow {
        text: text.to_owned().into_boxed_str(),
        utf16_len: text.encode_utf16().count() as u32,
        spans: spans.into_boxed_slice(),
    });
    assert_eq!(flow.validate(), Ok(()));
    flow
}

#[cfg(test)]
mod line_tests;
#[cfg(test)]
mod tests;
