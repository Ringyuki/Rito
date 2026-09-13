//! Engine-neutral style values shared across Rito's style and consumer layers.
//!
//! This leaf crate contains only owned, typed contracts. It deliberately has
//! no dependency on a CSS engine, DOM implementation, source tree, layout
//! system, serializer, or platform API.
//!
//! `InlineFormattingStyle` is a versioned migration slice, not a claim that
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
pub const INLINE_STYLE_LIST_ITEM_LIMIT: usize = 256;

/// Maximum UTF-8 bytes retained for one resolved background-image URL.
///
/// Computed URLs are attacker-controlled publication input. V1 fails closed
/// above this limit instead of multiplying an unbounded string across style
/// projection, interning, and consumer payloads.
pub const RESOLVED_URL_BYTE_LIMIT: usize = 64 * 1024;

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

pub use color::{AbsoluteColor, AbsoluteColorSpace, ColorNoneFlags, ComputedColor};
pub use font::{
    FontFamilies, FontFamily, FontFamilyError, FontFamilyName, FontFamilyNameSyntax,
    FontObliqueAngle, FontSlant, FontWeight, GenericFontFamily, LineHeight,
};
pub use fragment::{
    AlignmentBaseline, BaselineShift, BaselineSource, BorderRadii, CornerRadius,
    InlineFragmentStyle, PhysicalSides,
};
pub use inline::{FontStyle, InlineBidi, InlineFormattingStyle};
pub use layout::{
    AlignItems, BoxSizing, CellVerticalAlign, Clear, Float, JustifyContent, LayoutDisplay,
    LayoutDisplayInside, LayoutDisplayOutside, LayoutFormattingStyle, LayoutStyleId,
    LayoutStyleTable, LayoutStyleTableError, ListMarkerStyle, MaximumHeight, MaximumSize,
    MinimumHeight, ObjectFit, Overflow, PageBreak, Position, PreferredSize,
};
pub use length::{LengthPercentage, LengthPercentageOrAuto, NonNegativeLengthPercentage};
pub use paint::{
    BackgroundImagePaint, BackgroundImagePosition, BackgroundImageRepeat, BackgroundImageSize,
    BackgroundSizeAxis, BorderEdge, BorderEdges, BorderStyle, BoxShadow, InlinePaintStyle,
    ResolvedUrl, ResolvedUrlError, TextDecoration, TextDecorationLines, TextDecorationStyle,
    TextShadow,
};
pub use scalar::{
    AngleDegrees, CssPx, FiniteF32, NonNegativeCssPx, NonNegativeNumber, NumericError, Percentage,
    UnitInterval,
};
pub use table::{InlineStyleTable, StyleId, StyleTableError};
pub use text::{
    Direction, InlineTextFlow, LanguageTag, LineBreak, OverflowWrap, RubyAlign, TextAlign,
    TextIndent, TextJustify, TextTransform, TextTransformCase, TextWrapMode, UnicodeBidi,
    WhiteSpaceCollapse, WordBreak, WritingMode,
};
pub use transform::{TransformList, TransformListError, TransformOperation};
