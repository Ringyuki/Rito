use std::num::NonZeroUsize;

const DEFAULT_MAX_LINE_BOXES_PER_ADVANCE: usize = 32;
const DEFAULT_MAX_DESCENDANT_NODES_PER_ADVANCE: usize = 32;

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
}

impl LayoutWorkBudget {
    pub(crate) const fn new(max_top_level_nodes: NonZeroUsize) -> Self {
        Self {
            max_top_level_nodes,
            max_descendant_nodes: NonZeroUsize::new(DEFAULT_MAX_DESCENDANT_NODES_PER_ADVANCE)
                .expect("the default descendant-node budget is non-zero"),
            max_line_boxes: NonZeroUsize::new(DEFAULT_MAX_LINE_BOXES_PER_ADVANCE)
                .expect("the default line-box budget is non-zero"),
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
        }
    }

    pub(in crate::layout) const fn unbounded() -> Self {
        Self {
            max_top_level_nodes: NonZeroUsize::MAX,
            max_descendant_nodes: NonZeroUsize::MAX,
            max_line_boxes: NonZeroUsize::MAX,
        }
    }
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
pub(in crate::layout) struct LayoutWorkMeter {
    root_accepts_remaining: usize,
    root_starts_remaining: usize,
    descendant_accepts_remaining: usize,
    descendant_starts_remaining: usize,
    line_boxes_remaining: usize,
}

impl LayoutWorkMeter {
    pub(in crate::layout) fn new(budget: LayoutWorkBudget) -> Self {
        Self {
            root_accepts_remaining: budget.max_top_level_nodes.get(),
            root_starts_remaining: budget.max_top_level_nodes.get(),
            descendant_accepts_remaining: budget.max_descendant_nodes.get(),
            descendant_starts_remaining: budget.max_descendant_nodes.get(),
            line_boxes_remaining: budget.max_line_boxes.get(),
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
        *remaining = remaining.saturating_sub(count);
    }

    pub(in crate::layout) fn try_start_node(&mut self, scope: LayoutSessionScope) -> bool {
        let remaining = match scope {
            LayoutSessionScope::Root => &mut self.root_starts_remaining,
            LayoutSessionScope::Descendant => &mut self.descendant_starts_remaining,
        };
        if *remaining == 0 {
            return false;
        }
        *remaining -= 1;
        true
    }

    pub(in crate::layout) const fn line_boxes_remaining(&self) -> usize {
        self.line_boxes_remaining
    }

    pub(in crate::layout) fn consume_line_boxes(&mut self, count: usize) {
        self.line_boxes_remaining = self.line_boxes_remaining.saturating_sub(count);
    }
}
