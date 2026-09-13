//! `TreeBuilder`'s inline-level pass. Flattens a run of inline-level nodes
//! into an `InlineCollector`: text nodes collapse or keep their white space
//! by their computed mode (a lone newline is a `<br>` forced break), styled
//! inline elements carry propagated decorations, a link scope and a
//! baseline shift, `display: inline-block` spans become atomic
//! mini-paragraphs, and `<ruby>` collects as mono-ruby base/annotation
//! pairs. The free functions resolve an inline box's baseline shift from
//! its `vertical-align`, flatten ruby parts to plain text, and collapse an
//! annotation's white space.

use rito_fragment::{FormattingNode, FormattingNodeContent, InlineItem};
use rito_style_contract::{
    LayoutDisplayInside, LayoutDisplayOutside, LayoutStyleId, StyleId, WhiteSpaceCollapse,
};

use super::{element_source_index, inline_items_have_substance};
use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::{InlineCollector, TreeBuilder};
use crate::xhtml::{DocumentNode, ElementNode};

impl TreeBuilder<'_> {
    pub(super) fn collect_inline(
        &mut self,
        node: &DocumentNode,
        inherited: StyleId,
        ancestor_shift_px: f64,
        collector: &mut InlineCollector,
    ) -> EpubResult<()> {
        match node {
            DocumentNode::Text(text) => {
                // The parser encodes <br> as a text node holding exactly
                // one newline (the frozen engine shares this convention):
                // a forced line break, not collapsible white space.
                if text.content == "\n" {
                    collector.push_hard_break(inherited, ancestor_shift_px);
                    return Ok(());
                }
                // Preserved white space bypasses BOTH collapse layers:
                // the parser pre-collapsed `content` (keeping the raw in
                // `source_text` when it changed), and the whitespace-only
                // shortcut below would drop an indent-only run entirely
                // (measured: a calibre story's four-space paragraph
                // indents, kept by Blink under `white-space: pre-wrap`).
                if !self.white_space_collapse(inherited)? {
                    self.require_inline_capabilities(inherited, false, "text run")?;
                    collector.push_text(
                        text.source_text.as_deref().unwrap_or(&text.content),
                        inherited,
                        ancestor_shift_px,
                        false,
                        None,
                        text.source_ref.source_node_id.map(|id| id.index()),
                        Some(text.source_ref.node_path.clone()),
                    );
                    return Ok(());
                }
                // White-space-only runs collapse away without needing a
                // style of their own (inter-element formatting text).
                if text
                    .content
                    .chars()
                    .all(|ch| matches!(ch, ' ' | '\t' | '\n' | '\r'))
                {
                    collector.push_collapsible_whitespace(inherited);
                    return Ok(());
                }
                self.require_inline_capabilities(inherited, false, "text run")?;
                let collapse = self.white_space_collapse(inherited)?;
                collector.push_text(
                    &text.content,
                    inherited,
                    ancestor_shift_px,
                    collapse,
                    None,
                    text.source_ref.source_node_id.map(|id| id.index()),
                    Some(text.source_ref.node_path.clone()),
                );
                Ok(())
            }
            DocumentNode::Inline(element) => {
                if element.tag == "ruby" {
                    return self.collect_ruby(element, ancestor_shift_px, collector);
                }
                if element.tag == "rt" || element.tag == "rp" {
                    // Annotation parts outside a <ruby> are malformed
                    // markup; render their text as plain inline content
                    // rather than dropping the chapter.
                    self.degrade(format!(
                        "<{}> outside <ruby> rendered as plain text",
                        element.tag
                    ));
                }
                let source_index = element_source_index(element)?;
                if self.is_display_none(source_index, &element.tag) {
                    return Ok(());
                }
                let style = self.inline_style_id(source_index, &element.tag);
                self.require_inline_capabilities(style, true, &element.tag)?;
                let style = self.propagate_text_decorations(style, inherited)?;
                let resolved = self
                    .inline
                    .style(style)
                    .map_err(|error| EpubError::new(format!("{} style: {error}", element.tag)))?;
                let parent_font_size = self
                    .inline
                    .style(inherited)
                    .map(|parent| f64::from(parent.font.size.get()))
                    .map_err(|error| {
                        EpubError::new(format!("{} parent style: {error}", element.tag))
                    })?;
                let parent_style = self.inline.style(inherited).ok();
                let shift = ancestor_shift_px
                    + resolved_baseline_shift_with_parent(resolved, parent_font_size, parent_style);
                // An <a href> scopes its destination over everything it
                // contains; nested links (invalid HTML) keep the inner.
                let link = (element.tag == "a")
                    .then(|| {
                        element
                            .attributes
                            .as_ref()
                            .and_then(|attributes| attributes.href.clone())
                    })
                    .flatten();
                let saved_link = match link {
                    Some(href) => Some(collector.current_link.replace(href)),
                    None => None,
                };
                // A `display: inline-block` span is an ATOMIC inline: its
                // content becomes a hidden mini-paragraph node the inline
                // engine lays out recursively at shrink-to-fit width
                // (CSS 2.1 §10.3.5), riding the host line as one box whose
                // baseline is its last line's (§10.8.1). Content that is
                // not inline-only falls back to plain flattening.
                let layout_style_id = self.layout_style_id(source_index, &element.tag);
                let is_inline_block = self
                    .layout
                    .style(layout_style_id)
                    .map(|resolved| {
                        resolved.display.outside == LayoutDisplayOutside::Inline
                            && resolved.display.inside == LayoutDisplayInside::FlowRoot
                    })
                    .unwrap_or(false);
                if is_inline_block
                    && self.collect_inline_block(
                        element,
                        source_index,
                        style,
                        layout_style_id,
                        shift,
                        collector,
                    )?
                {
                    if let Some(saved) = saved_link {
                        collector.current_link = saved;
                    }
                    return Ok(());
                }
                if element.children.is_empty() {
                    // A childless inline box still opens on the line: its
                    // font's leaded envelope around its shifted baseline
                    // joins the line metrics (an empty <sup> footnote
                    // anchor grows the line exactly like one holding a
                    // marker; measured, Blink lifts the whole first line
                    // of a page by the sup envelope with nothing in it).
                    collector.push_empty_box(style, shift, source_index);
                }
                for child in &element.children {
                    self.collect_inline(child, style, shift, collector)?;
                }
                if let Some(saved) = saved_link {
                    collector.current_link = saved;
                }
                Ok(())
            }
            DocumentNode::Image(image) => {
                self.collect_image(image, inherited, ancestor_shift_px, collector)
            }
            DocumentNode::Block(element) => Err(EpubError::new(format!(
                "block-level <{}> inside an inline run; anonymous box grouping missed it",
                element.tag
            ))),
        }
    }

    /// Builds one `display: inline-block` span into an atomic inline: a
    /// hidden mini-paragraph node holding its (inline-only) content, and
    /// an `InlineItem::InlineBlock` referencing it. Returns `false` —
    /// pushing nothing — when the content is not representable as a flow
    /// (a block child inside), so the caller flattens instead. A failed
    /// attempt may leave orphan nodes in the arena; they are unreachable
    /// and ids are never reused, so they cost only their bytes.
    fn collect_inline_block(
        &mut self,
        element: &ElementNode,
        source_index: usize,
        style: StyleId,
        layout_style: LayoutStyleId,
        baseline_shift_px: f64,
        collector: &mut InlineCollector,
    ) -> EpubResult<bool> {
        let mut sub = self.inline_collector();
        sub.current_link = collector.current_link.clone();
        for child in &element.children {
            if let Err(error) = self.collect_inline(child, style, 0.0, &mut sub) {
                self.degrade(format!(
                    "<{}> inline-block content not inline-only ({error:?}); flattened",
                    element.tag
                ));
                return Ok(false);
            }
        }
        let (items, sources) = sub.finish();
        if !inline_items_have_substance(&items) {
            // An empty inline-block has no ink and no last-line baseline;
            // the flattening path yields the same nothing.
            return Ok(false);
        }
        let node = self.push_node(
            FormattingNode {
                style: layout_style,
                content: FormattingNodeContent::InlineFlow { items },
                children: Vec::new(),
            },
            Some(source_index),
        );
        self.strut_styles.insert(node.0, style);
        self.flow_item_sources.insert(node.0, sources);
        collector.push_image(
            InlineItem::InlineBlock {
                node,
                style,
                layout_style,
                baseline_shift_px,
            },
            source_index,
            element.source_ref.node_path.clone(),
            "",
        );
        Ok(true)
    }

    /// Collects one `<ruby>` element as mono-ruby pairs: each `<rt>` closes
    /// the base text accumulated before it, producing one text item whose
    /// annotation paints above that base segment's laid-out extent at half
    /// the base font size (the reader's ruby convention, shared with the
    /// retained engine). The base segments shape and break with the flow
    /// like ordinary text. `<rp>` fallback parentheses render only when
    /// ruby is unsupported, so they drop. Anything beyond plain-text bases
    /// and annotations — nested markup, images — fails closed by name.
    fn collect_ruby(
        &mut self,
        element: &ElementNode,
        ancestor_shift_px: f64,
        collector: &mut InlineCollector,
    ) -> EpubResult<()> {
        let source_index = element_source_index(element)?;
        if self.is_display_none(source_index, "ruby") {
            return Ok(());
        }
        let style = self.inline_style_id(source_index, "ruby");
        self.require_inline_capabilities(style, true, "ruby")?;
        let collapse = self.white_space_collapse(style)?;
        let mut pending_base = String::new();
        for child in &element.children {
            match child {
                DocumentNode::Text(text) => pending_base.push_str(&text.content),
                DocumentNode::Inline(inner) if inner.tag == "rt" => {
                    let mut text = String::new();
                    if collect_plain_text(&inner.children, &mut text).is_err() {
                        self.degrade("ruby annotation markup flattened to text".to_owned());
                        text.clear();
                        collect_text_lenient(&inner.children, &mut text);
                    }
                    let annotation = collapse_annotation_text(&text, collapse);
                    if pending_base.trim().is_empty() && !annotation.is_empty() {
                        self.degrade("ruby annotation without a base dropped".to_owned());
                        continue;
                    }
                    // The annotation size is the rt element's cascaded
                    // font-size relative to the base (UA default 50%,
                    // commonly overridden — `rt { font-size: 0.55em }` in
                    // the measured corpus grew every title line one px).
                    let rt_source_index = element_source_index(inner)?;
                    let rt_style = self.inline_style_id(rt_source_index, "rt");
                    let size_ratio = match (self.inline.style(rt_style), self.inline.style(style)) {
                        (Ok(rt_resolved), Ok(base_resolved))
                            if base_resolved.font.size.get() > 0.0 =>
                        {
                            rt_resolved.font.size.get() / base_resolved.font.size.get()
                        }
                        _ => 0.5,
                    };
                    // The annotation container's own computed `ruby-align`
                    // (inherited from the ruby element unless rt overrides)
                    // drives how the painted annotation distributes.
                    let ruby_align = self
                        .inline
                        .style(rt_style)
                        .map(|rt_resolved| rt_resolved.text_flow.ruby_align)
                        .unwrap_or(rito_style_contract::RubyAlign::SpaceAround);
                    collector.push_text(
                        &std::mem::take(&mut pending_base),
                        style,
                        ancestor_shift_px,
                        collapse,
                        Some(annotation)
                            .filter(|text| !text.is_empty())
                            .map(|text| rito_fragment::RubyAnnotation {
                                text,
                                size_ratio,
                                align: ruby_align,
                            }),
                        Some(source_index),
                        Some(element.source_ref.node_path.clone()),
                    );
                }
                DocumentNode::Inline(inner) if inner.tag == "rp" => {}
                DocumentNode::Inline(inner) if inner.tag == "rb" => {
                    if collect_plain_text(&inner.children, &mut pending_base).is_err() {
                        self.degrade("ruby base markup flattened to text".to_owned());
                        collect_text_lenient(&inner.children, &mut pending_base);
                    }
                }
                DocumentNode::Inline(inner) => {
                    // Nested inline markup inside a ruby base: flatten to
                    // its text so the base still reads.
                    self.degrade(format!(
                        "ruby base <{}> markup flattened to text",
                        inner.tag
                    ));
                    collect_text_lenient(&inner.children, &mut pending_base);
                }
                DocumentNode::Image(_) | DocumentNode::Block(_) => {
                    self.degrade("non-text ruby content dropped".to_owned());
                }
            }
        }
        if !pending_base.is_empty() {
            collector.push_text(
                &pending_base,
                style,
                ancestor_shift_px,
                collapse,
                None,
                Some(source_index),
                Some(element.source_ref.node_path.clone()),
            );
        }
        Ok(())
    }

    fn white_space_collapse(&mut self, style: StyleId) -> EpubResult<bool> {
        let collapse = {
            let style = self
                .inline
                .style(style)
                .map_err(|error| EpubError::new(format!("inline style resolves: {error}")))?;
            style.text_flow.white_space_collapse
        };
        match collapse {
            WhiteSpaceCollapse::Collapse => Ok(true),
            // Fully implemented: the collector's verbatim path keeps
            // spaces and segment breaks, and a preserved newline is a
            // forced break in the inline engine.
            WhiteSpaceCollapse::Preserve => Ok(false),
            // Partially preserved modes keep their spaces; their break
            // subtleties are approximated by the wrapping line breaker.
            other => {
                self.degrade(format!(
                    "preserved white space approximated (spaces kept, hard breaks wrap): {other:?}"
                ));
                Ok(false)
            }
        }
    }
}

