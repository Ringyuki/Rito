use crate::{layout::inline_segment::InlineSegment, style::StyledNode};

use super::context::OwnedInlineContext;

#[derive(Debug)]
pub(super) struct NodeFrame {
    pub(super) nodes: std::vec::IntoIter<StyledNode>,
    pub(super) context: OwnedInlineContext,
    pub(super) summary: TextSegmentSummary,
    pub(super) exit: Option<InlineExit>,
}

impl NodeFrame {
    pub(super) fn root(nodes: Vec<StyledNode>, href: Option<String>) -> Self {
        Self {
            nodes: nodes.into_iter(),
            context: OwnedInlineContext::root(href),
            summary: TextSegmentSummary::default(),
            exit: None,
        }
    }
}

#[derive(Debug, Default)]
pub(super) struct TextSegmentSummary {
    pub(super) first: Option<usize>,
    pub(super) last: Option<usize>,
}

impl TextSegmentSummary {
    pub(super) fn include(&mut self, index: usize) {
        self.first.get_or_insert(index);
        self.last = Some(index);
    }

    pub(super) fn merge(&mut self, child: &Self) {
        if let Some(first) = child.first {
            self.first.get_or_insert(first);
        }
        if child.last.is_some() {
            self.last = child.last;
        }
    }
}

#[derive(Debug)]
pub(super) struct InlineExit {
    pub(super) has_own_borders: bool,
    pub(super) margin_left: f64,
    pub(super) margin_right: f64,
}

pub(super) fn apply_inline_exit(
    output: &mut [InlineSegment],
    summary: &TextSegmentSummary,
    exit: InlineExit,
) {
    let (Some(first), Some(last)) = (summary.first, summary.last) else {
        return;
    };
    if let Some(text) = output[first].as_text_mut() {
        text.border_start |= exit.has_own_borders;
        if exit.margin_left > 0.0 {
            text.inline_margin_left = Some(exit.margin_left);
        }
    }
    if let Some(text) = output[last].as_text_mut() {
        text.border_end |= exit.has_own_borders;
        if exit.margin_right > 0.0 {
            text.inline_margin_right = Some(exit.margin_right);
        }
    }
}
