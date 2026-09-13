use std::hash::{Hash, Hasher};

use rito_style_contract::{InlineStyleTable, LayoutStyleId, LayoutStyleTable, StyleId};

/// Stable identity of one node in a [`FormattingTree`].
///
/// Identities are dense indexes into the tree's node arena, stable for the
/// tree's lifetime, and the key half of every fragment-cache entry.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, PartialOrd, Ord)]
pub struct FormattingNodeId(pub u32);

/// A ruby base's annotation: the text drawn above the base and the
/// annotation font size as a ratio of the base size (the `rt` element's
/// cascaded `font-size`; the UA default is 0.5, publishers commonly
/// The slice of a ruby annotation that rides one base segment when the
/// base splits across lines. Measured (word-allocation matrix,
/// 2026-08-05): a multi-word annotation splits at its spaces, each word
/// riding the segment its CHARACTER MIDPOINT falls over — the midpoint's
/// position in the annotation string, as a fraction, against the
/// segment's span of the base, as a fraction of its characters (正规|勇者
/// under "Legal Brave" carries Legal|Brave; 正规勇|者 keeps Legal Brave's
/// Brave on the 者 segment, whose rt box then widens past the single
/// glyph). A single word — no spaces — rides whichever segment holds its
/// midpoint, the whole-annotation-on-first-segment behaviour for
/// front-heavy splits.
///
/// Pure over its inputs so layout, line growth, and paint replay the
/// same allocation without threading extra state.
pub fn allocate_ruby_annotation(annotation: &str, start_ratio: f64, end_ratio: f64) -> String {
    allocate_ruby_annotation_range(annotation, start_ratio, end_ratio)
        .and_then(|range| annotation.get(range))
        .map_or_else(String::new, str::to_owned)
}

/// The byte range of [`allocate_ruby_annotation`]'s words inside the
/// annotation — the selected words are consecutive, so the allocation is
/// one contiguous slice — or `None` when no word rides the segment.
pub fn allocate_ruby_annotation_range(
    annotation: &str,
    start_ratio: f64,
    end_ratio: f64,
) -> Option<core::ops::Range<usize>> {
    let total = annotation.chars().count();
    if total == 0 {
        return None;
    }
    let mut allocated: Option<core::ops::Range<usize>> = None;
    let mut char_position = 0usize;
    let mut byte = 0usize;
    for word in annotation.split(' ') {
        let len = word.chars().count();
        if len > 0 {
            let midpoint = (char_position as f64 + len as f64 / 2.0) / total as f64;
            // Half-open on the LEFT: a word whose midpoint lands exactly
            // on the split point rides the EARLIER segment (measured:
            // 异|禀 under Talent — midpoint 0.5 at a half-way split —
            // rewinds because Talent presses on 异's segment).
            if midpoint > start_ratio && midpoint <= end_ratio {
                let end = byte + word.len();
                allocated = Some(allocated.map_or(byte..end, |range| range.start..end));
            }
        }
        char_position += len + 1;
        byte += word.len() + 1;
    }
    allocated
}

