pub const NAME: &str = "css";
pub const OWNS: &str = "CSS tokenization, parsing, declarations, selectors, and supported syntax";

mod parser;
mod tokens;
mod values;

use std::collections::BTreeMap;

pub(crate) use parser::{parse_css_rules_with_root_font_size, CssRuleSummary};
pub(crate) use parser::{parse_font_face_rules, summarize_stylesheet_texts};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CssViewport {
    pub width: f64,
    pub height: f64,
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

pub(crate) fn parse_css_rules(css: &str) -> Vec<CssRuleSummary> {
    parser::parse_css_rules(css)
}

pub(crate) fn parse_css_declarations_with_viewport(
    css: &str,
    parent_font_size: f64,
    root_font_size: f64,
    viewport: Option<CssViewport>,
) -> Map<String, Value> {
    values::parse_declarations_with_viewport(css, parent_font_size, root_font_size, viewport).values
}
