pub const NAME: &str = "xhtml";
pub const OWNS: &str = "XHTML parsing, source tree, source spans, and document semantics";

mod parser;

use std::collections::BTreeMap;

pub use parser::parse_xhtml;
pub(crate) use parser::summarize_parsed_chapters;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterSource {
    pub idref: String,
    pub href: String,
    pub linear: bool,
    pub text_length: usize,
    pub text_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XhtmlSummary {
    pub chapter_count: usize,
    pub chapters: Vec<XhtmlChapterSummary>,
    pub full_detail_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XhtmlChapterSummary {
    pub idref: String,
    pub href: String,
    pub attribute_counts: BTreeMap<String, usize>,
    pub body_attributes: Option<ElementAttributes>,
    pub counts: XhtmlNodeCounts,
    pub first_text: String,
    pub image_sources: Vec<String>,
    pub last_text: String,
    pub max_depth: usize,
    pub stylesheet_hrefs: Option<Vec<String>>,
    pub embedded_stylesheets: Option<Vec<String>>,
    pub tag_counts: BTreeMap<String, usize>,
    pub text_hash: String,
    pub top_level_count: usize,
    pub warning_count: usize,
    pub warnings_hash: String,
    pub detail_hash: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XhtmlNodeCounts {
    pub block: usize,
    pub image: usize,
    pub inline: usize,
    pub text: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementAttributes {
    pub all_attributes: Option<BTreeMap<String, String>>,
    pub class: Option<String>,
    pub colspan: Option<u32>,
    pub href: Option<String>,
    pub id: Option<String>,
    pub language: Option<String>,
    pub rowspan: Option<u32>,
    pub style: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseResult {
    pub nodes: Vec<DocumentNode>,
    pub warnings: Vec<String>,
    pub body_attributes: Option<ElementAttributes>,
    pub stylesheet_hrefs: Option<Vec<String>>,
    pub embedded_stylesheets: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocumentNode {
    Block(ElementNode),
    Inline(ElementNode),
    Text(TextNode),
    Image(ImageNode),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ElementNode {
    pub tag: String,
    pub attributes: Option<ElementAttributes>,
    pub children: Vec<DocumentNode>,
    pub source_ref: SourceRef,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextNode {
    pub content: String,
    pub source_ref: SourceRef,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageNode {
    pub src: String,
    pub alt: String,
    pub attributes: Option<ElementAttributes>,
    pub source_ref: SourceRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceRef {
    pub node_path: Vec<usize>,
}
