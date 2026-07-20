use crate::{
    Direction, FontFamilies, FontSlant, FontWeight, InlineFragmentStyleV1, InlinePaintStyleV1,
    InlineTextFlowV1, LineHeight, NonNegativeCssPx, UnicodeBidi, WritingMode,
};

/// Font selection and line-metric inputs for inline formatting.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct FontStyleV1 {
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
}

/// Directionality and writing-mode inputs kept separate from physical layout.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct InlineBidiV1 {
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
pub struct InlineFormattingStyleV1 {
    /// Font selection and line metrics.
    pub font: FontStyleV1,
    /// Text transformation, spacing, and breaking behavior.
    pub text_flow: InlineTextFlowV1,
    /// Directionality and writing mode.
    pub bidi: InlineBidiV1,
    /// Inline fragment geometry.
    pub fragment: InlineFragmentStyleV1,
    /// Foreground, background, decoration, and shadow paint.
    pub paint: InlinePaintStyleV1,
}
