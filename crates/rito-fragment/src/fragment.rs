use crate::formatting_tree::FormattingNodeId;

/// Physical rectangle in CSS px, relative to the containing fragment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FragmentRect {
    /// Inline-axis offset.
    pub x: f64,
    /// Block-axis offset.
    pub y: f64,
    /// Inline-axis extent.
    pub width: f64,
    /// Block-axis extent.
    pub height: f64,
}

/// One immutable box fragment.
#[derive(Clone, Debug, PartialEq)]
pub struct BoxFragment {
    /// The formatting node this fragment materializes (a node split across
    /// fragmentainers produces several fragments with the same source).
    pub source: FormattingNodeId,
    /// Border-box rectangle relative to the parent fragment.
    pub rect: FragmentRect,
    /// Child fragments in paint order.
    pub children: Vec<Fragment>,
}

/// One line box produced by an inline formatting context.
#[derive(Clone, Debug, PartialEq)]
pub struct LineFragment {
    /// The inline-flow node this line belongs to.
    pub source: FormattingNodeId,
    /// Line box rectangle relative to the parent fragment. The width is the
    /// full advance including trailing whitespace.
    pub rect: FragmentRect,
    /// Baseline offset from the line box top, CSS px.
    pub baseline: f64,
    /// Outside list marker (a disc) anchored to this line, in
    /// line-relative coordinates. Only the first line of a
    /// `display: list-item` flow carries one; the painter fills it with
    /// the line's text color.
    pub marker: Option<MarkerFragment>,
    /// Advance consumed by trailing whitespace, CSS px. Consumers that need
    /// the visible ink extent subtract this from the rect width, matching
    /// how CSS hangs whitespace at the end of a line.
    pub trailing_whitespace: f64,
    /// The ruby-annotation reserve folded into `baseline`. The paint
    /// snap treats this share separately — the annotation reserves whole
    /// device rows (ceil) while the strut part keeps the two-stage
    /// round. Zero on lines without ruby growth.
    pub ruby_growth: f64,
    /// Text (and later inline-box) fragments in visual order.
    pub children: Vec<Fragment>,
}

/// An outside list-item marker: a filled disc whose geometry Blink derives
/// from the list item's primary font (measured 2026-07-28, two faces and
/// four sizes): diameter = ascent / 3, horizontally the disc's right edge
/// sits `7px` (Chromium's marker padding) before the content edge, and its
/// vertical center rides half the x-height above the first line's baseline.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MarkerFragment {
    /// Disc left edge, relative to the line box origin.
    pub x: f64,
    /// Disc top edge, relative to the line box origin.
    pub y: f64,
    pub diameter: f64,
}

/// One run of laid-out text inside a line.
#[derive(Clone, Debug, PartialEq)]
pub struct TextFragment {
    /// The inline-flow node the text belongs to.
    pub source: FormattingNodeId,
    /// Rectangle relative to the parent line fragment.
    pub rect: FragmentRect,
    /// Start byte offset into the inline flow's concatenated item text.
    pub text_start: u32,
    /// End byte offset (exclusive) into the concatenated item text.
    pub text_end: u32,
    /// Extra per-cluster justification spacing, painted as additional
    /// letter spacing. The rect already sits at its justified position;
    /// this spreads the run's own characters apart.
    pub justify_px: f64,
    /// The `ruby-align: space-around` interior gap a wide annotation
    /// opened between this run's clusters, painted as additional letter
    /// spacing like `justify_px`. Kept separate because the annotation
    /// extent derives from it (one gap of widening, half overhanging
    /// each side) while justification spacing never widens the
    /// annotation.
    pub ruby_gap_px: f64,
    /// The overhang each side of a spread ruby's annotation box: the
    /// edge share, capped at half the annotation size. The annotation
    /// rect widens by one overhang per side; `ruby_gap_px` spaces the
    /// base clusters.
    pub ruby_overhang_px: f64,
    /// A pair-trimmed opener's removed blank LEFT half (half its font
    /// size), zero otherwise. Layout shaped the run with the `halt`
    /// half-width variant, but the painter draws the untrimmed glyph —
    /// whose outline sits one blank half further right — so it must
    /// shift the draw origin left by this amount for the ink to land
    /// where the halt variant puts it.
    pub opener_trim_px: f64,
    /// Raster anchoring for a run inside a decorated inline box, absent
    /// for bare text (which snaps off the line box alone).
    pub box_snap: Option<BoxSnap>,
    /// Raster anchoring for this run's ruby annotation, when it has one:
    /// the annotation is its own line box and rounds to a device row
    /// independently of the base line's snap.
    pub ruby_annotation_snap: Option<RubyAnnotationSnap>,
}

