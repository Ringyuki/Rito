use super::{
    inline_content::flatten_inline_content,
    inline_segment::{InlineSegment, SegmentContext},
};
use crate::style::{StyledNode, StyledNodeKind};

pub(crate) fn collect_ruby_segments(
    node: &StyledNode,
    out: &mut Vec<InlineSegment>,
    context: &SegmentContext,
) {
    let mut pending_base_nodes = Vec::new();

    for child in &node.children {
        if child.node_type == StyledNodeKind::Text {
            pending_base_nodes.push(child.clone());
        } else if child.node_type == StyledNodeKind::Inline {
            pending_base_nodes = handle_ruby_inline_child(child, pending_base_nodes, out, context);
        }
    }

    flush_ruby_base(&pending_base_nodes, "", out, context);
}

fn handle_ruby_inline_child(
    child: &StyledNode,
    pending_base_nodes: Vec<StyledNode>,
    out: &mut Vec<InlineSegment>,
    context: &SegmentContext,
) -> Vec<StyledNode> {
    match child.tag.as_deref() {
        Some("rt") => {
            flush_ruby_base(&pending_base_nodes, &extract_text(child), out, context);
            Vec::new()
        }
        Some("rp") => pending_base_nodes,
        Some("rb") => {
            flush_ruby_base(&pending_base_nodes, "", out, context);
            child.children.clone()
        }
        _ => {
            let mut next = pending_base_nodes;
            next.push(child.clone());
            next
        }
    }
}

fn flush_ruby_base(
    pending_base_nodes: &[StyledNode],
    annotation: &str,
    out: &mut Vec<InlineSegment>,
    context: &SegmentContext,
) {
    if pending_base_nodes.is_empty() {
        return;
    }
    let ruby_context = SegmentContext {
        href: context.href.clone(),
        bg_color: context.bg_color.clone(),
        vertical_align: context.vertical_align.clone(),
        ..SegmentContext::default()
    };
    let mut base_segments = flatten_inline_content(pending_base_nodes, ruby_context);
    if !annotation.is_empty() {
        for segment in &mut base_segments {
            if let InlineSegment::Text(text) = segment {
                text.ruby_annotation = Some(annotation.to_owned());
            }
        }
    }
    out.extend(base_segments);
}

fn extract_text(node: &StyledNode) -> String {
    if node.node_type == StyledNodeKind::Text {
        return node.content.clone().unwrap_or_default();
    }

    node.children.iter().map(extract_text).collect::<String>()
}
