pub const NAME: &str = "css";
pub const OWNS: &str = "CSS tokenization, parsing, declarations, selectors, and supported syntax";

#[cfg(feature = "legacy-css-diagnostics")]
mod parser;
#[cfg(feature = "legacy-css-diagnostics")]
mod tokens;
#[cfg(feature = "legacy-css-diagnostics")]
mod values;

use std::collections::BTreeMap;

#[cfg(feature = "legacy-css-diagnostics")]
pub(crate) use parser::summarize_stylesheet_texts;
#[cfg(feature = "legacy-css-diagnostics")]
pub(crate) use parser::{parse_css_rules_with_root_font_size, CssRuleSummary};
use serde::{Deserialize, Serialize};
#[cfg(feature = "legacy-css-diagnostics")]
use serde_json::{Map, Value};

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CssViewport {
    pub width: f64,
    pub height: f64,
    pub device_pixel_ratio: f64,
    pub color_scheme: CssColorScheme,
}

impl CssViewport {
    pub(crate) fn new(width: f64, height: f64) -> Self {
        Self {
            width,
            height,
            device_pixel_ratio: 1.0,
            color_scheme: CssColorScheme::Light,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CssColorScheme {
    Light,
    #[cfg_attr(
        not(feature = "bench-internals"),
        expect(
            dead_code,
            reason = "production viewport construction is light-only; benchmark parity can supply dark"
        )
    )]
    Dark,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CssSummary {
    pub stylesheet_count: usize,
    pub stylesheets: Vec<CssStylesheetSummary>,
    pub full_detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CssStylesheetSummary {
    pub href: String,
    pub rule_count: usize,
    pub font_face_count: usize,
    pub declaration_key_counts: BTreeMap<String, usize>,
    pub selector_hash: String,
    pub raw_declarations_hash: String,
    pub declaration_value_hash: String,
    pub font_face_hash: String,
    pub detail_hash: String,
}

#[cfg(feature = "legacy-css-diagnostics")]
pub(crate) fn parse_css_rules(css: &str) -> Vec<CssRuleSummary> {
    parser::parse_css_rules(css)
}

#[cfg(feature = "legacy-css-diagnostics")]
pub(crate) fn parse_css_declarations_with_viewport(
    css: &str,
    parent_font_size: f64,
    root_font_size: f64,
    viewport: Option<CssViewport>,
) -> Map<String, Value> {
    values::parse_declarations_with_viewport(css, parent_font_size, root_font_size, viewport).values
}
