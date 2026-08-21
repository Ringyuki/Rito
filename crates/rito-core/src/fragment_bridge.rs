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
    /// Flank border strokes for inline images, keyed by the `<img>`
    /// element's SOURCE index (images have no formatting node). The
    /// widths are the absorbed border widths (top, right, bottom, left);
    /// layout reserved them as padding, the painter strokes them around
    /// the raster rect.
    pub image_border_paints: BTreeMap<u32, (NodePaint, [f64; 4])>,
    /// The chapter body's own background color, when it has one. This is
    /// the page background — the frame producer washes each page with it
    /// — matching how the retained pipeline hoists a body background onto
    /// the page rather than painting a content-box rectangle.
    pub page_background: Option<String>,
    /// The chapter body's background image, painted across the full page
    /// like the CSS body-background canvas propagation. The `paintBlock`
    /// paint object, color stripped (the wash owns it).
    pub page_background_image: Option<Value>,
    /// Per inline-flow node: each item's interaction source, index-aligned
    /// with the flow's `InlineItem` list. Page artifacts join laid-out
    /// runs back to links, images, and source nodes through this table.
    pub flow_item_sources: BTreeMap<u32, Vec<FlowItemSource>>,
    /// Anchor `id` attributes per formatting node, for jump navigation.
    pub node_anchors: BTreeMap<u32, String>,
    /// Link destinations carried by block-level boxes (an `<a href>`
    /// around block children scopes the link over the block's whole
    /// border box, padding included, exactly as the browser hit-tests
    /// it). Keyed by formatting node id.
    pub node_links: BTreeMap<u32, String>,
    /// Anchor `id` attributes for source nodes that produce no formatting
    /// node of their own — images, which lay out as inline atoms. Keyed by
    /// source-arena index, the coordinate `flow_item_sources` reports.
    pub source_anchors: BTreeMap<usize, String>,
    /// Source tag per block-level formatting node, for semantic roles.
    pub node_tags: BTreeMap<u32, String>,
    /// Constructs the tree could not represent exactly and rendered with
    /// an approximation instead (ignored decoration, flattened display,
    /// collapsed preserved white space, …). Empty means exact.
    pub degradations: Vec<String>,
}

/// One inline item's interaction provenance.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FlowItemSource {
    /// Source-arena node index of the item's owner (the text node for a
    /// text run, the image element for an image).
    pub source_index: Option<usize>,
    /// Source-tree node path of the item's owner, the durable locator
    /// coordinate shared with the retained backend.
    pub source_path: Option<Vec<usize>>,
    /// Destination of the nearest enclosing `<a href>`, if any.
    pub href: Option<String>,
    /// Alt text for an image item.
    pub image_alt: Option<String>,
    /// Piecewise-linear map from item text to the owner's source text,
    /// both UTF-16. White-space collapse breaks linearity, so each
    /// contiguous copied stretch is one segment; offsets between
    /// segments (collapsed spaces) have no exact source position.
    pub segments: Vec<SourceSegment>,
}

/// One linear stretch of the item→source text mapping.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceSegment {
    /// Start offset in the item's text, UTF-16.
    pub item_start: u32,
    /// Start offset in the source node's text, UTF-16.
    pub source_start: u32,
    /// Length of the stretch, UTF-16.
    pub len: u32,
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
        /// Stroke thickness. The node's box can be taller (an author
        /// `height` plus both borders flows as the box size, like a
        /// browser's `<hr>`), while the visible stroke keeps the border
        /// width and rides at the box top.
        thickness: f64,
    },
    /// Block-box decoration: the `paintBlock` command's `paint` object
    /// and optional `borderBox` widths, exactly as the render protocol
    /// consumes them. Border widths are already lowered into the node's
    /// layout padding, so the fragment rect is the CSS border box and the
    /// renderer strokes edges inside it.
    Box {
        paint: Value,
        border_box: Option<Value>,
        /// The box's computed transform list in wire order, painted as a
        /// stacking wrapper around the box and its whole subtree (origin =
        /// border-box center, CSS transform-origin default).
        transform: Option<Value>,
        /// Ridge/groove edges paint two-tone: the border entry strokes
        /// the edge's OUTER half color across the full width and each
        /// entry here overlays the INNER half (the strip adjacent to the
        /// content) with the opposite tone. Keyed by edge index in
        /// border-box order (0 top, 1 right, 2 bottom, 3 left).
        bevels: Vec<(usize, String)>,
        /// A collapsed table's dashed/dotted horizontal edges paint per
        /// CELL segment (the collapsed border belongs to the cells and
        /// the dash phase restarts at each cell edge); the painter
        /// splits such an edge into per-cell rules instead of one
        /// full-width stroke.
        segment_horizontal_edges: bool,
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
    let mut inline = inline.clone();
    let fallback_inline_style = inline
        .intern(fallback_inline_formatting_style())
        .map_err(|error| EpubError::new(format!("fallback inline style interns: {error}")))?;
    let mut builder = TreeBuilder {
        layout: &mut layout,
        inline: &mut inline,
        image_dimensions,
        anonymous_style,
        fallback_inline_style,
        nodes: Vec::new(),
        source_nodes: Vec::new(),
        node_paints: BTreeMap::new(),
        image_border_paints: BTreeMap::new(),
        flow_item_sources: BTreeMap::new(),
        node_anchors: BTreeMap::new(),
        source_anchors: BTreeMap::new(),
        node_tags: BTreeMap::new(),
        block_link: None,
        node_links: BTreeMap::new(),
        strut_styles: BTreeMap::new(),
        degradations: Vec::new(),
        checked_block_styles: std::collections::HashMap::new(),
        checked_box_paints: std::collections::HashMap::new(),
        checked_inline_styles: std::collections::HashMap::new(),
    };
    let body_style = builder.layout_style_id(body_source_node_index, "chapter body");
    let page_background = builder.chapter_body_background(body_source_node_index)?;
    let body_inline_style = builder.inline_style_id(body_source_node_index, "chapter body");
    let children = builder.build_children(nodes, body_inline_style)?;
    let root = builder.push_node(
        FormattingNode {
            style: body_style,
            content: FormattingNodeContent::BlockContainer,
            children,
        },
        Some(body_source_node_index),
    );
    // CSS propagates the body's background to the canvas. In the paged
    // reader baseline (epub.js columns, and this engine's pages) the body
    // box fills the page, so the positioning area is the page content
    // box: the image paints at page level. Color stays with the page
    // wash so translucent colors never apply twice.
    let page_background_image = builder
        .inline
        .style(body_inline_style)
        .ok()
        .and_then(|resolved| {
            let (plan, _) = block_box_paint(resolved);
            let (NodePaint::Box { paint, .. }, _) = plan? else {
                return None;
            };
            let background = paint
                .as_object()
                .and_then(|paint| paint.get("background"))
                .and_then(Value::as_object)
                .filter(|background| background.contains_key("image"))?;
            let mut background = background.clone();
            background.remove("color");
            Some(serde_json::json!({ "background": background }))
        });
    let TreeBuilder {
        nodes: mut formatting_nodes,
        source_nodes,
        node_paints,
        image_border_paints,
        flow_item_sources,
        node_anchors,
        node_links,
        source_anchors,
        node_tags,
        strut_styles,
        degradations,
        ..
    } = builder;
    fold_through_collapsing_margins(&mut formatting_nodes, root, &mut layout)?;
    let mut tree = FormattingTree::with_styles(
        formatting_nodes,
        root,
        FormattingTreeStyles { layout, inline },
    )
    .map_err(EpubError::new)?;
    tree.set_strut_styles(strut_styles);
    Ok(ChapterFormattingTree {
        tree,
        source_nodes,
        node_paints,
        image_border_paints,
        page_background,
        page_background_image,
        flow_item_sources,
        node_anchors,
        node_links,
        source_anchors,
        node_tags,
        degradations,
    })
}

struct TreeBuilder<'a> {
    layout: &'a mut LayoutStyleTableV1,
    inline: &'a mut InlineStyleTableV1,
    image_dimensions: &'a BTreeMap<String, (u32, u32)>,
    anonymous_style: LayoutStyleId,
    /// The style a node falls back to when the projection retained no
    /// inline entry for it (its own declarations were unrepresentable).
    fallback_inline_style: StyleId,
    nodes: Vec<FormattingNode>,
    source_nodes: Vec<Option<usize>>,
    node_paints: BTreeMap<u32, NodePaint>,
    image_border_paints: BTreeMap<u32, (NodePaint, [f64; 4])>,
    flow_item_sources: BTreeMap<u32, Vec<FlowItemSource>>,
    node_anchors: BTreeMap<u32, String>,
    source_anchors: BTreeMap<usize, String>,
    node_tags: BTreeMap<u32, String>,
    /// Link destinations recorded per block node for whole-box hit areas.
    node_links: BTreeMap<u32, String>,
    /// The nearest enclosing block-level `<a href>` destination: an `<a>`
    /// containing block children scopes its link over the whole subtree
    /// (the TOC-card idiom `<a><div>card</div></a>`), so inline runs
    /// collected below it start with this link active.
    block_link: Option<String>,
    /// The container inline style per inline-flow node — the CSS strut.
    strut_styles: BTreeMap<u32, StyleId>,
    degradations: Vec<String>,
    /// Capability verdict per interned style id, so each distinct style is
    /// checked once per chapter.
    checked_block_styles: std::collections::HashMap<u32, Option<String>>,
    checked_box_paints:
        std::collections::HashMap<u32, (Option<(NodePaint, [f64; 4])>, Vec<String>)>,
    checked_inline_styles: std::collections::HashMap<(u32, bool), Option<String>>,
}

