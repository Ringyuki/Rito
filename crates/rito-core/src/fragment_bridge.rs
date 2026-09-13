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
use rito_style_contract::{InlineStyleTable, LayoutStyleId, LayoutStyleTable, StyleId};

use std::collections::BTreeMap;

use crate::epub::{EpubError, EpubResult};
use crate::render::contract::{
    ReaderBackgroundPaint, ReaderBlockPaint, ReaderBorderBox, ReaderBorderStyle, ReaderColor,
    ReaderTransform,
};
use crate::xhtml::DocumentNode;

mod box_paint;
mod builder;
mod inline_collector;
mod margins;
mod styles;
#[cfg(test)]
mod test_support;

use box_paint::block_box_paint;
use margins::fold_through_collapsing_margins;
use styles::{anonymous_block_style, fallback_inline_formatting_style};
#[cfg(test)]
pub(crate) use test_support::tests_block_style;

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
    pub(crate) node_paints: BTreeMap<u32, NodePaint>,
    /// Flank border strokes for inline images, keyed by the `<img>`
    /// element's SOURCE index (images have no formatting node). The
    /// widths are the absorbed border widths (top, right, bottom, left);
    /// layout reserved them as padding, the painter strokes them around
    /// the raster rect.
    pub(crate) image_border_paints: BTreeMap<u32, (NodePaint, [f64; 4])>,
    /// The chapter body's own background color, when it has one. This is
    /// the page background — the frame producer washes each page with it
    /// — matching how the retained pipeline hoists a body background onto
    /// the page rather than painting a content-box rectangle.
    pub(crate) page_background: Option<ReaderColor>,
    /// The chapter body's background image, painted across the full page
    /// like the CSS body-background canvas propagation. The block
    /// background paint, colour stripped (the wash owns it).
    pub(crate) page_background_image: Option<ReaderBackgroundPaint>,
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
    /// Outside list markers, keyed by the list item's formatting node id.
    /// The painter places each marker's box with its right edge at the
    /// item box's content-left edge, on the first line's baseline, from
    /// the advance [`ChapterFormattingTree::measure_list_markers`] shaped;
    /// layout never sees the marker (CSS `list-style-position: outside`,
    /// the browser's default).
    pub list_markers: BTreeMap<u32, ListMarkerPaint>,
    /// Ruby annotations shaped at their own size with the base's spacing
    /// off, keyed by (inline-flow node id, item index): the natural
    /// cluster origins the painter distributes over each base segment by
    /// `ruby-align`, and how far over the base's baseline the annotation
    /// line sits. Filled by [`ChapterFormattingTree::measure_painted_runs`].
    pub ruby_annotation_runs: BTreeMap<(u32, usize), rito_inline::MeasuredRuby>,
    /// Constructs the tree could not represent exactly and rendered with
    /// an approximation instead (ignored decoration, flattened display,
    /// collapsed preserved white space, …). Empty means exact.
    pub degradations: Vec<String>,
}

/// One outside list marker's paint inputs.
#[derive(Clone, Debug, PartialEq)]
pub struct ListMarkerPaint {
    /// Marker text (e.g. `9.` for decimal, `•` for disc).
    pub text: String,
    /// The list item's interned inline style: the marker inherits the
    /// item's font, size and color (CSS `::marker` default).
    pub style: StyleId,
    /// The painted string ([`Self::painted_text`]) shaped in `style`: the
    /// marker box's inline size and where its clusters sit. `None` until
    /// [`ChapterFormattingTree::measure_painted_runs`] runs — the bridge
    /// has no shaper, so the backend measures right after bridging.
    pub run: Option<rito_inline::MeasuredRun>,
}

impl ListMarkerPaint {
    /// The string the painter draws: the marker text and its trailing
    /// space, the way the browser's marker box carries it (`9. `).
    pub fn painted_text(&self) -> String {
        format!("{} ", self.text)
    }
}

