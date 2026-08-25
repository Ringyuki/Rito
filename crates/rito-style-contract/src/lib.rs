//! Engine-neutral style values shared across Rito's style and consumer layers.
//!
//! This leaf crate contains only owned, typed contracts. It deliberately has
//! no dependency on a CSS engine, DOM implementation, source tree, layout
//! system, serializer, or platform API.
//!
//! `InlineFormattingStyleV1` is a versioned migration slice, not a claim that
//! every CSS property affecting shaping, layout, compositing, or painting is
//! already represented. Evidence must call its coverage “contract-slice
//! complete” unless a separate consumer-equivalence gate proves the omitted
//! properties are irrelevant or initial.

#![forbid(unsafe_code)]

/// Maximum entries accepted in any one bounded V1 list payload.
///
/// This resource guard intentionally fails closed on valid-but-hostile CSS;
/// callers can preserve the original engine value through a later contract
/// version instead of allocating an unbounded migration payload.
pub const INLINE_STYLE_LIST_ITEM_LIMIT_V1: usize = 256;

/// Maximum UTF-8 bytes retained for one resolved background-image URL.
///
/// Computed URLs are attacker-controlled publication input. V1 fails closed
/// above this limit instead of multiplying an unbounded string across style
/// projection, interning, and consumer payloads.
pub const RESOLVED_URL_BYTE_LIMIT_V1: usize = 64 * 1024;

mod color;
mod font;
mod fragment;
mod inline;
mod layout;
mod length;
mod paint;
mod scalar;
mod table;
mod text;
mod transform;

pub use color::{AbsoluteColor, AbsoluteColorSpace, ColorNoneFlags, ComputedColorV1};
pub use font::{
    FontFamilies, FontFamily, FontFamilyError, FontFamilyName, FontFamilyNameSyntax,
    FontObliqueAngle, FontSlant, FontWeight, GenericFontFamily, LineHeight,
};
pub use fragment::{
    AlignmentBaseline, BaselineShift, BaselineSource, BorderRadii, CornerRadius,
    InlineFragmentStyleV1, PhysicalSides,
};
pub use inline::{FontStyleV1, InlineBidiV1, InlineFormattingStyleV1};
pub use layout::{
    AlignItemsV1, BoxSizingV1, CellVerticalAlignV1, ClearV1, FloatV1, JustifyContentV1,
    LayoutDisplayInsideV1, LayoutDisplayOutsideV1, LayoutDisplayV1, LayoutFormattingStyleV1,
    LayoutStyleId, LayoutStyleTableError, LayoutStyleTableV1, ListMarkerStyleV1, MaximumHeightV1,
    MaximumSizeV1, MinimumHeightV1, ObjectFitV1, OverflowV1, PageBreakV1, PositionV1,
    PreferredSizeV1,
};
pub use length::{LengthPercentage, LengthPercentageOrAuto, NonNegativeLengthPercentage};
pub use paint::{
    BackgroundImagePaintV1, BackgroundImagePositionV1, BackgroundImageRepeatV1,
    BackgroundImageSizeV1, BackgroundSizeAxisV1, BorderEdge, BorderEdges, BorderStyle, BoxShadow,
    InlinePaintStyleV1, ResolvedUrlErrorV1, ResolvedUrlV1, TextDecoration, TextDecorationLines,
    TextDecorationStyle, TextShadow,
};
pub use scalar::{
    AngleDegrees, CssPx, FiniteF32, NonNegativeCssPx, NonNegativeNumber, NumericError, Percentage,
    UnitInterval,
};
pub use table::{InlineStyleTableV1, StyleId, StyleTableError};
pub use text::{
    Direction, InlineTextFlowV1, LanguageTag, LineBreak, OverflowWrap, RubyAlign, TextAlign,
    TextIndent, TextJustify, TextTransform, TextTransformCase, TextWrapMode, UnicodeBidi,
    WhiteSpaceCollapse, WordBreak, WritingMode,
};
pub use transform::{TransformListErrorV1, TransformListV1, TransformOperationV1};