/// Where each cluster of an annotation paints over its base: the
/// browser's `ruby-align` distribution replayed from the annotation's
/// natural cluster origins (`natural`, from the slice's start, totalling
/// `natural_advance`) across the base extent `width` wide starting at
/// `start`, the annotation set at `annotation_size` px. Returns one
/// absolute x per cluster, in `natural` order. Chromium's laws (LayoutNG
/// `ApplyRubyAlign` and `ApplyJustificationInternal` with the ruby-text
/// target), the slack being the extent less the annotation's width on
/// the 1/64 layout grid:
/// - `space-around` (the initial) justifies the annotation: its
///   expansion opportunities are counted the way a justified line's are
///   (after every space and CJK glyph, before a CJK glyph that follows
///   neither, never at the line's edges); an inset of slack/(count+1),
///   capped at twice the annotation's whole-pixel font size, stays half
///   at each edge while the rest spreads over the opportunities — so a
///   two-word Latin annotation keeps 8px at each edge of a wide base and
///   opens the rest in its space (DOM-measured on a five-glyph base), a
///   single Latin word centers, and CJK glyphs take one share each.
///   With no opportunity the slack halves at the edges.
/// - `space-between`: the same opportunities take every share, nothing
///   at the edges; with no opportunity the annotation centers.
/// - `center`: packed and centered, half the slack on the grid.
/// - `start`: packed at the box's start.
///
/// A wider annotation than its extent packs from the start (its base
/// spread to hold it).
pub fn distribute_ruby_annotation(
    text: &str,
    natural: &[crate::ClusterPosition],
    natural_advance: f64,
    start: f64,
    width: f64,
    align: rito_style_contract::RubyAlign,
    annotation_size: f64,
) -> Vec<f64> {
    use rito_style_contract::RubyAlign;
    let trunc_64 = |value: f64| (value * 64.0).trunc() / 64.0;
    let ceil_64 = |value: f64| (((value - 1.0 / 1024.0) * 64.0).ceil() / 64.0).max(0.0);
    let packed = || {
        natural
            .iter()
            .map(|cluster| start + cluster.x)
            .collect::<Vec<f64>>()
    };
    let space = width - ceil_64(natural_advance);
    if natural.is_empty() || space <= 0.0 {
        return packed();
    }
    // Each cluster's expansion opportunities (before, after), with the
    // line's leading and trailing opportunities disallowed.
    let mut is_after = true;
    let mut flags: Vec<(bool, bool)> = natural
        .iter()
        .map(|cluster| {
            let character = text
                .get(cluster.byte as usize..)
                .and_then(|rest| rest.chars().next())
                .unwrap_or('\0');
            if ruby_treat_as_space(character) {
                is_after = true;
                (false, true)
            } else if ruby_glyph_expands(character) {
                let before = !is_after;
                is_after = true;
                (before, true)
            } else {
                is_after = false;
                (false, false)
            }
        })
        .collect();
    if is_after {
        if let Some(last) = flags.last_mut() {
            last.1 = false;
        }
    }
    let count = flags
        .iter()
        .map(|(before, after)| u32::from(*before) + u32::from(*after))
        .sum::<u32>();
    let (edge, per_opportunity) = match align {
        RubyAlign::Start => return packed(),
        RubyAlign::Center => (trunc_64(space / 2.0), 0.0),
        RubyAlign::SpaceBetween => {
            if count == 0 {
                (trunc_64(space / 2.0), 0.0)
            } else {
                (0.0, space / f64::from(count))
            }
        }
        RubyAlign::SpaceAround => {
            if count == 0 {
                (trunc_64(space / 2.0), 0.0)
            } else {
                let cap = 2.0 * (annotation_size + 0.5).floor();
                let inset = trunc_64(space / (f64::from(count) + 1.0)).min(cap);
                (trunc_64(inset / 2.0), (space - inset) / f64::from(count))
            }
        }
    };
    let mut x = start + edge;
    let mut origins = Vec::with_capacity(natural.len());
    for (index, cluster) in natural.iter().enumerate() {
        let (before, after) = flags[index];
        let step = natural
            .get(index + 1)
            .map_or(natural_advance, |next| next.x)
            - cluster.x;
        // A before-opportunity's share moves the glyph's ink as well as
        // widening its advance.
        let shift = if before { per_opportunity } else { 0.0 };
        origins.push(x + shift);
        x += step + shift + if after { per_opportunity } else { 0.0 };
    }
    origins
}

/// The characters justification treats as spaces (Chromium's
/// `Character::TreatAsSpace`): a share follows each.
fn ruby_treat_as_space(character: char) -> bool {
    matches!(character, ' ' | '\t' | '\n' | '\u{a0}')
}

/// Whether a glyph carries a per-glyph justification opportunity inside
/// an annotation: the CJK blocks (the browser's justify opportunity
/// classes applied inside the annotation box).
fn ruby_glyph_expands(character: char) -> bool {
    matches!(
        u32::from(character),
        0x2E80..=0x9FFF | 0xF900..=0xFAFF | 0xFF00..=0xFFEF | 0x20000..=0x3FFFF
    )
}

