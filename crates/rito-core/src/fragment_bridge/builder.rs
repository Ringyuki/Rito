//! `TreeBuilder`'s block-level pass. Walks a chapter's parsed nodes, groups
//! runs of inline-level siblings into (anonymous) inline flows, builds block
//! containers, regroups the blocks the parser hoisted out of a block-level
//! `<a>`, and interns the derived styles the pass needs on the fly: border
//! widths absorbed as padding, a container's text style with its own box
//! stripped, an anonymous flow's strut without the parent's indent, and
//! text decorations propagated from an ancestor inline box. Also holds the
//! chapter body's background lookup, the per-style cache of box-paint
//! plans, and the source-index, substance and zero-length helpers shared
//! with the sibling passes under `builder/`.

use rito_fragment::{FormattingNode, FormattingNodeContent, FormattingNodeId, InlineItem};
use rito_style_contract::{
    JustifyContent, LayoutDisplayInside, LayoutDisplayOutside, LayoutStyleId, LengthPercentage,
    NonNegativeLengthPercentage, StyleId,
};

use capability::box_decoration_violation;

use super::box_paint::block_box_paint;
use super::styles::list_marker_text;
use super::{InlineCollector, ListMarkerPaint, NodePaint, TreeBuilder};
use crate::epub::{EpubError, EpubResult};
use crate::render::contract::ReaderColor;
use crate::xhtml::{DocumentNode, ElementNode};

mod capability;
mod inline;
mod replaced;
mod table;

