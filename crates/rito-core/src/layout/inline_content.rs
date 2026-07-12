use serde_json::{Map, Value};

use super::{
    inline_atoms::{create_image_atom, create_inline_block_atom},
    inline_ruby::collect_ruby_segments,
    inline_segment::{InlineSegment, SegmentContext, TextSegment},
    style_values::*,
    text_mapping::{finalize_inline_text_flow, TextMappingCandidate, TextSegmentMapping},
};
use crate::style::{StyledNode, StyledNodeKind};
pub(super) use whitespace::WhitespaceCollapseState;
use whitespace::{normalize_text_for_white_space, reset_whitespace_after_atom};

pub(crate) use super::inline_summary::normalize_inline_segment;

#[cfg(test)]
mod mapping_tests;
#[cfg(test)]
mod tests;
mod whitespace;

pub(crate) fn flatten_inline_content(
    nodes: &[StyledNode],
    context: SegmentContext<'_>,
) -> Vec<InlineSegment> {
    let mut segments = Vec::new();
    let mut whitespace = WhitespaceCollapseState::default();
    collect_segments(nodes, &mut segments, &context, &mut whitespace);
    finalize_inline_text_flow(&mut segments);
    segments
}

pub(super) fn collect_segments(
    nodes: &[StyledNode],
    out: &mut Vec<InlineSegment>,
    context: &SegmentContext,
    whitespace: &mut WhitespaceCollapseState,
) {
    for node in nodes {
        collect_segment_node(node, out, context, whitespace);
    }
}

fn collect_segment_node(
    node: &StyledNode,
    out: &mut Vec<InlineSegment>,
    context: &SegmentContext,
    whitespace: &mut WhitespaceCollapseState,
) {
    match node.node_type {
        StyledNodeKind::Text => collect_text_segment(node, out, context, whitespace),
        StyledNodeKind::Inline => collect_inline_segments(node, out, context, whitespace),
        StyledNodeKind::Image => collect_image_segment(node, out, context, whitespace),
        StyledNodeKind::Block => collect_inline_block_segment(node, out, whitespace),
    }
}

fn collect_text_segment(
    node: &StyledNode,
    out: &mut Vec<InlineSegment>,
    context: &SegmentContext,
    whitespace: &mut WhitespaceCollapseState,
) {
    let raw = node.content.as_deref().unwrap_or_default();
    if raw.is_empty() {
        return;
    }

    let style = patch_inherited_style(&node.style, context);
    let normalized = normalize_text_for_white_space(node, &style, whitespace);
    if normalized.text.is_empty() {
        return;
    }
    let display_text = apply_text_transform(&normalized.text, &style);
    let source_path = node
        .source_ref
        .as_ref()
        .map(|source| source.node_path.clone());
    let mapping = TextSegmentMapping::Candidate(TextMappingCandidate::new(
        normalized.text.clone(),
        source_path.clone(),
        normalized.source_text_offset,
        normalized.source_basis,
        &display_text,
    ));
    out.push(InlineSegment::Text(TextSegment {
        text: display_text,
        mapping,
        style,
        href: context.href.clone(),
        source_path,
        source_text: node.source_ref.as_ref().map(|_| normalized.source_text),
        source_text_offset: (normalized.source_text_offset > 0)
            .then_some(normalized.source_text_offset),
        ruby_annotation: None,
        inline_margin_left: None,
        inline_margin_right: None,
        border_start: false,
        border_end: false,
    }));
}

fn collect_inline_segments(
    node: &StyledNode,
    out: &mut Vec<InlineSegment>,
    context: &SegmentContext,
    whitespace: &mut WhitespaceCollapseState,
) {
    if node.tag.as_deref() == Some("ruby") {
        collect_ruby_segments(node, out, context, whitespace);
        return;
    }

    let child = build_inline_child_context(node, context);
    let before_len = out.len();
    collect_segments(&node.children, out, &child.context, whitespace);
    mark_inline_fragments(out, before_len, node, child.has_own_borders);
}

fn collect_image_segment(
    node: &StyledNode,
    out: &mut Vec<InlineSegment>,
    context: &SegmentContext,
    whitespace: &mut WhitespaceCollapseState,
) {
    let mut atom = create_image_atom(node, context.image_sizes);
    atom.href = context.href.clone();
    if context.vertical_align.is_some()
        && string_style(&atom.style, "verticalAlign").as_deref() == Some("baseline")
    {
        if let Some(vertical_align) = &context.vertical_align {
            atom.style.insert(
                "verticalAlign".to_owned(),
                Value::String(vertical_align.clone()),
            );
        }
    }
    out.push(InlineSegment::Atom(atom));
    reset_whitespace_after_atom(whitespace);
}

fn collect_inline_block_segment(
    node: &StyledNode,
    out: &mut Vec<InlineSegment>,
    whitespace: &mut WhitespaceCollapseState,
) {
    if string_style(&node.style, "display").as_deref() == Some("inline-block") {
        out.push(InlineSegment::Atom(create_inline_block_atom(node)));
        reset_whitespace_after_atom(whitespace);
    }
}