/// The baseline shift one inline box asks for, CSS px; positive raises
/// content above the baseline. `super`/`sub` shift by the PARENT's font
/// (CSS 2.1 §10.8.1: "the proper position for superscripts of the
/// parent's box"), measured per size against the pinned browser
/// (sup/sub marker probes, 2026-07-26, Chromium 147): super raises by
/// `floor64(parent_em / 3) + 1`, sub drops by
/// `floor64(parent_em / 5) + 1`, where floor64 is Blink's LayoutUnit
/// (1/64 px) floor. The offsets do not depend on the shifted box's own
/// font size.
pub(super) fn resolved_baseline_shift(
    style: &rito_style_contract::InlineFormattingStyle,
    parent_font_size_px: f64,
) -> f64 {
    resolved_baseline_shift_with_parent(style, parent_font_size_px, None)
}

fn resolved_baseline_shift_with_parent(
    style: &rito_style_contract::InlineFormattingStyle,
    parent_font_size_px: f64,
    parent: Option<&rito_style_contract::InlineFormattingStyle>,
) -> f64 {
    let layout_unit_floor = |value: f64| (value * 64.0).floor() / 64.0;
    // The box's half of the line box below (or above) the baseline:
    // half-leading plus the descent (ascent) share of the em, on the
    // 0.88/0.12 split the super/sub offsets already assume.
    let line_height_px = |s: &rito_style_contract::InlineFormattingStyle| {
        let fs = f64::from(s.font.size.get());
        match s.font.line_height {
            rito_style_contract::LineHeight::Number(n) => f64::from(n.get()) * fs,
            rito_style_contract::LineHeight::Length(px) => f64::from(px.get()),
            rito_style_contract::LineHeight::Normal => fs * 1.2,
        }
    };
    let below = |s: &rito_style_contract::InlineFormattingStyle| {
        let fs = f64::from(s.font.size.get());
        (line_height_px(s) - fs) / 2.0 + 0.12 * fs
    };
    let above = |s: &rito_style_contract::InlineFormattingStyle| {
        let fs = f64::from(s.font.size.get());
        (line_height_px(s) - fs) / 2.0 + 0.88 * fs
    };
    match style.fragment.baseline_shift {
        rito_style_contract::BaselineShift::Super => {
            layout_unit_floor(parent_font_size_px / 3.0) + 1.0
        }
        rito_style_contract::BaselineShift::Sub => {
            -(layout_unit_floor(parent_font_size_px / 5.0) + 1.0)
        }
        // The box's bottom edge sits on the line-under edge: the shift
        // is the strut's below-baseline share minus the box's own
        // (Range-measured on a 1.2em line-height-1 span in a
        // 15.2px/1.35 paragraph: the span sits 2.28px lower than the
        // baseline position; the strut share formula gives 2.295).
        // A box deeper than the strut clamps to zero — it defines the
        // under edge itself.
        rito_style_contract::BaselineShift::Bottom => parent
            .map(|strut| -(below(strut) - below(style)).max(0.0))
            .unwrap_or(0.0),
        // Mirror for the line-over edge; measured, the strut and a
        // taller span cancel to ~0 in the common title case.
        rito_style_contract::BaselineShift::Top => parent
            .map(|strut| (above(strut) - above(style)).max(0.0))
            .unwrap_or(0.0),
        // Zero offsets pass the whitelist; every other value is rejected
        // there before reaching this resolver.
        _ => 0.0,
    }
}

