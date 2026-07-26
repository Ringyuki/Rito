use std::hash::{Hash, Hasher};

use rito_style_contract::{InlineStyleTableV1, LayoutStyleId, LayoutStyleTableV1, StyleId};

/// Stable identity of one node in a [`FormattingTree`].
///
/// Identities are dense indexes into the tree's node arena, stable for the
/// tree's lifetime, and the key half of every fragment-cache entry.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, PartialOrd, Ord)]
pub struct FormattingNodeId(pub u32);

/// One item of an inline formatting context's input, in content order.
#[derive(Clone, Debug, PartialEq)]
pub enum InlineItem {
    /// A run of text styled by one interned inline style.
    Text {
        /// The run's text content.
        text: String,
        /// Typed reference into the tree's inline style table.
        style: StyleId,
        /// Accumulated baseline shift from `vertical-align` on ancestor
        /// inline boxes, CSS px; positive raises the run. Resolved at tree
        /// construction so the provider needs no ancestor walk.
        baseline_shift_px: f64,
        /// Ruby annotation text for a run that is a ruby base. The base
        /// takes part in shaping and line breaking like any text; the
        /// annotation is painted above the base's laid-out extent and
        /// never affects inline geometry.
        ruby_annotation: Option<String>,
    },
    /// An atomic inline replaced box (an image): it occupies inline space
    /// like a single glyph and never splits. Display size resolves at
    /// layout time from the layout style's sizing fields against these
    /// intrinsic dimensions.
    Image {
        /// Resource reference of the image source, as authored (the
        /// consumer resolves it against the publication's resources).
        src: String,
        /// Intrinsic pixel width of the image source.
        intrinsic_width: f64,
        /// Intrinsic pixel height of the image source.
        intrinsic_height: f64,
        /// Typed reference into the tree's inline style table.
        style: StyleId,
        /// Typed reference into the tree's layout style table, carrying
        /// the CSS sizing fields (width/height/max-width).
        layout_style: LayoutStyleId,
        /// Accumulated baseline shift from `vertical-align` on this box
        /// and its ancestor inline boxes, CSS px; positive raises it.
        baseline_shift_px: f64,
        /// Whether the drawn content letterboxes inside the resolved box
        /// preserving its intrinsic ratio. The SVG-wrapped image idiom
        /// (`<svg width="100%" height="100%" viewBox><image/></svg>`) pins
        /// both axes on the fold, and SVG 2 `preserveAspectRatio` (default
        /// `xMidYMid meet`) makes the content contain-fit the viewport —
        /// only `none` stretches. The box itself stays the resolved size.
        fit_contain: bool,
    },
}

/// Content carried by one formatting node.
///
/// The content set starts deliberately small: block containers, opaque
/// leaves with an already-resolved block size, and inline flows (the input
/// of an inline formatting context). Tables, floats, and positioned content
/// are added together with the formatting contexts that can lay them out.
/// Unrepresentable content must fail closed before tree construction, never
/// degrade into a guess here.
#[derive(Clone, Debug, PartialEq)]
pub enum FormattingNodeContent {
    /// A block container establishing vertical stacking of its children.
    BlockContainer,
    /// A leaf whose block size is already resolved (for substrate tests and
    /// replaced-content placeholders). CSS px.
    SizedLeaf {
        /// Resolved block-axis size in CSS px.
        block_size: f64,
        /// Whether a fragmentainer boundary may split this leaf.
        breakable: bool,
    },
    /// A paragraph: the ordered inline items one inline formatting context
    /// lays out into line fragments. Requires the tree to carry style
    /// tables, because inline items reference interned inline styles.
    InlineFlow {
        /// Items in content order.
        items: Vec<InlineItem>,
    },
    /// A table grid: children are `TableRow` nodes in row order.
    Table,
    /// One table row: children are `TableCell` nodes in column order.
    TableRow,
    /// One table cell: lays out its children like a block container inside
    /// the column width the table assigns.
    TableCell {
        /// Grid columns this cell spans (≥ 1).
        col_span: u32,
    },
}

/// One node of the formatting tree.
#[derive(Clone, Debug, PartialEq)]
pub struct FormattingNode {
    /// Typed computed-style reference; the table lives beside the tree.
    pub style: LayoutStyleId,
    /// Node content.
    pub content: FormattingNodeContent,
    /// Children in document order (block-level only in this substrate).
    pub children: Vec<FormattingNodeId>,
}

/// The typed style tables a formatting tree's nodes reference.
#[derive(Debug)]
pub struct FormattingTreeStyles {
    /// Interned block/layout styles referenced by `FormattingNode::style`.
    pub layout: LayoutStyleTableV1,
    /// Interned inline styles referenced by [`InlineItem::Text`].
    pub inline: InlineStyleTableV1,
}

