use std::num::NonZeroUsize;

use crate::layout::text_work::{TextWorkBudget, TextWorkMeter};

const DEFAULT_MAX_LINE_BOXES_PER_ADVANCE: usize = 32;
const DEFAULT_MAX_DESCENDANT_NODES_PER_ADVANCE: usize = 32;
const DEFAULT_MAX_TEXT_UTF16_UNITS_PER_ADVANCE: usize = 16_384;
const DEFAULT_MAX_ATOMIC_TEXT_OPERATIONS_PER_ADVANCE: usize = 64;

/// Deterministic upper bounds for one layout-session advance.
///
/// The public budget controls how many top-level source nodes may be accepted.
/// Greedy leaf paragraphs also stop after a small internal line-box quantum and
/// transparent descendant containers share a fixed node quantum. Other
/// composite nodes and individual shaping calls remain atomic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LayoutWorkBudget {
    max_top_level_nodes: NonZeroUsize,
    max_descendant_nodes: NonZeroUsize,
    max_line_boxes: NonZeroUsize,
    text: TextWorkBudget,
}

impl LayoutWorkBudget {
    pub(crate) const fn new(max_top_level_nodes: NonZeroUsize) -> Self {
        Self {
            max_top_level_nodes,
            max_descendant_nodes: NonZeroUsize::new(DEFAULT_MAX_DESCENDANT_NODES_PER_ADVANCE)
                .expect("the default descendant-node budget is non-zero"),
            max_line_boxes: NonZeroUsize::new(DEFAULT_MAX_LINE_BOXES_PER_ADVANCE)
                .expect("the default line-box budget is non-zero"),
            text: default_text_work_budget(),
        }
    }

    #[cfg(test)]
    pub(in crate::layout) const fn with_max_line_boxes(
        max_top_level_nodes: NonZeroUsize,
        max_line_boxes: NonZeroUsize,
    ) -> Self {
        Self {
            max_top_level_nodes,
            max_descendant_nodes: NonZeroUsize::new(DEFAULT_MAX_DESCENDANT_NODES_PER_ADVANCE)
                .expect("the default descendant-node budget is non-zero"),
            max_line_boxes,
            text: default_text_work_budget(),
        }
    }

    #[cfg(test)]
    pub(in crate::layout) const fn with_work_limits(
        max_top_level_nodes: NonZeroUsize,
        max_descendant_nodes: NonZeroUsize,
        max_line_boxes: NonZeroUsize,
    ) -> Self {
        Self {
            max_top_level_nodes,
            max_descendant_nodes,
            max_line_boxes,
            text: default_text_work_budget(),
        }
    }

    #[cfg(test)]
    pub(in crate::layout) const fn with_text_work_limits(
        max_top_level_nodes: NonZeroUsize,
        max_text_utf16_units: NonZeroUsize,
        max_atomic_text_operations: NonZeroUsize,
    ) -> Self {
        Self {
            max_top_level_nodes,
            max_descendant_nodes: NonZeroUsize::new(DEFAULT_MAX_DESCENDANT_NODES_PER_ADVANCE)
                .expect("the default descendant-node budget is non-zero"),
            max_line_boxes: NonZeroUsize::new(DEFAULT_MAX_LINE_BOXES_PER_ADVANCE)
                .expect("the default line-box budget is non-zero"),
            text: TextWorkBudget::new(max_text_utf16_units, max_atomic_text_operations),
        }
    }

    pub(in crate::layout) const fn unbounded() -> Self {
        Self {
            max_top_level_nodes: NonZeroUsize::MAX,
            max_descendant_nodes: NonZeroUsize::MAX,
            max_line_boxes: NonZeroUsize::MAX,
            text: TextWorkBudget::new(NonZeroUsize::MAX, NonZeroUsize::MAX),
        }
    }
}

