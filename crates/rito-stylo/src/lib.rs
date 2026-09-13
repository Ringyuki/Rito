//! Rito's private adapter over the Stylo CSS engine.
//!
//! `rito-core` hands this crate a parsed chapter (a `rito-source` arena) with
//! its stylesheets and gets back the two typed style tables the fragment
//! engine reads (`rito-style-contract`):
//! [`StyleDocument::resolve_production_slice`] runs the cascade once and
//! projects every element into an inline-formatting style and a layout
//! style. Around that one path the crate provides:
//!
//! - [`parse_font_faces`], which extracts `@font-face` rules from
//!   stylesheets with Stylo's own parser;
//! - [`epub_ua_stylesheet`], the user-agent stylesheet that supplies the HTML
//!   box-generation and typography defaults publication content assumes;
//! - [`css_defines_property`], which tells the source gate whether a
//!   declaration's property name exists in CSS at all;
//! - [`canonicalize_font_family_value`], which re-serializes a reader-supplied
//!   `font-family` value through Stylo's grammar before it is embedded in an
//!   internal stylesheet.
//!
//! Stylo types never cross this crate's boundary: every public input and
//! output is a Rito-owned type, and `rito-core` does not re-export this crate.

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

pub use font_faces::{parse_font_faces, FontFaceRule, FontFaceStylesheetInput};
pub use projection::{
    InlineStyleDisposition, InlineStyleField, InlineStyleProjection, InlineStyleProjectionReason,
    LayoutStyleDisposition, LayoutStyleField, LayoutStyleProjection, LayoutStyleProjectionReason,
    ProductionStyleProjection,
};
pub use session::{
    canonicalize_font_family_value, ColorScheme, StyleDocument, StyleError, StyleOrigin,
    StylesheetInput, Viewport,
};
pub use ua::epub_ua_stylesheet;

/// Reports whether CSS itself defines this property name.
///
/// Publications carry author typos (`boder`), tool-injected custom properties,
/// and unknown vendor prefixes. Browsers drop such declarations and keep the
/// rest of the rule, so a source gate must not treat them as unrepresentable
/// content — only a property CSS *does* define can be a real capability gap.
pub fn css_defines_property(name: &str) -> bool {
    style::properties::PropertyId::parse_enabled_for_all_content(name).is_ok()
}
