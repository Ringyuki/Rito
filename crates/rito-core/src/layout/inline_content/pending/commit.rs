use crate::layout::{
    inline_segment::InlineSegment,
    text_work::{AtomicTextOperationKind, TextWorkMeter, TextWorkPermitResult, TextWorkYield},
};

use super::require_unit;

#[derive(Debug)]
pub(super) enum PendingSegmentCommit {
    Reserving { segment: InlineSegment },
    Ready(PendingReadySegmentCommit),
    Transition,
}

#[derive(Debug)]
pub(super) struct PendingReadySegmentCommit {
    segment: InlineSegment,
    expected_len: usize,
    output_capacity: usize,
}

impl PendingSegmentCommit {
    pub(super) fn new(segment: InlineSegment) -> Self {
        Self::Reserving { segment }
    }

    /// Publishes exactly one owned segment and returns its text index, if any.
    ///
    /// Capacity growth is admitted independently from the final append unit.
    /// Once growth succeeds, `Ready` retains the permit across a unit-budget
    /// yield so the same allocation is never admitted twice.
    pub(super) fn advance(
        &mut self,
        output: &mut Vec<InlineSegment>,
        work: &mut TextWorkMeter,
    ) -> Result<Option<usize>, TextWorkYield> {
        let state = std::mem::replace(self, Self::Transition);
        let ready = match state {
            Self::Reserving { segment } => {
                let expected_len = checked_post_commit_len(output.len())
                    .expect("inline segment count must fit in usize");
                if output.len() == output.capacity() {
                    if matches!(
                        work.try_permit_atomic(
                            AtomicTextOperationKind::InlineCollection,
                            expected_len,
                        ),
                        TextWorkPermitResult::Yield
                    ) {
                        *self = Self::Reserving { segment };
                        return Err(TextWorkYield);
                    }
                    output.reserve(1);
                }
                PendingReadySegmentCommit {
                    segment,
                    expected_len,
                    output_capacity: output.capacity(),
                }
            }
            Self::Ready(ready) => ready,
            Self::Transition => unreachable!("a segment commit cannot advance while transitioning"),
        };

        if let Err(error) = require_unit(work) {
            *self = Self::Ready(ready);
            return Err(error);
        }
        Ok(ready.commit(output))
    }
}

pub(super) const fn checked_post_commit_len(output_len: usize) -> Option<usize> {
    output_len.checked_add(1)
}

impl PendingReadySegmentCommit {
    fn commit(self, output: &mut Vec<InlineSegment>) -> Option<usize> {
        assert_eq!(
            output.capacity(),
            self.output_capacity,
            "segment output capacity cannot change while a commit is pending"
        );
        assert_eq!(
            output.len().checked_add(1),
            Some(self.expected_len),
            "segment output length cannot change while a commit is pending"
        );
        assert!(
            output.len() < self.output_capacity,
            "a paid segment append must fit the reserved output capacity"
        );

        let text_index = (!self.segment.is_atom()).then_some(output.len());
        output.push(self.segment);
        assert_eq!(output.len(), self.expected_len);
        assert_eq!(output.capacity(), self.output_capacity);
        text_index
    }
}