const fn default_text_work_budget() -> TextWorkBudget {
    TextWorkBudget::new(
        NonZeroUsize::new(DEFAULT_MAX_TEXT_UTF16_UNITS_PER_ADVANCE)
            .expect("the default text character budget is non-zero"),
        NonZeroUsize::new(DEFAULT_MAX_ATOMIC_TEXT_OPERATIONS_PER_ADVANCE)
            .expect("the default atomic text-operation budget is non-zero"),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::layout) enum LayoutSessionScope {
    Root,
    Descendant,
}

/// One advance-wide work meter shared by every recursively active layout
/// session. Root input accounting remains the public progress contract while
/// descendant input and line layout use private fixed-size quanta.
#[derive(Debug)]
pub(crate) struct LayoutWorkMeter {
    root_accepts_remaining: usize,
    root_starts_remaining: usize,
    descendant_accepts_remaining: usize,
    descendant_starts_remaining: usize,
    line_boxes_remaining: usize,
    text_work: TextWorkMeter,
}

impl LayoutWorkMeter {
    pub(crate) fn new(budget: LayoutWorkBudget) -> Self {
        #[cfg(any(test, feature = "bench-internals"))]
        crate::layout::bounded_work_probe::record_quantum();
        Self {
            root_accepts_remaining: budget.max_top_level_nodes.get(),
            root_starts_remaining: budget.max_top_level_nodes.get(),
            descendant_accepts_remaining: budget.max_descendant_nodes.get(),
            descendant_starts_remaining: budget.max_descendant_nodes.get(),
            line_boxes_remaining: budget.max_line_boxes.get(),
            text_work: TextWorkMeter::new(budget.text),
        }
    }

    pub(in crate::layout) fn accepts_remaining(&self, scope: LayoutSessionScope) -> usize {
        match scope {
            LayoutSessionScope::Root => self.root_accepts_remaining,
            LayoutSessionScope::Descendant => self.descendant_accepts_remaining,
        }
    }

    pub(in crate::layout) fn consume_accepts(&mut self, scope: LayoutSessionScope, count: usize) {
        let remaining = match scope {
            LayoutSessionScope::Root => &mut self.root_accepts_remaining,
            LayoutSessionScope::Descendant => &mut self.descendant_accepts_remaining,
        };
        #[cfg(any(test, feature = "bench-internals"))]
        let before = *remaining;
        *remaining = remaining.saturating_sub(count);
        #[cfg(any(test, feature = "bench-internals"))]
        crate::layout::bounded_work_probe::record_accepts(
            matches!(scope, LayoutSessionScope::Descendant),
            before - *remaining,
        );
    }

    pub(in crate::layout) fn try_start_node(&mut self, scope: LayoutSessionScope) -> bool {
        let remaining = match scope {
            LayoutSessionScope::Root => &mut self.root_starts_remaining,
            LayoutSessionScope::Descendant => &mut self.descendant_starts_remaining,
        };
        if *remaining == 0 {
            #[cfg(any(test, feature = "bench-internals"))]
            crate::layout::bounded_work_probe::record_start(
                matches!(scope, LayoutSessionScope::Descendant),
                false,
            );
            return false;
        }
        *remaining -= 1;
        #[cfg(any(test, feature = "bench-internals"))]
        crate::layout::bounded_work_probe::record_start(
            matches!(scope, LayoutSessionScope::Descendant),
            true,
        );
        true
    }

    pub(in crate::layout) const fn line_boxes_remaining(&self) -> usize {
        self.line_boxes_remaining
    }

    pub(in crate::layout) const fn can_prepare_root_frontier(&self) -> bool {
        self.root_accepts_remaining > 0
            && self.root_starts_remaining > 0
            && self.line_boxes_remaining > 0
            && self.text_work.has_capacity()
    }

    pub(in crate::layout) fn consume_line_boxes(&mut self, count: usize) {
        #[cfg(any(test, feature = "bench-internals"))]
        let consumed = count.min(self.line_boxes_remaining);
        self.line_boxes_remaining = self.line_boxes_remaining.saturating_sub(count);
        #[cfg(any(test, feature = "bench-internals"))]
        crate::layout::bounded_work_probe::record_line_boxes(consumed);
    }

    /// Keeps private root work within the runtime request's remaining public
    /// slots without restoring work already consumed in earlier chapters.
    pub(crate) fn cap_root_work_remaining(&mut self, remaining: usize) {
        self.root_accepts_remaining = self.root_accepts_remaining.min(remaining);
        self.root_starts_remaining = self.root_starts_remaining.min(remaining);
    }

    pub(in crate::layout) fn text_work_mut(&mut self) -> &mut TextWorkMeter {
        &mut self.text_work
    }
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroUsize;

    use super::{LayoutWorkBudget, LayoutWorkMeter};
    use crate::layout::text_work::AtomicTextOperationKind;

    #[test]
    fn default_text_limits_are_transferred_to_the_meter() {
        let mut meter = LayoutWorkMeter::new(LayoutWorkBudget::new(non_zero(1)));
        let text = meter.text_work_mut();

        assert_eq!(text.utf16_units_remaining(), 16_384);
        assert_eq!(text.atomic_operations_remaining(), 64);
    }

    #[test]
    fn unbounded_text_limits_are_transferred_to_the_meter() {
        let mut meter = LayoutWorkMeter::new(LayoutWorkBudget::unbounded());
        let text = meter.text_work_mut();

        assert_eq!(text.utf16_units_remaining(), usize::MAX);
        assert_eq!(text.atomic_operations_remaining(), usize::MAX);
    }

    #[test]
    fn custom_text_limits_are_transferred_to_the_meter() {
        let budget =
            LayoutWorkBudget::with_text_work_limits(non_zero(1), non_zero(23), non_zero(7));
        let mut meter = LayoutWorkMeter::new(budget);
        let text = meter.text_work_mut();

        assert_eq!(text.utf16_units_remaining(), 23);
        assert_eq!(text.atomic_operations_remaining(), 7);
    }

    #[test]
    fn mutable_accessor_shares_one_text_meter_across_consumers() {
        let budget =
            LayoutWorkBudget::with_text_work_limits(non_zero(1), non_zero(10), non_zero(3));
        let mut meter = LayoutWorkMeter::new(budget);

        assert_eq!(meter.text_work_mut().take_utf16_units(4), 4);
        assert!(matches!(
            meter
                .text_work_mut()
                .try_permit_atomic(AtomicTextOperationKind::Measure, 2),
            crate::layout::text_work::TextWorkPermitResult::Permit { .. }
        ));

        let text = meter.text_work_mut();
        assert_eq!(text.utf16_units_remaining(), 4);
        assert_eq!(text.atomic_operations_remaining(), 2);
    }

    #[test]
    fn root_cap_preserves_consumed_work_and_charges_synthetic_slots() {
        let mut meter = LayoutWorkMeter::new(LayoutWorkBudget::new(non_zero(5)));

        meter.consume_accepts(super::LayoutSessionScope::Root, 1);
        assert!(meter.try_start_node(super::LayoutSessionScope::Root));
        assert!(meter.try_start_node(super::LayoutSessionScope::Root));
        meter.cap_root_work_remaining(4);

        assert_eq!(meter.root_accepts_remaining, 4);
        assert_eq!(meter.root_starts_remaining, 3);

        let mut empty_chapter = LayoutWorkMeter::new(LayoutWorkBudget::new(non_zero(5)));
        empty_chapter.cap_root_work_remaining(4);
        assert_eq!(empty_chapter.root_accepts_remaining, 4);
        assert_eq!(empty_chapter.root_starts_remaining, 4);
    }

    fn non_zero(value: usize) -> NonZeroUsize {
        NonZeroUsize::new(value).expect("test budget is non-zero")
    }
}
