use crate::xhtml::{DocumentNode, ElementAttributes};

pub(super) fn footnote_content(nodes: &[DocumentNode]) -> (String, String) {
    (collect_text(nodes), serialize_html(nodes))
}

fn collect_text(nodes: &[DocumentNode]) -> String {
    let mut text = String::new();
    for node in nodes {
        match node {
            DocumentNode::Text(text_node) => text.push_str(&text_node.content),
            DocumentNode::Block(element) => push_block_text(&mut text, &element.children),
            DocumentNode::Inline(element) => text.push_str(&collect_text(&element.children)),
            DocumentNode::Image(_) => {}
        }
    }
    text.trim().to_owned()
}

fn push_block_text(text: &mut String, nodes: &[DocumentNode]) {
    let nested = collect_text(nodes);
    let nested = nested.trim();
    if nested.is_empty() {
        return;
    }
    if !text.is_empty() && !text.ends_with(' ') {
        text.push(' ');
    }
    text.push_str(nested);
}

fn serialize_html(nodes: &[DocumentNode]) -> String {
    nodes.iter().map(serialize_node_html).collect()
}

fn serialize_node_html(node: &DocumentNode) -> String {
    match node {
        DocumentNode::Text(text) => escape_html(&text.content),
        DocumentNode::Image(image) => {
            format!("<img{}>", serialize_attrs(image.attributes.as_ref()))
        }
        DocumentNode::Block(element) | DocumentNode::Inline(element) => format!(
            "<{}{}>{}</{}>",
            element.tag,
            serialize_attrs(element.attributes.as_ref()),
            serialize_html(&element.children),
            element.tag
        ),
    }
}

fn serialize_attrs(attributes: Option<&ElementAttributes>) -> String {
    let Some(all_attributes) = attributes.and_then(|attributes| attributes.all_attributes.as_ref())
    else {
        return String::new();
    };
    all_attributes
        .iter()
        .map(|(name, value)| format!(" {name}=\"{}\"", escape_attr(value)))
        .collect()
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_attr(value: &str) -> String {
    value.replace('&', "&amp;").replace('"', "&quot;")
}
