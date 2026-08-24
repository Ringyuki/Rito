use std::{num::NonZeroUsize, sync::Arc};

use serde_json::Map;

use super::super::PendingInlineCandidateCleanup;
use crate::{
    layout::{
        inline_content::pending::PendingInlineCandidateCollector,
        inline_segment::{InlineSegment, TextSegment},
        text_mapping::TextSegmentMapping,
        text_work::{TextWorkBudget, TextWorkMeter},
    },
    style::{StyledNode, StyledNodeKind},
};

pub(super) const LARGE_NODE_COUNT: usize = 16_384;

pub(super) fn collector_without_root() -> PendingInlineCandidateCollector {
    let mut owner = PendingInlineCandidateCollector::new(Vec::new(), None, None);
    owner.initial_root = None;
    owner
}

pub(super) fn drive_q1(cleanup: &mut PendingInlineCandidateCleanup, limit: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert_one(cleanup);
        steps += 1;
        assert!(steps < limit, "candidate cleanup must not livelock");
    }
    steps
}

pub(super) fn assert_one(cleanup: &mut PendingInlineCandidateCleanup) {
    let progress = cleanup.advance(q1());
    assert_eq!(progress.consumed_units, 1);
}

pub(super) fn q1() -> NonZeroUsize {
    NonZeroUsize::MIN
}

pub(super) fn unlimited_meter() -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(NonZeroUsize::MAX, NonZeroUsize::MAX))
}

pub(super) fn text_segment_with_source(source_text: Arc<str>) -> InlineSegment {
    InlineSegment::Text(TextSegment {
        text: source_text.to_string(),
        mapping: TextSegmentMapping::synthetic(),
        style: Map::new(),
        href: None,
        source_path: None,
        source_text: Some(source_text),
        source_text_offset: None,
        ruby_annotation: None,
        inline_margin_left: None,
        inline_margin_right: None,
        border_start: false,
        border_end: false,
    })
}

pub(super) fn deep_inline(node_count: usize) -> StyledNode {
    let mut node = leaf(StyledNodeKind::Inline);
    for _ in 1..node_count {
        node = branch(StyledNodeKind::Inline, vec![node]);
    }
    node
}

pub(super) fn text_node(content: &str) -> StyledNode {
    let mut node = leaf(StyledNodeKind::Text);
    node.content = Some(content.to_owned());
    node
}

pub(super) fn ruby_node(children: Vec<StyledNode>) -> StyledNode {
    let mut node = branch(StyledNodeKind::Inline, children);
    node.tag = Some("ruby".to_owned());
    node
}

pub(super) fn leaf(kind: StyledNodeKind) -> StyledNode {
    branch(kind, Vec::new())
}

fn branch(kind: StyledNodeKind, children: Vec<StyledNode>) -> StyledNode {
    StyledNode {
        node_type: kind,
        tag: None,
        content: None,
        source_text: None,
        src: None,
        alt: None,
        id: None,
        href: None,
        colspan: None,
        rowspan: None,
        style: Map::new(),
        children,
        source_ref: None,
    }
}
