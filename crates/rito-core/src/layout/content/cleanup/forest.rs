use std::mem;

use super::{line::PendingLineBoxCleanup, LayoutBlock, LayoutChild};
use crate::layout::content::RuntimeChild;

#[derive(Debug)]
pub(super) struct PendingRuntimeChildForestCleanup {
    current: Option<LayoutChild>,
    frame: Vec<LayoutChild>,
    depth: usize,
    line: Option<PendingLineBoxCleanup>,
    #[cfg(test)]
    carrier_pushes: usize,
    #[cfg(test)]
    carrier_capacity_growth: usize,
}

impl PendingRuntimeChildForestCleanup {
    pub(super) fn new(mut children: Vec<LayoutChild>) -> Self {
        let current = children.pop();
        Self {
            current,
            frame: children,
            depth: 0,
            line: None,
            #[cfg(test)]
            carrier_pushes: 0,
            #[cfg(test)]
            carrier_capacity_growth: 0,
        }
    }

    pub(super) fn is_complete(&self) -> bool {
        let complete = self.current.is_none() && self.line.is_none();
        debug_assert!(!complete || (self.frame.is_empty() && self.depth == 0));
        complete
    }

    pub(super) fn advance_one(&mut self) -> bool {
        if self.line.is_some() {
            return self.advance_line();
        }
        let Some(child) = self.current.take() else {
            return false;
        };
        match child {
            RuntimeChild::Block(block) => self.advance_block(block),
            RuntimeChild::Line(line) => {
                self.line = Some(PendingLineBoxCleanup::new(line));
                self.advance_line()
            }
            RuntimeChild::Image(image) => self.release_leaf(image),
            RuntimeChild::Hr(rule) => self.release_leaf(rule),
        }
    }

    fn release_leaf<T>(&mut self, value: T) -> bool {
        drop(value);
        self.resume_after_release();
        true
    }

    fn advance_line(&mut self) -> bool {
        let line = self.line.as_mut().expect("active line cleanup exists");
        let advanced = line.advance_one();
        debug_assert!(advanced, "an active line cleanup has work");
        if line.is_complete() {
            self.line = None;
            self.resume_after_release();
        }
        true
    }

    fn advance_block(&mut self, mut block: Box<LayoutBlock>) -> bool {
        let Some(child) = block.children.pop() else {
            return self.release_leaf(block);
        };
        let outer_frame = mem::take(&mut self.frame);
        let child_frame = mem::replace(&mut block.children, outer_frame);
        self.frame = child_frame;
        self.push_carrier(block);
        self.current = Some(child);
        self.depth = self.depth.saturating_add(1);
        true
    }

    fn resume_after_release(&mut self) {
        if self.depth == 0 {
            self.current = self.frame.pop();
            return;
        }
        let Some(mut carrier) = self.take_carrier() else {
            self.depth = 0;
            return;
        };
        if let Some(sibling) = self.frame.pop() {
            self.push_carrier(carrier);
            self.current = Some(sibling);
            return;
        }
        self.frame = mem::take(&mut carrier.children);
        self.current = Some(RuntimeChild::Block(carrier));
        self.depth = self.depth.saturating_sub(1);
    }

    fn take_carrier(&mut self) -> Option<Box<LayoutBlock>> {
        match self.frame.pop()? {
            RuntimeChild::Block(block) => Some(block),
            RuntimeChild::Line(_) | RuntimeChild::Image(_) | RuntimeChild::Hr(_) => {
                unreachable!("a nested cleanup frame ends with its block carrier")
            }
        }
    }

    fn push_carrier(&mut self, carrier: Box<LayoutBlock>) {
        #[cfg(test)]
        let capacity = self.frame.capacity();
        self.frame.push(RuntimeChild::Block(carrier));
        #[cfg(test)]
        {
            self.carrier_pushes = self.carrier_pushes.saturating_add(1);
            self.carrier_capacity_growth = self
                .carrier_capacity_growth
                .saturating_add(self.frame.capacity().saturating_sub(capacity));
        }
    }

    fn drain(&mut self) {
        while self.advance_one() {}
    }

    #[cfg(test)]
    pub(super) fn carrier_push_stats(&self) -> (usize, usize) {
        (self.carrier_pushes, self.carrier_capacity_growth)
    }
}

impl Drop for PendingRuntimeChildForestCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}
