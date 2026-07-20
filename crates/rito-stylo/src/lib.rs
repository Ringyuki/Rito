//! Private direct Stylo integration boundary for Rito.
//!
//! This crate is deliberately not re-exported from `rito-core`. Its public
//! items are a crate-to-crate facade and never become part of Rito's JS or
//! Rust consumer API. Stylo types are confined to private modules.

#![deny(unsafe_code)]
#![deny(unsafe_op_in_unsafe_fn)]

mod break_properties;
mod config;
mod device;
mod dom;
mod font_faces;
mod presentational_hints;
mod projection;
mod session;
mod traversal;
mod ua;

pub use font_faces::{parse_font_faces_v1, FontFaceRuleV1, FontFaceStylesheetInputV1};
pub use presentational_hints::supports_body_bgcolor_presentational_hint;
pub use projection::{
    BoxSizingV2, ComputedDisplayV1, ComputedElementStyleV0, ComputedElementStyleV1,
    ComputedElementStyleV2, ComputedLineHeightV1, DirectionV2, DisplayCategory, DisplayInsideV1,
    DisplayOutsideV1, FontStyleV2, InlineStyleDispositionV1, InlineStyleFieldV1,
    InlineStyleProjectionReasonV1, InlineStyleProjectionV1, LayoutStyleDispositionV1,
    LayoutStyleFieldV1, LayoutStyleProjectionReasonV1, LayoutStyleProjectionV1, LineBreakV2,
    OverflowWrapV2, ProductionStyleProjectionV1, ResolvedStylesV0, ResolvedStylesV1,
    ResolvedStylesV2, SrgbaV1, TextAlignV2, TextJustifyV2, TextTransformCaseV2, TextTransformV2,
    TextWrapModeV2, UnicodeBidiV2, WhiteSpaceCollapseV2, WordBreakV2, WritingModeV2,
};
pub use session::{
    canonicalize_font_family_value, ColorScheme, StyleDocument, StyleError, StyleOrigin,
    StylesheetInput, Viewport,
};
pub use ua::{epub_ua_stylesheet, EPUB_UA_PROFILE_ID};

/// Exact upstream engine version compiled into this adapter.
pub const STYLO_VERSION: &str = "0.19.0";