impl TreeBuilder<'_> {
    /// Records one approximation the tree build applied instead of
    /// failing the chapter. Deduplicated: one entry per distinct reason.
    fn degrade(&mut self, reason: String) {
        if !self.degradations.contains(&reason) {
            self.degradations.push(reason);
        }
    }

    pub(super) fn push_node(
        &mut self,
        node: FormattingNode,
        source: Option<usize>,
    ) -> FormattingNodeId {
        let id = FormattingNodeId(self.nodes.len() as u32);
        self.nodes.push(node);
        self.source_nodes.push(source);
        id
    }

    pub(super) fn layout_style_id(&mut self, source_index: usize, what: &str) -> LayoutStyleId {
        match self.layout.node_style_id(source_index) {
            Ok(id) => id,
            Err(_) => {
                self.degrade(format!(
                    "<{what}> layout style missing: block defaults applied"
                ));
                self.anonymous_style
            }
        }
    }

    pub(super) fn inline_style_id(&mut self, source_index: usize, what: &str) -> StyleId {
        match self.inline.node_style_id(source_index) {
            Ok(id) => id,
            Err(_) => {
                self.degrade(format!(
                    "<{what}> inline style missing: text defaults applied"
                ));
                self.fallback_inline_style
            }
        }
    }

    fn is_display_none(&mut self, source_index: usize, what: &str) -> bool {
        match self.layout.style_for_node(source_index) {
            Ok(style) => style.display.outside == LayoutDisplayOutside::None,
            Err(_) => {
                self.degrade(format!("<{what}> layout style missing: treated as visible"));
                false
            }
        }
    }

    /// Builds the formatting children of one block-level container from its
    /// document children, grouping runs of inline-level content into inline
    /// flows (anonymous ones when block-level siblings are present).
    pub(super) fn build_children(
        &mut self,
        children: &[DocumentNode],
        container_inline_style: StyleId,
    ) -> EpubResult<Vec<FormattingNodeId>> {
        let mut built = Vec::new();
        let mut pending_inline: Vec<&DocumentNode> = Vec::new();
        let mut index = 0;
        while index < children.len() {
            let child = &children[index];
            match child {
                DocumentNode::Block(element) => {
                    self.flush_inline_run(&mut pending_inline, container_inline_style, &mut built)?;
                    if let Some((consumed, id)) = self.rebuild_block_anchor(&children[index..])? {
                        if let Some(id) = id {
                            built.push(id);
                        }
                        index += consumed;
                        continue;
                    }
                    if let Some(id) = self.build_block(element)? {
                        built.push(id);
                    }
                }
                inline_level => pending_inline.push(inline_level),
            }
            index += 1;
        }
        self.flush_inline_run(&mut pending_inline, container_inline_style, &mut built)?;
        Ok(built)
    }

    /// Restores the box of a `display: block` anchor the parser unwrapped.
    ///
    /// The parse-time hoist cannot see styles, so a block-child `<a>` is
    /// flattened and its class-derived box lost (b2's TOC entries each
    /// shrank by the `.toc a` padding). Consecutive siblings hoisted from
    /// one anchor regroup under a synthetic block carrying the anchor's
    /// computed layout style; an anchor whose computed display stays
    /// inline keeps the flattened shape, which is what CSS renders for a
    /// true inline wrapper around blocks.
    fn rebuild_block_anchor(
        &mut self,
        siblings: &[DocumentNode],
    ) -> EpubResult<Option<(usize, Option<FormattingNodeId>)>> {
        let DocumentNode::Block(first) = &siblings[0] else {
            return Ok(None);
        };
        let Some(anchor) = first.anchor_ref.clone() else {
            return Ok(None);
        };
        let Some(anchor_id) = anchor.source_node_id else {
            return Ok(None);
        };
        let Ok(anchor_layout) = self.layout.style_for_node(anchor_id.index()) else {
            return Ok(None);
        };
        if anchor_layout.display.outside != LayoutDisplayOutside::Block {
            return Ok(None);
        }
        // The hoist preserved the anchor's whitespace-only text nodes
        // between its blocks; they must not split the group (they
        // collapse to nothing inside the wrapper exactly as they did in
        // the flat shape — splitting on them wrapped every <p> in its
        // own padded box and doubled the anchor padding per entry).
        let mut consumed = 0;
        let mut scan = 0;
        while scan < siblings.len() {
            match &siblings[scan] {
                DocumentNode::Block(block)
                    if block
                        .anchor_ref
                        .as_ref()
                        .and_then(|reference| reference.source_node_id)
                        == Some(anchor_id) =>
                {
                    scan += 1;
                    consumed = scan;
                }
                DocumentNode::Text(text) if text.content.trim().is_empty() => {
                    scan += 1;
                }
                _ => break,
            }
        }
        let children = siblings[..consumed]
            .iter()
            .map(|node| match node {
                DocumentNode::Block(block) => {
                    let mut block = block.clone();
                    // The regroup consumed the marker; a stale one would
                    // regroup again inside the synthetic wrapper forever.
                    block.anchor_ref = None;
                    DocumentNode::Block(block)
                }
                other => other.clone(),
            })
            .collect();
        let synthetic = ElementNode {
            tag: "a".to_owned(),
            // The hrefs already ride the hoisted blocks; repeating them
            // on the wrapper would double the link surface.
            attributes: None,
            children,
            source_ref: anchor,
            anchor_ref: None,
        };
        Ok(Some((consumed, self.build_block(&synthetic)?)))
    }

    /// Wraps a pending run of inline-level siblings in an anonymous inline
    /// flow, dropping it when white-space collapsing leaves nothing.
    fn flush_inline_run(
        &mut self,
        pending: &mut Vec<&DocumentNode>,
        container_inline_style: StyleId,
        built: &mut Vec<FormattingNodeId>,
    ) -> EpubResult<()> {
        if pending.is_empty() {
            return Ok(());
        }
        let run = std::mem::take(pending);
        let container_inline_style = self.container_text_style(container_inline_style)?;
        let mut collector = self.inline_collector();
        for node in run {
            self.collect_inline(node, container_inline_style, 0.0, &mut collector)?;
        }
        let (items, sources) = collector.finish();
        if !inline_items_have_substance(&items) {
            return Ok(());
        }
        let id = self.push_node(
            FormattingNode {
                style: self.anonymous_style,
                content: FormattingNodeContent::InlineFlow { items },
                children: Vec::new(),
            },
            None,
        );
        let strut = self.anonymous_strut_style(container_inline_style)?;
        self.strut_styles.insert(id.0, strut);
        self.flow_item_sources.insert(id.0, sources);
        built.push(id);
        Ok(())
    }

    /// Builds one block-level element. Returns `None` for `display: none`.
    /// A fresh inline collector that starts inside the current block-level
    /// link scope, if any.
    fn inline_collector(&self) -> InlineCollector {
        InlineCollector {
            current_link: self.block_link.clone(),
            ..InlineCollector::default()
        }
    }

    fn build_block(&mut self, element: &ElementNode) -> EpubResult<Option<FormattingNodeId>> {
        if element.tag == "hr" {
            return self.build_hr(element);
        }
        let source_index = element_source_index(element)?;
        if self.is_display_none(source_index, &element.tag) {
            return Ok(None);
        }
        let style = self.layout_style_id(source_index, &element.tag);
        {
            let resolved = self
                .layout
                .style(style)
                .map_err(|error| EpubError::new(format!("block style resolves: {error}")))?;
            if resolved.display.inside == LayoutDisplayInside::Table {
                // `build_table` absorbs the table's border into padding
                // itself (and registers the decoration paint); absorbing
                // here too counted the border twice — every 2px-framed
                // card ran 4px narrower and 4px taller than Blink.
                return self.build_table(element, source_index, style);
            }
        }
        self.require_block_capabilities(style, &element.tag)?;
        let tag = element.tag.clone();
        // One ordinal scope per open list container; a nested list
        // restarts its own count exactly like the browser's list-item
        // counter.
        let opens_list_scope = matches!(tag.as_str(), "ol" | "ul");
        if opens_list_scope {
            self.list_counters.push(0);
        }
        let list_marker_text = {
            let resolved = self
                .layout
                .style(style)
                .map_err(|error| EpubError::new(format!("block style resolves: {error}")))?;
            if resolved.display.is_list_item {
                if let Some(counter) = self.list_counters.last_mut() {
                    *counter += 1;
                }
                let ordinal = self.list_counters.last().copied().unwrap_or(1);
                list_marker_text(resolved.list_style_type, ordinal)
            } else {
                None
            }
        };
        let plan = self.block_box_paint_plan(source_index, &tag)?;
        // Border widths become padding on a derived layout style: the
        // fragment rect grows into the CSS border box, contents shrink
        // exactly as CSS reserves border space, and the painter strokes
        // the edges inside the rect.
        let (style, decoration) = match plan {
            Some((paint, widths)) if widths.iter().any(|width| *width > 0.0) => (
                self.style_with_border_padding(style, widths, &tag)?,
                Some(paint),
            ),
            Some((paint, _)) => (style, Some(paint)),
            None => (style, None),
        };
        // The parser unwraps an inline <a> around block children and
        // merges its href onto each hoisted block, so the link arrives
        // as an href attribute on ANY block element (the TOC-card div),
        // not only on a literal <a> tag.
        let block_link = element
            .attributes
            .as_ref()
            .and_then(|attributes| attributes.href.clone());
        let own_link = block_link.clone();
        let saved_block_link = match block_link {
            Some(href) => Some(self.block_link.replace(href)),
            None => None,
        };
        let has_block_children = element
            .children
            .iter()
            .any(|child| matches!(child, DocumentNode::Block(_)));
        let id = if has_block_children {
            let container_inline_style = self.inline_style_id(source_index, &element.tag);
            let children = self.build_children(&element.children, container_inline_style)?;
            self.push_node(
                FormattingNode {
                    style,
                    content: FormattingNodeContent::BlockContainer,
                    children,
                },
                Some(source_index),
            )
        } else {
            // A block whose children are all inline-level is one inline
            // flow; an empty block still occupies flow (its margins
            // apply), it just has no line boxes.
            let inline_style = self.inline_style_id(source_index, &element.tag);
            let inline_style = self.container_text_style(inline_style)?;
            let inline_style = self.flex_centered_text_style(source_index, inline_style)?;
            let mut collector = self.inline_collector();
            for child in &element.children {
                self.collect_inline(child, inline_style, 0.0, &mut collector)?;
            }
            let (items, sources) = collector.finish();
            let (content, sources) = if !inline_items_have_substance(&items) {
                (FormattingNodeContent::BlockContainer, None)
            } else {
                (FormattingNodeContent::InlineFlow { items }, Some(sources))
            };
            let is_flow = sources.is_some();
            let id = self.push_node(
                FormattingNode {
                    style,
                    content,
                    children: Vec::new(),
                },
                Some(source_index),
            );
            if is_flow {
                self.strut_styles.insert(id.0, inline_style);
            }
            if let Some(sources) = sources {
                self.flow_item_sources.insert(id.0, sources);
            }
            id
        };
        if let Some(saved) = saved_block_link {
            self.block_link = saved;
        }
        if let Some(href) = own_link {
            self.node_links.insert(id.0, href);
        }
        if let Some(anchor) = element
            .attributes
            .as_ref()
            .and_then(|attributes| attributes.id.clone())
        {
            self.node_anchors.insert(id.0, anchor);
        }
        self.node_tags.insert(id.0, tag);
        if let Some(paint) = decoration {
            self.node_paints.insert(id.0, paint);
        }
        if let Some(text) = list_marker_text {
            let marker_style = self.inline_style_id(source_index, "li marker");
            self.list_markers.insert(
                id.0,
                ListMarkerPaint {
                    text,
                    style: marker_style,
                    run: None,
                },
            );
        }
        if opens_list_scope {
            self.list_counters.pop();
        }
        Ok(Some(id))
    }

    /// Interns a copy of `style` whose padding absorbs the given border
    /// widths (top, right, bottom, left). Percentage padding cannot
    /// absorb a pixel border, so it fails closed.
    fn style_with_border_padding(
        &mut self,
        style: LayoutStyleId,
        widths: [f64; 4],
        what: &str,
    ) -> EpubResult<LayoutStyleId> {
        let mut derived = *self
            .layout
            .style(style)
            .map_err(|error| EpubError::new(format!("{what} style resolves: {error}")))?;
        let widen = |side: &mut NonNegativeLengthPercentage, width: f64| -> EpubResult<()> {
            if width <= 0.0 {
                return Ok(());
            }
            let LengthPercentage::Length(px) = side.value() else {
                // Percentage padding cannot absorb a pixel border; keep
                // the padding untouched (the edge still paints, content
                // sits closer to it than a browser would place it).
                return Ok(());
            };
            let total = rito_style_contract::CssPx::new(px.get() + width as f32)
                .map_err(|error| EpubError::new(format!("{what} border padding: {error:?}")))?;
            *side = NonNegativeLengthPercentage::new(LengthPercentage::Length(total));
            Ok(())
        };
        widen(&mut derived.padding.top, widths[0])?;
        widen(&mut derived.padding.right, widths[1])?;
        widen(&mut derived.padding.bottom, widths[2])?;
        widen(&mut derived.padding.left, widths[3])?;
        if std::env::var_os("RITO_BORDER_DEBUG").is_some() {
            eprintln!(
                "[border-absorb] {what}: widths={widths:?} padding after: {:?}",
                derived.padding
            );
        }
        self.layout
            .intern(derived)
            .map_err(|error| EpubError::new(format!("{what} border style interns: {error}")))
    }

    /// A degraded flex container with `justify-content: center` lays its
    /// inline-level children as a CENTERED flow: for a single-line flex
    /// row, main-axis centering and text-align:center produce the same
    /// line geometry (measured on b2's `.illus` plates — the browser
    /// centers the img inside the 627px line; the plain block degrade
    /// left it at the line start, 45px off).
    fn flex_centered_text_style(
        &mut self,
        source_index: usize,
        strut: StyleId,
    ) -> EpubResult<StyleId> {
        let Ok(layout_style) = self.layout.style_for_node(source_index) else {
            return Ok(strut);
        };
        if layout_style.display.inside != LayoutDisplayInside::Flex
            || layout_style.justify_content != JustifyContent::Center
        {
            return Ok(strut);
        }
        let resolved = self
            .inline
            .style(strut)
            .map_err(|error| EpubError::new(format!("flex flow style resolves: {error}")))?;
        if resolved.text_flow.text_align == rito_style_contract::TextAlign::Center {
            return Ok(strut);
        }
        let mut derived = resolved.clone();
        derived.text_flow.text_align = rito_style_contract::TextAlign::Center;
        self.inline
            .intern(derived)
            .map_err(|error| EpubError::new(format!("flex flow style interns: {error}")))
    }

    /// Collects inline-level content into styled text items. `inherited` is
    /// the style of the nearest element ancestor (the container itself for
    /// text sitting directly in an anonymous flow), which is exactly the
    /// computed style a text node takes in CSS.
    /// The style bare text borrows from its block container, with the
    /// container's own box (padding, borders and background) stripped:
    /// those belong to the block, which paints them once, not to the
    /// text runs inside it (a paragraph's background carried onto its
    /// runs painted each line's band over the previous line's descenders
    /// where the line height is tighter than the font's ascent plus
    /// descent). A span's own style keeps its box — that is what makes
    /// it an inline box.
    fn container_text_style(&mut self, style: StyleId) -> EpubResult<StyleId> {
        use rito_style_contract as c;
        let resolved = self
            .inline
            .style(style)
            .map_err(|error| EpubError::new(format!("container style resolves: {error}")))?;
        let zero_side =
            |side: &c::NonNegativeLengthPercentage| length_percentage_is_zero(&side.value());
        let zero_edge = |edge: &c::BorderEdge| f64::from(edge.resolved_width.get()) == 0.0;
        // Margins strip too: the container's own margins are
        // block-level geometry; left on the borrowed text style they
        // would re-enter layout as inline box gaps on every paragraph
        // run (the first landing turned b1's every indented paragraph
        // into a doubled-margin reflow, 14,937 -> 2.65M).
        let inert_margin = |side: &c::LengthPercentageOrAuto| match side {
            c::LengthPercentageOrAuto::Auto => true,
            c::LengthPercentageOrAuto::Value(value) => length_percentage_is_zero(value),
        };
        let fragment = &resolved.fragment;
        let paint = &resolved.paint;
        let transparent_background = paint.background.resolve(paint.foreground).alpha().get()
            == 0.0
            && paint.background_image.is_none();
        if zero_side(&fragment.padding.top)
            && zero_side(&fragment.padding.right)
            && zero_side(&fragment.padding.bottom)
            && zero_side(&fragment.padding.left)
            && zero_edge(&fragment.border.top)
            && zero_edge(&fragment.border.right)
            && zero_edge(&fragment.border.bottom)
            && zero_edge(&fragment.border.left)
            && inert_margin(&fragment.margin.top)
            && inert_margin(&fragment.margin.right)
            && inert_margin(&fragment.margin.bottom)
            && inert_margin(&fragment.margin.left)
            && transparent_background
        {
            return Ok(style);
        }
        let mut derived = resolved.clone();
        derived.paint.background = c::AbsoluteColor::new(
            c::AbsoluteColorSpace::Srgb,
            [0.0, 0.0, 0.0],
            0.0,
            c::ColorNoneFlags::new(false, false, false, false),
        )
        .map_err(|error| EpubError::new(format!("container text style background: {error:?}")))?
        .into();
        derived.paint.background_image = None;
        let zero = c::NonNegativeLengthPercentage::new(c::LengthPercentage::Length(
            c::CssPx::new(0.0)
                .map_err(|error| EpubError::new(format!("container text style zero: {error:?}")))?,
        ));
        derived.fragment.padding.top = zero;
        derived.fragment.padding.right = zero;
        derived.fragment.padding.bottom = zero;
        derived.fragment.padding.left = zero;
        let clear = |edge: &mut c::BorderEdge| {
            edge.resolved_width = c::NonNegativeCssPx::new(0.0).expect("zero width");
            edge.style = c::BorderStyle::None;
        };
        clear(&mut derived.fragment.border.top);
        clear(&mut derived.fragment.border.right);
        clear(&mut derived.fragment.border.bottom);
        clear(&mut derived.fragment.border.left);
        let zero_margin = c::LengthPercentageOrAuto::Value(c::LengthPercentage::Length(
            c::CssPx::new(0.0).map_err(|error| {
                EpubError::new(format!("container text style zero margin: {error:?}"))
            })?,
        ));
        derived.fragment.margin.top = zero_margin;
        derived.fragment.margin.right = zero_margin;
        derived.fragment.margin.bottom = zero_margin;
        derived.fragment.margin.left = zero_margin;
        self.inline
            .intern(derived)
            .map_err(|error| EpubError::new(format!("container text style interns: {error}")))
    }

    /// The strut style for an ANONYMOUS block's inline flow: the parent's
    /// style with `text-indent` cleared. The browser indents only the
    /// first line of an element's own block container — a bare inline
    /// wrapped in an anonymous box starts flush (measured: a block-level
    /// `<span>` of dashes under an indented div paints at the content
    /// edge while the engine indented it 1.5em).
    fn anonymous_strut_style(&mut self, style: StyleId) -> EpubResult<StyleId> {
        use rito_style_contract as c;
        let resolved = self
            .inline
            .style(style)
            .map_err(|error| EpubError::new(format!("anonymous strut resolves: {error}")))?;
        if length_percentage_is_zero(&resolved.text_flow.text_indent.value) {
            return Ok(style);
        }
        let mut derived = resolved.clone();
        derived.text_flow.text_indent = c::TextIndent {
            value: c::LengthPercentage::Length(c::CssPx::new(0.0).map_err(|error| {
                EpubError::new(format!("anonymous strut zero indent: {error:?}"))
            })?),
            hanging: derived.text_flow.text_indent.hanging,
            each_line: derived.text_flow.text_indent.each_line,
        };
        self.inline
            .intern(derived)
            .map_err(|error| EpubError::new(format!("anonymous strut interns: {error}")))
    }

    /// CSS 2 §16.3.1 text-decoration propagation: an inline box's
    /// decorations draw across its in-flow descendants — they are NOT
    /// inherited properties, so a descendant's computed style carries
    /// none of them and cannot cancel them with `text-decoration: none`.
    /// The flattened run keeps one style per text item, so an ancestor's
    /// lines fold into the descendant's style here. A descendant with no
    /// decoration of its own takes the ancestor's stroke wholesale (its
    /// color and style belong to the decorating box); one with its own
    /// lines keeps them and unions the ancestor's flags (measured: a UA
    /// underlined <a> around an undecorated calibre <span> underlines in
    /// the browser, and the run style dropped it).
    fn propagate_text_decorations(
        &mut self,
        own: StyleId,
        inherited: StyleId,
    ) -> EpubResult<StyleId> {
        use rito_style_contract as c;
        let ancestor = self
            .inline
            .style(inherited)
            .map_err(|error| EpubError::new(format!("decoration ancestor resolves: {error}")))?
            .paint
            .text_decoration;
        if ancestor.lines.is_empty() {
            return Ok(own);
        }
        let resolved = self
            .inline
            .style(own)
            .map_err(|error| EpubError::new(format!("decoration owner resolves: {error}")))?;
        let decoration = if resolved.paint.text_decoration.lines.is_empty() {
            ancestor
        } else {
            let mut merged = resolved.paint.text_decoration;
            merged.lines = c::TextDecorationLines::new(
                merged.lines.underline || ancestor.lines.underline,
                merged.lines.overline || ancestor.lines.overline,
                merged.lines.line_through || ancestor.lines.line_through,
                merged.lines.blink || ancestor.lines.blink,
            );
            merged
        };
        if decoration == resolved.paint.text_decoration {
            return Ok(own);
        }
        let mut derived = resolved.clone();
        derived.paint.text_decoration = decoration;
        self.inline
            .intern(derived)
            .map_err(|error| EpubError::new(format!("propagated decoration interns: {error}")))
    }

    /// Whitelist gate for a style used as a block-level box. Every field
    /// must hold a value the block context provably implements; anything
    /// else fails closed naming the field. The default is rejection: a
    /// property this list has never heard of can only over-reject (visible
    /// in the representability reports), never silently mis-lay.
    /// The chapter body's background color for the page wash, `None`
    /// when transparent. Body decoration beyond a plain background color
    /// still fails closed like any other box.
    pub(super) fn chapter_body_background(
        &mut self,
        source_index: usize,
    ) -> EpubResult<Option<ReaderColor>> {
        let style = self.inline_style_id(source_index, "chapter body");
        let (background, bordered, decoration) = {
            let resolved = self
                .inline
                .style(style)
                .map_err(|error| EpubError::new(format!("chapter body style resolves: {error}")))?;
            let background = match resolved.paint.background {
                rito_style_contract::ComputedColor::Absolute(color)
                    if color.alpha().get() > 0.0 =>
                {
                    crate::style::paint_color(color).ok()
                }
                rito_style_contract::ComputedColor::CurrentColor => {
                    crate::style::paint_color(resolved.paint.foreground).ok()
                }
                _ => None,
            };
            let bordered = [
                &resolved.fragment.border.top,
                &resolved.fragment.border.right,
                &resolved.fragment.border.bottom,
                &resolved.fragment.border.left,
            ]
            .iter()
            .any(|edge| {
                edge.resolved_width.get() > 0.0
                    && !matches!(
                        edge.style,
                        rito_style_contract::BorderStyle::None
                            | rito_style_contract::BorderStyle::Hidden
                    )
            });
            (background, bordered, box_decoration_violation(resolved))
        };
        if bordered {
            self.degrade("<chapter body> border not painted".to_owned());
        }
        if let Some(reason) = decoration {
            self.degrade(format!("<chapter body> decoration ignored: {reason}"));
        }
        Ok(background)
    }

    /// The block's decoration plan: `None` for an undecorated box, or
    /// the `paintBlock` payload plus the border widths the layout style
    /// must absorb as padding. Paint the fragment painter cannot
    /// reproduce (background images, shadows, transforms, exotic border
    /// styles) fails closed — with the fragment engine as pagination
    /// authority there is no retained page to compare against, so the
    /// tree build itself must refuse what it cannot paint.
    fn block_box_paint_plan(
        &mut self,
        source_index: usize,
        what: &str,
    ) -> EpubResult<Option<(NodePaint, [f64; 4])>> {
        let style = self.inline_style_id(source_index, what);
        let verdict = match self.checked_box_paints.get(&style.raw()) {
            Some(cached) => cached.clone(),
            None => {
                let resolved = self
                    .inline
                    .style(style)
                    .map_err(|error| EpubError::new(format!("{what} style resolves: {error}")))?;
                let verdict = block_box_paint(resolved);
                self.checked_box_paints.insert(style.raw(), verdict.clone());
                verdict
            }
        };
        let (plan, degradations) = verdict;
        for reason in degradations {
            self.degrade(format!("<{what}> {reason}"));
        }
        Ok(plan)
    }
}