/// The engine-input side of the durable layout contract.
///
/// A `FormattingTree` is immutable once built. It carries no DOM, no Stylo
/// internals, and no platform types; styles are typed references resolved
/// through the style tables carried beside the nodes.
#[derive(Debug)]
pub struct FormattingTree {
    nodes: Vec<FormattingNode>,
    root: FormattingNodeId,
    styles: Option<FormattingTreeStyles>,
    /// CSS strut styles per inline-flow node: the block container's own
    /// inline style, whose line-height floors every line box the flow
    /// produces (CSS 2 §10.8.1).
    strut_styles: std::collections::BTreeMap<u32, StyleId>,
    fingerprint: u64,
}

impl FormattingTree {
    /// Builds a table-less tree from an arena and a root reference.
    ///
    /// Fails closed on a dangling root or child reference, and on any
    /// content (inline flows) that needs style tables to resolve: a
    /// structurally invalid tree must never reach layout.
    pub fn new(nodes: Vec<FormattingNode>, root: FormattingNodeId) -> Result<Self, String> {
        validate_structure(&nodes, root)?;
        for (index, node) in nodes.iter().enumerate() {
            if matches!(node.content, FormattingNodeContent::InlineFlow { .. }) {
                return Err(format!(
                    "formatting node {index} is an inline flow but the tree carries no style tables"
                ));
            }
        }
        let fingerprint = fingerprint(&nodes, root, None);
        Ok(Self {
            nodes,
            root,
            styles: None,
            strut_styles: std::collections::BTreeMap::new(),
            fingerprint,
        })
    }

    /// Builds a tree that carries its style tables.
    ///
    /// Fails closed on dangling references and on any inline item whose
    /// style id is not interned in the inline table.
    pub fn with_styles(
        nodes: Vec<FormattingNode>,
        root: FormattingNodeId,
        styles: FormattingTreeStyles,
    ) -> Result<Self, String> {
        validate_structure(&nodes, root)?;
        for (index, node) in nodes.iter().enumerate() {
            if let FormattingNodeContent::InlineFlow { items } = &node.content {
                for item in items {
                    match item {
                        InlineItem::Text { style, .. } => {
                            styles.inline.style(*style).map_err(|error| {
                                format!("formatting node {index} references an inline style outside the tree's table: {error}")
                            })?;
                        }
                        InlineItem::Image {
                            style,
                            layout_style,
                            ..
                        } => {
                            styles.inline.style(*style).map_err(|error| {
                                format!("formatting node {index} references an inline style outside the tree's table: {error}")
                            })?;
                            styles.layout.style(*layout_style).map_err(|error| {
                                format!("formatting node {index} references a layout style outside the tree's table: {error}")
                            })?;
                        }
                    }
                }
            }
        }
        let fingerprint = fingerprint(&nodes, root, Some(&styles));
        Ok(Self {
            nodes,
            root,
            styles: Some(styles),
            strut_styles: std::collections::BTreeMap::new(),
            fingerprint,
        })
    }

    /// Content fingerprint of the whole tree (structure, style references,
    /// leaf payloads, and — when carried — the style tables' content),
    /// computed once at construction.
    ///
    /// Trees are immutable, so an equal fingerprint means byte-equal layout
    /// input; the fragment cache uses it to reject entries recorded against
    /// a different tree that happens to reuse the same dense node ids.
    /// Records the strut style for inline-flow nodes and folds the
    /// mapping into the tree fingerprint (struts change layout).
    pub fn set_strut_styles(&mut self, strut_styles: std::collections::BTreeMap<u32, StyleId>) {
        let mut mixer = FnvMixer::new();
        mixer.mix(&self.fingerprint.to_le_bytes());
        for (node, style) in &strut_styles {
            mixer.mix(&node.to_le_bytes());
            mixer.mix(&style.raw().to_le_bytes());
        }
        self.fingerprint = mixer.finish();
        self.strut_styles = strut_styles;
    }

    /// The strut style recorded for an inline-flow node, if any.
    pub fn strut_style(&self, node: FormattingNodeId) -> Option<StyleId> {
        self.strut_styles.get(&node.0).copied()
    }

    pub fn fingerprint(&self) -> u64 {
        self.fingerprint
    }

    /// The style tables carried beside the nodes, if any.
    pub fn styles(&self) -> Option<&FormattingTreeStyles> {
        self.styles.as_ref()
    }

    /// Root node identity.
    pub fn root(&self) -> FormattingNodeId {
        self.root
    }

    /// Resolves a node by identity.
    pub fn node(&self, id: FormattingNodeId) -> &FormattingNode {
        &self.nodes[id.0 as usize]
    }

    /// Number of nodes in the arena.
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    /// Whether the arena is empty.
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }
}

