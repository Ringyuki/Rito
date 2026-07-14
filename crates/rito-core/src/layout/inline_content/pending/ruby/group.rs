use crate::{
    layout::text_work::{TextWorkMeter, TextWorkYield},
    style::{StyledNode, StyledNodeKind},
};

use super::super::{discard::PendingNodeDiscard, require_unit, ruby_text::admit_inline_collection};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RubyGroupBoundaryKind {
    Annotation,
    Replacement,
    End,
}

#[derive(Debug)]
pub(super) struct PendingRubyGroupPlan {
    seed: Vec<StyledNode>,
    inspected_prefix: usize,
    direct_base_count: usize,
}

#[derive(Debug)]
pub(super) struct RubyGroupSpec {
    seed: Vec<StyledNode>,
    prefix_len: usize,
    direct_base_count: usize,
    expected_len: usize,
    boundary: RubyGroupBoundaryKind,
}

#[derive(Debug)]
pub(super) struct PendingRubyGroupBuild {
    output: Vec<StyledNode>,
    output_capacity: usize,
    prefix_remaining: usize,
    direct_base_remaining: usize,
    expected_len: usize,
    boundary: RubyGroupBoundaryKind,
    discard: Option<PendingNodeDiscard>,
}

#[derive(Debug)]
pub(super) struct PendingRubyBoundary {
    pub(super) nodes: Vec<StyledNode>,
    pub(super) kind: RubyGroupBoundaryKind,
}

impl PendingRubyBoundary {
    pub(super) fn consume_node(
        &self,
        children: &mut std::vec::IntoIter<StyledNode>,
        work: &mut TextWorkMeter,
    ) -> Result<Option<StyledNode>, TextWorkYield> {
        let expected = match self.kind {
            RubyGroupBoundaryKind::Annotation => DirectChildKind::Annotation,
            RubyGroupBoundaryKind::Replacement => DirectChildKind::Replacement,
            RubyGroupBoundaryKind::End => return Ok(None),
        };
        require_unit(work)?;
        let node = children.next().expect("a preflighted ruby boundary exists");
        debug_assert_eq!(direct_child_kind(&node), expected);
        Ok(Some(node))
    }

    pub(super) fn drain_nodes_into(&mut self, output: &mut Vec<StyledNode>) {
        output.append(&mut self.nodes);
    }
}

impl PendingRubyGroupPlan {
    pub(super) const fn new(seed: Vec<StyledNode>) -> Self {
        Self {
            seed,
            inspected_prefix: 0,
            direct_base_count: 0,
        }
    }

    pub(super) fn advance(
        &mut self,
        children: &[StyledNode],
        work: &mut TextWorkMeter,
    ) -> Result<RubyGroupSpec, TextWorkYield> {
        loop {
            if self.inspected_prefix == children.len() {
                require_unit(work)?;
                return Ok(self.finish(RubyGroupBoundaryKind::End));
            }
            require_unit(work)?;
            match direct_child_kind(&children[self.inspected_prefix]) {
                DirectChildKind::Base => checked_add(&mut self.direct_base_count, 1),
                DirectChildKind::Skip => {}
                DirectChildKind::Annotation => {
                    return Ok(self.finish(RubyGroupBoundaryKind::Annotation));
                }
                DirectChildKind::Replacement => {
                    return Ok(self.finish(RubyGroupBoundaryKind::Replacement));
                }
            }
            checked_add(&mut self.inspected_prefix, 1);
        }
    }

    pub(super) fn drain_nodes_into(&mut self, output: &mut Vec<StyledNode>) {
        output.append(&mut self.seed);
    }

    fn finish(&mut self, boundary: RubyGroupBoundaryKind) -> RubyGroupSpec {
        let expected_len = self
            .seed
            .len()
            .checked_add(self.direct_base_count)
            .expect("ruby base-group length must fit in usize");
        RubyGroupSpec {
            seed: std::mem::take(&mut self.seed),
            prefix_len: self.inspected_prefix,
            direct_base_count: self.direct_base_count,
            expected_len,
            boundary,
        }
    }
}

impl RubyGroupSpec {
    pub(super) fn needs_reserve(&self) -> bool {
        self.seed.capacity() < self.expected_len
    }