fn length_percentage_is_zero(value: &rito_style_contract::LengthPercentage) -> bool {
    match value {
        rito_style_contract::LengthPercentage::Length(px) => px.get() == 0.0,
        rito_style_contract::LengthPercentage::Percentage(ratio) => ratio.ratio() == 0.0,
        rito_style_contract::LengthPercentage::Linear { length, percentage } => {
            length.get() == 0.0 && percentage.ratio() == 0.0
        }
    }
}

fn element_source_index(element: &ElementNode) -> EpubResult<usize> {
    element
        .source_ref
        .source_node_id
        .map(|id| id.index())
        .ok_or_else(|| {
            EpubError::new(format!(
                "element <{}> carries no source identity",
                element.tag
            ))
        })
}

/// Whether an inline flow holds any real content. A flow of nothing but
/// childless inline boxes (calibre's empty `<a></a>` anchor paragraphs)
/// is EMPTY: CSS 2.1 §9.4.2 treats a line box with no text, no
/// preserved white space and no inline elements with non-zero
/// margins/padding/borders as zero-height and non-existent, so the
/// paragraph contributes no line at all (measured: Blink lays the
/// anchor-only paragraph at height 0 and the page does not shift).
fn inline_items_have_substance(items: &[InlineItem]) -> bool {
    items
        .iter()
        .any(|item| !matches!(item, InlineItem::EmptyBox { .. }))
}
