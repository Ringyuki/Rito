use serde::{Deserialize, Serialize};

use crate::{
    epub::{EpubError, EpubResult},
    layout::{build_page_semantic_tree, LayoutSemanticNode, LayoutSemanticRole},
};

use super::{navigation::spread_index_for_page, RuntimeRevision};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeSemanticRole {
    Heading,
    Paragraph,
    List,
    ListItem,
    Image,
    Link,
    Blockquote,
    Table,
    Generic,
}

/// Bounds in page-content coordinates after retained layout transforms and
/// clipping. Reader margins and spread placement are deliberately excluded.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSemanticBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSemanticNode {
    pub role: RuntimeSemanticRole,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<u8>,
    /// Direct text aggregate for leaf/fallback consumers. When `children` is
    /// non-empty, consumers should render the children instead of repeating
    /// this aggregate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// `Some("")` is retained so decorative images remain distinguishable
    /// from images whose alternative text is unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    /// Original EPUB href. URL safety policy belongs to the host DOM adapter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    pub bounds: RuntimeSemanticBounds,
    pub children: Vec<RuntimeSemanticNode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePageSemantics {
    pub revision_id: String,
    pub page_index: usize,
    pub spread_index: usize,
    pub nodes: Vec<RuntimeSemanticNode>,
}

pub(super) fn page_semantics(
    revision_id: &str,
    revision: &RuntimeRevision,
    page_index: usize,
) -> EpubResult<RuntimePageSemantics> {
    if page_index >= revision.known_extent.page_count {
        return Err(EpubError::new(format!("unknown page index: {page_index}")));
    }
    let page = revision
        .layout
        .pages
        .get(page_index)
        .ok_or_else(|| EpubError::new(format!("unknown page index: {page_index}")))?;
    Ok(RuntimePageSemantics {
        revision_id: revision_id.to_owned(),
        page_index,
        spread_index: spread_index_for_page(revision, page_index),
        nodes: build_page_semantic_tree(page)
            .into_iter()
            .map(runtime_node)
            .collect(),
    })
}

fn runtime_node(node: LayoutSemanticNode) -> RuntimeSemanticNode {
    RuntimeSemanticNode {
        role: runtime_role(node.role),
        level: node.level,
        text: node.text,
        alt: node.alt,
        href: node.href,
        bounds: RuntimeSemanticBounds {
            x: node.bounds.x,
            y: node.bounds.y,
            width: node.bounds.width,
            height: node.bounds.height,
        },
        children: node.children.into_iter().map(runtime_node).collect(),
    }
}

fn runtime_role(role: LayoutSemanticRole) -> RuntimeSemanticRole {
    match role {
        LayoutSemanticRole::Heading => RuntimeSemanticRole::Heading,
        LayoutSemanticRole::Paragraph => RuntimeSemanticRole::Paragraph,
        LayoutSemanticRole::List => RuntimeSemanticRole::List,
        LayoutSemanticRole::ListItem => RuntimeSemanticRole::ListItem,
        LayoutSemanticRole::Image => RuntimeSemanticRole::Image,
        LayoutSemanticRole::Link => RuntimeSemanticRole::Link,
        LayoutSemanticRole::Blockquote => RuntimeSemanticRole::Blockquote,
        LayoutSemanticRole::Table => RuntimeSemanticRole::Table,
        LayoutSemanticRole::Generic => RuntimeSemanticRole::Generic,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        RuntimePageSemantics, RuntimeSemanticBounds, RuntimeSemanticNode, RuntimeSemanticRole,
    };

    #[test]
    fn page_semantics_use_a_narrow_camel_case_wire_shape() {
        let response = RuntimePageSemantics {
            revision_id: "rev-7".to_owned(),
            page_index: 2,
            spread_index: 1,
            nodes: vec![RuntimeSemanticNode {
                role: RuntimeSemanticRole::ListItem,
                level: None,
                text: Some("Item".to_owned()),
                alt: None,
                href: None,
                bounds: RuntimeSemanticBounds {
                    x: 1.0,
                    y: 2.0,
                    width: 3.0,
                    height: 4.0,
                },
                children: Vec::new(),
            }],
        };

        assert_eq!(
            serde_json::to_value(response).expect("page semantics serialize"),
            json!({
                "revisionId": "rev-7",
                "pageIndex": 2,
                "spreadIndex": 1,
                "nodes": [{
                "role": "listitem",
                "text": "Item",
                "bounds": { "x": 1.0, "y": 2.0, "width": 3.0, "height": 4.0 },
                    "children": [],
                }],
            })
        );
    }
}