    pub(super) fn reserve(
        mut self,
        work: &mut TextWorkMeter,
    ) -> Result<PendingRubyGroupBuild, (Self, TextWorkYield)> {
        // A seed from `rb.children` already owns its allocation. Scheduling
        // pays an atomic operation only when appending direct base nodes would
        // grow that allocation; spare seed capacity is deliberately reused.
        if self.needs_reserve() {
            if let Err(error) = admit_inline_collection(work, self.expected_len) {
                return Err((self, error));
            }
            self.seed.reserve_exact(self.direct_base_count);
        }
        Ok(self.into_build())
    }

    pub(super) fn drain_nodes_into(&mut self, output: &mut Vec<StyledNode>) {
        output.append(&mut self.seed);
    }

    fn into_build(self) -> PendingRubyGroupBuild {
        let output_capacity = self.seed.capacity();
        debug_assert!(output_capacity >= self.expected_len);
        PendingRubyGroupBuild {
            output: self.seed,
            output_capacity,
            prefix_remaining: self.prefix_len,
            direct_base_remaining: self.direct_base_count,
            expected_len: self.expected_len,
            boundary: self.boundary,
            discard: None,
        }
    }
}

impl PendingRubyGroupBuild {
    pub(super) fn advance(
        &mut self,
        children: &mut std::vec::IntoIter<StyledNode>,
        work: &mut TextWorkMeter,
    ) -> Result<PendingRubyBoundary, TextWorkYield> {
        loop {
            if let Some(discard) = self.discard.as_mut() {
                if discard.advance(work)? {
                    self.discard = None;
                }
                continue;
            }
            if self.prefix_remaining == 0 {
                self.verify_complete();
                return Ok(PendingRubyBoundary {
                    nodes: std::mem::take(&mut self.output),
                    kind: self.boundary,
                });
            }
            require_unit(work)?;
            let node = children
                .next()
                .expect("a preflighted direct ruby child exists");
            self.prefix_remaining -= 1;
            self.collect_node(node);
        }
    }

    pub(super) fn drain_nodes_into(&mut self, output: &mut Vec<StyledNode>) {
        output.append(&mut self.output);
        if let Some(discard) = self.discard.as_mut() {
            discard.drain_remaining_into(output);
        }
    }

    #[cfg(test)]
    pub(super) const fn has_pending_discard(&self) -> bool {
        self.discard.is_some()
    }

    fn collect_node(&mut self, mut node: StyledNode) {
        match direct_child_kind(&node) {
            DirectChildKind::Base => {
                self.direct_base_remaining = self
                    .direct_base_remaining
                    .checked_sub(1)
                    .expect("a collected ruby base node was counted by preflight");
                self.output.push(node);
                debug_assert_eq!(
                    self.output.capacity(),
                    self.output_capacity,
                    "ruby group preflight must prevent output growth"
                );
            }
            DirectChildKind::Skip => {
                if !node.children.is_empty() {
                    self.discard =
                        Some(PendingNodeDiscard::new(std::mem::take(&mut node.children)));
                }
            }
            DirectChildKind::Annotation | DirectChildKind::Replacement => {
                unreachable!("ruby group preflight stops before a boundary")
            }
        }
    }

    fn verify_complete(&self) {
        debug_assert_eq!(self.direct_base_remaining, 0);
        debug_assert_eq!(self.output.len(), self.expected_len);
        debug_assert_eq!(self.output.capacity(), self.output_capacity);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DirectChildKind {
    Base,
    Skip,
    Annotation,
    Replacement,
}

fn direct_child_kind(node: &StyledNode) -> DirectChildKind {
    if node.node_type == StyledNodeKind::Text {
        return DirectChildKind::Base;
    }
    if node.node_type != StyledNodeKind::Inline {
        return DirectChildKind::Skip;
    }
    match node.tag.as_deref() {
        Some("rt") => DirectChildKind::Annotation,
        Some("rp") => DirectChildKind::Skip,
        Some("rb") => DirectChildKind::Replacement,
        _ => DirectChildKind::Base,
    }
}

fn checked_add(target: &mut usize, value: usize) {
    *target = target
        .checked_add(value)
        .expect("ruby group preflight counts must fit in usize");
}