/// override it — 0.55em in the measured corpus).
#[derive(Clone, Debug, PartialEq)]
pub struct RubyAnnotation {
    /// Annotation text, whitespace-normalized.
    pub text: String,
    /// rt font size / base font size.
    pub size_ratio: f32,
    /// The rt element's computed `ruby-align`, driving how the painted
    /// annotation distributes over the base extent.
    pub align: rito_style_contract::RubyAlign,
}

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
        /// Ruby annotation for a run that is a ruby base. The base
        /// takes part in shaping and line breaking like any text; the
        /// annotation is painted above the base's laid-out extent and
        /// only affects inline geometry through the line's ruby growth.
        ruby_annotation: Option<RubyAnnotation>,
    },
    /// An atomic inline replaced box (an image): it occupies inline space
    /// like a single glyph and never splits. Display size resolves at
    /// layout time from the layout style's sizing fields against these
    /// intrinsic dimensions.
    Image {
        /// Resource reference of the image source, as authored (the
        /// consumer resolves it against the publication's resources).
        src: String,
        /// Source index of the `<img>` element in the document tree —
        /// the key its layout-inert paint (flank border strokes) is
        /// registered under. Zero when synthetic (tests, placeholders).
        source: u32,
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
        /// The folded SVG's viewBox size, when the image idiom carried
        /// one: the browser letterboxes THIS box into the element rect
        /// first, then the raster letterboxes inside it — and clamp
        /// bleed fills the inner sliver, not the outer margins.
        viewport: Option<(f64, f64)>,
        /// `vertical-align: top`: the box pins to the line-box top,
        /// ignoring the baseline-shift chain it sits in (a footnote
        /// badge inside `<sup>` stays at the line top while the sup's
        /// strut still raises the envelope). It only grows the line
        /// DOWNWARD when taller than the baseline envelope.
        align_top: bool,
        /// Computed `object-fit` from the cascade (the UA stylesheet
        /// sets `contain` on `img`; authors can override). Consumed at
        /// paint time: `Fill` stretches into the box, everything else
        /// letterboxes the raster inside it. Distinct from
        /// `fit_contain`, which is the SVG-fold geometry (two-stage
        /// viewBox + raster placement with clamp-bleed slivers).
        object_fit: rito_style_contract::ObjectFit,
    },
    /// An inline-block whose content is itself inline-only: an atomic
    /// inline laid out as its own mini paragraph (shrink-to-fit width,
    /// its own text-align and line-height), sitting in the host line
    /// with its baseline at its LAST line's baseline (CSS §10.8.1).
    /// Inline-blocks holding block children fail closed upstream.
    InlineBlock {
        /// The mini paragraph: a hidden `InlineFlow` node in the same
        /// tree (reachable only through this item, never a block child).
        /// The provider lays it out recursively at shrink-to-fit width.
        node: FormattingNodeId,
        /// The box's own inline style (the span's), for strut and
        /// alignment fallbacks in the host paragraph.
        style: StyleId,
        /// Typed reference into the tree's layout style table for the
        /// block-level knobs (text-align, line-height, padding).
        layout_style: LayoutStyleId,
        /// Accumulated baseline shift from `vertical-align` on ancestor
        /// inline boxes, CSS px; positive raises the box.
        baseline_shift_px: f64,
    },
    /// A childless inline box (an empty `<sup>` footnote anchor). It has
    /// no advance and never breaks a line, but the open box still
    /// contributes its font's leaded envelope around its shifted
    /// baseline to the line box — an empty raised sup grows the line
    /// exactly like one holding a marker character.
    EmptyBox {
        /// The box's own inline style, carrying its font and line-height.
        style: StyleId,
        /// Accumulated baseline shift from `vertical-align` on this box
        /// and its ancestors, CSS px; positive raises it.
        baseline_shift_px: f64,
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
    pub layout: LayoutStyleTable,
    /// Interned inline styles referenced by [`InlineItem::Text`].
    pub inline: InlineStyleTable,
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
        fn validate_item(
            styles: &FormattingTreeStyles,
            index: usize,
            item: &InlineItem,
        ) -> Result<(), String> {
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
                InlineItem::InlineBlock {
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
                InlineItem::EmptyBox { style, .. } => {
                    styles.inline.style(*style).map_err(|error| {
                        format!("formatting node {index} references an inline style outside the tree's table: {error}")
                    })?;
                }
            }
            Ok(())
        }
        for (index, node) in nodes.iter().enumerate() {
            if let FormattingNodeContent::InlineFlow { items } = &node.content {
                for item in items {
                    validate_item(&styles, index, item)?;
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
                fn mix_item(mixer: &mut FnvMixer, item: &InlineItem) {
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
                                    mixer.mix(&(annotation.text.len() as u32).to_le_bytes());
                                    mixer.mix(annotation.text.as_bytes());
                                    mixer.mix(&annotation.size_ratio.to_bits().to_le_bytes());
                                }
                                None => mixer.mix(&[0]),
                            }
                        }
                        InlineItem::Image {
                            src,
                            source,
                            intrinsic_width,
                            intrinsic_height,
                            style,
                            layout_style,
                            baseline_shift_px,
                            fit_contain,
                            viewport,
                            align_top,
                            object_fit,
                        } => {
                            mixer.mix(&[1]);
                            mixer.mix(&(src.len() as u32).to_le_bytes());
                            mixer.mix(src.as_bytes());
                            mixer.mix(&source.to_le_bytes());
                            mixer.mix(&intrinsic_width.to_bits().to_le_bytes());
                            mixer.mix(&intrinsic_height.to_bits().to_le_bytes());
                            if let Some((viewport_width, viewport_height)) = viewport {
                                mixer.mix(&[2]);
                                mixer.mix(&viewport_width.to_bits().to_le_bytes());
                                mixer.mix(&viewport_height.to_bits().to_le_bytes());
                            }
                            mixer.mix(&style.raw().to_le_bytes());
                            mixer.mix(&layout_style.raw().to_le_bytes());
                            mixer.mix(&baseline_shift_px.to_bits().to_le_bytes());
                            mixer.mix(&[u8::from(*fit_contain)]);
                            mixer.mix(&[u8::from(*align_top)]);
                            mixer.mix(&[*object_fit as u8]);
                        }
                        InlineItem::InlineBlock {
                            node,
                            style,
                            layout_style,
                            baseline_shift_px,
                        } => {
                            mixer.mix(&[4]);
                            mixer.mix(&node.0.to_le_bytes());
                            mixer.mix(&style.raw().to_le_bytes());
                            mixer.mix(&layout_style.raw().to_le_bytes());
                            mixer.mix(&baseline_shift_px.to_bits().to_le_bytes());
                        }
                        InlineItem::EmptyBox {
                            style,
                            baseline_shift_px,
                        } => {
                            mixer.mix(&[6]);
                            mixer.mix(&style.raw().to_le_bytes());
                            mixer.mix(&baseline_shift_px.to_bits().to_le_bytes());
                        }
                    }
                }
                for item in items {
                    mix_item(&mut mixer, item);
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
    #[test]
    fn ruby_annotation_allocation_follows_word_midpoints() {
        use super::allocate_ruby_annotation as alloc;
        // 正规|勇者 under "Legal Brave": Legal (midpoint 0.227) rides the
        // first half, Brave (0.773) the second.
        assert_eq!(alloc("Legal Brave", 0.0, 0.5), "Legal");
        assert_eq!(alloc("Legal Brave", 0.5, f64::INFINITY), "Brave");
        // A single word whose midpoint lands EXACTLY on the split point
        // rides the earlier segment (异|禀 under Talent rewinds).
        assert_eq!(alloc("Talent", 0.0, 0.5), "Talent");
        assert_eq!(alloc("Talent", 0.5, f64::INFINITY), "");
        // Front-heavy split keeps a single word on the wide first segment.
        assert_eq!(alloc("Leprechaun", 0.0, 0.75), "Leprechaun");
        // Six words split three-quarters in: e and f go down.
        assert_eq!(alloc("a b c d e f", 0.0, 0.75), "a b c d");
        assert_eq!(alloc("a b c d e f", 0.75, f64::INFINITY), "e f");
        // The same allocation as a byte range into the annotation.
        assert_eq!(
            allocate_ruby_annotation_range("Legal Brave", 0.0, 0.5),
            Some(0..5)
        );
        assert_eq!(
            allocate_ruby_annotation_range("Legal Brave", 0.5, f64::INFINITY),
            Some(6..11)
        );
        assert_eq!(
            allocate_ruby_annotation_range("Talent", 0.5, f64::INFINITY),
            None
        );
        assert_eq!(
            allocate_ruby_annotation_range("a b c d e f", 0.0, 0.75),
            Some(0..7)
        );
    }

    /// Every `ruby-align` law places the annotation's clusters over the
    /// base extent from their natural origins: per-glyph shares for CJK,
    /// whole-word units for Latin, packed starts and floored centers.
    #[test]
    fn ruby_annotation_distribution_follows_the_computed_alignment() {
        let cluster = |byte: u32, x: f64| crate::ClusterPosition { byte, x };
        let close = |actual: &[f64], expected: &[f64]| {
            assert_eq!(actual.len(), expected.len(), "{actual:?} vs {expected:?}");
            for (a, e) in actual.iter().zip(expected) {
                assert!((a - e).abs() < 1e-9, "{actual:?} vs {expected:?}");
            }
        };
        // Three 8px kana over a 32px base starting at 100: 8px of slack,
        // two opportunities (after the first and second glyph).
        let kana = [cluster(0, 0.0), cluster(3, 8.0), cluster(6, 16.0)];
        let place =
            |align| distribute_ruby_annotation("かんじ", &kana, 24.0, 100.0, 32.0, align, 8.0);
        // An inset of slack/3 on the layout grid, half at each edge, the
        // rest in the two gaps.
        let inset = (8.0_f64 / 3.0 * 64.0).trunc() / 64.0;
        let edge = (inset / 2.0 * 64.0).trunc() / 64.0;
        let gap = (8.0 - inset) / 2.0;
        close(
            &place(RubyAlign::SpaceAround),
            &[
                100.0 + edge,
                100.0 + edge + 8.0 + gap,
                100.0 + edge + 16.0 + 2.0 * gap,
            ],
        );
        // Interior shares only.
        close(&place(RubyAlign::SpaceBetween), &[100.0, 112.0, 124.0]);
        // Packed and centered on the 1/64 grid.
        close(&place(RubyAlign::Center), &[104.0, 112.0, 120.0]);
        // Packed at the start.
        close(&place(RubyAlign::Start), &[100.0, 108.0, 116.0]);
        // A Latin word has no opportunity: it centers whole, the slack
        // halved onto the 1/64 grid, interior steps natural.
        let word = [cluster(0, 0.0), cluster(1, 5.0), cluster(2, 9.33)];
        close(
            &distribute_ruby_annotation(
                "abc",
                &word,
                14.0,
                100.0,
                40.0,
                RubyAlign::SpaceAround,
                8.0,
            ),
            &[113.0, 118.0, 122.33],
        );
        // Spaced words: the space is the one opportunity; the inset
        // slack/2 stays half at each edge and the rest opens the space.
        let words = [
            cluster(0, 0.0),
            cluster(1, 5.0),
            cluster(2, 10.0),
            cluster(3, 12.0),
            cluster(4, 17.0),
        ];
        close(
            &distribute_ruby_annotation(
                "ab cd",
                &words,
                22.0,
                100.0,
                44.0,
                RubyAlign::SpaceAround,
                8.0,
            ),
            &[105.5, 110.5, 115.5, 128.5, 133.5],
        );
        // The inset caps at twice the annotation's whole-pixel font size
        // (DOM-measured: "Regulu Ere" at 8px over an 80.36px base kept
        // 8px at each edge and opened the rest, 28.16px, in its space).
        let two_words = [
            cluster(0, 0.0),
            cluster(1, 5.34),
            cluster(2, 8.89),
            cluster(3, 12.89),
            cluster(4, 16.89),
            cluster(5, 19.11),
            cluster(6, 23.11),
            cluster(7, 25.11),
            cluster(8, 30.0),
            cluster(9, 32.66),
        ];
        let placed = distribute_ruby_annotation(
            "Regulu Ere",
            &two_words,
            36.21,
            38.390625,
            80.359375,
            RubyAlign::SpaceAround,
            8.0,
        );
        assert!((placed[0] - (38.390625 + 8.0)).abs() < 1e-9, "{placed:?}");
        let slack = 80.359375 - (((36.21 - 1.0 / 1024.0) * 64.0f64).ceil() / 64.0);
        assert!(
            (placed[7] - (38.390625 + 8.0 + 25.11 + (slack - 16.0))).abs() < 1e-9,
            "{placed:?}"
        );
        // No slack: every law packs at the natural origins.
        close(
            &distribute_ruby_annotation(
                "かんじ",
                &kana,
                24.0,
                100.0,
                24.0,
                RubyAlign::SpaceAround,
                8.0,
            ),
            &[100.0, 108.0, 116.0],
        );
    }

    use super::*;
    use rito_style_contract::{
        AlignItems, Clear, Float, JustifyContent, LayoutDisplay, LayoutDisplayInside,
        LayoutDisplayOutside, LayoutFormattingStyle, LengthPercentageOrAuto, ListMarkerStyle,
        MaximumHeight, MaximumSize, MinimumHeight, Overflow, PageBreak, PhysicalSides, Position,
        PreferredSize, RubyAlign,
    };

    fn zero_padding() -> rito_style_contract::NonNegativeLengthPercentage {
        rito_style_contract::NonNegativeLengthPercentage::new(
            rito_style_contract::LengthPercentage::Length(
                rito_style_contract::CssPx::new(0.0).expect("zero length is finite"),
            ),
        )
    }

    fn layout_style(break_before: PageBreak) -> LayoutFormattingStyle {
        LayoutFormattingStyle {
            display: LayoutDisplay {
                outside: LayoutDisplayOutside::Block,
                inside: LayoutDisplayInside::Flow,
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
            box_sizing: rito_style_contract::BoxSizing::ContentBox,
            justify_content: JustifyContent::Normal,
            align_items: AlignItems::Normal,
            break_before,
            break_after: PageBreak::Auto,
            width: PreferredSize::Auto,
            height: PreferredSize::Auto,
            max_width: MaximumSize::None,
            min_height: MinimumHeight::Auto,
            max_height: MaximumHeight::None,
            clear: Clear::None,
            float: Float::None,
            overflow: Overflow::Visible,
            list_style_type: ListMarkerStyle::None,
            position: Position::Static,
            vertical_align: rito_style_contract::CellVerticalAlign::Baseline,
            border_spacing: (
                rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
            ),
            border_collapse: false,
            object_fit: rito_style_contract::ObjectFit::Fill,
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

    fn styles_with(break_before: PageBreak) -> FormattingTreeStyles {
        let mut layout = LayoutStyleTable::new(1);
        layout
            .intern_for_node(0, layout_style(break_before))
            .expect("style interns");
        FormattingTreeStyles {
            layout,
            inline: InlineStyleTable::new(0),
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
                layout: LayoutStyleTable::new(0),
                inline: InlineStyleTable::new(0),
            },
        )
        .is_err());
    }

    #[test]
    fn fingerprint_covers_style_table_content() {
        let first = FormattingTree::with_styles(
            vec![block_node()],
            FormattingNodeId(0),
            styles_with(PageBreak::Auto),
        )
        .expect("first tree builds");
        let second = FormattingTree::with_styles(
            vec![block_node()],
            FormattingNodeId(0),
            styles_with(PageBreak::Always),
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
            styles_with(PageBreak::Auto),
        )
        .expect("repeat tree builds");
        assert_eq!(first.fingerprint(), repeat.fingerprint());
    }
}
