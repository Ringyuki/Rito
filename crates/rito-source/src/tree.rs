use crate::{normalizer::normalize_xhtml_source, SourceError};

/// Maximum number of parser nodes accepted from one XHTML source.
pub const MAX_SOURCE_NODES: u32 = 1_000_000;

/// Maximum element nesting accepted before invoking the recursive XML parser.
pub const MAX_SOURCE_DEPTH: usize = 128;

/// Stable index into one [`SourceArena`].
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct NodeId(u32);

impl NodeId {
    /// Returns the dense arena index represented by this identifier.
    pub const fn index(self) -> usize {
        self.0 as usize
    }
}

/// Namespace-aware XML qualified name.
///
/// Prefix spelling is intentionally omitted. XML and selector semantics use
/// the resolved namespace URI plus local name.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QName {
    pub namespace: Option<String>,
    pub local_name: String,
}

impl QName {
    pub fn matches(&self, namespace: Option<&str>, local_name: &str) -> bool {
        self.namespace.as_deref() == namespace && self.local_name == local_name
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceAttribute {
    pub name: QName,
    pub value: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceElement {
    pub name: QName,
    pub attributes: Box<[SourceAttribute]>,
}

impl SourceElement {
    /// Finds an attribute by resolved namespace and local name.
    pub fn attribute_ns(&self, namespace: Option<&str>, local_name: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|attribute| attribute.name.matches(namespace, local_name))
            .map(|attribute| attribute.value.as_str())
    }

    /// Finds an unnamespaced attribute by local name.
    pub fn attribute(&self, local_name: &str) -> Option<&str> {
        self.attribute_ns(None, local_name)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SourceNodeKind {
    Document,
    Element(SourceElement),
    Text(String),
}

/// Immutable node data stored inside a [`SourceArena`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceNode {
    pub kind: SourceNodeKind,
    pub parent: Option<NodeId>,
    pub first_child: Option<NodeId>,
    pub last_child: Option<NodeId>,
    pub previous_sibling: Option<NodeId>,
    pub next_sibling: Option<NodeId>,
}

impl SourceNode {
    pub fn as_element(&self) -> Option<&SourceElement> {
        match &self.kind {
            SourceNodeKind::Element(element) => Some(element),
            SourceNodeKind::Document | SourceNodeKind::Text(_) => None,
        }
    }

    pub fn as_text(&self) -> Option<&str> {
        match &self.kind {
            SourceNodeKind::Text(text) => Some(text),
            SourceNodeKind::Document | SourceNodeKind::Element(_) => None,
        }
    }
}

/// Lossless element/text-order, namespace-aware, immutable XML source tree.
///
/// Comments and processing instructions are omitted because CSS selectors
/// neither match them nor count them for `:empty`. Element and text order,
/// whitespace text, resolved namespaces, and attributes are otherwise
/// preserved. Document-type declarations are removed and DTD-defined entity
/// references are rejected before tree construction. This type intentionally
/// does not implement `Clone`; share it with `Arc<SourceArena>` when multiple
/// subsystems need the same node identity.
#[derive(Debug, Eq, PartialEq)]
pub struct SourceArena {
    nodes: Box<[SourceNode]>,
    document: NodeId,
    root: NodeId,
}

impl SourceArena {
    /// Normalizes the legacy EPUB syntax supported by Rito, removes document
    /// type declarations, then strictly parses one bounded XML/XHTML source.
    /// DTD entity expansion is disabled.
    pub fn from_xhtml(source: &str) -> Result<Self, SourceError> {
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
        Self::build(&document)
    }

    fn build(document: &roxmltree::Document<'_>) -> Result<Self, SourceError> {
        let mut builder = SourceBuilder::new(MAX_SOURCE_NODES);
        let document_id = builder.push(SourceNodeKind::Document, None)?;
        let root = builder.append_xml_element(document.root_element(), document_id)?;
        Ok(Self {
            nodes: builder.nodes.into_boxed_slice(),
            document: document_id,
            root,
        })
    }

    pub const fn document(&self) -> NodeId {
        self.document
    }

    pub const fn root(&self) -> NodeId {
        self.root
    }

    pub const fn root_element(&self) -> NodeId {
        self.root
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    pub fn node(&self, id: NodeId) -> Option<&SourceNode> {
        self.nodes.get(id.index())
    }

    pub fn iter(&self) -> impl ExactSizeIterator<Item = (NodeId, &SourceNode)> {
        self.nodes.iter().enumerate().map(|(index, node)| {
            (
                NodeId(u32::try_from(index).expect("source size was validated while building")),
                node,
            )
        })
    }

    pub fn children(&self, parent: NodeId) -> Children<'_> {
        Children {
            arena: self,
            next: self.node(parent).and_then(|node| node.first_child),
        }
    }

    /// Iterates descendants in document order, excluding `root` itself.
    pub fn descendants(&self, root: NodeId) -> Descendants<'_> {
        Descendants {
            arena: self,
            root,
            next: self.node(root).and_then(|node| node.first_child),
        }
    }

    pub fn find_element_by_id(&self, expected: &str) -> Option<NodeId> {
        self.iter().find_map(|(id, node)| {
            let element = node.as_element()?;
            element
                .attributes
                .iter()
                .any(|attribute| {
                    (attribute.name.namespace.is_none()
                        || attribute.name.namespace.as_deref()
                            == Some("http://www.w3.org/XML/1998/namespace"))
                        && attribute.name.local_name == "id"
                        && attribute.value == expected
                })
                .then_some(id)
        })
    }
}

pub struct Children<'a> {
    arena: &'a SourceArena,
    next: Option<NodeId>,
}

impl<'a> Iterator for Children<'a> {
    type Item = (NodeId, &'a SourceNode);

    fn next(&mut self) -> Option<Self::Item> {
        let id = self.next?;
        let node = self.arena.node(id)?;
        self.next = node.next_sibling;
        Some((id, node))
    }
}

pub struct Descendants<'a> {
    arena: &'a SourceArena,
    root: NodeId,
    next: Option<NodeId>,
}

impl<'a> Iterator for Descendants<'a> {
    type Item = (NodeId, &'a SourceNode);

    fn next(&mut self) -> Option<Self::Item> {
        let id = self.next?;
        let node = self.arena.node(id)?;
        self.next = node.first_child.or_else(|| self.next_after_subtree(id));
        Some((id, node))
    }
}

impl Descendants<'_> {
    fn next_after_subtree(&self, mut id: NodeId) -> Option<NodeId> {
        loop {
            if id == self.root {
                return None;
            }
            let node = self.arena.node(id)?;
            if let Some(sibling) = node.next_sibling {
                return Some(sibling);
            }
            id = node.parent?;
        }
    }
}

struct SourceBuilder {
    nodes: Vec<SourceNode>,
    node_limit: u32,
}

impl SourceBuilder {
    fn new(node_limit: u32) -> Self {
        Self {
            nodes: Vec::new(),
            node_limit,
        }
    }