fn validate_structure(nodes: &[FormattingNode], root: FormattingNodeId) -> Result<(), String> {
    let bound = nodes.len() as u32;
    if root.0 >= bound {
        return Err(format!("formatting tree root {} is out of bounds", root.0));
    }
    for (index, node) in nodes.iter().enumerate() {
        for child in &node.children {
            if child.0 >= bound {
                return Err(format!(
                    "formatting node {index} references dangling child {}",
                    child.0
                ));
            }
        }
    }
    Ok(())
}

/// FNV-1a over a canonical encoding of the arena and style tables.
/// Deterministic across platforms; collisions are theoretically possible but
/// the cache only uses the fingerprint to *reject* reuse, layered on top of
/// node-id and constraint equality, so a collision costs correctness nothing
/// worse than what full content comparison would also accept.
fn fingerprint(
    nodes: &[FormattingNode],
    root: FormattingNodeId,
    styles: Option<&FormattingTreeStyles>,
) -> u64 {
    let mut mixer = FnvMixer::new();
    mixer.mix(&root.0.to_le_bytes());
    for node in nodes {
        mixer.mix(&node.style.raw().to_le_bytes());
        match &node.content {
            FormattingNodeContent::BlockContainer => mixer.mix(&[0]),
            FormattingNodeContent::SizedLeaf {
                block_size,
                breakable,
            } => {
                mixer.mix(&[1, u8::from(*breakable)]);
                mixer.mix(&block_size.to_bits().to_le_bytes());
            }
            FormattingNodeContent::Table => mixer.mix(&[3]),
            FormattingNodeContent::TableRow => mixer.mix(&[4]),
            FormattingNodeContent::TableCell { col_span } => {
                mixer.mix(&[5]);
                mixer.mix(&col_span.to_le_bytes());
            }
            FormattingNodeContent::InlineFlow { items } => {
                mixer.mix(&[2]);
                mixer.mix(&(items.len() as u32).to_le_bytes());
                for item in items {
                    match item {
                        InlineItem::Text {
                            text,
                            style,
                            baseline_shift_px,
                            ruby_annotation,
                        } => {
                            mixer.mix(&[0]);
                            mixer.mix(&(text.len() as u32).to_le_bytes());
                            mixer.mix(text.as_bytes());
                            mixer.mix(&style.raw().to_le_bytes());
                            mixer.mix(&baseline_shift_px.to_bits().to_le_bytes());
                            match ruby_annotation {
                                Some(annotation) => {
                                    mixer.mix(&[1]);
                                    mixer.mix(&(annotation.len() as u32).to_le_bytes());
                                    mixer.mix(annotation.as_bytes());
                                }
                                None => mixer.mix(&[0]),
                            }
                        }
                        InlineItem::Image {
                            src,
                            intrinsic_width,
                            intrinsic_height,
                            style,
                            layout_style,
                            baseline_shift_px,
                            fit_contain,
                        } => {
                            mixer.mix(&[1]);
                            mixer.mix(&(src.len() as u32).to_le_bytes());
                            mixer.mix(src.as_bytes());
                            mixer.mix(&intrinsic_width.to_bits().to_le_bytes());
                            mixer.mix(&intrinsic_height.to_bits().to_le_bytes());
                            mixer.mix(&style.raw().to_le_bytes());
                            mixer.mix(&layout_style.raw().to_le_bytes());
                            mixer.mix(&baseline_shift_px.to_bits().to_le_bytes());
                            mixer.mix(&[u8::from(*fit_contain)]);
                        }
                    }
                }
            }
        }
        mixer.mix(&(node.children.len() as u32).to_le_bytes());
        for child in &node.children {
            mixer.mix(&child.0.to_le_bytes());
        }
    }
    if let Some(styles) = styles {
        mixer.mix(&[3]);
        styles.layout.styles().hash(&mut mixer);
        styles.layout.node_style_ids().hash(&mut mixer);
        styles.inline.styles().hash(&mut mixer);
        styles.inline.node_style_ids().hash(&mut mixer);
    }
    mixer.finish()
}

/// FNV-1a 64 usable both for raw canonical bytes and as a `std::hash::Hasher`
/// bridge for `Hash` types, with every integer write pinned little-endian
/// and `usize` widened to eight bytes so identical values hash identically
/// on 32-bit wasm and 64-bit native targets.
struct FnvMixer(u64);

impl FnvMixer {
    fn new() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }

    fn mix(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
}

