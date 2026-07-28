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
    /// Advance consumed by trailing whitespace, CSS px. Consumers that need
    /// the visible ink extent subtract this from the rect width, matching
    /// how CSS hangs whitespace at the end of a line.
    pub trailing_whitespace: f64,
    /// Text (and later inline-box) fragments in visual order.
    pub children: Vec<Fragment>,
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