    fn push(
        &mut self,
        kind: SourceNodeKind,
        parent: Option<NodeId>,
    ) -> Result<NodeId, SourceError> {
        let index = u32::try_from(self.nodes.len()).map_err(|_| SourceError::TooManyNodes)?;
        if index >= self.node_limit {
            return Err(SourceError::TooManyNodes);
        }
        self.nodes.push(SourceNode {
            kind,
            parent,
            first_child: None,
            last_child: None,
            previous_sibling: None,
            next_sibling: None,
        });
        Ok(NodeId(index))
    }

    fn append_xml_element(
        &mut self,
        source: roxmltree::Node<'_, '_>,
        parent: NodeId,
    ) -> Result<NodeId, SourceError> {
        let root = self.append_element(source, parent)?;
        let mut pending = vec![(root, source.children())];

        while let Some((parent, children)) = pending.last_mut() {
            let parent = *parent;
            let Some(child) = children.next() else {
                pending.pop();
                continue;
            };
            if child.is_element() {
                let child_id = self.append_element(child, parent)?;
                pending.push((child_id, child.children()));
            } else if child.is_text() {
                let child_id = self.push(
                    SourceNodeKind::Text(child.text().unwrap_or_default().to_owned()),
                    Some(parent),
                )?;
                self.attach_child(parent, child_id);
            }
        }
        Ok(root)
    }

    fn append_element(
        &mut self,
        source: roxmltree::Node<'_, '_>,
        parent: NodeId,
    ) -> Result<NodeId, SourceError> {
        let element = SourceElement {
            name: qname(source.tag_name().namespace(), source.tag_name().name()),
            attributes: source
                .attributes()
                .map(|attribute| SourceAttribute {
                    name: qname(attribute.namespace(), attribute.name()),
                    value: attribute.value().to_owned(),
                })
                .collect::<Vec<_>>()
                .into_boxed_slice(),
        };
        let id = self.push(SourceNodeKind::Element(element), Some(parent))?;
        self.attach_child(parent, id);
        Ok(id)
    }

    fn attach_child(&mut self, parent: NodeId, child: NodeId) {
        let previous = self.nodes[parent.index()].last_child;
        if let Some(previous) = previous {
            self.nodes[previous.index()].next_sibling = Some(child);
            self.nodes[child.index()].previous_sibling = Some(previous);
        } else {
            self.nodes[parent.index()].first_child = Some(child);
        }
        self.nodes[parent.index()].last_child = Some(child);
    }
}

fn qname(namespace: Option<&str>, local_name: &str) -> QName {
    QName {
        namespace: namespace.map(ToOwned::to_owned),
        local_name: local_name.to_owned(),
    }
}

pub(crate) fn map_parse_error(error: roxmltree::Error) -> SourceError {
    match error {
        roxmltree::Error::NodesLimitReached => SourceError::TooManyNodes,
        error => SourceError::InvalidXml(error.to_string()),
    }
}

pub(crate) fn validate_source_depth(source: &str) -> Result<(), SourceError> {
    use quick_xml::events::Event;

    let mut reader = quick_xml::Reader::from_str(source);
    let mut depth = 0usize;
    loop {
        match reader.read_event() {
            Ok(Event::Start(_)) => {
                depth += 1;
                if depth > MAX_SOURCE_DEPTH {
                    return Err(SourceError::TooDeep);
                }
            }
            Ok(Event::End(_)) => depth = depth.saturating_sub(1),
            Ok(Event::Eof) => return Ok(()),
            Ok(_) => {}
            Err(error) => return Err(SourceError::InvalidXml(error.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{SourceBuilder, SourceError, SourceNodeKind};

    #[test]
    fn builder_enforces_its_node_limit_before_allocating_another_node() {
        let mut builder = SourceBuilder::new(1);
        builder.push(SourceNodeKind::Document, None).unwrap();
        assert_eq!(
            builder.push(SourceNodeKind::Document, None),
            Err(SourceError::TooManyNodes)
        );
    }
}