impl Hasher for FnvMixer {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        self.mix(bytes);
    }

    fn write_u16(&mut self, value: u16) {
        self.mix(&value.to_le_bytes());
    }

    fn write_u32(&mut self, value: u32) {
        self.mix(&value.to_le_bytes());
    }

    fn write_u64(&mut self, value: u64) {
        self.mix(&value.to_le_bytes());
    }

    fn write_u128(&mut self, value: u128) {
        self.mix(&value.to_le_bytes());
    }

    fn write_usize(&mut self, value: usize) {
        self.mix(&(value as u64).to_le_bytes());
    }

    fn write_i8(&mut self, value: i8) {
        self.mix(&[value as u8]);
    }

    fn write_i16(&mut self, value: i16) {
        self.write_u16(value as u16);
    }

    fn write_i32(&mut self, value: i32) {
        self.write_u32(value as u32);
    }

    fn write_i64(&mut self, value: i64) {
        self.write_u64(value as u64);
    }

    fn write_i128(&mut self, value: i128) {
        self.write_u128(value as u128);
    }

    fn write_isize(&mut self, value: isize) {
        self.write_usize(value as usize);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rito_style_contract::{
        AlignItemsV1, ClearV1, FloatV1, JustifyContentV1, LayoutDisplayInsideV1,
        LayoutDisplayOutsideV1, LayoutDisplayV1, LayoutFormattingStyleV1, LengthPercentageOrAuto,
        ListMarkerStyleV1, MaximumHeightV1, MaximumSizeV1, MinimumHeightV1, OverflowV1,
        PageBreakV1, PhysicalSides, PositionV1, PreferredSizeV1,
    };

    fn zero_padding() -> rito_style_contract::NonNegativeLengthPercentage {
        rito_style_contract::NonNegativeLengthPercentage::new(
            rito_style_contract::LengthPercentage::Length(
                rito_style_contract::CssPx::new(0.0).expect("zero length is finite"),
            ),
        )
    }

    fn layout_style(break_before: PageBreakV1) -> LayoutFormattingStyleV1 {
        LayoutFormattingStyleV1 {
            display: LayoutDisplayV1 {
                outside: LayoutDisplayOutsideV1::Block,
                inside: LayoutDisplayInsideV1::Flow,
                is_list_item: false,
            },
            margin: PhysicalSides {
                top: LengthPercentageOrAuto::Auto,
                right: LengthPercentageOrAuto::Auto,
                bottom: LengthPercentageOrAuto::Auto,
                left: LengthPercentageOrAuto::Auto,
            },
            padding: PhysicalSides {
                top: zero_padding(),
                right: zero_padding(),
                bottom: zero_padding(),
                left: zero_padding(),
            },
            box_sizing: rito_style_contract::BoxSizingV1::ContentBox,
            justify_content: JustifyContentV1::Normal,
            align_items: AlignItemsV1::Normal,
            break_before,
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
            vertical_align: rito_style_contract::CellVerticalAlignV1::Baseline,
            border_spacing: (
                rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
            ),
            inset: PhysicalSides {
                top: LengthPercentageOrAuto::Auto,
                right: LengthPercentageOrAuto::Auto,
                bottom: LengthPercentageOrAuto::Auto,
                left: LengthPercentageOrAuto::Auto,
            },
        }
    }

    fn block_node() -> FormattingNode {
        FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::BlockContainer,
            children: Vec::new(),
        }
    }

    fn styles_with(break_before: PageBreakV1) -> FormattingTreeStyles {
        let mut layout = LayoutStyleTableV1::new(1);
        layout
            .intern_for_node(0, layout_style(break_before))
            .expect("style interns");
        FormattingTreeStyles {
            layout,
            inline: InlineStyleTableV1::new(0),
        }
    }

    #[test]
    fn inline_flow_without_style_tables_fails_closed() {
        let nodes = vec![FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow { items: Vec::new() },
            children: Vec::new(),
        }];
        assert!(FormattingTree::new(nodes, FormattingNodeId(0)).is_err());
    }

    #[test]
    fn inline_item_with_untabled_style_fails_closed() {
        let nodes = vec![FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Text {
                    text: "orphan".to_owned(),
                    style: StyleId::from_raw(7),
                    baseline_shift_px: 0.0,
                    ruby_annotation: None,
                }],
            },
            children: Vec::new(),
        }];
        assert!(FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline: InlineStyleTableV1::new(0),
            },
        )
        .is_err());
    }

    #[test]
    fn fingerprint_covers_style_table_content() {
        let first = FormattingTree::with_styles(
            vec![block_node()],
            FormattingNodeId(0),
            styles_with(PageBreakV1::Auto),
        )
        .expect("first tree builds");
        let second = FormattingTree::with_styles(
            vec![block_node()],
            FormattingNodeId(0),
            styles_with(PageBreakV1::Always),
        )
        .expect("second tree builds");
        assert_ne!(
            first.fingerprint(),
            second.fingerprint(),
            "identical structure with different table content must not share a fingerprint"
        );

        let repeat = FormattingTree::with_styles(
            vec![block_node()],
            FormattingNodeId(0),
            styles_with(PageBreakV1::Auto),
        )
        .expect("repeat tree builds");
        assert_eq!(first.fingerprint(), repeat.fingerprint());
    }
}