/// Flattens all text content into `out`, descending through inline
/// markup and skipping non-text nodes — the lenient ruby fallback.
fn collect_text_lenient(nodes: &[DocumentNode], out: &mut String) {
    for node in nodes {
        match node {
            DocumentNode::Text(text) => out.push_str(&text.content),
            DocumentNode::Inline(element) => collect_text_lenient(&element.children, out),
            DocumentNode::Image(_) | DocumentNode::Block(_) => {}
        }
    }
}

/// Flattens nested plain text (text nodes only) into `out`; any element
/// or image inside fails closed, keeping ruby parts honest.
fn collect_plain_text(nodes: &[DocumentNode], out: &mut String) -> EpubResult<()> {
    for node in nodes {
        match node {
            DocumentNode::Text(text) => out.push_str(&text.content),
            DocumentNode::Inline(element) => {
                return Err(EpubError::new(format!(
                    "ruby part with nested <{}> markup is not representable yet",
                    element.tag
                )));
            }
            DocumentNode::Image(_) | DocumentNode::Block(_) => {
                return Err(EpubError::new(
                    "ruby part with non-text content is not representable yet",
                ));
            }
        }
    }
    Ok(())
}

/// An annotation's text as its own inline formatting context lays it
/// out: under `white-space-collapse: collapse` every run of collapsible
/// white space (spaces, tabs, line breaks — CSS Text §4.1, never a
/// Unicode space separator such as an en space or a no-break space,
/// which shapes as its own glyph) becomes one space and the line's
/// leading and trailing spaces are removed; a preserving value keeps the
/// text as written. Measured on a book whose Latin annotations space
/// their words with U+2002: Unicode-splitting them to plain spaces
/// shaped every gap at the book face's space width instead of the en
/// space's half em the browser falls back to, packing every such
/// annotation short of the browser's.
fn collapse_annotation_text(text: &str, collapse: bool) -> String {
    if !collapse {
        return text.to_owned();
    }
    let collapsible = |ch: char| matches!(ch, ' ' | '\t' | '\n' | '\r' | '\u{000C}');
    let mut out = String::with_capacity(text.len());
    let mut pending_space = false;
    for ch in text.chars() {
        if collapsible(ch) {
            pending_space = !out.is_empty();
            continue;
        }
        if pending_space {
            out.push(' ');
            pending_space = false;
        }
        out.push(ch);
    }
    out
}