struct InlineChildContext<'a> {
    context: SegmentContext<'a>,
    has_own_borders: bool,
}

fn build_inline_child_context<'a>(
    node: &StyledNode,
    inherited: &SegmentContext<'a>,
) -> InlineChildContext<'a> {
    let has_own_borders = has_inline_borders(&node.style);
    InlineChildContext {
        has_own_borders,
        context: SegmentContext {
            image_sizes: inherited.image_sizes,
            href: node.href.clone().or_else(|| inherited.href.clone()),
            bg_color: non_empty_string_style(&node.style, "backgroundColor")
                .or_else(|| inherited.bg_color.clone()),
            vertical_align: non_baseline_vertical_align(&node.style)
                .or_else(|| inherited.vertical_align.clone()),
            padding: if has_inline_padding(&node.style) {
                Some(padding_from_style(&node.style))
            } else {
                inherited.padding.clone()
            },
            border_radius: if number_style(&node.style, "borderRadius").unwrap_or(0.0) > 0.0 {
                number_style(&node.style, "borderRadius")
            } else {
                inherited.border_radius
            },
            borders: if has_own_borders {
                Some(merge_borders(
                    inherited.borders.as_ref(),
                    &borders_from_style(&node.style),
                ))
            } else {
                inherited.borders.clone()
            },
        },
    }
}

fn patch_inherited_style(
    style: &Map<String, Value>,
    context: &SegmentContext,
) -> Map<String, Value> {
    let needs_bg = context.bg_color.is_some()
        && string_style(style, "backgroundColor")
            .as_deref()
            .unwrap_or_default()
            .is_empty();
    let needs_vertical_align = context.vertical_align.is_some()
        && string_style(style, "verticalAlign").as_deref() == Some("baseline");
    let needs_padding = context.padding.is_some() && !has_inline_padding(style);
    let needs_border_radius = context.border_radius.is_some()
        && number_style(style, "borderRadius").unwrap_or(0.0) <= 0.0;
    let needs_borders = context.borders.is_some();

    if !needs_bg
        && !needs_vertical_align
        && !needs_padding
        && !needs_border_radius
        && !needs_borders
    {
        return style.clone();
    }

    let mut patched = style.clone();
    if needs_bg {
        if let Some(bg_color) = &context.bg_color {
            patched.insert(
                "backgroundColor".to_owned(),
                Value::String(bg_color.clone()),
            );
        }
    }
    if needs_vertical_align {
        if let Some(vertical_align) = &context.vertical_align {
            patched.insert(
                "verticalAlign".to_owned(),
                Value::String(vertical_align.clone()),
            );
        }
    }
    if needs_padding {
        if let Some(padding) = &context.padding {
            insert_number(&mut patched, "paddingTop", padding.top);
            insert_number(&mut patched, "paddingRight", padding.right);
            insert_number(&mut patched, "paddingBottom", padding.bottom);
            insert_number(&mut patched, "paddingLeft", padding.left);
        }
    }
    if needs_border_radius {
        if let Some(border_radius) = context.border_radius {
            insert_number(&mut patched, "borderRadius", border_radius);
        }
    }
    if needs_borders {
        let borders = merge_inherited_borders(&patched, context.borders.as_ref());
        patched.insert("borderTop".to_owned(), borders.top);
        patched.insert("borderRight".to_owned(), borders.right);
        patched.insert("borderBottom".to_owned(), borders.bottom);
        patched.insert("borderLeft".to_owned(), borders.left);
    }

    patched
}

fn mark_inline_fragments(
    out: &mut [InlineSegment],
    before_len: usize,
    node: &StyledNode,
    has_own_borders: bool,
) {
    let margin_left = number_style(&node.style, "marginLeft").unwrap_or(0.0);
    let margin_right = number_style(&node.style, "marginRight").unwrap_or(0.0);
    let has_inline_margin = margin_left > 0.0 || margin_right > 0.0;
    if (!has_own_borders && !has_inline_margin) || out.len() <= before_len {
        return;
    }

    let Some((first, last)) = find_text_segment_range(out, before_len) else {
        return;
    };
    if let Some(segment) = out[first].as_text_mut() {
        if has_own_borders {
            segment.border_start = true;
        }
        if margin_left > 0.0 {
            segment.inline_margin_left = Some(margin_left);
        }
    }
    if let Some(segment) = out[last].as_text_mut() {
        if has_own_borders {
            segment.border_end = true;
        }
        if margin_right > 0.0 {
            segment.inline_margin_right = Some(margin_right);
        }
    }
}

fn find_text_segment_range(out: &[InlineSegment], start: usize) -> Option<(usize, usize)> {
    let mut first = None;
    let mut last = None;
    for (index, segment) in out.iter().enumerate().skip(start) {
        if !segment.is_atom() {
            first.get_or_insert(index);
            last = Some(index);
        }
    }
    first.zip(last)
}

fn insert_number(output: &mut Map<String, Value>, key: &str, value: f64) {
    output.insert(key.to_owned(), paint_number_value(value));
}
