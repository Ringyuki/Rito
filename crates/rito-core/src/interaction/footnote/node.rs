use crate::xhtml::{DocumentNode, ElementAttributes, ElementNode};

use super::FootnoteKind;

pub(super) fn is_noteref(node: &DocumentNode) -> bool {
    matches!(node, DocumentNode::Block(_) | DocumentNode::Inline(_))
        && has_epub_type(node, |token| token == "noteref")
}

pub(super) fn footnote_kind(node: &DocumentNode) -> Option<FootnoteKind> {
    if !matches!(node, DocumentNode::Block(_)) {
        return None;
    }
    element_attributes(node)
        .and_then(|attributes| attributes.all_attributes.as_ref())
        .and_then(|attributes| attributes.get("epub:type"))
        .and_then(|value| value.split_whitespace().find_map(parse_footnote_kind))
}

pub(super) fn element_attributes(node: &DocumentNode) -> Option<&ElementAttributes> {
    match node {
        DocumentNode::Block(element) | DocumentNode::Inline(element) => element.attributes.as_ref(),
        DocumentNode::Image(image) => image.attributes.as_ref(),
        DocumentNode::Text(_) => None,
    }
}

pub(super) fn children(node: &DocumentNode) -> Option<&[DocumentNode]> {
    match node {
        DocumentNode::Block(ElementNode { children, .. })
        | DocumentNode::Inline(ElementNode { children, .. }) => Some(children),
        DocumentNode::Image(_) | DocumentNode::Text(_) => None,
    }
}

fn has_epub_type(node: &DocumentNode, predicate: impl Fn(&str) -> bool) -> bool {
    element_attributes(node)
        .and_then(|attributes| attributes.all_attributes.as_ref())
        .and_then(|attributes| attributes.get("epub:type"))
        .is_some_and(|value| value.split_whitespace().any(predicate))
}

pub(super) fn parse_footnote_kind(token: &str) -> Option<FootnoteKind> {
    match token {
        "footnote" => Some(FootnoteKind::Footnote),
        "endnote" => Some(FootnoteKind::Endnote),
        "rearnote" => Some(FootnoteKind::Rearnote),
        "note" => Some(FootnoteKind::Note),
        _ => None,
    }
}
