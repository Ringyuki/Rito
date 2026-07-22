//! Builds fragment-engine input from parsed chapter content.
//!
//! This is where the typed style tables retained on a revision meet real
//! book content: parsed chapter nodes (with reader semantics such as
//! out-of-flow footnote asides already applied upstream) become a
//! [`FormattingTree`] whose nodes reference interned styles — block
//! elements become block containers, runs of inline-level content become
//! inline flows with white space collapsed, and `display: none` subtrees
//! disappear. Inline-level content sitting beside block-level siblings is
//! wrapped in an anonymous block box, like CSS box generation.
//!
//! Images become atomic inline items carrying their intrinsic dimensions
//! (display sizing happens at layout time against the typed CSS sizing
//! fields). Everything the fragment engine cannot represent yet — preserved
//! white space, images without known dimensions — fails closed with the
//! offending construct named, never a guessed layout.

use rito_fragment::{
    FormattingNode, FormattingNodeContent, FormattingNodeId, FormattingTree, FormattingTreeStyles,
    InlineItem,
};
use rito_style_contract::{
    AlignItemsV1, ClearV1, FloatV1, InlineStyleTableV1, JustifyContentV1, LayoutDisplayInsideV1,
    LayoutDisplayOutsideV1, LayoutDisplayV1, LayoutFormattingStyleV1, LayoutStyleId,
    LayoutStyleTableV1, LengthPercentage, LengthPercentageOrAuto, ListMarkerStyleV1,
    MaximumHeightV1, MaximumSizeV1, MinimumHeightV1, NonNegativeLengthPercentage, OverflowV1,
    PageBreakV1, PhysicalSides, PositionV1, PreferredSizeV1, StyleId, WhiteSpaceCollapse,
};

use std::collections::BTreeMap;

use serde_json::Value;

use crate::epub::{EpubError, EpubResult};
use crate::xhtml::{DocumentNode, ElementNode, ImageNode};

/// One chapter's formatting tree plus the mapping back to source nodes.
#[derive(Debug)]
pub struct ChapterFormattingTree {
    pub tree: FormattingTree,
    /// Source-arena node index per formatting node; `None` for synthesized
    /// boxes (the chapter root, anonymous block boxes).
    pub source_nodes: Vec<Option<usize>>,
    /// Paint the fragment painter must apply to specific formatting nodes
    /// (keyed by node id). Every entry is layout-inert: it colors a box the
    /// engine already sized, and a painter that does not understand an
    /// entry must fail closed rather than skip it.
    pub node_paints: BTreeMap<u32, NodePaint>,
    /// The chapter body's own background color, when it has one. This is
    /// the page background — the frame producer washes each page with it
    /// — matching how the retained pipeline hoists a body background onto
    /// the page rather than painting a content-box rectangle.
    pub page_background: Option<String>,
    /// Per inline-flow node: each item's interaction source, index-aligned
    /// with the flow's `InlineItem` list. Page artifacts join laid-out
    /// runs back to links, images, and source nodes through this table.
    pub flow_item_sources: BTreeMap<u32, Vec<FlowItemSource>>,
    /// Anchor `id` attributes per formatting node, for jump navigation.
    pub node_anchors: BTreeMap<u32, String>,
    /// Source tag per block-level formatting node, for semantic roles.
    pub node_tags: BTreeMap<u32, String>,
}

/// One inline item's interaction provenance.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FlowItemSource {
    /// Source-arena node index of the item's owner (the text node for a
    /// text run, the image element for an image).
    pub source_index: Option<usize>,
    /// Destination of the nearest enclosing `<a href>`, if any.
    pub href: Option<String>,
    /// Alt text for an image item.
    pub image_alt: Option<String>,
}

/// One node's layout-inert paint requirement.
#[derive(Debug, Clone, PartialEq)]
pub enum NodePaint {
    /// A horizontal rule's stroke across the node's box.
    Rule {
        /// CSS color of the stroke.
        color: String,
        /// Stroke pattern understood by the render protocol.
        style: &'static str,
    },
    /// Block-box decoration: the `paintBlock` command's `paint` object
    /// and optional `borderBox` widths, exactly as the render protocol
    /// consumes them. Border widths are already lowered into the node's
    /// layout padding, so the fragment rect is the CSS border box and the
    /// renderer strokes edges inside it.
    Box {
        paint: Value,
        border_box: Option<Value>,
    },
}

/// Builds the formatting tree for one chapter's parsed body content.
///
/// `layout` and `inline` are the chapter's typed projection tables (the
/// same tables revisions retain); the tree carries clones so it stays an
/// immutable, self-contained engine input.
pub fn build_chapter_formatting_tree(
    nodes: &[DocumentNode],
    body_source_node_index: usize,
    layout: &LayoutStyleTableV1,
    inline: &InlineStyleTableV1,
    image_dimensions: &BTreeMap<String, (u32, u32)>,
) -> EpubResult<ChapterFormattingTree> {
    let mut layout = layout.clone();
    let anonymous_style = layout
        .intern(anonymous_block_style())
        .map_err(|error| EpubError::new(format!("anonymous block style interns: {error}")))?;
    let mut builder = TreeBuilder {
        layout: &mut layout,
        inline,
        image_dimensions,
        anonymous_style,
        nodes: Vec::new(),
        source_nodes: Vec::new(),
        node_paints: BTreeMap::new(),
        flow_item_sources: BTreeMap::new(),
        node_anchors: BTreeMap::new(),
        node_tags: BTreeMap::new(),
        checked_block_styles: std::collections::HashMap::new(),
        checked_box_paints: std::collections::HashMap::new(),
        checked_inline_styles: std::collections::HashMap::new(),
    };
    let body_style = builder.layout_style_id(body_source_node_index, "chapter body")?;
    let page_background = builder.chapter_body_background(body_source_node_index)?;
    let body_inline_style = builder.inline_style_id(body_source_node_index, "chapter body")?;
    let children = builder.build_children(nodes, body_inline_style)?;
    let root = builder.push_node(
        FormattingNode {
            style: body_style,
            content: FormattingNodeContent::BlockContainer,
            children,
        },
        Some(body_source_node_index),
    );
    let TreeBuilder {
        nodes: formatting_nodes,
        source_nodes,
        node_paints,
        flow_item_sources,
        node_anchors,
        node_tags,
        ..
    } = builder;
    let tree = FormattingTree::with_styles(
        formatting_nodes,
        root,
        FormattingTreeStyles {
            layout,
            inline: inline.clone(),
        },
    )
    .map_err(EpubError::new)?;
    Ok(ChapterFormattingTree {
        tree,
        source_nodes,
        node_paints,
        page_background,
        flow_item_sources,
        node_anchors,
        node_tags,
    })
}

struct TreeBuilder<'a> {
    layout: &'a mut LayoutStyleTableV1,
    inline: &'a InlineStyleTableV1,
    image_dimensions: &'a BTreeMap<String, (u32, u32)>,
    anonymous_style: LayoutStyleId,
    nodes: Vec<FormattingNode>,
    source_nodes: Vec<Option<usize>>,
    node_paints: BTreeMap<u32, NodePaint>,
    flow_item_sources: BTreeMap<u32, Vec<FlowItemSource>>,
    node_anchors: BTreeMap<u32, String>,
    node_tags: BTreeMap<u32, String>,
    /// Capability verdict per interned style id, so each distinct style is
    /// checked once per chapter.
    checked_block_styles: std::collections::HashMap<u32, Option<String>>,
    checked_box_paints:
        std::collections::HashMap<u32, Result<Option<(NodePaint, [f64; 4])>, String>>,
    checked_inline_styles: std::collections::HashMap<(u32, bool), Option<String>>,
}