impl TreeBuilder<'_> {
    /// Records one approximation the tree build applied instead of
    /// failing the chapter. Deduplicated: one entry per distinct reason.
    fn degrade(&mut self, reason: String) {
        if !self.degradations.contains(&reason) {
            self.degradations.push(reason);
        }
    }

    fn push_node(&mut self, node: FormattingNode, source: Option<usize>) -> FormattingNodeId {
        let id = FormattingNodeId(self.nodes.len() as u32);
        self.nodes.push(node);
        self.source_nodes.push(source);
        id
    }

    fn layout_style_id(&mut self, source_index: usize, what: &str) -> LayoutStyleId {
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

    fn inline_style_id(&mut self, source_index: usize, what: &str) -> StyleId {
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
            Ok(style) => style.display.outside == LayoutDisplayOutsideV1::None,
            Err(_) => {
                self.degrade(format!("<{what}> layout style missing: treated as visible"));
                false
            }
        }
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
        if anchor_layout.display.outside != LayoutDisplayOutsideV1::Block {
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
            if resolved.display.inside == LayoutDisplayInsideV1::Table {
                // `build_table` absorbs the table's border into padding
                // itself (and registers the decoration paint); absorbing
                // here too counted the border twice — every 2px-framed
                // card ran 4px narrower and 4px taller than Blink.
                return self.build_table(element, source_index, style);
            }
        }
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
            let (content, sources) = if items.is_empty() {
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
        if layout_style.display.inside != LayoutDisplayInsideV1::Flex
            || layout_style.justify_content != JustifyContentV1::Center
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
    /// container's own box (padding and borders) stripped: those belong
    /// to the block layout, not to the text runs inside it. A span's own
    /// style keeps its box — that is what makes it an inline box.
    fn container_text_style(&mut self, style: StyleId) -> EpubResult<StyleId> {
        use rito_style_contract as c;
        let resolved = self
            .inline
            .style(style)
            .map_err(|error| EpubError::new(format!("container style resolves: {error}")))?;
        let zero_side = |side: &c::NonNegativeLengthPercentage| {
            length_percentage_is_zero(&side.value())
        };
        let zero_edge =
            |edge: &c::BorderEdge| f64::from(edge.resolved_width.get()) == 0.0;
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
        {
            return Ok(style);
        }
        let mut derived = resolved.clone();
        let zero = c::NonNegativeLengthPercentage::new(c::LengthPercentage::Length(
            c::CssPx::new(0.0).map_err(|error| {
                EpubError::new(format!("container text style zero: {error:?}"))
            })?,
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
                let shift = ancestor_shift_px + resolved_baseline_shift(resolved, parent_font_size);
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
                        resolved.display.outside == LayoutDisplayOutsideV1::Inline
                            && resolved.display.inside == LayoutDisplayInsideV1::FlowRoot
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
        if items.is_empty() {
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

    /// Builds one `<hr>`: a fixed-height leaf whose visible line is a
    /// stroke across its box. An author border-top drives the line's
    /// height, pattern, and color, mirroring the retained engine's rule
    /// resolution; without one the rule is the classic one-pixel solid
    /// line in the element's text color. Exotic stroke patterns collapse
    /// to solid exactly as the render protocol does.
    fn build_hr(&mut self, element: &ElementNode) -> EpubResult<Option<FormattingNodeId>> {
        use rito_style_contract::BorderStyle;
        let source_index = element_source_index(element)?;
        if self.is_display_none(source_index, "hr") {
            return Ok(None);
        }
        let style = self.layout_style_id(source_index, "hr");
        self.require_block_capabilities(style, "hr")?;
        let inline_style = self.inline_style_id(source_index, "hr");
        let resolved = self
            .inline
            .style(inline_style)
            .map_err(|error| EpubError::new(format!("hr style: {error}")))?;
        let border = resolved.fragment.border.top;
        let use_border = border.resolved_width.get() > 0.0
            && !matches!(border.style, BorderStyle::None | BorderStyle::Hidden);
        let (thickness, stroke, color) = if use_border {
            let stroke = match border.style {
                BorderStyle::Dotted => "dotted",
                BorderStyle::Dashed => "dashed",
                // A thin inset rule paints Chromium's fixed 3D bevel pair
                // (top #9A9A9A, bottom #EEEEEE, border-color ignored —
                // measured identical for gray, red and slate); the paint
                // walk expands it into two solid strokes.
                BorderStyle::Inset | BorderStyle::Groove => "inset",
                _ => "solid",
            };
            let color = border.color.resolve(resolved.paint.foreground);
            (f64::from(border.resolved_width.get()), stroke, color)
        } else {
            // No author border: the UA default is `border: 1px inset`, so
            // the rule is Chromium's bevel pair over a two-pixel box
            // (b52 profile pages: every block below a bare <hr> sat one
            // pixel high under the old one-pixel model).
            (1.0, "inset", resolved.paint.foreground)
        };
        // The box the rule occupies in flow follows the CSS box model: an
        // author `height` is the content height, and both horizontal
        // borders add to it (the book-measured 3px cascade: a
        // `height: 2px; border: 1px inset` rule flows 4px tall in Blink
        // while the stroke stays 1px). Without author borders the UA
        // 1px-inset pair still spans two pixels of flow.
        let block_size = if use_border {
            let bottom = resolved.fragment.border.bottom;
            let bottom_width = if matches!(bottom.style, BorderStyle::None | BorderStyle::Hidden) {
                0.0
            } else {
                f64::from(bottom.resolved_width.get())
            };
            let author_height = self
                .layout
                .style(style)
                .ok()
                .and_then(|layout_style| match layout_style.height {
                    rito_style_contract::PreferredSizeV1::Value(value) => match value.value() {
                        rito_style_contract::LengthPercentage::Length(px) => {
                            Some(f64::from(px.get()))
                        }
                        _ => None,
                    },
                    _ => None,
                })
                .unwrap_or(0.0);
            thickness + author_height + bottom_width
        } else {
            thickness * 2.0
        };
        let color = crate::style::absolute_color(color)
            .map_err(|error| EpubError::new(format!("hr stroke color: {error:?}")))?;
        let id = self.push_node(
            FormattingNode {
                style,
                content: FormattingNodeContent::SizedLeaf {
                    block_size,
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
                thickness,
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
                    let annotation = text.split_whitespace().collect::<Vec<_>>().join(" ");
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
                    let size_ratio = match (
                        self.inline.style(rt_style),
                        self.inline.style(style),
                    ) {
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

    /// Collects one image as an atomic inline item. The image element has
    /// its own projected styles; display sizing happens at layout time.
    fn collect_image(
        &mut self,
        image: &ImageNode,
        inherited: StyleId,
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
        if self.is_display_none(source_index, "image") {
            return Ok(());
        }
        let dimensions = self.image_dimensions.get(&image.src).copied();
        let (width, height) = match dimensions {
            Some(dimensions) => dimensions,
            None => {
                // A missing or undecodable image lays out as Chromium's
                // broken-image placeholder instead of refusing the chapter.
                // Measured (pinned-face oracle): a 16×16 icon, followed by
                // the alt text in the element's own style when alt is
                // non-empty (alt "015" at 16px → 40×18: icon 16 + three
                // 8px digits; the pair participates in inline layout, so a
                // centered row of art + missing plate shifts by half the
                // placeholder — the b69 finale page's 19px displacement).
                // An empty alt collapses in Chromium (0×0); the 1×1 here
                // is the closest the atom pipeline represents.
                self.degrade(format!(
                    "image dimensions unavailable, placeholder rendered: {}",
                    image.src
                ));
                if image.alt.is_empty() {
                    (1, 1)
                } else {
                    (16, 16)
                }
            }
        };
        let style = self.inline_style_id(source_index, "image");
        let layout_style = self.layout_style_id(source_index, "image");
        // The image's own border reserves space exactly like a
        // container's: its widths become padding on the derived layout
        // style, the atom's advance spans them, and the raster paints
        // inside (measured on the b60 cover's 1px `none solid` flanks —
        // dropping them shifted the whole plate one pixel against Blink).
        let layout_style = match self.block_box_paint_plan(source_index, "image")? {
            Some((paint, widths)) if widths.iter().any(|width| *width > 0.0) => {
                self.image_border_paints
                    .insert(source_index as u32, (paint, widths));
                self.style_with_border_padding(layout_style, widths, "image")?
            }
            _ => layout_style,
        };
        self.require_image_capabilities(layout_style)?;
        self.require_inline_capabilities(style, true, "image")?;
        let resolved = self
            .inline
            .style(style)
            .map_err(|error| EpubError::new(format!("image style: {error}")))?;
        if let Some(anchor) = image
            .attributes
            .as_ref()
            .and_then(|attributes| attributes.id.clone())
        {
            self.source_anchors.insert(source_index, anchor);
        }
        // NOTE: an SVG-folded raster's PLACEMENT is two-stage in the
        // browser — the svg element letterboxes its viewBox (cover:
        // 1434×2048 → 595.166×850 at x 22.417), then the inner <image>
        // contain-fits the raster (1119×1600) inside the scaled
        // image-element rect, landing at x 22.766, width 594.47. The
        // raster intrinsics below reproduce that FINAL rect in one step,
        // which is why swapping them for the viewBox regresses the cover
        // (10.6k → 226k, twice measured: the raster then letterboxes a
        // second time against the wrong basis). The residual 1,701-px
        // edge-column class lives in the 0.35px band between the viewBox
        // content edge and the raster edge — whatever the browser paints
        // there needs a reduced svg-letterbox probe before any change.
        // `vertical-align: top` pins the image to the line-box top,
        // stepping OUT of whatever baseline-shift chain wraps it (the
        // zhangyue footnote badge sits inside <sup> yet hugs the line
        // top in Blink; the sup's strut still raises the envelope).
        let align_top = matches!(
            resolved.fragment.baseline_shift,
            rito_style_contract::BaselineShift::Top
        );
        let baseline_shift_px = ancestor_shift_px
            + resolved_baseline_shift(
                resolved,
                self.inline
                    .style(inherited)
                    .map(|parent| f64::from(parent.font.size.get()))
                    .map_err(|error| EpubError::new(format!("image parent style: {error}")))?,
            );
        collector.push_image(
            InlineItem::Image {
                src: image.src.clone(),
                source: source_index as u32,
                intrinsic_width: f64::from(width),
                intrinsic_height: f64::from(height),
                style,
                layout_style,
                fit_contain: image.svg_contain,
                viewport: image.svg_viewport,
                align_top,
                baseline_shift_px,
            },
            source_index,
            image.source_ref.node_path.clone(),
            &image.alt,
        );
        if dimensions.is_none() && !image.alt.is_empty() {
            // The placeholder's alt text follows the icon inline, in the
            // image element's own style — exactly the run Chromium lays
            // out for a broken image.
            collector.push_text(
                &image.alt,
                style,
                baseline_shift_px,
                true,
                None,
                Some(source_index),
                Some(image.source_ref.node_path.clone()),
            );
        }
        Ok(())
    }

    /// Builds a `display: table` element into the table grid the block
    /// engine lays out: row groups flatten, rows collect cells, a cell's
    /// content builds like a block container, and `colspan` spans grid
    /// columns. Structure the CSS table model would wrap in anonymous
    /// boxes degrades to plain rows/cells with a note.
    fn build_table(
        &mut self,
        element: &ElementNode,
        source_index: usize,
        style: LayoutStyleId,
    ) -> EpubResult<Option<FormattingNodeId>> {
        let tag = element.tag.clone();
        let collapsed = self
            .layout
            .style(style)
            .map(|resolved| resolved.border_collapse)
            .unwrap_or(false);
        let plan = self.block_box_paint_plan(source_index, &tag)?;
        let (style, decoration) = match plan {
            Some((paint, widths)) if widths.iter().any(|width| *width > 0.0) => (
                self.style_with_border_padding(style, widths, &tag)?,
                Some(paint),
            ),
            Some((paint, _)) => (style, Some(paint)),
            None => (style, None),
        };
        let mut rows = Vec::new();
        self.collect_table_rows(&element.children, &mut rows)?;
        let row_ids = rows
            .into_iter()
            .map(|row| self.build_table_row(row))
            .collect::<EpubResult<Vec<_>>>()?;
        let id = self.push_node(
            FormattingNode {
                style,
                content: FormattingNodeContent::Table,
                children: row_ids,
            },
            Some(source_index),
        );
        if let Some(anchor) = element
            .attributes
            .as_ref()
            .and_then(|attributes| attributes.id.clone())
        {
            self.node_anchors.insert(id.0, anchor);
        }
        self.node_tags.insert(id.0, tag);
        if let Some(mut paint) = decoration {
            if let NodePaint::Box {
                segment_horizontal_edges,
                ..
            } = &mut paint
            {
                *segment_horizontal_edges = collapsed;
            }
            self.node_paints.insert(id.0, paint);
        }
        Ok(Some(id))
    }

    /// Flattens row groups and collects row elements in document order.
    fn collect_table_rows<'n>(
        &mut self,
        children: &'n [DocumentNode],
        rows: &mut Vec<&'n ElementNode>,
    ) -> EpubResult<()> {
        for child in children {
            let DocumentNode::Block(inner) = child else {
                continue;
            };
            let inner_index = element_source_index(inner)?;
            if self.is_display_none(inner_index, &inner.tag) {
                continue;
            }
            let inside = {
                let style_id = self.layout_style_id(inner_index, &inner.tag);
                self.layout
                    .style(style_id)
                    .map(|resolved| resolved.display.inside)
                    .unwrap_or(LayoutDisplayInsideV1::Flow)
            };
            match inside {
                LayoutDisplayInsideV1::TableRow => rows.push(inner),
                LayoutDisplayInsideV1::TableRowGroup
                | LayoutDisplayInsideV1::TableHeaderGroup
                | LayoutDisplayInsideV1::TableFooterGroup => {
                    self.collect_table_rows(&inner.children, rows)?;
                }
                LayoutDisplayInsideV1::TableColumn | LayoutDisplayInsideV1::TableColumnGroup => {}
                _ => {
                    self.degrade(format!(
                        "<{}> inside a table is not a row; skipped",
                        inner.tag
                    ));
                }
            }
        }
        Ok(())
    }

    fn build_table_row(&mut self, row: &ElementNode) -> EpubResult<FormattingNodeId> {
        let source_index = element_source_index(row)?;
        let style = self.layout_style_id(source_index, &row.tag);
        let mut cells = Vec::new();
        for child in &row.children {
            let DocumentNode::Block(cell) = child else {
                continue;
            };
            let cell_index = element_source_index(cell)?;
            if self.is_display_none(cell_index, &cell.tag) {
                continue;
            }
            let cell_style = self.layout_style_id(cell_index, &cell.tag);
            let cell_tag = cell.tag.clone();
            let plan = self.block_box_paint_plan(cell_index, &cell_tag)?;
            let (cell_style, decoration) = match plan {
                Some((paint, widths)) if widths.iter().any(|width| *width > 0.0) => (
                    self.style_with_border_padding(cell_style, widths, &cell_tag)?,
                    Some(paint),
                ),
                Some((paint, _)) => (cell_style, Some(paint)),
                None => (cell_style, None),
            };
            let col_span = cell
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.colspan)
                .unwrap_or(1)
                .max(1);
            if cell
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.rowspan)
                .is_some_and(|span| span > 1)
            {
                self.degrade("table rowspan laid out as a single row".to_owned());
            }
            let inline_style = self.inline_style_id(cell_index, &cell.tag);
            let children = self.build_children(&cell.children, inline_style)?;
            let id = self.push_node(
                FormattingNode {
                    style: cell_style,
                    content: FormattingNodeContent::TableCell {
                        col_span: col_span as u32,
                    },
                    children,
                },
                Some(cell_index),
            );
            self.node_tags.insert(id.0, cell_tag);
            if let Some(anchor) = cell
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.id.clone())
            {
                self.node_anchors.insert(id.0, anchor);
            }
            if let Some(paint) = decoration {
                self.node_paints.insert(id.0, paint);
            }
            cells.push(id);
        }
        let row_id = self.push_node(
            FormattingNode {
                style,
                content: FormattingNodeContent::TableRow,
                children: cells,
            },
            Some(source_index),
        );
        self.node_tags.insert(row_id.0, row.tag.clone());
        if let Some(anchor) = row
            .attributes
            .as_ref()
            .and_then(|attributes| attributes.id.clone())
        {
            self.node_anchors.insert(row_id.0, anchor);
        }
        Ok(row_id)
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
        let style = self.inline_style_id(source_index, "chapter body");
        let (background, bordered, decoration) = {
            let resolved = self
                .inline
                .style(style)
                .map_err(|error| EpubError::new(format!("chapter body style resolves: {error}")))?;
            let background = match resolved.paint.background {
                rito_style_contract::ComputedColorV1::Absolute(color)
                    if color.alpha().get() > 0.0 =>
                {
                    crate::style::absolute_color(color).ok()
                }
                rito_style_contract::ComputedColorV1::CurrentColor => {
                    crate::style::absolute_color(resolved.paint.foreground).ok()
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

    /// Fail-open gate for block layout styles: an unimplemented field is
    /// recorded as a degradation and the box lays out as plain block flow
    /// (display variants flatten, exotic sizing constraints are ignored),
    /// keeping every chapter representable at reduced fidelity.
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
        if let Some(reason) = verdict {
            self.degrade(format!("<{what}> laid out as plain block flow: {reason}"));
        }
        Ok(())
    }

    /// Whitelist gate for an image's layout style: the sizing fields are
    /// consumed by image display sizing, so more values are implemented
    /// than for plain blocks.
    fn require_image_capabilities(&mut self, style: LayoutStyleId) -> EpubResult<()> {
        let (floated, violation) = {
            let resolved = self
                .layout
                .style(style)
                .map_err(|error| EpubError::new(format!("image style resolves: {error}")))?;
            (
                resolved.float != rito_style_contract::FloatV1::None,
                shared_box_capability_violation(resolved),
            )
        };
        if floated {
            self.degrade(
                "floated image laid out in-flow (line-box wrapping is unimplemented)".to_owned(),
            );
        }
        if let Some(reason) = violation {
            self.degrade(format!("image constraint ignored: {reason}"));
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
        if let Some(reason) = verdict {
            self.degrade(format!("{what} inline decoration ignored: {reason}"));
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
        // Preserve (`pre-wrap`/`pre`) keeps spaces and segment breaks
        // verbatim through the collector's non-collapsing path; the wrap
        // axis rides text-wrap separately (measured: a calibre story's
        // four-space paragraph indents, kept by Blink, erased by the
        // collapsing fallback — every line of the chapter shifted).
        c::WhiteSpaceCollapse::Collapse | c::WhiteSpaceCollapse::Preserve => {}
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
        // `isolate` is HTML's UA default on flow content and on any
        // `dir` element. The engine performs no bidi reordering at all
        // (a listed capability gap), so isolation is inert here rather
        // than a per-element approximation worth noting.
        (
            c::Direction::LeftToRight,
            c::UnicodeBidi::Normal | c::UnicodeBidi::Isolate,
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
) -> (Option<(NodePaint, [f64; 4])>, Vec<String>) {
    use rito_style_contract as c;
    let mut degradations = Vec::new();
    let mut box_shadows = Vec::new();
    for shadow in style.paint.box_shadows.iter() {
        let Ok(color) =
            crate::style::absolute_color(shadow.color.resolve(style.paint.foreground))
        else {
            degradations.push("box-shadow color unresolvable, shadow skipped".to_owned());
            continue;
        };
        box_shadows.push(serde_json::json!({
            "offsetX": f64::from(shadow.offset_x.get()),
            "offsetY": f64::from(shadow.offset_y.get()),
            "blur": f64::from(shadow.blur_radius.get()),
            "spread": f64::from(shadow.spread_radius.get()),
            "color": color,
            "inset": shadow.inset,
        }));
    }
    let background = match style.paint.background {
        c::ComputedColorV1::Absolute(color) if color.alpha().get() == 0.0 => None,
        c::ComputedColorV1::Absolute(color) => crate::style::absolute_color(color).ok(),
        c::ComputedColorV1::CurrentColor => {
            crate::style::absolute_color(style.paint.foreground).ok()
        }
    };
    let mut widths = [0.0; 4];
    let mut border = serde_json::Map::new();
    let mut bevels = Vec::new();
    for (index, (edge, name)) in [
        (&style.fragment.border.top, "top"),
        (&style.fragment.border.right, "right"),
        (&style.fragment.border.bottom, "bottom"),
        (&style.fragment.border.left, "left"),
    ]
    .into_iter()
    .enumerate()
    {
        let width = f64::from(edge.resolved_width.get());
        if width <= 0.0 || matches!(edge.style, c::BorderStyle::None | c::BorderStyle::Hidden) {
            continue;
        }
        let Ok(color) = crate::style::absolute_color(edge.color.resolve(style.paint.foreground))
        else {
            degradations.push(format!("border-{name} color unresolvable, edge skipped"));
            continue;
        };
        let mut color = color;
        let stroke = match edge.style {
            c::BorderStyle::Solid => "solid",
            c::BorderStyle::Dashed => "dashed",
            c::BorderStyle::Dotted => "dotted",
            c::BorderStyle::Double => "double",
            c::BorderStyle::Ridge | c::BorderStyle::Groove
                if two_tone_halves(&color, edge.style, index).is_some() =>
            {
                let (outer, inner) =
                    two_tone_halves(&color, edge.style, index).expect("guard checked");
                color = outer;
                bevels.push((index, inner));
                "solid"
            }
            c::BorderStyle::Inset | c::BorderStyle::Outset => {
                // Blink's legacy 3D shading (probed matrix, 2026-08-20):
                // the darkened sides (top/left for inset, bottom/right
                // for outset) use Color::Dark() — channels scaled by
                // (V − 0.33)/V — while the lighter sides keep the base
                // color, lightening it only when it lacks 1.75:1
                // contrast against its own dark shade. A currentColor
                // border ignores the text color and shades from #EEEEEE
                // (gray hr rules paint 154/238, red currentColor ones
                // identically).
                let base = if matches!(edge.color, c::ComputedColorV1::CurrentColor) {
                    "#eeeeee".to_owned()
                } else {
                    color.clone()
                };
                let darken = matches!(index, 0 | 3)
                    == matches!(edge.style, c::BorderStyle::Inset);
                color = inset_outset_shade(&base, darken).unwrap_or(base);
                "solid"
            }
            other => {
                degradations.push(format!("border-{name} style {other:?} drawn solid"));
                "solid"
            }
        };
        widths[index] = width;
        border.insert(
            name.to_owned(),
            serde_json::json!({ "width": width, "color": color, "style": stroke }),
        );
    }
    // The frame-buffer protocol requires all four widths whenever a
    // border box is present, zero-filled for unpainted edges.
    let border_box = (!border.is_empty()).then(|| {
        serde_json::json!({
            "topWidth": widths[0],
            "rightWidth": widths[1],
            "bottomWidth": widths[2],
            "leftWidth": widths[3],
        })
    });
    // The background-image cluster travels exactly as the render protocol
    // consumes it; the canvas side implements cover/contain, tiling, and
    // percentage positioning in full.
    let background_image = style.paint.background_image.as_ref().and_then(|image| {
        let href = match crate::style::background_publication_href(image.url.as_str()) {
            Ok(href) => href.to_owned(),
            Err(error) => {
                degradations.push(format!("background-image dropped: {error:?}"));
                return None;
            }
        };
        let position_axis = |axis| match crate::style::background_position_axis_wire(axis) {
            Ok(value) => Some(value),
            Err(_) => None,
        };
        let (x, y) = (
            position_axis(image.position.x),
            position_axis(image.position.y),
        );
        if x.is_none() || y.is_none() {
            degradations.push("background-position calc() treated as 0".to_owned());
        }
        Some(serde_json::json!({
            "image": href,
            "size": crate::style::background_size_wire(image.size),
            "repeat": crate::style::background_repeat_wire(image.repeat),
            "position": {
                "x": x.unwrap_or(serde_json::json!({ "unit": "percent", "value": 0.0 })),
                "y": y.unwrap_or(serde_json::json!({ "unit": "percent", "value": 0.0 })),
            },
        }))
    });
    // Corner radii round the background, the border stroke, and the clip
    // the box paints inside. A uniform box rides the protocol's single
    // radius; corners that disagree ship as four circular radii in CSS
    // order (a chat bubble rounds one edge only: 0 20px 20px 0), taking
    // each corner's horizontal length. Elliptical or percentage corners
    // inside a non-uniform set flatten to that length and say so.
    let radii = style.fragment.border_radii;
    let corners = [
        radii.top_left,
        radii.top_right,
        radii.bottom_right,
        radii.bottom_left,
    ];
    let uniform = corners
        .iter()
        .all(|corner| *corner == radii.top_left && corner.horizontal == corner.vertical);
    let radius = if uniform {
        match radii.top_left.horizontal.value() {
            c::LengthPercentage::Length(px) if px.get() > 0.0 => {
                Some(serde_json::json!({ "px": f64::from(px.get()) }))
            }
            c::LengthPercentage::Percentage(ratio) if ratio.percent() > 0.0 => {
                Some(serde_json::json!({ "pct": f64::from(ratio.percent()) }))
            }
            c::LengthPercentage::Linear { length, .. } => {
                degradations
                    .push("calc() border-radius: percentage component dropped".to_owned());
                Some(serde_json::json!({ "px": f64::from(length.get()) }))
            }
            _ => None,
        }
    } else {
        let mut lossy = false;
        let px_corners: Vec<f64> = corners
            .iter()
            .map(|corner| {
                if corner.horizontal != corner.vertical {
                    lossy = true;
                }
                match corner.horizontal.value() {
                    c::LengthPercentage::Length(px) => f64::from(px.get()),
                    c::LengthPercentage::Percentage(_) => {
                        lossy = true;
                        0.0
                    }
                    c::LengthPercentage::Linear { length, .. } => {
                        lossy = true;
                        f64::from(length.get())
                    }
                }
            })
            .collect();
        if lossy {
            degradations.push(
                "border-radius: elliptical or percentage corner flattened to its length"
                    .to_owned(),
            );
        }
        (px_corners.iter().any(|px| *px > 0.0))
            .then(|| serde_json::json!({ "corners": px_corners }))
    };
    let transform = (!style.paint.transform.is_none()).then(|| {
        Value::Array(
            style
                .paint
                .transform
                .as_slice()
                .iter()
                .map(|operation| match operation {
                    c::TransformOperationV1::Rotate { radians } => serde_json::json!({
                        "kind": "rotate",
                        "rad": f64::from(radians.get()),
                    }),
                })
                .collect(),
        )
    });
    if background.is_none()
        && background_image.is_none()
        && border.is_empty()
        && transform.is_none()
        && box_shadows.is_empty()
    {
        return (None, degradations);
    }
    let mut paint = serde_json::Map::new();
    if background.is_some() || background_image.is_some() {
        let mut object = serde_json::Map::new();
        if let Some(color) = background {
            object.insert("color".to_owned(), Value::String(color));
        }
        if let Some(Value::Object(image)) = background_image {
            object.extend(image);
        }
        paint.insert("background".to_owned(), Value::Object(object));
    }
    if !border.is_empty() {
        paint.insert("border".to_owned(), Value::Object(border));
    }
    if let Some(radius) = radius {
        paint.insert("radius".to_owned(), radius);
    }
    if !box_shadows.is_empty() {
        paint.insert("boxShadow".to_owned(), Value::Array(box_shadows));
    }
    (
        Some((
            NodePaint::Box {
                paint: Value::Object(paint),
                border_box,
                transform,
                bevels,
                segment_horizontal_edges: false,
            },
            widths,
        )),
        degradations,
    )
}

/// Blink's inset/outset side shade: `Dark()` for the shadowed sides,
/// the base color for the lit sides unless it lacks 1.75:1 contrast
/// against its own dark shade (then `Light()`: channels scaled by
/// min(1, V + 0.33)/V, black lightening to #545454). Returns `None`
/// for colors the 6-digit-hex parser cannot read (they stay base).
fn inset_outset_shade(base: &str, darken: bool) -> Option<String> {
    let hex = base.strip_prefix('#')?;
    if hex.len() != 6 {
        return None;
    }
    let channel = |at: usize| u8::from_str_radix(&hex[at..at + 2], 16).ok();
    let channels = [channel(0)?, channel(2)?, channel(4)?];
    let value = f64::from(*channels.iter().max().expect("three channels")) / 255.0;
    let dark_scale = if value > 0.0 {
        ((value - 0.33) / value).max(0.0)
    } else {
        0.0
    };
    let dark = channels.map(|component| (f64::from(component) * dark_scale).round() as u8);
    let format = |[red, green, blue]: [u8; 3]| format!("#{red:02x}{green:02x}{blue:02x}");
    if darken {
        return Some(format(dark));
    }
    let linear = |component: u8| {
        let srgb = f64::from(component) / 255.0;
        if srgb <= 0.03928 {
            srgb / 12.92
        } else {
            ((srgb + 0.055) / 1.055).powf(2.4)
        }
    };
    let luminance = |parts: [u8; 3]| {
        0.2126 * linear(parts[0]) + 0.7152 * linear(parts[1]) + 0.0722 * linear(parts[2])
    };
    let (base_luminance, dark_luminance) = (luminance(channels), luminance(dark));
    let (high, low) = if base_luminance >= dark_luminance {
        (base_luminance, dark_luminance)
    } else {
        (dark_luminance, base_luminance)
    };
    if (high + 0.05) / (low + 0.05) >= 1.75 {
        return Some(format(channels));
    }
    if value == 0.0 {
        return Some("#545454".to_owned());
    }
    let light_scale = (value + 0.33).min(1.0) / value;
    Some(format(channels.map(|component| {
        (f64::from(component) * light_scale).round().min(255.0) as u8
    })))
}

/// Splits a ridge/groove edge into its two measured Blink tones: one half
/// keeps the border color, the other is Blink's `Color::Dark()` — every
/// channel scaled by `(V - 0.33) / V` where `V` is the largest channel
/// (steelblue `#4682b4` darkens to `#254560`, `#cc2200` to `#781400`,
/// both probed channel-exact). Ridge raises the box: top/left edges keep
/// the base tone outside and darken inside; bottom/right mirror. Groove
/// is ridge inverted. Returns `(outer, inner)` in border-box edge order,
/// or `None` for colors the split cannot parse (translucent borders
/// serialize as `rgba(...)` and degrade to solid instead).
fn two_tone_halves(
    base: &str,
    style: rito_style_contract::BorderStyle,
    edge_index: usize,
) -> Option<(String, String)> {
    use rito_style_contract::BorderStyle;
    let hex = base.strip_prefix('#')?;
    if hex.len() != 6 {
        return None;
    }
    let channel = |at: usize| u8::from_str_radix(&hex[at..at + 2], 16).ok();
    let channels = [channel(0)?, channel(2)?, channel(4)?];
    let value = f64::from(*channels.iter().max().expect("three channels")) / 255.0;
    let scale = if value > 0.0 {
        ((value - 0.33) / value).max(0.0)
    } else {
        0.0
    };
    let [red, green, blue] =
        channels.map(|component| (f64::from(component) * scale).round() as u8);
    let dark = format!("#{red:02x}{green:02x}{blue:02x}");
    let base = base.to_owned();
    // Edge indices: 0 top, 1 right, 2 bottom, 3 left.
    let raised_outside = matches!(edge_index, 0 | 3) == matches!(style, BorderStyle::Ridge);
    Some(if raised_outside {
        (base, dark)
    } else {
        (dark, base)
    })
}

/// Box decoration the fragment painter cannot reproduce outside a block
/// box (inline boxes and the chapter body). Block boxes paint shadows
/// through `block_box_paint`; backgrounds and borders are checked
/// separately, so they are not this function's concern.
fn box_decoration_violation(
    style: &rito_style_contract::InlineFormattingStyleV1,
) -> Option<String> {
    if !style.paint.box_shadows.is_empty() {
        return Some("box-shadow".to_owned());
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
    // Transforms paint as a block-box wrapper; an inline box carrying one
    // has no border-box the wrapper could rotate about.
    if !style.paint.transform.is_none() {
        return Some("inline transform".to_owned());
    }
    // Inline horizontal margins are modeled: they displace
    // the inline box like padding/border gaps — advance edits at the box
    // boundaries, a line indent for a span opening a forced-break line —
    // while staying outside the painted box; percentages resolve against
    // the containing block. Vertical margins have no effect on inline
    // boxes in CSS, so dropping them matches the browser.
    // Percentage padding has no inline expression; lengths are modeled.
    for (side, name) in [
        (&style.fragment.padding.top, "padding-top"),
        (&style.fragment.padding.right, "padding-right"),
        (&style.fragment.padding.bottom, "padding-bottom"),
        (&style.fragment.padding.left, "padding-left"),
    ] {
        if !matches!(
            side.value(),
            c::LengthPercentage::Length(_)
        ) && !length_percentage_is_zero(&side.value())
        {
            return Some(format!("inline percentage {name}"));
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
/// content above the baseline. `super`/`sub` shift by the PARENT's font
/// (CSS 2.1 §10.8.1: "the proper position for superscripts of the
/// parent's box"), measured per size against the pinned browser
/// (sup/sub marker probes, 2026-07-26, Chromium 147): super raises by
/// `floor64(parent_em / 3) + 1`, sub drops by `floor64(parent_em / 5)
/// + 1`, where floor64 is Blink's LayoutUnit (1/64 px) floor. The
/// offsets do not depend on the shifted box's own font size.
fn resolved_baseline_shift(
    style: &rito_style_contract::InlineFormattingStyleV1,
    parent_font_size_px: f64,
) -> f64 {
    let layout_unit_floor = |value: f64| (value * 64.0).floor() / 64.0;
    match style.fragment.baseline_shift {
        rito_style_contract::BaselineShift::Super => {
            layout_unit_floor(parent_font_size_px / 3.0) + 1.0
        }
        rito_style_contract::BaselineShift::Sub => {
            -(layout_unit_floor(parent_font_size_px / 5.0) + 1.0)
        }
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
    /// The style of a whitespace-only node awaiting content. `None` for a
    /// space produced by the previous text node itself (it belongs to
    /// that item); `Some` for an inter-element space, which must not
    /// extend a styled span's inline box.
    pending_space_style: Option<StyleId>,
    has_content: bool,
}

impl InlineCollector {
    /// Records a run of collapsible white space with no content of its own.
    fn push_collapsible_whitespace(&mut self, style: StyleId) {
        if self.has_content {
            self.pending_space = true;
            self.pending_space_style = Some(style);
        }
    }

    /// Appends one text node's content. A collapsed space belongs to the
    /// run that produced it (the CSS "first space of the sequence wins"
    /// rule), so a space pending from earlier nodes lands at the end of the
    /// previous item, while this node's own interior spaces stay here.
    #[allow(clippy::too_many_arguments)]
    fn push_text(
        &mut self,
        text: &str,
        style: StyleId,
        baseline_shift_px: f64,
        collapse: bool,
        ruby_annotation: Option<rito_fragment::RubyAnnotation>,
        source_index: Option<usize>,
        source_path: Option<Vec<usize>>,
    ) {
        let source = FlowItemSource {
            source_index,
            source_path,
            href: self.current_link.clone(),
            image_alt: None,
            segments: Vec::new(),
        };
        if !collapse {
            // `white-space: pre-wrap` — every space and segment break
            // lands verbatim (Blink keeps a calibre story's four-space
            // paragraph indents; the collapsing path erased them and
            // shifted every line of the chapter). A space pending from a
            // collapse-mode neighbour still materializes first.
            if text.is_empty() {
                return;
            }
            let utf16 = |value: &str| value.encode_utf16().count() as u32;
            let mut verbatim = String::with_capacity(text.len() + 1);
            if self.pending_space {
                verbatim.push(' ');
                self.pending_space = false;
                self.pending_space_style = None;
            }
            let lead = utf16(&verbatim);
            verbatim.push_str(text);
            let segments = vec![SourceSegment {
                item_start: lead,
                source_start: 0,
                len: utf16(text),
            }];
            self.has_content = true;
            self.append_text_item(
                verbatim,
                segments,
                source,
                style,
                baseline_shift_px,
                ruby_annotation,
            );
            return;
        }
        let is_space = |ch: char| matches!(ch, ' ' | '\t' | '\n' | '\r');
        let mut rest = text;
        // A collapsible space at the start of a line is removed (CSS Text
        // §4.1.3), and after a forced break the line start is knowable at
        // collection time: whether the space arrived as an inter-element
        // run (pending) or as this node's own leading white space, it
        // vanishes instead of shifting the line (measured: a chapter head
        // whose source indents the text after `<br/>` sat 0.25em right of
        // Blink's).
        if matches!(
            self.items.last(),
            Some(InlineItem::Text { text, .. }) if text.ends_with('\n')
        ) {
            self.pending_space = false;
            self.pending_space_style = None;
            rest = rest.trim_start_matches(is_space);
        }
        if self.pending_space {
            // The space belongs to an earlier node; this node's leading
            // white space folds into it and disappears. An inter-element
            // space whose style differs from the previous item's stands
            // alone: appending it would stretch that item's inline box
            // past the span's real end (measured: a boxed span's border
            // painted after the following space).
            // A space pending after a ruby base also stands alone: the
            // base item cannot absorb it (its annotation attaches to
            // exactly the base's extent), and silently dropping it erased
            // the base's own trailing collapsed space (b11: 原初之火
            // followed by ！ sat 0.25em left of the browser's line).
            let after_ruby = matches!(
                self.items.last(),
                Some(InlineItem::Text {
                    ruby_annotation: Some(_),
                    ..
                })
            );
            let standalone = after_ruby
                || match (self.pending_space_style, self.items.last()) {
                    (
                        Some(space_style),
                        Some(InlineItem::Text {
                            style: last_style, ..
                        }),
                    ) => *last_style != space_style,
                    (Some(_), _) => true,
                    (None, _) => false,
                };
            if standalone {
                let space_style = self.pending_space_style.or_else(|| match self.items.last() {
                    Some(InlineItem::Text { style, .. }) => Some(*style),
                    _ => None,
                });
                if let Some(space_style) = space_style {
                    self.items.push(InlineItem::Text {
                        text: " ".to_owned(),
                        style: space_style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    });
                    self.sources.push(FlowItemSource {
                        source_index: None,
                        source_path: None,
                        href: self.current_link.clone(),
                        image_alt: None,
                        segments: Vec::new(),
                    });
                }
            } else if let Some(InlineItem::Text {
                text: last,
                ruby_annotation: None,
                ..
            }) = self.items.last_mut()
            {
                last.push(' ');
            }
            self.pending_space = false;
            self.pending_space_style = None;
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
        // Track the piecewise-linear item→source mapping while copying:
        // every skipped or synthesized space closes the open stretch.
        let utf16 = |value: &str| value.encode_utf16().count() as u32;
        let mut segments: Vec<SourceSegment> = Vec::new();
        let mut source_position = utf16(text) - utf16(rest);
        let mut collapsed_units = utf16(&collapsed);
        let mut open: Option<(u32, u32)> = None;
        let close = |open: &mut Option<(u32, u32)>,
                     segments: &mut Vec<SourceSegment>,
                     collapsed_units: u32| {
            if let Some((item_start, source_start)) = open.take() {
                segments.push(SourceSegment {
                    item_start,
                    source_start,
                    len: collapsed_units - item_start,
                });
            }
        };
        let mut interior_space = false;
        let mut trailing_space = false;
        for ch in rest.chars() {
            let units = ch.len_utf16() as u32;
            if is_space(ch) {
                close(&mut open, &mut segments, collapsed_units);
                source_position += units;
                interior_space = true;
                trailing_space = true;
                continue;
            }
            if interior_space {
                collapsed.push(' ');
                collapsed_units += 1;
                interior_space = false;
            }
            if open.is_none() {
                open = Some((collapsed_units, source_position));
            }
            trailing_space = false;
            collapsed.push(ch);
            collapsed_units += units;
            source_position += units;
            self.has_content = true;
        }
        close(&mut open, &mut segments, collapsed_units);
        if !collapsed.is_empty() {
            self.append_text_item(
                collapsed,
                segments,
                source,
                style,
                baseline_shift_px,
                ruby_annotation,
            );
        }
        if trailing_space && self.has_content {
            // This node ends in white space; it lands here if any content
            // follows, and collapses away at the end of the flow.
            self.pending_space = true;
            self.pending_space_style = None;
        }
    }

    /// Appends one prepared text run, merging into the previous item when
    /// the style and shift are unchanged so a paragraph of plain text
    /// stays a single shaping run. A ruby base never merges with its
    /// neighbours: its annotation attaches to exactly this run's laid-out
    /// extent. Merge identity ignores the mapping segments: two pushes of
    /// the same source node extend one item, their segments concatenating
    /// shifted by the existing item length.
    fn append_text_item(
        &mut self,
        collapsed: String,
        segments: Vec<SourceSegment>,
        source: FlowItemSource,
        style: StyleId,
        baseline_shift_px: f64,
        ruby_annotation: Option<rito_fragment::RubyAnnotation>,
    ) {
        let utf16 = |value: &str| value.encode_utf16().count() as u32;
        let same_source = self.sources.last().is_some_and(|last| {
            last.source_index == source.source_index
                && last.source_path == source.source_path
                && last.href == source.href
                && last.image_alt == source.image_alt
        });
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
                let shift = utf16(last);
                last.push_str(&collapsed);
                if let Some(last_source) = self.sources.last_mut() {
                    last_source
                        .segments
                        .extend(segments.iter().map(|segment| SourceSegment {
                            item_start: segment.item_start + shift,
                            ..*segment
                        }));
                }
                return;
            }
        }
        let mut source = source;
        source.segments = segments;
        self.items.push(InlineItem::Text {
            text: collapsed,
            style,
            baseline_shift_px,
            ruby_annotation,
        });
        self.sources.push(source);
    }

    /// Appends a forced line break as a preserved newline in the flow text.
    ///
    /// The break keeps its own inherited style: a `<br>` is an inline
    /// element whose font participates in the envelope of the line it
    /// ends (measured on b39's id210: a 16px-span's leading <br> after a
    /// 12px line grows that line's box from 20.2031 to 21.2031 — folding
    /// the newline into the previous 12px item lost the pixel and shifted
    /// the whole rest of the page). Same-styled breaks still fold into
    /// the previous run so the common case stays one item.
    fn push_hard_break(&mut self, style: StyleId, baseline_shift_px: f64) {
        self.pending_space = false;
        if let Some(InlineItem::Text {
            text: last,
            ruby_annotation: None,
            style: last_style,
            ..
        }) = self.items.last_mut()
        {
            if *last_style == style {
                last.push('\n');
                self.has_content = true;
                return;
            }
        }
        {
            self.sources.push(FlowItemSource {
                source_index: None,
                source_path: None,
                href: self.current_link.clone(),
                image_alt: None,
                segments: Vec::new(),
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
    fn push_image(
        &mut self,
        item: InlineItem,
        source_index: usize,
        source_path: Vec<usize>,
        alt: &str,
    ) {
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
            source_path: Some(source_path),
            href: self.current_link.clone(),
            image_alt: (!alt.is_empty()).then(|| alt.to_owned()),
            segments: Vec::new(),
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

/// A contentless chapter tree, for sources the parser found no body in:
/// the chapter renders as one empty page instead of blocking the book.
/// Folds CSS parent-child margin collapse into the tree statically.
///
/// The block engine collapses adjacent sibling margins but treats every
/// container as a formatting-context root, so a paragraph's margin inside
/// an undecorated wrapper `<div>` would stack with the wrapper's own
/// margin where a browser collapses them through the boundary. Because
/// the bridge tree is fully resolved, the through-collapse is a static
/// property: an escaping child margin moves onto the parent (joined with
/// the CSS collapse rule) and the child keeps zero. Runs bottom-up so a
/// margin escapes any depth of plain wrappers, exactly like the cascade
/// of adjoining margins in CSS 2 §8.3.1.
///
/// A boundary stops the escape when CSS says it must: padding (borders
/// are already absorbed as padding by this bridge) on the meeting edge,
/// a non-`visible` overflow (a new formatting context), or — for the
/// bottom edge — a non-auto height or min-height.
fn fold_through_collapsing_margins(
    nodes: &mut [FormattingNode],
    root: FormattingNodeId,
    layout: &mut LayoutStyleTableV1,
) -> EpubResult<()> {
    fn resolved_px(value: LengthPercentageOrAuto) -> Option<f64> {
        match value {
            LengthPercentageOrAuto::Value(LengthPercentage::Length(px)) => {
                Some(f64::from(px.get()))
            }
            // A zero percentage is zero at any basis; treating it as
            // unresolvable made a `body { margin: 0% 1%; }` swallow its
            // first child's escaped margin — the child was zeroed before
            // the body's own margin failed to resolve, and the chapter
            // opened flush where the browser keeps the 1.5em gap.
            LengthPercentageOrAuto::Value(LengthPercentage::Percentage(pct))
                if pct.ratio() == 0.0 =>
            {
                Some(0.0)
            }
            LengthPercentageOrAuto::Auto => Some(0.0),
            _ => None,
        }
    }
    fn zero_padding(value: NonNegativeLengthPercentage) -> bool {
        matches!(value.value(), LengthPercentage::Length(px) if px.get() == 0.0)
            || matches!(value.value(), LengthPercentage::Percentage(pct) if pct.ratio() == 0.0)
    }
    /// CSS 2 §8.3.1 pairwise join: positives take the max, negatives the
    /// most negative, mixed signs sum.
    fn join(a: f64, b: f64) -> f64 {
        a.max(0.0).max(b.max(0.0)) + a.min(0.0).min(b.min(0.0))
    }
    fn set_margin(
        layout: &mut LayoutStyleTableV1,
        nodes: &mut [FormattingNode],
        node: FormattingNodeId,
        top: Option<f64>,
        bottom: Option<f64>,
    ) -> EpubResult<()> {
        let mut style = layout
            .style(nodes[node.0 as usize].style)
            .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?
            .clone();
        let as_length = |px: f64| -> EpubResult<LengthPercentageOrAuto> {
            Ok(LengthPercentageOrAuto::Value(LengthPercentage::Length(
                rito_style_contract::CssPx::new(px as f32)
                    .map_err(|error| EpubError::new(format!("folded margin is finite: {error}")))?,
            )))
        };
        if let Some(px) = top {
            style.margin.top = as_length(px)?;
        }
        if let Some(px) = bottom {
            style.margin.bottom = as_length(px)?;
        }
        nodes[node.0 as usize].style = layout
            .intern(style)
            .map_err(|error| EpubError::new(format!("folded style interns: {error}")))?;
        Ok(())
    }
    fn fold(
        nodes: &mut [FormattingNode],
        node: FormattingNodeId,
        layout: &mut LayoutStyleTableV1,
        is_root: bool,
    ) -> EpubResult<()> {
        let children = nodes[node.0 as usize].children.clone();
        for child in &children {
            if matches!(
                nodes[child.0 as usize].content,
                FormattingNodeContent::BlockContainer
            ) {
                fold(nodes, *child, layout, false)?;
            }
        }
        if children.is_empty() {
            return Ok(());
        }
        let style = layout
            .style(nodes[node.0 as usize].style)
            .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?
            .clone();
        if style.overflow != OverflowV1::Visible {
            return Ok(());
        }
        // A flow root seals its margins: a FLOAT (or explicit flow-root)
        // container establishes a new block formatting context, so its
        // first child's margin stays INSIDE the box instead of lifting
        // onto it (bridge-level replica: a float holding a 21px-margined
        // h1 must sit at flow position 0 with the heading 21px inside —
        // the unguarded fold parked the float itself at 21).
        if style.float != FloatV1::None
            || matches!(
                style.display.inside,
                rito_style_contract::LayoutDisplayInsideV1::FlowRoot
            )
        {
            return Ok(());
        }
        fn in_flow(
            nodes: &[FormattingNode],
            layout: &mut LayoutStyleTableV1,
            id: FormattingNodeId,
        ) -> bool {
            layout
                .style(nodes[id.0 as usize].style)
                .map(|child| child.float == FloatV1::None)
                .unwrap_or(false)
        }
        // At the ROOT container only: a float before the first in-flow
        // child anchors at the body top, above that child's top margin
        // (measured on b12's title: the glyph-stack floats sit at the
        // body top while the first in-flow block opens 1em lower — the
        // fold lifted the margin onto the body and every float moved
        // down with it). The margin stays on the child then. INNER
        // containers keep the fold even with leading floats: their
        // escaped margin acts before the container and the floats ride
        // with it (an unguarded skip moved b9's plate floats 22.7k).
        let float_leads = is_root
            && children
            .iter()
            .copied()
            .find(|id| {
                in_flow(nodes, layout, *id)
                    || layout
                        .style(nodes[id.0 as usize].style)
                        .map(|child| child.float != FloatV1::None)
                        .unwrap_or(false)
            })
            .is_some_and(|id| !in_flow(nodes, layout, id));
        if zero_padding(style.padding.top) && !float_leads {
            // The escaping set at the container top: the first in-flow
            // child's top margin — and, when that child is a
            // self-collapsing empty block (CSS 2 §8.3.1: no lines, no
            // children, auto heights, no padding), its bottom margin and
            // the NEXT sibling's top margin join the same set. Folding
            // only the top while the bottom stayed behind split the pair:
            // an empty `<h4>` with margins 30/25 read as 30 + 25 = 55
            // where the browser collapses the whole set to 30.
            fn is_self_collapsing_empty(
                nodes: &[FormattingNode],
                layout: &mut LayoutStyleTableV1,
                id: FormattingNodeId,
                zero_padding: &impl Fn(NonNegativeLengthPercentage) -> bool,
            ) -> bool {
                let node = &nodes[id.0 as usize];
                if !matches!(node.content, FormattingNodeContent::BlockContainer)
                    || !node.children.is_empty()
                {
                    return false;
                }
                layout
                    .style(node.style)
                    .map(|style| {
                        zero_padding(style.padding.top)
                            && zero_padding(style.padding.bottom)
                            && style.height == PreferredSizeV1::Auto
                            && style.min_height == MinimumHeightV1::Auto
                    })
                    .unwrap_or(false)
            }
            let mut accumulated: Option<f64> = None;
            // The container's own margin must be resolvable before any
            // child margin is zeroed: an unresolvable own margin used to
            // abort AFTER the children were stripped, dropping their
            // margins on the floor instead of leaving them in place.
            let own = resolved_px(style.margin.top);
            let in_flow_children: Vec<FormattingNodeId> = if own.is_some() {
                children
                    .iter()
                    .copied()
                    .filter(|id| in_flow(nodes, layout, *id))
                    .collect()
            } else {
                Vec::new()
            };
            for child in in_flow_children {
                let child_style = layout
                    .style(nodes[child.0 as usize].style)
                    .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?;
                let child_clear = child_style.clear;
                let child_margin_top = child_style.margin.top;
                // A clearing spacer with float siblings before it takes
                // clearance at layout time; the margins at and after it
                // then resolve against the cleared line (follower top =
                // float margin-box bottom + max(0, join(spacer bottom,
                // follower top) - spacer top), 32-case browser matrix),
                // so the fold must leave them in place for the layout
                // pass instead of hoisting them onto the container.
                if child_clear != ClearV1::None
                    && is_self_collapsing_empty(nodes, layout, child, &zero_padding)
                    && children
                        .iter()
                        .copied()
                        .take_while(|id| *id != child)
                        .any(|id| {
                            layout
                                .style(nodes[id.0 as usize].style)
                                .map(|sibling| sibling.float != FloatV1::None)
                                .unwrap_or(false)
                        })
                {
                    break;
                }
                let Some(top) = resolved_px(child_margin_top) else {
                    break;
                };
                let empty = is_self_collapsing_empty(nodes, layout, child, &zero_padding);
                let bottom = if empty {
                    resolved_px(
                        layout
                            .style(nodes[child.0 as usize].style)
                            .map_err(|error| {
                                EpubError::new(format!("fold style resolves: {error}"))
                            })?
                            .margin
                            .bottom,
                    )
                } else {
                    None
                };
                accumulated = Some(join(accumulated.unwrap_or(0.0), top));
                set_margin(layout, nodes, child, Some(0.0), None)?;
                if !empty {
                    break;
                }
                let Some(bottom) = bottom else {
                    break;
                };
                accumulated = Some(join(accumulated.unwrap_or(0.0), bottom));
                set_margin(layout, nodes, child, None, Some(0.0))?;
            }
            if let (Some(escape), Some(own)) = (accumulated, own) {
                if escape != 0.0 {
                    set_margin(layout, nodes, node, Some(join(own, escape)), None)?;
                }
            }
        }
        let bottom_open = !is_root
            && zero_padding(style.padding.bottom)
            && style.height == PreferredSizeV1::Auto
            && style.min_height == MinimumHeightV1::Auto;
        if bottom_open {
            let last = children
                .iter()
                .rev()
                .copied()
                .find(|id| in_flow(nodes, layout, *id));
            // A float AFTER the last in-flow child anchors at its
            // hypothetical flow position, which lies BELOW that child's
            // bottom margin (measured: a title page's hoisted author
            // block — content, a clearing spacer, then a float with a
            // large negative margin-top — sat one spacer margin high
            // when the fold hid the margin from the float's anchor).
            // The margin stays on the child then; the block engine's
            // pending-margin chain carries it to the float.
            let floats_after = last.is_some_and(|last| {
                children
                    .iter()
                    .copied()
                    .skip_while(|id| *id != last)
                    .skip(1)
                    .any(|id| !in_flow(nodes, layout, id))
            });
            if let (Some(last), false) = (last, floats_after) {
                let last_style = layout
                    .style(nodes[last.0 as usize].style)
                    .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?;
                let escape = resolved_px(last_style.margin.bottom);
                let own = layout
                    .style(nodes[node.0 as usize].style)
                    .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?
                    .margin
                    .bottom;
                let own = resolved_px(own);
                if let (Some(escape), Some(own)) = (escape, own) {
                    if escape != 0.0 {
                        set_margin(layout, nodes, last, None, Some(0.0))?;
                        set_margin(layout, nodes, node, None, Some(join(own, escape)))?;
                    }
                }
            }
        }
        if is_root {
            root_margins_to_padding(nodes, node, layout)?;
        }
        Ok(())
    }
    /// The chapter body's margins — its own plus what collapsed into it —
    /// become body padding: the browser offsets the whole flow by them
    /// (horizontally too), and padding carries identical geometry through
    /// this engine, applying on the first page only exactly like a margin
    /// at an unforced fragmentainer start.
    fn root_margins_to_padding(
        nodes: &mut [FormattingNode],
        root: FormattingNodeId,
        layout: &mut LayoutStyleTableV1,
    ) -> EpubResult<()> {
        let mut style = layout
            .style(nodes[root.0 as usize].style)
            .map_err(|error| EpubError::new(format!("fold style resolves: {error}")))?
            .clone();
        let mut changed = false;
        let zero = || {
            LengthPercentageOrAuto::Value(LengthPercentage::Length(
                rito_style_contract::CssPx::new(0.0).expect("zero is finite"),
            ))
        };
        // Margin and padding percentages share the inline-size basis in
        // CSS, so a percentage margin folds into a percentage padding
        // unchanged. Mixed length + percentage cannot sum statically and
        // stays unfolded.
        let mut absorb = |margin: &mut LengthPercentageOrAuto,
                          padding: &mut NonNegativeLengthPercentage|
         -> EpubResult<()> {
            let folded = match (*margin, padding.value()) {
                (LengthPercentageOrAuto::Auto, _) => None,
                (
                    LengthPercentageOrAuto::Value(LengthPercentage::Length(margin_px)),
                    LengthPercentage::Length(existing),
                ) => {
                    let px = f64::from(margin_px.get());
                    if px <= 0.0 {
                        None
                    } else {
                        Some(LengthPercentage::Length(
                            rito_style_contract::CssPx::new(
                                (f64::from(existing.get()) + px) as f32,
                            )
                            .map_err(|error| {
                                EpubError::new(format!("padding is finite: {error}"))
                            })?,
                        ))
                    }
                }
                // A zero-percentage padding (`padding: 0% 0`) is exactly
                // zero regardless of basis, so a length margin folds into
                // it as a plain length — dropping into the fallthrough
                // instead silently vanished a chapter's 22px heading
                // margin and shifted every page of the book.
                (
                    LengthPercentageOrAuto::Value(LengthPercentage::Length(margin_px)),
                    LengthPercentage::Percentage(existing),
                ) if existing.ratio() == 0.0 && margin_px.get() > 0.0 => {
                    Some(LengthPercentage::Length(margin_px))
                }
                (
                    LengthPercentageOrAuto::Value(LengthPercentage::Percentage(pct)),
                    existing_padding,
                ) if pct.ratio() > 0.0 => {
                    let existing_ratio = match existing_padding {
                        LengthPercentage::Length(existing) if existing.get() == 0.0 => 0.0,
                        LengthPercentage::Percentage(existing) => f64::from(existing.ratio()),
                        _ => return Ok(()),
                    };
                    Some(LengthPercentage::Percentage(
                        rito_style_contract::Percentage::from_ratio(
                            (existing_ratio + f64::from(pct.ratio())) as f32,
                        )
                        .map_err(|error| {
                            EpubError::new(format!("padding ratio is finite: {error}"))
                        })?,
                    ))
                }
                _ => None,
            };
            if let Some(next) = folded {
                *padding = NonNegativeLengthPercentage::new(next);
                changed = true;
            }
            // Only a margin the padding actually absorbed may be
            // cleared; an unfoldable one (mixed length + percentage)
            // stays a real margin for layout to apply at the flow start.
            let absorbed = folded.is_some()
                || matches!(*margin, LengthPercentageOrAuto::Value(LengthPercentage::Length(px)) if px.get() <= 0.0)
                || matches!(*margin, LengthPercentageOrAuto::Auto);
            if absorbed
                && !matches!(*margin, LengthPercentageOrAuto::Value(LengthPercentage::Length(px)) if px.get() == 0.0)
            {
                *margin = zero();
                changed = true;
            }
            Ok(())
        };
        let mut margin = style.margin;
        let mut padding = style.padding;
        absorb(&mut margin.top, &mut padding.top)?;
        absorb(&mut margin.bottom, &mut padding.bottom)?;
        absorb(&mut margin.left, &mut padding.left)?;
        absorb(&mut margin.right, &mut padding.right)?;
        if changed {
            style.margin = margin;
            style.padding = padding;
            nodes[root.0 as usize].style = layout
                .intern(style)
                .map_err(|error| EpubError::new(format!("folded style interns: {error}")))?;
        }
        Ok(())
    }
    fold(nodes, root, layout, true)
}

pub fn empty_chapter_formatting_tree() -> EpubResult<ChapterFormattingTree> {
    let mut layout = LayoutStyleTableV1::new(1);
    let style = layout
        .intern(anonymous_block_style())
        .map_err(|error| EpubError::new(format!("anonymous block style interns: {error}")))?;
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style,
            content: FormattingNodeContent::BlockContainer,
            children: Vec::new(),
        }],
        FormattingNodeId(0),
        FormattingTreeStyles {
            layout,
            inline: InlineStyleTableV1::new(1),
        },
    )
    .map_err(EpubError::new)?;
    Ok(ChapterFormattingTree {
        tree,
        source_nodes: vec![None],
        node_paints: BTreeMap::new(),
        image_border_paints: BTreeMap::new(),
        page_background: None,
        page_background_image: None,
        flow_item_sources: BTreeMap::new(),
        node_anchors: BTreeMap::new(),
        node_links: BTreeMap::new(),
        source_anchors: BTreeMap::new(),
        node_tags: BTreeMap::new(),
        degradations: vec!["chapter has no body source node; rendered empty".to_owned()],
    })
}

/// The inline style a node degrades to when the projection retained no
/// entry for it: an undecorated 16px generic-serif paragraph. Inherited
/// context is lost, but the text renders.
fn fallback_inline_formatting_style() -> rito_style_contract::InlineFormattingStyleV1 {
    let mut style = rito_inline::plain_paragraph_style(
        rito_style_contract::FontFamilies::new(vec![rito_style_contract::FontFamily::Generic(
            rito_style_contract::GenericFontFamily::Serif,
        )])
        .expect("one generic family is a valid stack"),
        16.0,
        0.0,
    );
    // The harness helper paints an opaque black background; a fallback
    // node must inherit the page instead of washing it out.
    style.paint.background = rito_style_contract::AbsoluteColor::new(
        rito_style_contract::AbsoluteColorSpace::Srgb,
        [0.0, 0.0, 0.0],
        0.0,
        rito_style_contract::ColorNoneFlags::new(false, false, false, false),
    )
    .expect("transparent is finite")
    .into();
    style
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
        vertical_align: rito_style_contract::CellVerticalAlignV1::Baseline,
        border_spacing: (
            rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
            rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
        ),
        border_collapse: false,
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
                } => (
                    text.as_str(),
                    ruby_annotation.as_ref().map(|a| a.text.as_str()),
                ),
                InlineItem::Image { .. } | InlineItem::InlineBlock { .. } => {
                    panic!("no atomic items here")
                }
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
        assert_eq!(
            ruby_annotation.as_ref().map(|a| a.text.as_str()),
            Some("とうきょう")
        );
    }

    #[test]
    fn collapsible_space_after_a_forced_break_is_removed_at_the_line_start() {
        // CSS Text §4.1.3: collapsible spaces at the start of a line are
        // removed. Source indentation after `<br/>` is exactly that.
        let chapter = resolved_chapter_from(
            "<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>t</title></head><body>\n  <p>lead<br />\n    <span>tail</span></p>\n</body></html>",
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
            panic!("paragraph is an inline flow");
        };
        let flow: String = items
            .iter()
            .map(|item| match item {
                InlineItem::Text { text, .. } => text.as_str(),
                InlineItem::Image { .. } | InlineItem::InlineBlock { .. } => {
                    panic!("no atomic items here")
                }
            })
            .collect();
        assert_eq!(flow, "lead\ntail", "no space survives the forced break");
    }

    #[test]
    fn pre_wrap_keeps_spaces_and_segment_breaks_verbatim() {
        // white-space: pre-wrap — Blink keeps a calibre story's
        // four-space paragraph indents and its interior space runs; a
        // preserved newline is a forced break like <br/>.
        let chapter = resolved_chapter_with(
            "<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>t</title></head><body><p class=\"pre\">    lead  in\nnext</p></body></html>",
            "p.pre { white-space: pre-wrap; }",
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
            panic!("paragraph is an inline flow");
        };
        let flow: String = items
            .iter()
            .map(|item| match item {
                InlineItem::Text { text, .. } => text.as_str(),
                InlineItem::Image { .. } | InlineItem::InlineBlock { .. } => {
                    panic!("no atomic items here")
                }
            })
            .collect();
        assert_eq!(
            flow, "    lead  in\nnext",
            "spaces and the segment break survive verbatim"
        );
        assert!(
            built.degradations.is_empty(),
            "pre-wrap is implemented, not degraded: {:?}",
            built.degradations
        );
    }

    #[test]
    fn list_items_degrade_to_plain_blocks_pending_marker_layout() {
        let chapter = resolved_chapter_from(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <ol><li>first entry</li></ol>
</body></html>"#,
        );
        let built = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect("list items lay out as plain blocks");
        assert!(
            built
                .degradations
                .iter()
                .any(|reason| reason.contains("plain block flow")),
            "the flattened list is recorded: {:?}",
            built.degradations
        );
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
                } => (
                    text.as_str(),
                    ruby_annotation.as_ref().map(|a| a.text.as_str()),
                ),
                InlineItem::Image { .. } | InlineItem::InlineBlock { .. } => {
                    panic!("no atomic items here")
                }
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
                thickness: 2.0,
            }),
        );
        // A bare <hr> keeps the UA `border: 1px inset` pair: a two-pixel
        // flow box whose stroke is the fixed bevel (the color rides along
        // but the inset paint ignores it).
        let plain = built.tree.node(root.children[1]);
        assert!(matches!(
            plain.content,
            FormattingNodeContent::SizedLeaf {
                block_size,
                breakable: false,
            } if block_size == 2.0
        ));
        assert_eq!(
            built.node_paints.get(&root.children[1].0),
            Some(&NodePaint::Rule {
                color: "#223344".to_owned(),
                style: "inset",
                thickness: 1.0,
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
        let Some(NodePaint::Box {
            paint, border_box, ..
        }) = built.node_paints.get(&card_id.0) else {
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
    fn a_collapsed_table_marks_its_horizontal_edges_for_segmentation() {
        let chapter = resolved_chapter_with(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <table class="bc"><tr><td>A</td><td>B</td></tr></table>
  <table class="sep"><tr><td>A</td><td>B</td></tr></table>
</body></html>"#,
            ".bc { border-collapse: collapse; border-bottom: dotted 3px #ED0286; }\n.sep { border-bottom: dotted 3px #ED0286; }\n",
        );
        let built = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect("tables build");
        let root = built.tree.node(built.tree.root());
        let mut flags = Vec::new();
        for child in &root.children {
            if let Some(NodePaint::Box {
                segment_horizontal_edges,
                ..
            }) = built.node_paints.get(&child.0)
            {
                flags.push(*segment_horizontal_edges);
            }
        }
        assert_eq!(
            flags,
            vec![true, false],
            "only the collapsed table segments its horizontal edges"
        );
    }

    #[test]
    fn double_border_style_reaches_the_painter() {
        // Two 1px lines with a 1px gap at `medium` — the painter renders
        // the pair itself, so the bridge must pass the style through
        // (mapped to solid, b51's message frame filled the gap row).
        let chapter = resolved_chapter_with(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <div class="frame"><p>text</p></div>
</body></html>"#,
            ".frame { border: 3px double #000000; }\n",
        );
        let built = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect("double borders build");
        let root = built.tree.node(built.tree.root());
        let Some(NodePaint::Box { paint, .. }) = built.node_paints.get(&root.children[0].0) else {
            panic!("the frame still paints its border");
        };
        assert_eq!(paint["border"]["top"]["style"], "double");
        assert!(
            !built
                .degradations
                .iter()
                .any(|reason| reason.contains("drawn solid")),
            "no approximation recorded: {:?}",
            built.degradations
        );
    }

    #[test]
    fn ridge_borders_split_into_measured_two_tone_halves() {
        let chapter = resolved_chapter_with(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <div class="frame"><p>text</p></div>
</body></html>"#,
            ".frame { border-top: 6px ridge #4682b4; border-right: 6px groove #4682b4; }\n",
        );
        let built = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect("ridge borders build");
        let root = built.tree.node(built.tree.root());
        let Some(NodePaint::Box { paint, bevels, .. }) =
            built.node_paints.get(&root.children[0].0)
        else {
            panic!("the frame paints its border");
        };
        // Ridge top: outer keeps steelblue, inner darkens (V - 0.33
        // scaling, probed #254560). Groove right inverts: outer stays
        // base, the dark half hugs the content.
        assert_eq!(paint["border"]["top"]["style"], "solid");
        assert_eq!(paint["border"]["top"]["color"], "#4682b4");
        assert_eq!(paint["border"]["right"]["color"], "#4682b4");
        assert_eq!(bevels.as_slice(), &[
            (0, "#254560".to_owned()),
            (1, "#254560".to_owned()),
        ]);
        assert!(
            !built
                .degradations
                .iter()
                .any(|reason| reason.contains("drawn solid")),
            "two-tone edges are exact, not degraded: {:?}",
            built.degradations
        );
    }

    #[test]
    fn malformed_ruby_structures_degrade_to_plain_text() {
        let stray_rt = resolved_chapter_from(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <p>text<rt>leak</rt></p>
</body></html>"#,
        );
        let built = build_chapter_formatting_tree(
            &stray_rt.nodes,
            stray_rt.body_index,
            &stray_rt.layout,
            &stray_rt.inline,
            &no_images(),
        )
        .expect("a stray <rt> renders as plain text");
        assert!(
            built
                .degradations
                .iter()
                .any(|reason| reason.contains("outside <ruby>")),
            "the malformed markup is recorded: {:?}",
            built.degradations
        );
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
                InlineItem::Image { .. } | InlineItem::InlineBlock { .. } => {
                    panic!("no atomic items in this paragraph")
                }
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

    fn source_han_test_bytes() -> Vec<u8> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf"
        );
        std::fs::read(path).expect("pinned SourceHan test font reads")
    }

    fn tinos_bytes() -> Vec<u8> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"
        );
        std::fs::read(path).expect("pinned Tinos test font reads")
    }

    #[test]
    fn a_block_level_link_scopes_its_href_over_the_card_subtree() {
        // The TOC-card idiom: <a href><div>card text</div></a> — the <a>
        // is block-level (it contains a block), and its destination must
        // reach every inline item inside the card, exactly as an inline
        // <a> scopes its runs.
        let chapter = resolved_chapter_from(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <a href="Section001.xhtml"><div>card one</div></a>
  <p>plain</p>
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
        let linked = built
            .flow_item_sources
            .values()
            .flatten()
            .filter(|source| source.href.as_deref() == Some("Section001.xhtml"))
            .count();
        assert!(
            linked > 0,
            "card text inside a block-level <a> carries its href"
        );
        let unlinked = built
            .flow_item_sources
            .values()
            .flatten()
            .any(|source| source.href.is_none());
        assert!(unlinked, "the plain paragraph stays link-free");
    }

    /// Blink keeps a following sibling's margin BELOW a cleared empty
    /// spacer (measured five-case oracle: follower top = the float's
    /// margin-box bottom + the follower's collapsed margin, whether the
    /// margin is its own or escaped from a child). The static fold must
    /// not hoist that margin through the spacer onto the container.
    #[test]
    fn margins_after_a_cleared_spacer_stay_below_the_clear_line() {
        for (name, follow, expected) in [
            (
                "own margin",
                r#"<div style="margin-top: 16px"><p>x</p></div>"#,
                146.0,
            ),
            (
                "child-escaped margin",
                r#"<div><p style="margin-top: 3.2px">x</p></div>"#,
                133.2,
            ),
        ] {
            let chapter = resolved_chapter_with(
                &format!(
                    r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <div class="box">
    <div class="fl"></div>
    <div class="cb"></div>
    {follow}
  </div>
</body></html>"#
                ),
                "body { margin: 0; } p { margin: 0; } .box { width: 320px; }                  .fl { float: left; width: 120px; height: 50px; margin: 40px 0; }                  .cb { clear: both; }
",
            );
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
            let outcome = engine
                .layout(
                    &built.tree,
                    built.tree.root(),
                    &ConstraintSpace::continuous(640.0),
                    None,
                    &cancel,
                )
                .expect("lays out");
            let Fragment::Box(root) = &outcome.fragments.root else {
                panic!("root box");
            };
            fn find_line_y(fragment: &Fragment, offset: f64) -> Option<f64> {
                match fragment {
                    Fragment::Box(node) => node
                        .children
                        .iter()
                        .find_map(|child| find_line_y(child, offset + node.rect.y)),
                    Fragment::Line(line) => Some(offset + line.rect.y),
                    _ => None,
                }
            }
            let line_y = find_line_y(&outcome.fragments.root, -root.rect.y)
                .expect("the follower's line laid out");
            assert!(
                (line_y - expected).abs() < 0.1,
                "{name}: the follower's line starts below the cleared float: {line_y} vs {expected}"
            );
        }
    }

    /// illu3-t replica with the book's blanket margin rule: the spacer's
    /// own margins cancel the follower's smaller one (follower top =
    /// float margin-box bottom + max(0, join(spacer bottom, follower
    /// top) - spacer top)), and none of that chain moves the container.
    #[test]
    fn cleared_spacer_margins_credit_the_follower_and_spare_the_container() {
        let chapter = resolved_chapter_with(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<div class="illu">
  <div class="illu-box">
    <div class="HT font08 box-left" style="margin: 4em 0em"><div class="inner"><p class="c" style="margin-bottom: 0.5em">[a]</p><p class="z">text</p></div></div>
    <div class="HT font08 box-right" style="margin: 4em 0em"><div class="inner"><p class="c" style="margin-bottom: 0.5em">[b]</p><p class="z">text</p></div></div>
    <div class="cboth"></div>
    <div class="font08 tail"><p>one</p><p>two</p></div>
  </div>
</div>
</body></html>"#,
            "body { margin: 0; padding: 0; }              .illu p, .illu div { margin: 0.2em 0em; text-indent: 0; line-height: 1.2em; }              .illu .illu-box { width: 320px; max-width: 100%; margin: 0.8em auto; }              .illu .illu-box .box-left { width: 49%; float: left; }              .illu .illu-box .box-right { width: 49%; float: right; }              .inner { width: 95%; margin: 0 auto; }              .font08 { font-size: 0.8em; }              .cboth { clear: both; }
",
        );
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
        let outcome = engine
            .layout(
                &built.tree,
                built.tree.root(),
                &ConstraintSpace::continuous(640.0),
                None,
                &cancel,
            )
            .expect("lays out");
        fn walk_blocks(fragment: &Fragment, offset: f64, out: &mut Vec<(u32, f64, f64)>) {
            if let Fragment::Box(node) = fragment {
                out.push((node.source.0, offset + node.rect.y, node.rect.height));
                for child in &node.children {
                    walk_blocks(child, offset + node.rect.y, out);
                }
            }
        }
        let mut blocks = Vec::new();
        walk_blocks(&outcome.fragments.root, 0.0, &mut blocks);
        let y_of = |source: u32| {
            blocks
                .iter()
                .find(|(s, ..)| *s == source)
                .map(|(_, y, _)| *y)
                .expect("block laid out")
        };
        assert!((y_of(12) - 12.8).abs() < 0.1, "container: {}", y_of(12));
        assert!((y_of(3) - 63.98).abs() < 0.1, "float: {}", y_of(3));
        assert!((y_of(8) - 157.38).abs() < 0.1, "spacer: {}", y_of(8));
        assert!((y_of(11) - 157.38).abs() < 0.1, "follower: {}", y_of(11));
    }

    /// b51 title replica: the badge's own margin must survive the fold
    /// (it collapses into the container's EQUAL margin statically, then
    /// the cleared line swallows it — the browser keeps it below).
    #[test]
    fn cleared_spacer_keeps_the_badge_margin_below_the_float() {
        let chapter = resolved_chapter_with(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<div class="title">
  <div class="fr tall"></div>
  <div class="cboth"></div>
  <div class="ftitle"><p>m</p></div>
</div>
</body></html>"#,
            "body { padding: 0%; margin-top: 0%; margin-bottom: 0%; margin-left: 1%; margin-right: 1%; }              p { margin: 0; }              .title { width: 272px; margin: 0 auto; margin-top: 16px; }              .fr { float: right; }              .tall { width: 200px; height: 191.42px; }              .cboth { clear: both; }              .ftitle { width: 67.2px; height: 67.2px; overflow: hidden; margin: 16px auto; }
",
        );
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
        let outcome = engine
            .layout(
                &built.tree,
                built.tree.root(),
                &ConstraintSpace::continuous(640.0),
                None,
                &cancel,
            )
            .expect("lays out");
        fn walk_blocks(fragment: &Fragment, offset: f64, out: &mut Vec<(u32, f64, f64)>) {
            if let Fragment::Box(node) = fragment {
                out.push((node.source.0, offset + node.rect.y, node.rect.height));
                for child in &node.children {
                    walk_blocks(child, offset + node.rect.y, out);
                }
            }
        }
        let mut blocks = Vec::new();
        walk_blocks(&outcome.fragments.root, 0.0, &mut blocks);
        let y_of = |source: u32| {
            blocks
                .iter()
                .find(|(s, ..)| *s == source)
                .map(|(_, y, _)| *y)
                .expect("block laid out")
        };
        assert!((y_of(0) - 16.0).abs() < 0.1, "float: {}", y_of(0));
        assert!((y_of(1) - 207.42).abs() < 0.1, "spacer: {}", y_of(1));
        assert!((y_of(3) - 223.42).abs() < 0.1, "badge: {}", y_of(3));
    }

    /// The 1/64 line-fit tolerance must not leak into alignment: a
    /// right-aligned line starts at exactly the container width minus
    /// its advance, unquantized (the browser's Range keeps the
    /// fractional start).
    #[test]
    fn right_aligned_line_starts_at_width_minus_advance() {
        let chapter = resolved_chapter_with(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<p>『和你恋爱什么，应该是不可能的』完</p>
</body></html>"#,
            "body { margin: 0; padding: 0; }              p { margin: 0; text-align: right; font-weight: bold; font-size: 16px; }
",
        );
        let built = build_chapter_formatting_tree(
            &chapter.nodes,
            chapter.body_index,
            &chapter.layout,
            &chapter.inline,
            &no_images(),
        )
        .expect("tree builds");
        let engine = BlockFormattingContext::new(
            ParleyInlineContext::new(vec![tinos_bytes(), source_han_test_bytes()]).expect("fonts register"),
        );
        let cancel = CancelFlag::new();
        let outcome = engine
            .layout(
                &built.tree,
                built.tree.root(),
                &ConstraintSpace::continuous(627.21875),
                None,
                &cancel,
            )
            .expect("lays out");
        fn walk_lines(fragment: &Fragment, off: f64, out: &mut Vec<(f64, f64)>) {
            match fragment {
                Fragment::Box(node) => {
                    for child in &node.children {
                        walk_lines(child, off + node.rect.x, out);
                    }
                }
                Fragment::Line(line) => {
                    out.push((off + line.rect.x, line.rect.width));
                }
                _ => {}
            }
        }
        let mut lines = Vec::new();
        walk_lines(&outcome.fragments.root, 0.0, &mut lines);
        let (line_x, _) = lines[0];
        assert!(
            (line_x - (627.21875 - 272.0)).abs() < 1e-6,
            "right-aligned start is exact: {line_x}"
        );
    }

    /// #85 full replica with PERCENTAGE margins (the b60 title exactly:
    /// % margins are unfoldable, so the flow-root fold guard is not in
    /// play — this observes where the +13.4 line drift enters the
    /// bridge+layout pipeline).
    #[test]
    fn observe_percent_margin_float_lines() {
        let chapter = resolved_chapter_with(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <div class="t1">
    <h1>X</h1>
  </div>

  <div class="t2">
    <h2>2</h2>
  </div>
</body></html>"#,
            "body { margin-left: 1%; margin-right: 1%; line-height: 130%; } .t1 { float: right; margin-top: 4%; margin-left: 10%; width: 48px; } .t2 { float: right; margin-top: 28%; margin-left: 10%; width: 48px; } h1 { font-size: 32px; line-height: 100%; } h2 { font-size: 30.4px; }",
        );
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
        let outcome = engine
            .layout(
                &built.tree,
                built.tree.root(),
                &ConstraintSpace::continuous(640.0),
                None,
                &cancel,
            )
            .expect("lays out");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root box");
        };
        let float_boxes: Vec<(f64, f64)> = root
            .children
            .iter()
            .filter_map(|child| match child {
                Fragment::Box(float_box) => {
                    let inner = float_box.children.iter().find_map(|inner| match inner {
                        Fragment::Box(heading) => Some(heading.rect.y),
                        _ => None,
                    });
                    Some((float_box.rect.y, inner.unwrap_or(f64::NAN)))
                }
                _ => None,
            })
            .collect();
        assert_eq!(float_boxes.len(), 2, "two floats");
        // The float sits at its own %-margin (basis = the containing
        // block, 4% / 28% of 627.2) and the heading's UA margin applies
        // ONCE inside — the previous inner layout re-resolved the float's
        // %-margin against the float's own 48px width and stacked it onto
        // the heading (h1 +1.9, h2 +13.4; truth line tops 46.518/200.841).
        assert!((float_boxes[0].0 - 25.0781).abs() < 0.02, "t1 y {}", float_boxes[0].0);
        assert!((float_boxes[0].1 - 21.4375).abs() < 0.02, "h1 inner y {}", float_boxes[0].1);
        assert!((float_boxes[1].0 - 175.6094).abs() < 0.02, "t2 y {}", float_boxes[1].0);
        assert!((float_boxes[1].1 - 25.2188).abs() < 0.05, "h2 inner y {}", float_boxes[1].1);
    }

    /// #85 phantom-fy probe at BRIDGE level: the b60 title skeleton
    /// (two right floats with whitespace text between the divs, each
    /// holding a margined heading). CSS: the second float's border top =
    /// its own margin-top (flow position 0). The runtime probe measured
    /// the real page drifting +13.4 here — this test decides whether the
    /// phantom lives in the bridge+layout pipeline or upstream.
    #[test]
    fn observe_title_float_ys() {
        let chapter = resolved_chapter_with(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <div class="t1">
    <h1>X</h1>
  </div>

  <div class="t2">
    <h2>2</h2>
  </div>
</body></html>"#,
            ".t1 { float: right; width: 48px; } .t2 { float: right; margin-top: 100px; width: 48px; } h1 { margin: 21px 0; font-size: 32px; } h2 { margin: 25px 0; font-size: 30px; }",
        );
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
        let outcome = engine
            .layout(
                &built.tree,
                built.tree.root(),
                &ConstraintSpace::continuous(600.0),
                None,
                &cancel,
            )
            .expect("lays out");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root box");
        };
        let mut float_ys: Vec<f64> = Vec::new();
        for child in &root.children {
            if let Fragment::Box(inner) = child {
                eprintln!("[t85] box source={} y={:.4} h={:.4}", inner.source.0, inner.rect.y, inner.rect.height);
                float_ys.push(inner.rect.y);
            }
            if let Fragment::Line(line) = child {
                eprintln!("[t85] stray line y={:.4}", line.rect.y);
            }
        }
        assert!(float_ys.len() >= 2, "two float boxes present");
        assert!(
            float_ys[0].abs() < 1e-6,
            "first float at flow 0, got {}",
            float_ys[0]
        );
        assert!(
            (float_ys[1] - 100.0).abs() < 1e-6,
            "second float at its own margin-top 100, got {}",
            float_ys[1]
        );
    }

    /// Observation (a real book's title page): a text-carrying div
    /// with a fixed `height` must flow at padding + height (Blink: the
    /// `.book-rank` pill is 24 + 30 = 54 tall, its line overflowing
    /// visibly), not at its natural line height. The pixel walk measured
    /// the three blocks below the rank sitting 9.2px high — exactly
    /// 30 − 20.8 (the fixed height replaced by one 130% line).
    #[test]
    fn observe_fixed_height_text_div_flow() {
        let chapter = resolved_chapter_with(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <div class="a">x</div>
  <div class="rank">I</div>
  <div class="b">y</div>
</body></html>"#,
            "body { line-height: 130%; } .rank { height: 30px; padding-top: 24px; font-size: 24px; }",
        );
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
        let outcome = engine
            .layout(
                &built.tree,
                built.tree.root(),
                &ConstraintSpace::continuous(600.0),
                None,
                &cancel,
            )
            .expect("lays out");
        let Fragment::Box(root) = &outcome.fragments.root else {
            panic!("root box");
        };
        let mut tops: Vec<f64> = Vec::new();
        for child in &root.children {
            match child {
                Fragment::Box(inner) => {
                    eprintln!(
                        "[t-rank] box source={} y={:.4} h={:.4}",
                        inner.source.0, inner.rect.y, inner.rect.height
                    );
                    tops.push(inner.rect.y);
                }
                Fragment::Line(line) => {
                    eprintln!("[t-rank] line y={:.4} h={:.4}", line.rect.y, line.rect.height);
                    tops.push(line.rect.y);
                }
                _ => {}
            }
        }
        assert!(tops.len() >= 3, "three blocks present");
        let last = *tops.last().expect("last block top");
        // Blink: .a line 20.8, .rank flows 24 + 30 = 54 → .b at 74.8.
        assert!(
            (last - 74.8).abs() < 0.05,
            "the block after the fixed-height div flows at 74.8, got {last}"
        );
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
                            InlineItem::Image { .. } | InlineItem::InlineBlock { .. } => None,
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
