use crate::{
    normalizer::normalize_xhtml_source,
    tree::{map_parse_error, validate_source_depth},
    SourceError, MAX_SOURCE_NODES,
};

const EPUB_OPS_NAMESPACE: &str = "http://www.idpf.org/2007/ops";

/// Borrowed, source-order attributes needed by Rito's lightweight EPUB
/// semantic scans. Values point into one normalized XHTML source and are only
/// valid for the duration of the visitor call.
#[derive(Clone, Copy, Debug)]
pub struct XhtmlSemanticElement<'a> {
    pub node_index: usize,
    pub parent_element_index: Option<usize>,
    pub local_name: &'a str,
    pub epub_type: Option<&'a str>,
    pub href: Option<&'a str>,
    pub id: Option<&'a str>,
}

/// Visits source XML elements without constructing [`crate::SourceArena`] or
/// a layout-oriented semantic tree.
///
/// The scan shares the canonical XHTML normalizer, depth limit, strict XML
/// parser, and node limit used by `SourceArena::from_xhtml`. `roxmltree` keeps
/// only a borrowed XML index for this call; no text or attribute strings are
/// copied. Callers should retain only the rare attributes they actually need.
pub fn visit_xhtml_semantic_elements(
    source: &str,
    mut visit: impl FnMut(XhtmlSemanticElement<'_>),
) -> Result<(), SourceError> {
    let normalized = normalize_xhtml_source(source);
    validate_source_depth(normalized.as_ref())?;
    let document = roxmltree::Document::parse_with_options(
        normalized.as_ref(),
        roxmltree::ParsingOptions {
            allow_dtd: false,
            nodes_limit: MAX_SOURCE_NODES,
        },
    )
    .map_err(map_parse_error)?;

    for node in document
        .root()
        .descendants()
        .filter(|node| node.is_element())
    {
        visit(XhtmlSemanticElement {
            node_index: node.id().get_usize(),
            parent_element_index: node.parent_element().map(|parent| parent.id().get_usize()),
            local_name: node.tag_name().name(),
            epub_type: node.attribute((EPUB_OPS_NAMESPACE, "type")),
            href: node.attribute("href"),
            id: node.attribute("id"),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{visit_xhtml_semantic_elements, XhtmlSemanticElement};

    #[test]
    fn visits_normalized_legacy_xhtml_with_resolved_epub_attributes() {
        let mut elements = Vec::new();
        visit_xhtml_semantic_elements(
            r##"<!DOCTYPE html><html xmlns:ops="http://www.idpf.org/2007/ops"><body><br><a ops:type="noteref" href="#n">1</a></body></html>"##,
            |element: XhtmlSemanticElement<'_>| {
                elements.push((
                    element.local_name.to_owned(),
                    element.epub_type.map(ToOwned::to_owned),
                    element.href.map(ToOwned::to_owned),
                ));
            },
        )
        .expect("legacy XHTML is normalized before scanning");

        assert_eq!(
            elements.last(),
            Some(&(
                "a".to_owned(),
                Some("noteref".to_owned()),
                Some("#n".to_owned())
            ))
        );
    }
}
