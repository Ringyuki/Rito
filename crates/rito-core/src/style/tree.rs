use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::xhtml::SourceRef;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StyledNodeKind {
    Block,
    Inline,
    Text,
    Image,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyledNode {
    #[serde(rename = "type")]
    pub node_type: StyledNodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub src: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colspan: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rowspan: Option<u32>,
    pub style: Map<String, Value>,
    pub children: Vec<StyledNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_ref: Option<SourceRef>,
}

impl StyledNode {
    pub(crate) fn text(
        content: String,
        source_text: Option<String>,
        style: Map<String, Value>,
        source_ref: SourceRef,
    ) -> Self {
        Self {
            node_type: StyledNodeKind::Text,
            tag: None,
            content: Some(content),
            source_text,
            src: None,
            alt: None,
            id: None,
            href: None,
            colspan: None,
            rowspan: None,
            style,
            children: Vec::new(),
            source_ref: Some(source_ref),
        }
    }
}
