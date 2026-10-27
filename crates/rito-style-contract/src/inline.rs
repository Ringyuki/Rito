use crate::{
    BorderEdge, Direction, FontFamilies, FontSlant, FontWeight, InlineFragmentStyle,
    InlinePaintStyle, InlineTextFlow, LengthPercentageOrAuto, LineHeight, NonNegativeCssPx,
    NonNegativeLengthPercentage, UnicodeBidi, WritingMode,
};

/// Font selection and line-metric inputs for inline formatting.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct FontStyle {
    /// Ordered computed family fallback list.
    pub families: FontFamilies,
    /// Whether the computed family represents a platform system font.
    pub is_system_font: bool,
    /// Whether the family remains the engine's initial computed family.
    pub is_initial: bool,
    /// Computed font size in CSS pixels.
    pub size: NonNegativeCssPx,
    /// Computed numeric font weight.
    pub weight: FontWeight,
    /// Computed upright, italic, or angled-oblique slant.
    pub slant: FontSlant,
    /// Computed line-height without guessing `normal` font metrics.
    pub line_height: LineHeight,
    /// Whether `line-height` is declared for this element rather than
    /// inherited. Computed values cannot express this, and a consumer that
    /// stores line-height as an inheritable ratio needs it to reproduce the
    /// ancestor's ratio for a purely inherited length.
    pub line_height_is_declared: bool,
}

/// Directionality and writing-mode inputs kept separate from physical layout.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct InlineBidi {
    /// Base inline direction.
    pub direction: Direction,
    /// Unicode embedding, override, or isolation behavior.
    pub unicode_bidi: UnicodeBidi,
    /// Block/inline axis writing mode.
    pub writing_mode: WritingMode,
}

/// First versioned, engine-neutral inline formatting contract.
///
/// The five groups make ownership explicit while remaining one hashable unit
/// for deterministic interning. No group has an implicit default; producers
/// must project every included field they claim as exact or fail closed. This
/// V1 is a migration slice and does not by itself prove full CSS consumer
/// equivalence for properties not represented here.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct InlineFormattingStyle {
    /// Font selection and line metrics.
    pub font: FontStyle,
    /// Text transformation, spacing, and breaking behavior.
    pub text_flow: InlineTextFlow,
    /// Directionality and writing mode.
    pub bidi: InlineBidi,
    /// Inline fragment geometry.
    pub fragment: InlineFragmentStyle,
    /// Foreground, background, decoration, and shadow paint.
    pub paint: InlinePaintStyle,
}

/// An inline box's margin, border and padding at one end of its inline
/// axis: the start or end edge its content's lines begin or finish at.
#[derive(Clone, Copy, Debug)]
pub struct InlineEdge<'a> {
    /// The margin on that side.
    pub margin: &'a LengthPercentageOrAuto,
    /// The border on that side.
    pub border: &'a BorderEdge,
    /// The padding on that side.
    pub padding: &'a NonNegativeLengthPercentage,
}

impl InlineEdge<'_> {
    /// The edge's used size in CSS px, its percentages resolved against the
    /// containing block's inline size `basis`; `auto` margins are zero on an
    /// inline box. The margin and padding each land on the 1/64 px layout
    /// grid truncated toward zero, as Blink's `LayoutUnit(float)` takes a
    /// computed length; border widths are whole already.
    pub fn size(&self, basis: Option<f32>) -> f32 {
        let layout_unit = |px: f32| (px * 64.0).trunc() / 64.0;
        let margin = match self.margin {
            LengthPercentageOrAuto::Auto => 0.0,
            LengthPercentageOrAuto::Value(value) => layout_unit(value.resolve(basis)),
        };
        let padding = layout_unit(self.padding.value().resolve(basis).max(0.0));
        margin + self.border.resolved_width.get() + padding
    }

    /// Whether the edge takes no space at any containing block size.
    pub fn is_empty(&self) -> bool {
        let margin = match self.margin {
            LengthPercentageOrAuto::Auto => true,
            LengthPercentageOrAuto::Value(value) => value.is_zero(),
        };
        margin && self.border.resolved_width.get() == 0.0 && self.padding.value().is_zero()
    }
}

impl InlineFormattingStyle {
    /// The box's edge where its content's lines start (`end` false) or end:
    /// the left or right side in horizontal writing (swapped when lines run
    /// right to left), the top or bottom side in vertical writing.
    pub fn inline_edge(&self, end: bool) -> InlineEdge<'_> {
        let fragment = &self.fragment;
        let vertical = self.bidi.writing_mode != WritingMode::HorizontalTopToBottom;
        // Lines start on the low side of the inline axis (left, or top)
        // unless they run right to left.
        let low = (self.bidi.direction == Direction::LeftToRight) != end;
        let (margin, border, padding) = match (vertical, low) {
            (false, true) => (
                &fragment.margin.left,
                &fragment.border.left,
                &fragment.padding.left,
            ),
            (false, false) => (
                &fragment.margin.right,
                &fragment.border.right,
                &fragment.padding.right,
            ),
            (true, true) => (
                &fragment.margin.top,
                &fragment.border.top,
                &fragment.padding.top,
            ),
            (true, false) => (
                &fragment.margin.bottom,
                &fragment.border.bottom,
                &fragment.padding.bottom,
            ),
        };
        InlineEdge {
            margin,
            border,
            padding,
        }
    }
}