impl TreeBuilder<'_> {
    fn push_node(&mut self, node: FormattingNode, source: Option<usize>) -> FormattingNodeId {
        let id = FormattingNodeId(self.nodes.len() as u32);
        self.nodes.push(node);
        self.source_nodes.push(source);
        id
    }

    fn layout_style_id(&self, source_index: usize, what: &str) -> EpubResult<LayoutStyleId> {
        self.layout
            .node_style_id(source_index)
            .map_err(|error| EpubError::new(format!("{what} has no layout style: {error}")))
    }

    fn inline_style_id(&self, source_index: usize, what: &str) -> EpubResult<StyleId> {
        self.inline
            .node_style_id(source_index)
            .map_err(|error| EpubError::new(format!("{what} has no inline style: {error}")))
    }

    fn is_display_none(&self, source_index: usize, what: &str) -> EpubResult<bool> {
        let style = self
            .layout
            .style_for_node(source_index)
            .map_err(|error| EpubError::new(format!("{what} has no layout style: {error}")))?;
        Ok(style.display.outside == LayoutDisplayOutsideV1::None)
    }

    /// Builds the formatting children of one block-level container from its
    /// document children, grouping runs of inline-level content into inline
    /// flows (anonymous ones when block-level siblings are present).
    fn build_children(
        &mut self,
        children: &[DocumentNode],
        container_inline_style: StyleId,
    ) -> EpubResult<Vec<FormattingNodeId>> {
        let mut built = Vec::new();
        let mut pending_inline: Vec<&DocumentNode> = Vec::new();
        for child in children {
            match child {
                DocumentNode::Block(element) => {
                    self.flush_inline_run(&mut pending_inline, container_inline_style, &mut built)?;
                    if let Some(id) = self.build_block(element)? {
                        built.push(id);
                    }
                }
                inline_level => pending_inline.push(inline_level),
            }
        }
        self.flush_inline_run(&mut pending_inline, container_inline_style, &mut built)?;
        Ok(built)
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
        let mut collector = InlineCollector::default();
        for node in run {
            self.collect_inline(node, container_inline_style, 0.0, &mut collector)?;
        }
        let (items, sources) = collector.finish();
        if items.is_empty() {
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
        self.flow_item_sources.insert(id.0, sources);
        built.push(id);
        Ok(())
    }

    /// Builds one block-level element. Returns `None` for `display: none`.
    fn build_block(&mut self, element: &ElementNode) -> EpubResult<Option<FormattingNodeId>> {
        if element.tag == "hr" {
            return self.build_hr(element);
        }
        let source_index = element_source_index(element)?;
        if self.is_display_none(source_index, &element.tag)? {
            return Ok(None);
        }
        let style = self.layout_style_id(source_index, &element.tag)?;
        self.require_block_capabilities(style, &element.tag)?;
        let tag = element.tag.clone();
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
        let has_block_children = element
            .children
            .iter()
            .any(|child| matches!(child, DocumentNode::Block(_)));
        let id = if has_block_children {
            let container_inline_style = self.inline_style_id(source_index, &element.tag)?;
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
            let inline_style = self.inline_style_id(source_index, &element.tag)?;
            let mut collector = InlineCollector::default();
            for child in &element.children {
                self.collect_inline(child, inline_style, 0.0, &mut collector)?;
            }
            let (items, sources) = collector.finish();
            let (content, sources) = if items.is_empty() {
                (FormattingNodeContent::BlockContainer, None)
            } else {
                (FormattingNodeContent::InlineFlow { items }, Some(sources))
            };
            let id = self.push_node(
                FormattingNode {
                    style,
                    content,
                    children: Vec::new(),
                },
                Some(source_index),
            );
            if let Some(sources) = sources {
                self.flow_item_sources.insert(id.0, sources);
            }
            id
        };
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
        let mut derived = self
            .layout
            .style(style)
            .map_err(|error| EpubError::new(format!("{what} style resolves: {error}")))?
            .clone();
        let widen = |side: &mut NonNegativeLengthPercentage, width: f64| -> EpubResult<()> {
            if width <= 0.0 {
                return Ok(());
            }
            let LengthPercentage::Length(px) = side.value() else {
                return Err(EpubError::new(format!(
                    "<{what}> border with percentage padding is not representable yet"
                )));
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
        self.layout
            .intern(derived)
            .map_err(|error| EpubError::new(format!("{what} border style interns: {error}")))
    }

    /// Collects inline-level content into styled text items. `inherited` is
    /// the style of the nearest element ancestor (the container itself for
    /// text sitting directly in an anonymous flow), which is exactly the
    /// computed style a text node takes in CSS.
    fn collect_inline(
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
                // White-space-only runs collapse away without needing a
                // style of their own (inter-element formatting text).
                if text
                    .content
                    .chars()
                    .all(|ch| matches!(ch, ' ' | '\t' | '\n' | '\r'))
                {
                    collector.push_collapsible_whitespace();
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
                );
                Ok(())
            }
            DocumentNode::Inline(element) => {
                if element.tag == "ruby" {
                    return self.collect_ruby(element, ancestor_shift_px, collector);
                }
                if element.tag == "rt" || element.tag == "rp" {
                    // Annotation parts are consumed by their <ruby> parent;
                    // reaching one here means malformed markup whose text
                    // would otherwise leak into the base flow.
                    return Err(EpubError::new(format!(
                        "<{}> outside a <ruby> element is not representable",
                        element.tag
                    )));
                }
                let source_index = element_source_index(element)?;
                if self.is_display_none(source_index, &element.tag)? {
                    return Ok(());
                }
                let style = self.inline_style_id(source_index, &element.tag)?;
                self.require_inline_capabilities(style, true, &element.tag)?;
                let resolved = self
                    .inline
                    .style(style)
                    .map_err(|error| EpubError::new(format!("{} style: {error}", element.tag)))?;
                let shift = ancestor_shift_px + resolved_baseline_shift(resolved);
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
                for child in &element.children {
                    self.collect_inline(child, style, shift, collector)?;
                }
                if let Some(saved) = saved_link {
                    collector.current_link = saved;
                }
                Ok(())
            }
            DocumentNode::Image(image) => self.collect_image(image, ancestor_shift_px, collector),
            DocumentNode::Block(element) => Err(EpubError::new(format!(
                "block-level <{}> inside an inline run; anonymous box grouping missed it",
                element.tag
            ))),
        }
    }

    /// Builds one `<hr>`: a fixed-height leaf whose visible line is a
    /// stroke across its box. An author border-top drives the line's
    /// height, pattern, and color, mirroring the retained engine's rule
    /// resolution; without one the rule is the classic one-pixel solid
    /// line in the element's text color. Exotic stroke patterns collapse
    /// to solid exactly as the render protocol does.
    fn build_hr(&mut self, element: &ElementNode) -> EpubResult<Option<FormattingNodeId>> {
        use rito_style_contract::BorderStyle;
        let source_index = element_source_index(element)?;
        if self.is_display_none(source_index, "hr")? {
            return Ok(None);
        }
        let style = self.layout_style_id(source_index, "hr")?;
        self.require_block_capabilities(style, "hr")?;
        let inline_style = self.inline_style_id(source_index, "hr")?;
        let resolved = self
            .inline
            .style(inline_style)
            .map_err(|error| EpubError::new(format!("hr style: {error}")))?;
        let border = resolved.fragment.border.top;
        let use_border = border.resolved_width.get() > 0.0
            && !matches!(border.style, BorderStyle::None | BorderStyle::Hidden);
        let (height, stroke, color) = if use_border {
            let stroke = match border.style {
                BorderStyle::Dotted => "dotted",
                BorderStyle::Dashed => "dashed",
                _ => "solid",
            };
            let color = border.color.resolve(resolved.paint.foreground);
            (f64::from(border.resolved_width.get()), stroke, color)
        } else {
            (1.0, "solid", resolved.paint.foreground)
        };
        let color = crate::style::absolute_color(color)
            .map_err(|error| EpubError::new(format!("hr stroke color: {error:?}")))?;
        let id = self.push_node(
            FormattingNode {
                style,
                content: FormattingNodeContent::SizedLeaf {
                    block_size: height,
                    breakable: false,
                },
                children: Vec::new(),
            },
            Some(source_index),
        );
        self.node_paints.insert(
            id.0,
            NodePaint::Rule {
                color,
                style: stroke,
            },
        );
        Ok(Some(id))
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
        if self.is_display_none(source_index, "ruby")? {
            return Ok(());
        }
        let style = self.inline_style_id(source_index, "ruby")?;
        self.require_inline_capabilities(style, true, "ruby")?;
        let collapse = self.white_space_collapse(style)?;
        let mut pending_base = String::new();
        for child in &element.children {
            match child {
                DocumentNode::Text(text) => pending_base.push_str(&text.content),
                DocumentNode::Inline(inner) if inner.tag == "rt" => {
                    let mut text = String::new();
                    collect_plain_text(&inner.children, &mut text)?;
                    let annotation = text.split_whitespace().collect::<Vec<_>>().join(" ");
                    if pending_base.trim().is_empty() && !annotation.is_empty() {
                        return Err(EpubError::new(
                            "ruby annotation without a base segment is not representable",
                        ));
                    }
                    collector.push_text(
                        &std::mem::take(&mut pending_base),
                        style,
                        ancestor_shift_px,
                        collapse,
                        Some(annotation).filter(|text| !text.is_empty()),
                        Some(source_index),
                    );
                }
                DocumentNode::Inline(inner) if inner.tag == "rp" => {}
                DocumentNode::Inline(inner) if inner.tag == "rb" => {
                    collect_plain_text(&inner.children, &mut pending_base)?;
                }
                DocumentNode::Inline(inner) => {
                    return Err(EpubError::new(format!(
                        "ruby base with nested <{}> markup is not representable yet",
                        inner.tag
                    )));
                }
                DocumentNode::Image(_) | DocumentNode::Block(_) => {
                    return Err(EpubError::new(
                        "ruby containing non-text content is not representable yet",
                    ));
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
            );
        }
        Ok(())
    }

    /// Collects one image as an atomic inline item. The image element has
    /// its own projected styles; display sizing happens at layout time.
    fn collect_image(
        &mut self,
        image: &ImageNode,
        ancestor_shift_px: f64,
        collector: &mut InlineCollector,
    ) -> EpubResult<()> {
        let source_index = image
            .source_ref
            .source_node_id
            .map(|id| id.index())
            .ok_or_else(|| {
                EpubError::new(format!("image {} carries no source identity", image.src))
            })?;
        if self.is_display_none(source_index, "image")? {
            return Ok(());
        }
        let Some((width, height)) = self.image_dimensions.get(&image.src) else {
            return Err(EpubError::new(format!(
                "image dimensions are unavailable: {}",
                image.src
            )));
        };
        let style = self.inline_style_id(source_index, "image")?;
        let layout_style = self.layout_style_id(source_index, "image")?;
        self.require_image_capabilities(layout_style)?;
        self.require_inline_capabilities(style, true, "image")?;
        let resolved = self
            .inline
            .style(style)
            .map_err(|error| EpubError::new(format!("image style: {error}")))?;
        collector.push_image(
            InlineItem::Image {
                src: image.src.clone(),
                intrinsic_width: f64::from(*width),
                intrinsic_height: f64::from(*height),
                style,
                layout_style,
                baseline_shift_px: ancestor_shift_px + resolved_baseline_shift(resolved),
            },
            source_index,
            &image.alt,
        );
        Ok(())
    }

    /// Whitelist gate for a style used as a block-level box. Every field
    /// must hold a value the block context provably implements; anything
    /// else fails closed naming the field. The default is rejection: a
    /// property this list has never heard of can only over-reject (visible
    /// in the representability reports), never silently mis-lay.
    /// The chapter body's background color for the page wash, `None`
    /// when transparent. Body decoration beyond a plain background color
    /// still fails closed like any other box.
    fn chapter_body_background(&mut self, source_index: usize) -> EpubResult<Option<String>> {
        let style = self.inline_style_id(source_index, "chapter body")?;
        let resolved = self
            .inline
            .style(style)
            .map_err(|error| EpubError::new(format!("chapter body style resolves: {error}")))?;
        let background = match resolved.paint.background {
            rito_style_contract::ComputedColorV1::Absolute(color) => {
                if color.alpha().get() == 0.0 {
                    None
                } else {
                    Some(crate::style::absolute_color(color).map_err(|error| {
                        EpubError::new(format!("chapter body background: {error:?}"))
                    })?)
                }
            }
            other => {
                return Err(EpubError::new(format!(
                    "<chapter body> background {other:?} is not representable in fragment paint yet"
                )))
            }
        };
        for (edge, name) in [
            (&resolved.fragment.border.top, "border-top"),
            (&resolved.fragment.border.right, "border-right"),
            (&resolved.fragment.border.bottom, "border-bottom"),
            (&resolved.fragment.border.left, "border-left"),
        ] {
            let painted = edge.resolved_width.get() > 0.0
                && !matches!(
                    edge.style,
                    rito_style_contract::BorderStyle::None
                        | rito_style_contract::BorderStyle::Hidden
                );
            if painted {
                return Err(EpubError::new(format!(
                    "<chapter body> {name} is not representable in fragment paint yet"
                )));
            }
        }
        if let Some(reason) = box_decoration_violation(resolved) {
            return Err(EpubError::new(format!(
                "<chapter body> {reason} is not representable in fragment paint yet"
            )));
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
        let style = self.inline_style_id(source_index, what)?;
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
        verdict.map_err(|reason| {
            EpubError::new(format!(
                "<{what}> {reason} is not representable in fragment paint yet"
            ))
        })
    }

    fn require_block_capabilities(&mut self, style: LayoutStyleId, what: &str) -> EpubResult<()> {
        let verdict = match self.checked_block_styles.get(&style.raw()) {
            Some(cached) => cached.clone(),
            None => {
                let resolved = self
                    .layout
                    .style(style)
                    .map_err(|error| EpubError::new(format!("{what} style resolves: {error}")))?;
                let verdict = block_capability_violation(resolved);
                self.checked_block_styles
                    .insert(style.raw(), verdict.clone());
                verdict
            }
        };
        match verdict {
            None => Ok(()),
            Some(reason) => Err(EpubError::new(format!(
                "<{what}> is not representable yet: {reason}"
            ))),
        }
    }

    /// Whitelist gate for an image's layout style: the sizing fields are
    /// consumed by image display sizing, so more values are implemented
    /// than for plain blocks.
    fn require_image_capabilities(&mut self, style: LayoutStyleId) -> EpubResult<()> {
        let resolved = self
            .layout
            .style(style)
            .map_err(|error| EpubError::new(format!("image style resolves: {error}")))?;
        if resolved.float != rito_style_contract::FloatV1::None {
            return Err(EpubError::new(
                "a floated image needs line-box wrapping, which is not representable yet"
                    .to_owned(),
            ));
        }
        if let Some(reason) = shared_box_capability_violation(resolved) {
            return Err(EpubError::new(format!(
                "image is not representable yet: {reason}"
            )));
        }
        Ok(())
    }

    /// Whitelist gate for inline styles. Box-level fields (margins,
    /// borders, vertical-align) do not inherit and only apply to actual
    /// inline boxes, so a text run — which borrows its nearest element's
    /// style — is checked against the text-level fields only, while inline
    /// elements and images are checked in full.
    fn require_inline_capabilities(
        &mut self,
        style: StyleId,
        is_box: bool,
        what: &str,
    ) -> EpubResult<()> {
        let key = (style.raw(), is_box);
        let verdict = match self.checked_inline_styles.get(&key) {
            Some(cached) => cached.clone(),
            None => {
                let resolved = self
                    .inline
                    .style(style)
                    .map_err(|error| EpubError::new(format!("{what} style resolves: {error}")))?;
                let verdict = if is_box {
                    inline_text_capability_violation(resolved)
                        .or_else(|| inline_box_capability_violation(resolved))
                } else {
                    inline_text_capability_violation(resolved)
                };
                self.checked_inline_styles.insert(key, verdict.clone());
                verdict
            }
        };
        match verdict {
            None => Ok(()),
            Some(reason) => Err(EpubError::new(format!(
                "{what} is not representable yet: {reason}"
            ))),
        }
    }

    fn white_space_collapse(&self, style: StyleId) -> EpubResult<bool> {
        let style = self
            .inline
            .style(style)
            .map_err(|error| EpubError::new(format!("inline style resolves: {error}")))?;
        match style.text_flow.white_space_collapse {
            WhiteSpaceCollapse::Collapse => Ok(true),
            other => Err(EpubError::new(format!(
                "preserved white space is not representable in the fragment tree yet: {other:?}"
            ))),
        }
    }
}

/// Block-box whitelist: `None` means every field is implemented; `Some`
/// names the first violating field and value.
fn block_capability_violation(style: &LayoutFormattingStyleV1) -> Option<String> {
    use rito_style_contract as c;
    if let Some(reason) = shared_box_capability_violation(style) {
        return Some(reason);
    }
    match style.display {
        c::LayoutDisplayV1 {
            outside: LayoutDisplayOutsideV1::Block,
            inside: c::LayoutDisplayInsideV1::Flow | c::LayoutDisplayInsideV1::FlowRoot,
            is_list_item: false,
        } => {}
        other => return Some(format!("display {other:?}")),
    }
    // Block width, horizontal margins (including auto centering), padding,
    // and box-sizing resolve through the block context's horizontal box
    // model; the remaining sizing constraints are still unimplemented.
    match style.width {
        c::PreferredSizeV1::Auto | c::PreferredSizeV1::Value(_) => {}
        other => return Some(format!("block width {other:?}")),
    }
    // Fixed heights resolve in the block context (content overflowing a
    // fixed box still fails closed at layout time); max-width caps the
    // horizontal box model.
    match style.height {
        c::PreferredSizeV1::Auto | c::PreferredSizeV1::Value(_) => {}
        other => return Some(format!("block height {other:?}")),
    }
    if style.min_height != c::MinimumHeightV1::Auto {
        return Some(format!("block min-height {:?}", style.min_height));
    }
    if style.max_height != c::MaximumHeightV1::None {
        return Some(format!("block max-height {:?}", style.max_height));
    }
    // list-style-type inherits everywhere but only paints on
    // display: list-item boxes, which the display gate above rejects; the
    // inherited value on plain blocks is inert per CSS.
    None
}

/// Constraints shared by every box the engine lays out, replaced or not.
fn shared_box_capability_violation(style: &LayoutFormattingStyleV1) -> Option<String> {
    use rito_style_contract as c;
    // Floated blocks lay out as placed float boxes: a resolvable width is
    // used directly, and an auto width shrinks to fit its content.
    // Floated images (line-box wrapping) stay rejected at collection.
    // `clear` is implemented as clearance past active floats.
    match style.position {
        c::PositionV1::Static => {}
        c::PositionV1::Relative => {
            let inset_is_inert = [
                style.inset.top,
                style.inset.right,
                style.inset.bottom,
                style.inset.left,
            ]
            .iter()
            .all(|side| matches!(side, c::LengthPercentageOrAuto::Auto));
            if !inset_is_inert {
                return Some("relative position with a non-auto inset".to_owned());
            }
        }
        c::PositionV1::Absolute => return Some("absolute position".to_owned()),
    }
    if style.break_before != c::PageBreakV1::Auto || style.break_after != c::PageBreakV1::Auto {
        return Some("forced page break".to_owned());
    }
    // justify-content / align-items only affect flex containers, which the
    // display gate rejects; overflow does not change layout geometry.
    None
}

/// Horizontal margins and any padding shift or shrink content; the block
/// context lays every box at x = 0 with the full inline size, so only
/// zero-length values (and auto vertical margins, which resolve to zero)
/// are implemented.
fn horizontal_spacing_violation(
    margin: &rito_style_contract::PhysicalSides<rito_style_contract::LengthPercentageOrAuto>,
    padding: &rito_style_contract::PhysicalSides<rito_style_contract::NonNegativeLengthPercentage>,
) -> Option<String> {
    let zero_or_auto = |side: &rito_style_contract::LengthPercentageOrAuto| match side {
        rito_style_contract::LengthPercentageOrAuto::Auto => false,
        rito_style_contract::LengthPercentageOrAuto::Value(value) => {
            !length_percentage_is_zero(value)
        }
    };
    if zero_or_auto(&margin.left) {
        return Some("horizontal margin-left".to_owned());
    }
    if zero_or_auto(&margin.right) {
        return Some("horizontal margin-right".to_owned());
    }
    for (side, name) in [
        (&padding.top, "padding-top"),
        (&padding.right, "padding-right"),
        (&padding.bottom, "padding-bottom"),
        (&padding.left, "padding-left"),
    ] {
        if !length_percentage_is_zero(&side.value()) {
            return Some(name.to_owned());
        }
    }
    None
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

/// Text-level inline whitelist: inherited fields every text run carries.
/// Every field either holds an implemented value or provably cannot affect
/// layout (paint-only properties pass).
fn inline_text_capability_violation(
    style: &rito_style_contract::InlineFormattingStyleV1,
) -> Option<String> {
    use rito_style_contract as c;
    // font: families/size/weight/slant/line-height all wired into Parley.
    match style.text_flow.text_justify {
        c::TextJustify::Auto => {}
        other => return Some(format!("text-justify {other:?}")),
    }
    if style.text_flow.text_transform.case != c::TextTransformCase::None
        || style.text_flow.text_transform.full_width
        || style.text_flow.text_transform.full_size_kana
    {
        return Some("text-transform".to_owned());
    }
    match style.text_flow.white_space_collapse {
        c::WhiteSpaceCollapse::Collapse => {}
        other => return Some(format!("white-space {other:?}")),
    }
    // text-wrap, word-break, overflow-wrap, and letter/word spacing are
    // wired straight into Parley's ranged styles; percentages and calc
    // spacings have no basis in inline layout and stay rejected.
    match style.text_flow.line_break {
        c::LineBreak::Auto => {}
        other => return Some(format!("line-break {other:?}")),
    }
    match style.text_flow.letter_spacing {
        c::LengthPercentage::Length(_) => {}
        other => return Some(format!("letter-spacing {other:?}")),
    }
    match style.text_flow.word_spacing {
        c::LengthPercentage::Length(_) => {}
        other => return Some(format!("word-spacing {other:?}")),
    }
    match (
        style.bidi.direction,
        style.bidi.unicode_bidi,
        style.bidi.writing_mode,
    ) {
        (
            c::Direction::LeftToRight,
            c::UnicodeBidi::Normal,
            c::WritingMode::HorizontalTopToBottom,
        ) => {}
        other => return Some(format!("bidi/writing-mode {other:?}")),
    }
    // paint (color, decoration, shadows, background, opacity, transform):
    // paint-only per CSS, no layout effect — passes.
    None
}

/// Paint the fragment display-command producer cannot reproduce on a box
/// yet. Borders are checked here for block boxes; inline boxes reject
/// them earlier in their own whitelist.
/// Resolves one block box's paintable decoration, or names the first
/// thing the fragment painter cannot reproduce. `Ok(None)` is an
/// undecorated box; `Ok(Some((paint, widths)))` carries the `paintBlock`
/// payload and the four border widths (top, right, bottom, left) the
/// layout style must absorb as padding so the fragment rect becomes the
/// CSS border box.
fn block_box_paint(
    style: &rito_style_contract::InlineFormattingStyleV1,
) -> Result<Option<(NodePaint, [f64; 4])>, String> {
    use rito_style_contract as c;
    if let Some(reason) = box_decoration_violation(style) {
        return Err(reason);
    }
    let background = match style.paint.background {
        c::ComputedColorV1::Absolute(color) if color.alpha().get() == 0.0 => None,
        c::ComputedColorV1::Absolute(color) => Some(
            crate::style::absolute_color(color)
                .map_err(|error| format!("background color ({error:?})"))?,
        ),
        c::ComputedColorV1::CurrentColor => Some(
            crate::style::absolute_color(style.paint.foreground)
                .map_err(|error| format!("background color ({error:?})"))?,
        ),
    };
    let mut widths = [0.0; 4];
    let mut border = serde_json::Map::new();
    let mut border_box = serde_json::Map::new();
    for (index, (edge, name, box_name)) in [
        (&style.fragment.border.top, "top", "topWidth"),
        (&style.fragment.border.right, "right", "rightWidth"),
        (&style.fragment.border.bottom, "bottom", "bottomWidth"),
        (&style.fragment.border.left, "left", "leftWidth"),
    ]
    .into_iter()
    .enumerate()
    {
        let width = f64::from(edge.resolved_width.get());
        if width <= 0.0 || matches!(edge.style, c::BorderStyle::None | c::BorderStyle::Hidden) {
            continue;
        }
        let stroke = match edge.style {
            c::BorderStyle::Solid => "solid",
            c::BorderStyle::Dashed => "dashed",
            c::BorderStyle::Dotted => "dotted",
            other => return Err(format!("border-{name} style {other:?}")),
        };
        let color = crate::style::absolute_color(edge.color.resolve(style.paint.foreground))
            .map_err(|error| format!("border-{name} color ({error:?})"))?;
        widths[index] = width;
        border.insert(
            name.to_owned(),
            serde_json::json!({ "width": width, "color": color, "style": stroke }),
        );
        border_box.insert(box_name.to_owned(), serde_json::json!(width));
    }
    if background.is_none() && border.is_empty() {
        return Ok(None);
    }
    let mut paint = serde_json::Map::new();
    if let Some(color) = background {
        paint.insert(
            "background".to_owned(),
            serde_json::json!({ "color": color }),
        );
    }
    if !border.is_empty() {
        paint.insert("border".to_owned(), Value::Object(border));
    }
    let border_box = (!border_box.is_empty()).then(|| Value::Object(border_box));
    Ok(Some((
        NodePaint::Box {
            paint: Value::Object(paint),
            border_box,
        },
        widths,
    )))
}

/// Box decoration the fragment painter cannot reproduce on any box:
/// background images, shadows, and transforms. Backgrounds and borders
/// are painted for block boxes (and checked separately where they are
/// not), so they are not this function's concern.
fn box_decoration_violation(
    style: &rito_style_contract::InlineFormattingStyleV1,
) -> Option<String> {
    if style.paint.background_image.is_some() {
        return Some("background-image".to_owned());
    }
    if !style.paint.box_shadows.is_empty() {
        return Some("box-shadow".to_owned());
    }
    if !style.paint.transform.is_none() {
        return Some("transform".to_owned());
    }
    None
}

/// Box-level inline whitelist: non-inherited fields that only apply to an
/// actual inline box (a styled element or an image), never to a text run
/// borrowing its ancestor's style.
fn inline_box_capability_violation(
    style: &rito_style_contract::InlineFormattingStyleV1,
) -> Option<String> {
    use rito_style_contract as c;
    match style.paint.background {
        c::ComputedColorV1::Absolute(color) if color.alpha().get() == 0.0 => {}
        other => return Some(format!("inline background {other:?}")),
    }
    if let Some(reason) = box_decoration_violation(style) {
        return Some(format!("inline {reason}"));
    }
    // Inline fragment boxes: margins/padding/borders displace glyphs.
    if let Some(reason) =
        horizontal_spacing_violation(&style.fragment.margin, &style.fragment.padding)
    {
        return Some(format!("inline {reason}"));
    }
    let vertical_margin_inert = [&style.fragment.margin.top, &style.fragment.margin.bottom]
        .iter()
        .all(|side| match side {
            c::LengthPercentageOrAuto::Auto => true,
            c::LengthPercentageOrAuto::Value(value) => length_percentage_is_zero(value),
        });
    if !vertical_margin_inert {
        return Some("inline vertical margin".to_owned());
    }
    for (edge, name) in [
        (&style.fragment.border.top, "border-top"),
        (&style.fragment.border.right, "border-right"),
        (&style.fragment.border.bottom, "border-bottom"),
        (&style.fragment.border.left, "border-left"),
    ] {
        if edge.resolved_width.get() != 0.0 {
            return Some(format!("inline {name}"));
        }
    }
    match style.fragment.baseline_shift {
        c::BaselineShift::Offset(offset) if length_percentage_is_zero(&offset) => {}
        c::BaselineShift::Super | c::BaselineShift::Sub => {}
        other => return Some(format!("vertical-align {other:?}")),
    }
    match style.fragment.alignment_baseline {
        c::AlignmentBaseline::Baseline => {}
        other => return Some(format!("alignment-baseline {other:?}")),
    }
    None
}

/// The baseline shift one inline box asks for, CSS px; positive raises
/// content above the baseline. `super`/`sub` use the box's own computed
/// font size with the conventional browser ratios; the exact values are
/// calibrated against the pinned-browser oracle.
fn resolved_baseline_shift(style: &rito_style_contract::InlineFormattingStyleV1) -> f64 {
    const SUPER_RATIO: f64 = 0.34;
    const SUB_RATIO: f64 = 0.20;
    let font_size = f64::from(style.font.size.get());
    match style.fragment.baseline_shift {
        rito_style_contract::BaselineShift::Super => SUPER_RATIO * font_size,
        rito_style_contract::BaselineShift::Sub => -(SUB_RATIO * font_size),
        // Zero offsets pass the whitelist; every other value is rejected
        // there before reaching this resolver.
        _ => 0.0,
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

/// Accumulates styled text with CSS white-space collapsing across item
/// boundaries: runs of collapsible white space become one space, and
/// leading/trailing white space of the whole flow disappears.
#[derive(Default)]
struct InlineCollector {
    items: Vec<InlineItem>,
    /// Interaction provenance, index-aligned with `items`.
    sources: Vec<FlowItemSource>,
    /// The nearest enclosing `<a href>` destination while collecting.
    current_link: Option<String>,
    pending_space: bool,
    has_content: bool,
}

impl InlineCollector {
    /// Records a run of collapsible white space with no content of its own.
    fn push_collapsible_whitespace(&mut self) {
        if self.has_content {
            self.pending_space = true;
        }
    }

    /// Appends one text node's content. A collapsed space belongs to the
    /// run that produced it (the CSS "first space of the sequence wins"
    /// rule), so a space pending from earlier nodes lands at the end of the
    /// previous item, while this node's own interior spaces stay here.
    fn push_text(
        &mut self,
        text: &str,
        style: StyleId,
        baseline_shift_px: f64,
        collapse: bool,
        ruby_annotation: Option<String>,
        source_index: Option<usize>,
    ) {
        let source = FlowItemSource {
            source_index,
            href: self.current_link.clone(),
            image_alt: None,
        };
        debug_assert!(collapse, "preserved white space fails closed upstream");
        let is_space = |ch: char| matches!(ch, ' ' | '\t' | '\n' | '\r');
        let mut rest = text;
        if self.pending_space {
            // The space belongs to an earlier node; this node's leading
            // white space folds into it and disappears.
            if let Some(InlineItem::Text {
                text: last,
                ruby_annotation: None,
                ..
            }) = self.items.last_mut()
            {
                last.push(' ');
            }
            self.pending_space = false;
            rest = rest.trim_start_matches(is_space);
        } else if self.has_content {
            let trimmed = rest.trim_start_matches(is_space);
            if trimmed.len() != rest.len() {
                // This node's own leading space, after earlier content.
                rest = trimmed;
                if !rest.is_empty() {
                    // Materialized below with the first character.
                    self.pending_space = true;
                }
            }
        } else {
            // Flow-leading white space collapses away entirely.
            rest = rest.trim_start_matches(is_space);
        }

        let mut collapsed = String::with_capacity(rest.len());
        if self.pending_space && !rest.is_empty() {
            collapsed.push(' ');
            self.pending_space = false;
        }
        let mut interior_space = false;
        let mut trailing_space = false;
        for ch in rest.chars() {
            if is_space(ch) {
                interior_space = true;
                trailing_space = true;
                continue;
            }
            if interior_space {
                collapsed.push(' ');
                interior_space = false;
            }
            trailing_space = false;
            collapsed.push(ch);
            self.has_content = true;
        }
        if !collapsed.is_empty() {
            // Merge into the previous item when the style and shift are
            // unchanged, so a paragraph of plain text stays a single
            // shaping run.
            // A ruby base never merges with its neighbours: its annotation
            // attaches to exactly this run's laid-out extent.
            let same_source = self.sources.last() == Some(&source);
            if let Some(InlineItem::Text {
                text: last,
                style: last_style,
                baseline_shift_px: last_shift,
                ruby_annotation: last_ruby,
            }) = self.items.last_mut()
            {
                if *last_style == style
                    && *last_shift == baseline_shift_px
                    && last_ruby.is_none()
                    && ruby_annotation.is_none()
                    && same_source
                {
                    last.push_str(&collapsed);
                } else {
                    self.items.push(InlineItem::Text {
                        text: collapsed,
                        style,
                        baseline_shift_px,
                        ruby_annotation,
                    });
                    self.sources.push(source);
                }
            } else {
                self.sources.push(source);
                self.items.push(InlineItem::Text {
                    text: collapsed,
                    style,
                    baseline_shift_px,
                    ruby_annotation,
                });
            }
        }
        if trailing_space && self.has_content {
            // This node ends in white space; it lands here if any content
            // follows, and collapses away at the end of the flow.
            self.pending_space = true;
        }
    }

    /// Appends a forced line break as a preserved newline in the flow text.
    fn push_hard_break(&mut self, style: StyleId, baseline_shift_px: f64) {
        self.pending_space = false;
        if let Some(InlineItem::Text {
            text: last,
            ruby_annotation: None,
            ..
        }) = self.items.last_mut()
        {
            last.push('\n');
        } else {
            self.sources.push(FlowItemSource {
                source_index: None,
                href: self.current_link.clone(),
                image_alt: None,
            });
            self.items.push(InlineItem::Text {
                text: "\n".to_owned(),
                style,
                baseline_shift_px,
                ruby_annotation: None,
            });
        }
        self.has_content = true;
    }

    /// Appends an atomic image item. A space pending from earlier text
    /// lands on that text; a space pending between two images collapses
    /// away (an accepted gap until mixed image runs need it).
    fn push_image(&mut self, item: InlineItem, source_index: usize, alt: &str) {
        if self.pending_space {
            if let Some(InlineItem::Text {
                text: last,
                ruby_annotation: None,
                ..
            }) = self.items.last_mut()
            {
                last.push(' ');
            }
            self.pending_space = false;
        }
        self.sources.push(FlowItemSource {
            source_index: Some(source_index),
            href: self.current_link.clone(),
            image_alt: (!alt.is_empty()).then(|| alt.to_owned()),
        });
        self.items.push(item);
        self.has_content = true;
    }

    fn finish(self) -> (Vec<InlineItem>, Vec<FlowItemSource>) {
        // Trailing pending space is dropped: flow-final white space
        // collapses away.
        debug_assert_eq!(self.items.len(), self.sources.len());
        (self.items, self.sources)
    }
}

/// The style of a CSS anonymous block box: block-level flow with every
/// box property initial. Inherited properties live on the inline items
/// inside, so the layout slice is fully initial here.
/// The plain block style in-crate test fixtures intern for containers.
#[cfg(test)]
pub(crate) fn tests_block_style() -> LayoutFormattingStyleV1 {
    anonymous_block_style()
}

fn anonymous_block_style() -> LayoutFormattingStyleV1 {
    let zero = LengthPercentageOrAuto::Value(LengthPercentage::Length(
        rito_style_contract::CssPx::new(0.0).expect("zero length is finite"),
    ));
    let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
        rito_style_contract::CssPx::new(0.0).expect("zero length is finite"),
    ));
    LayoutFormattingStyleV1 {
        display: LayoutDisplayV1 {
            outside: LayoutDisplayOutsideV1::Block,
            inside: LayoutDisplayInsideV1::Flow,
            is_list_item: false,
        },
        margin: PhysicalSides {
            top: zero,
            right: zero,
            bottom: zero,
            left: zero,
        },
        padding: PhysicalSides {
            top: zero_padding,
            right: zero_padding,
            bottom: zero_padding,
            left: zero_padding,
        },
        box_sizing: rito_style_contract::BoxSizingV1::ContentBox,
        justify_content: JustifyContentV1::Normal,
        align_items: AlignItemsV1::Normal,
        break_before: PageBreakV1::Auto,
        break_after: PageBreakV1::Auto,
        width: PreferredSizeV1::Auto,
        height: PreferredSizeV1::Auto,
        max_width: MaximumSizeV1::None,
        min_height: MinimumHeightV1::Auto,
        max_height: MaximumHeightV1::None,
        clear: ClearV1::None,
        float: FloatV1::None,
        overflow: OverflowV1::Visible,
        list_style_type: ListMarkerStyleV1::None,
        position: PositionV1::Static,
        inset: PhysicalSides {
            top: LengthPercentageOrAuto::Auto,
            right: LengthPercentageOrAuto::Auto,
            bottom: LengthPercentageOrAuto::Auto,
            left: LengthPercentageOrAuto::Auto,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        css::CssViewport,
        epub::{
            parsed_loaded_chapter_source, prepare_loaded_document_base, LoadedChapter,
            LoadedEpubDocument, LoadedTextResource, PackageDocument, PackageMetadata,
        },
        style::{resolve_prepared_chapter_style, ChapterStyleOptions, PreparedStyleChapterInput},
    };
    use rito_block::BlockFormattingContext;
    use rito_fragment::{CancelFlag, ConstraintSpace, FormattingContext, Fragment};
    use rito_inline::ParleyInlineContext;

    const CHAPTER_XHTML: &str = r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <p>First   paragraph with
     collapsed   spaces and <span class="bold">styled inline</span> text.</p>
  <div><p>Nested paragraph inside a wrapper block.</p></div>
  <p class="hidden">invisible content</p>
  <p></p>
</body></html>"#;

    const CHAPTER_CSS: &str = "\
html { font-family: Tinos; font-size: 16px; }\n\
p { margin: 8px 0; }\n\
.bold { font-weight: 700; }\n\
.hidden { display: none; }\n";

    struct ResolvedChapter {
        nodes: Vec<DocumentNode>,
        body_index: usize,
        layout: LayoutStyleTableV1,
        inline: InlineStyleTableV1,
    }

    fn no_images() -> BTreeMap<String, (u32, u32)> {
        BTreeMap::new()
    }

    fn resolved_chapter() -> ResolvedChapter {
        resolved_chapter_from(CHAPTER_XHTML)
    }

    fn resolved_chapter_from(xhtml: &str) -> ResolvedChapter {
        resolved_chapter_with(xhtml, CHAPTER_CSS)
    }

    fn resolved_chapter_with(xhtml: &str, css: &str) -> ResolvedChapter {
        let document = LoadedEpubDocument {
            package: PackageDocument {
                metadata: PackageMetadata {
                    title: "Bridge".to_owned(),
                    language: "en".to_owned(),
                    identifier: "bridge-test".to_owned(),
                    creator: None,
                },
                manifest: Vec::new(),
                spine: Vec::new(),
                toc: Vec::new(),
            },
            stylesheets: vec![LoadedTextResource {
                href: "styles/main.css".to_owned(),
                text: css.to_owned(),
            }],
            fonts: Vec::new(),
            images: Vec::new(),
            chapters: Vec::new(),
            archive_source: None,
        };
        let base = prepare_loaded_document_base(&document);
        let chapter = LoadedChapter {
            idref: "chapter-1".to_owned(),
            href: "chapter-1.xhtml".to_owned(),
            linear: true,
            xhtml_source: xhtml.to_owned(),
            source_loaded: true,
            image_refs: None,
        };
        let parsed = parsed_loaded_chapter_source(&chapter);
        let resolved = resolve_prepared_chapter_style(
            PreparedStyleChapterInput {
                stylesheet_ledger: &base.stylesheet_ledger,
                chapter_href: &parsed.source.href,
                source_arena: parsed.source_arena.as_ref(),
                body_source_node_id: parsed.parsed.body_source_node_id,
                nodes: &parsed.parsed.nodes,
                pagination_nodes: None,
                #[cfg(feature = "legacy-css-diagnostics")]
                body_attributes: parsed.parsed.body_attributes.as_ref(),
                author_stylesheets: &parsed.parsed.author_stylesheets,
            },
            Some(CssViewport::new(420.0, 640.0)),
            ChapterStyleOptions {
                root_font_size: 16.0,
                line_height_override: None,
                line_height_force: false,
                font_family_override: None,
                font_family_force: false,
            },
        )
        .expect("chapter style resolves");
        ResolvedChapter {
            nodes: parsed.parsed.nodes.clone(),
            body_index: parsed
                .parsed
                .body_source_node_id
                .expect("body has a source id")
                .index(),
            layout: resolved.layout_style_table,
            inline: resolved.inline_style_table,
        }
    }

    #[test]
    fn ruby_bases_carry_annotations_and_never_merge_with_neighbours() {
        let chapter = resolved_chapter_from(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <p>これは<ruby>漢字<rt>かんじ</rt></ruby>です。</p>
  <p><ruby><rb>東京</rb><rp>（</rp><rt>とうきょう</rt><rp>）</rp></ruby></p>
</body></html>"#,
        );
        let built = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect("tree builds");
        let root = built.tree.node(built.tree.root());
        let FormattingNodeContent::InlineFlow { items } =
            &built.tree.node(root.children[0]).content
        else {
            panic!("first paragraph is an inline flow");
        };
        let runs: Vec<(&str, Option<&str>)> = items
            .iter()
            .map(|item| match item {
                InlineItem::Text {
                    text,
                    ruby_annotation,
                    ..
                } => (text.as_str(), ruby_annotation.as_deref()),
                InlineItem::Image { .. } => panic!("no images here"),
            })
            .collect();
        assert_eq!(
            runs,
            vec![("これは", None), ("漢字", Some("かんじ")), ("です。", None),],
        );
        let FormattingNodeContent::InlineFlow { items } =
            &built.tree.node(root.children[1]).content
        else {
            panic!("second paragraph is an inline flow");
        };
        let InlineItem::Text {
            text,
            ruby_annotation,
            ..
        } = &items[0]
        else {
            panic!("ruby base is a text item");
        };
        assert_eq!(text, "東京");
        assert_eq!(ruby_annotation.as_deref(), Some("とうきょう"));
    }

    #[test]
    fn list_items_fail_closed_pending_marker_layout() {
        let chapter = resolved_chapter_from(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <ol><li>first entry</li></ol>
</body></html>"#,
        );
        for id in 0..4 {
            if let Ok(style) = chapter
                .layout
                .style(rito_style_contract::LayoutStyleId::from_raw(id))
            {
                eprintln!(
                    "layout style {id}: display {:?} list {:?}",
                    style.display, style.list_style_type
                );
            }
        }
        let error = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect_err("list items paint markers the fragment engine cannot produce yet");
        assert!(error.to_string().contains("list"), "{error}");
    }

    #[test]
    fn mono_ruby_pairs_each_annotation_with_its_base_segment() {
        let chapter = resolved_chapter_from(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <p><ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby></p>
</body></html>"#,
        );
        let built = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect("mono ruby builds");
        let root = built.tree.node(built.tree.root());
        let FormattingNodeContent::InlineFlow { items } =
            &built.tree.node(root.children[0]).content
        else {
            panic!("paragraph is an inline flow");
        };
        let runs: Vec<(&str, Option<&str>)> = items
            .iter()
            .map(|item| match item {
                InlineItem::Text {
                    text,
                    ruby_annotation,
                    ..
                } => (text.as_str(), ruby_annotation.as_deref()),
                InlineItem::Image { .. } => panic!("no images here"),
            })
            .collect();
        assert_eq!(runs, vec![("漢", Some("かん")), ("字", Some("じ"))],);
    }

    #[test]
    fn horizontal_rules_build_sized_leaves_with_rule_paint() {
        let chapter = resolved_chapter_with(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <hr class="fancy"/>
  <hr/>
</body></html>"#,
            "html { color: #223344; }\n.fancy { border-top: 2px dashed #336699; }\n",
        );
        let built = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect("rules build");
        let root = built.tree.node(built.tree.root());
        assert_eq!(root.children.len(), 2);
        let fancy = built.tree.node(root.children[0]);
        assert!(matches!(
            fancy.content,
            FormattingNodeContent::SizedLeaf {
                block_size,
                breakable: false,
            } if block_size == 2.0
        ));
        assert_eq!(
            built.node_paints.get(&root.children[0].0),
            Some(&NodePaint::Rule {
                color: "#336699".to_owned(),
                style: "dashed",
            }),
        );
        let plain = built.tree.node(root.children[1]);
        assert!(matches!(
            plain.content,
            FormattingNodeContent::SizedLeaf {
                block_size,
                breakable: false,
            } if block_size == 1.0
        ));
        assert_eq!(
            built.node_paints.get(&root.children[1].0),
            Some(&NodePaint::Rule {
                color: "#223344".to_owned(),
                style: "solid",
            }),
        );
    }

    #[test]
    fn decorated_blocks_carry_box_paint_and_absorb_border_widths() {
        let chapter = resolved_chapter_with(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <div class="card"><p>Inside the card.</p></div>
</body></html>"#,
            ".card { background-color: #112233; border: 2px solid #445566; padding: 4px; }\n",
        );
        let built = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect("decorated block builds");
        let root = built.tree.node(built.tree.root());
        let card_id = root.children[0];
        let card = built.tree.node(card_id);
        // Border widths absorbed into padding: 4px author padding + 2px border.
        let styles = built.tree.styles().expect("tree carries styles");
        let card_style = styles
            .layout
            .style(card.style)
            .expect("card style resolves");
        for side in [
            card_style.padding.top,
            card_style.padding.right,
            card_style.padding.bottom,
            card_style.padding.left,
        ] {
            let LengthPercentage::Length(px) = side.value() else {
                panic!("card padding stays a length");
            };
            assert!(
                (f64::from(px.get()) - 6.0).abs() < 1e-6,
                "padding absorbs the border"
            );
        }
        let Some(NodePaint::Box { paint, border_box }) = built.node_paints.get(&card_id.0) else {
            panic!(
                "card carries box paint, got {:?}",
                built.node_paints.get(&card_id.0)
            );
        };
        assert_eq!(paint["background"]["color"], "#112233");
        assert_eq!(paint["border"]["top"]["width"], 2.0);
        assert_eq!(paint["border"]["top"]["style"], "solid");
        assert_eq!(paint["border"]["left"]["color"], "#445566");
        assert_eq!(
            border_box.as_ref().expect("borders carry a border box")["topWidth"],
            2.0
        );
    }

    #[test]
    fn exotic_border_styles_fail_closed_by_name() {
        let chapter = resolved_chapter_with(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <div class="frame"><p>text</p></div>
</body></html>"#,
            ".frame { border: 3px double #000000; }\n",
        );
        let error = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect_err("double borders fail closed");
        assert!(
            error.message().contains("border-top style"),
            "error names the construct: {}",
            error.message()
        );
    }

    #[test]
    fn malformed_ruby_structures_fail_closed_by_name() {
        let stray_rt = resolved_chapter_from(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <p>text<rt>leak</rt></p>
</body></html>"#,
        );
        let error = build_chapter_formatting_tree(
            &stray_rt.nodes,
            stray_rt.body_index,
            &stray_rt.layout,
            &stray_rt.inline,
            &no_images(),
        )
        .expect_err("a stray <rt> would leak annotation text into the flow");
        assert!(error.to_string().contains("outside a <ruby>"), "{error}");
    }

    #[test]
    fn chapter_tree_reflects_box_generation_and_display_none() {
        let chapter = resolved_chapter();
        let built = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect("tree builds");
        let root = built.tree.node(built.tree.root());
        // p1 (inline flow), div (block container), empty p — hidden p gone.
        assert_eq!(root.children.len(), 3);
        let first = built.tree.node(root.children[0]);
        let FormattingNodeContent::InlineFlow { items } = &first.content else {
            panic!("first paragraph is an inline flow, got {:?}", first.content);
        };
        // Style boundaries split the items: plain, bold span, plain tail.
        assert_eq!(items.len(), 3, "{items:?}");
        let texts: Vec<&str> = items
            .iter()
            .map(|item| match item {
                InlineItem::Text { text, .. } => text.as_str(),
                InlineItem::Image { .. } => panic!("no images in this paragraph"),
            })
            .collect();
        assert_eq!(
            texts,
            vec![
                "First paragraph with collapsed spaces and ",
                "styled inline",
                " text.",
            ],
        );
        let (
            InlineItem::Text { style: plain, .. },
            InlineItem::Text { style: bold, .. },
            InlineItem::Text { style: tail, .. },
        ) = (&items[0], &items[1], &items[2])
        else {
            panic!("all three items are text runs");
        };
        assert_ne!(plain, bold, "the bold span interns a distinct style");
        assert_eq!(plain, tail, "text after the span returns to parent style");

        let wrapper = built.tree.node(root.children[1]);
        assert!(matches!(
            wrapper.content,
            FormattingNodeContent::BlockContainer
        ));
        assert_eq!(wrapper.children.len(), 1);
        let nested = built.tree.node(wrapper.children[0]);
        assert!(matches!(
            nested.content,
            FormattingNodeContent::InlineFlow { .. }
        ));

        let empty = built.tree.node(root.children[2]);
        assert!(matches!(
            empty.content,
            FormattingNodeContent::BlockContainer
        ));
        assert!(empty.children.is_empty());

        // Source mapping: real elements map back, the root maps to body.
        assert!(built.source_nodes[root.children[0].0 as usize].is_some());
        assert_eq!(
            built.source_nodes[built.tree.root().0 as usize],
            Some(chapter.body_index)
        );
    }

    #[test]
    fn chapter_tree_construction_is_deterministic() {
        let chapter = resolved_chapter();
        let first = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect("first build");
        let second = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect("second build");
        assert_eq!(first.tree.fingerprint(), second.tree.fingerprint());
        assert_eq!(first.source_nodes, second.source_nodes);
    }

    fn tinos_bytes() -> Vec<u8> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"
        );
        std::fs::read(path).expect("pinned Tinos test font reads")
    }

    #[test]
    fn real_chapter_paginates_losslessly_through_the_new_engine() {
        let chapter = resolved_chapter();
        let built = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect("tree builds");
        let engine = BlockFormattingContext::new(
            ParleyInlineContext::new(vec![tinos_bytes()]).expect("fonts register"),
        );
        let cancel = CancelFlag::new();
        let space = ConstraintSpace::fragmented(200.0, 60.0);
        let mut token = None;
        let mut pages = Vec::new();
        loop {
            let outcome = engine
                .layout(
                    &built.tree,
                    built.tree.root(),
                    &space,
                    token.as_ref(),
                    &cancel,
                )
                .expect("page lays out");
            token = outcome.continuation.clone();
            pages.push(outcome);
            if token.is_none() {
                break;
            }
            assert!(pages.len() < 64, "pagination terminates");
        }
        assert!(pages.len() > 1, "narrow pages force pagination");

        // Reassemble every text fragment across all pages per paragraph
        // node; the result must equal the collapsed source text exactly.
        let mut per_node: std::collections::BTreeMap<u32, String> =
            std::collections::BTreeMap::new();
        fn walk(
            fragment: &Fragment,
            tree: &FormattingTree,
            per_node: &mut std::collections::BTreeMap<u32, String>,
        ) {
            match fragment {
                Fragment::Box(inner) => {
                    for child in &inner.children {
                        walk(child, tree, per_node);
                    }
                }
                Fragment::Line(line) => {
                    let source = line.source;
                    let FormattingNodeContent::InlineFlow { items } = &tree.node(source).content
                    else {
                        panic!("line sources are inline flows");
                    };
                    let full_text: String = items
                        .iter()
                        .filter_map(|item| match item {
                            InlineItem::Text { text, .. } => Some(text.as_str()),
                            InlineItem::Image { .. } => None,
                        })
                        .collect();
                    let mut start = u32::MAX;
                    let mut end = 0_u32;
                    for run in &line.children {
                        let Fragment::Text(run) = run else {
                            panic!("line children are text runs");
                        };
                        start = start.min(run.text_start);
                        end = end.max(run.text_end);
                    }
                    per_node
                        .entry(source.0)
                        .or_default()
                        .push_str(&full_text[start as usize..end as usize]);
                }
                Fragment::Text(_) | Fragment::Image(_) => {}
            }
        }
        for page in &pages {
            walk(&page.fragments.root, &built.tree, &mut per_node);
        }
        let reassembled: Vec<&str> = per_node.values().map(String::as_str).collect();
        assert_eq!(
            reassembled,
            vec![
                "First paragraph with collapsed spaces and styled inline text.",
                "Nested paragraph inside a wrapper block.",
            ],
        );
    }
}