/// The ruby annotation's line-box geometry, in LINE-relative layout
/// coordinates. The painter rounds the physical line-box top to a device
/// row and hangs the glyphs at the half-leading below, mirroring how the
/// browser rasters the annotation as its own line (measured on the
/// dual-pipeline ruby probe: painted annotation row = round(annotation
/// line-box top) at every phase, where the base-anchored convention sat
/// one row high on half of them).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RubyAnnotationSnap {
    /// Line-relative layout top of the annotation's line box.
    pub line_top: f64,
    /// Half-leading between the annotation's line box and its glyph em
    /// box; the glyph top anchor sits this far below the rounded row.
    pub leading: f64,
}

/// The vertical anchor a decorated inline box gives the runs inside it.
///
/// The browser paints a bordered or padded span as its own snapped box:
/// the box's absolute top rounds to a device row, the top border+padding
/// rounds on top of that, and the run's baseline sits one integer ascent
/// below — so two runs sharing one layout baseline can raster one row
/// apart when their boxes round differently (measured on the summary
/// page's 22px/24px bordered spans: layout baseline 309.5625 painted at
/// 309 and 310).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BoxSnap {
    /// The primary font's grid-fit (integer) ascent at the run's size.
    pub int_ascent: f64,
    /// The primary font's grid-fit (integer) descent at the run's size.
    pub int_descent: f64,
    /// Top border width plus LayoutUnit-quantized top padding.
    pub edge_top: f64,
    /// Bottom border width plus LayoutUnit-quantized bottom padding.
    pub edge_bottom: f64,
}

/// One laid-out atomic inline (an image) inside a line.
#[derive(Clone, Debug, PartialEq)]
pub struct ImageFragment {
    /// The inline-flow node the image belongs to.
    pub source: FormattingNodeId,
    /// Rectangle relative to the parent line fragment.
    pub rect: FragmentRect,
    /// Index of the [`crate::InlineItem::Image`] in the source flow's items.
    pub item_index: u32,
}

/// A fragment tree node.
#[derive(Clone, Debug, PartialEq)]
pub enum Fragment {
    /// A block-level box fragment.
    Box(BoxFragment),
    /// A line box from an inline formatting context.
    Line(LineFragment),
    /// A text run inside a line box.
    Text(TextFragment),
    /// An atomic inline image inside a line box.
    Image(ImageFragment),
}

impl Fragment {
    /// The materialized source node.
    pub fn source(&self) -> FormattingNodeId {
        match self {
            Self::Box(fragment) => fragment.source,
            Self::Line(fragment) => fragment.source,
            Self::Text(fragment) => fragment.source,
            Self::Image(fragment) => fragment.source,
        }
    }

    /// Border-box rectangle relative to the parent fragment.
    pub fn rect(&self) -> FragmentRect {
        match self {
            Self::Box(fragment) => fragment.rect,
            Self::Line(fragment) => fragment.rect,
            Self::Text(fragment) => fragment.rect,
            Self::Image(fragment) => fragment.rect,
        }
    }
}

/// The immutable output of one formatting-context invocation: the fragments
/// that fit the given constraint space, sealed and never mutated afterwards.
#[derive(Clone, Debug, PartialEq)]
pub struct FragmentTree {
    /// Root fragment of this invocation.
    pub root: Fragment,
}