impl ChapterFormattingTree {
    /// Shapes the strings the painter places without layout — every
    /// outside marker in its item's style, every ruby annotation at its
    /// own size — so the painter works from the engine's own advances
    /// and cluster origins with no host measurement.
    pub fn measure_painted_runs(
        &mut self,
        context: &rito_inline::ParleyInlineContext,
    ) -> EpubResult<()> {
        let styles = self
            .tree
            .styles()
            .ok_or_else(|| EpubError::new("painted-run measurement needs style tables"))?;
        for marker in self.list_markers.values_mut() {
            let style = styles
                .inline
                .style(marker.style)
                .map_err(|error| EpubError::new(format!("marker style: {error}")))?;
            marker.run = Some(context.measure_run(style, &marker.painted_text()));
        }
        self.ruby_annotation_runs.clear();
        for index in 0..self.tree.len() {
            let node_id = FormattingNodeId(index as u32);
            let FormattingNodeContent::InlineFlow { items } = &self.tree.node(node_id).content
            else {
                continue;
            };
            for (item_index, item) in items.iter().enumerate() {
                let InlineItem::Text {
                    text,
                    style,
                    ruby_annotation: Some(annotation),
                    ..
                } = item
                else {
                    continue;
                };
                let style = styles
                    .inline
                    .style(*style)
                    .map_err(|error| EpubError::new(format!("ruby base style: {error}")))?;
                let annotation_size = style.font.size.get() * annotation.size_ratio;
                self.ruby_annotation_runs.insert(
                    (node_id.0, item_index),
                    context.measure_ruby_annotation(style, annotation_size, text, &annotation.text),
                );
            }
        }
        Ok(())
    }
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
#[expect(
    clippy::large_enum_variant,
    reason = "rules are rare beside decorated boxes and the map holds a few entries per chapter"
)]
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum NodePaint {
    /// A horizontal rule's stroke across the node's box.
    Rule {
        /// Colour of the stroke.
        color: ReaderColor,
        /// Stroke pattern the lowering understands.
        style: ReaderBorderStyle,
        /// Stroke thickness. The node's box can be taller (an author
        /// `height` plus both borders flows as the box size, like a
        /// browser's `<hr>`), while the visible stroke keeps the border
        /// width and rides at the box top.
        thickness: f64,
    },
    /// Block-box decoration: the block command's paint and optional
    /// border-box widths, exactly as the lowering consumes them. Border
    /// widths are already lowered into the node's layout padding, so the
    /// fragment rect is the CSS border box and the renderer strokes edges
    /// inside it.
    Box {
        paint: ReaderBlockPaint,
        border_box: Option<ReaderBorderBox>,
        /// The box's computed transform list in paint order, painted as a
        /// stacking wrapper around the box and its whole subtree (origin =
        /// border-box center, CSS transform-origin default).
        transform: Option<Vec<ReaderTransform>>,
        /// Ridge/groove edges paint two-tone: the border entry strokes
        /// the edge's OUTER half color across the full width and each
        /// entry here overlays the INNER half (the strip adjacent to the
        /// content) with the opposite tone. Keyed by edge index in
        /// border-box order (0 top, 1 right, 2 bottom, 3 left).
        bevels: Vec<(usize, ReaderColor)>,
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
    layout: &LayoutStyleTable,
    inline: &InlineStyleTable,
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
        list_markers: BTreeMap::new(),
        list_counters: Vec::new(),
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
                .background
                .filter(|background| background.image.is_some())?;
            Some(ReaderBackgroundPaint {
                color: None,
                ..background
            })
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
        list_markers,
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
        list_markers,
        ruby_annotation_runs: BTreeMap::new(),
        degradations,
    })
}

struct TreeBuilder<'a> {
    layout: &'a mut LayoutStyleTable,
    inline: &'a mut InlineStyleTable,
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
    /// Outside list markers recorded per list-item node.
    list_markers: BTreeMap<u32, ListMarkerPaint>,
    /// Ordinal counter stack: one entry per open <ol>/<ul>, holding the
    /// last ordinal handed out at that nesting level.
    list_counters: Vec<u32>,
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
    checked_box_paints: std::collections::HashMap<u32, CheckedBoxPaint>,
    checked_inline_styles: std::collections::HashMap<(u32, bool), Option<String>>,
}

/// One box-paint capability verdict: the paint (with its border widths)
/// when the style is paintable, plus the degradations it charged.
type CheckedBoxPaint = (Option<(NodePaint, [f64; 4])>, Vec<String>);

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

pub fn empty_chapter_formatting_tree() -> EpubResult<ChapterFormattingTree> {
    let mut layout = LayoutStyleTable::new(1);
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
            inline: InlineStyleTable::new(1),
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
        list_markers: BTreeMap::new(),
        ruby_annotation_runs: BTreeMap::new(),
        degradations: vec!["chapter has no body source node; rendered empty".to_owned()],
    })
}

#[cfg(test)]
mod tests;
