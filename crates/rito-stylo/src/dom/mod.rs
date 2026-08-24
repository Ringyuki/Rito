#![allow(unsafe_code)]

mod data;
mod selectors;
mod traits;

use std::sync::atomic::Ordering;
use std::{
    collections::HashMap, marker::PhantomPinned, pin::Pin, ptr::NonNull, sync::Arc as StdArc,
};

use rito_source::{NodeId, SourceArena, SourceElement, SourceNode, SourceNodeKind};
use rito_style_contract::LanguageTag;

use style::{
    color::AbsoluteColor,
    context::QuirksMode,
    data::ElementDataRef,
    invalidation::element::restyle_hints::RestyleHint,
    properties::{parse_style_attribute, ComputedValues},
    selector_parser::AttrValue,
    servo_arc::Arc,
    shared_lock::{Locked, SharedRwLock},
    stylesheets::{CssRuleType, UrlExtraData},
    LocalName, Namespace,
};
use style_dom::ElementState;

use crate::{
    break_properties::rewrite_declaration_list,
    presentational_hints::{
        parse_body_bgcolor_presentational_hint, parse_svg_geometry_presentational_hint,
        SvgGeometryAxis,
    },
    session::StyleError,
};

use self::data::ElementStyleSlot;

pub(crate) const HTML_NAMESPACE: &str = "http://www.w3.org/1999/xhtml";
pub(crate) const MATHML_NAMESPACE: &str = "http://www.w3.org/1998/Math/MathML";
pub(crate) const SVG_NAMESPACE: &str = "http://www.w3.org/2000/svg";
pub(crate) const XML_NAMESPACE: &str = "http://www.w3.org/XML/1998/namespace";

pub(crate) struct DomStorage {
    source: StdArc<SourceArena>,
    guard: SharedRwLock,
    elements: Box<[Option<ElementMetadata>]>,
    slots: Box<[Option<ElementStyleSlot>]>,
    inherited_languages: Box<[Option<LanguageTag>]>,
    language_tag_normalization_count: usize,
    handles: Box<[DomHandle]>,
    opaque_nodes: HashMap<usize, NodeId>,
    _pin: PhantomPinned,
}

struct DomHandle {
    owner: NonNull<DomStorage>,
    id: NodeId,
}

struct ElementMetadata {
    local_name: LocalName,
    namespace: Namespace,
    attributes: Box<[DomAttribute]>,
    id: Option<style::Atom>,
    style_attribute: Option<Arc<Locked<style::properties::PropertyDeclarationBlock>>>,
    body_bgcolor_presentational_hint: Option<AbsoluteColor>,
    /// `width`/`height` on `<svg>` as typed declarations (SVG 2 §7.2).
    /// Empty for every other element, and for attribute values the CSS
    /// grammar rejects — browsers ignore an invalid presentation attribute.
    svg_geometry_presentational_hints: Box<[style::properties::PropertyDeclaration]>,
    state: ElementState,
}

struct DomAttribute {
    local_name: LocalName,
    namespace: Namespace,
    value: String,
}

impl DomStorage {
    pub(crate) fn new(
        source: StdArc<SourceArena>,
        guard: SharedRwLock,
        url_data: &UrlExtraData,
    ) -> Result<Pin<Box<Self>>, StyleError> {
        let mut elements = Vec::with_capacity(source.len());
        let mut slots = Vec::with_capacity(source.len());
        let mut inherited_languages: Vec<Option<LanguageTag>> = Vec::with_capacity(source.len());
        let mut language_tag_normalization_count = 0;
        for (id, node) in source.iter() {
            let Some(element) = element(node) else {
                elements.push(None);
                slots.push(None);
                inherited_languages.push(None);
                continue;
            };
            let metadata = ElementMetadata::new(element, id.index(), &guard, url_data)?;
            let language = match metadata.language_attribute() {
                Some("") => None,
                Some(value) => {
                    language_tag_normalization_count += 1;
                    Some(LanguageTag::new(value))
                }
                None => node
                    .parent
                    .and_then(|parent| inherited_languages[parent.index()].clone()),
            };
            debug_assert!(node.parent.is_none_or(|parent| parent < id));
            elements.push(Some(metadata));
            slots.push(Some(ElementStyleSlot::default()));
            inherited_languages.push(language);
        }
        let handles = source
            .iter()
            .map(|(id, _)| DomHandle {
                owner: NonNull::dangling(),
                id,
            })
            .collect::<Vec<_>>()
            .into_boxed_slice();
        let opaque_nodes = source
            .iter()
            .map(|(id, node)| (std::ptr::from_ref(node).addr(), id))
            .collect();
        let mut storage = Box::new(Self {
            source,
            guard,
            elements: elements.into_boxed_slice(),
            slots: slots.into_boxed_slice(),
            inherited_languages: inherited_languages.into_boxed_slice(),
            language_tag_normalization_count,
            handles,
            opaque_nodes,
            _pin: PhantomPinned,
        });
        let owner = NonNull::from(storage.as_ref());
        for handle in &mut storage.handles {
            handle.owner = owner;
        }
        Ok(Box::into_pin(storage))
    }

    pub(crate) fn document(&self) -> DomNode<'_> {
        self.handle(self.source.document())
    }

    pub(crate) fn root_element(&self) -> DomNode<'_> {
        self.handle(self.source.root_element())
    }

    pub(crate) fn handle(&self, id: NodeId) -> DomNode<'_> {
        DomNode {
            handle: &self.handles[id.index()],
        }
    }

    pub(crate) fn element_handles(&self) -> impl Iterator<Item = DomNode<'_>> {
        self.source
            .iter()
            .filter(|(_, node)| matches!(node.kind, SourceNodeKind::Element(_)))
            .map(|(id, _)| self.handle(id))
    }

    pub(crate) fn source_node_count(&self) -> usize {
        self.source.len()
    }

    pub(crate) fn language_tag_normalization_count(&self) -> usize {
        self.language_tag_normalization_count
    }

    pub(crate) fn shared_lock(&self) -> &SharedRwLock {
        &self.guard
    }

    pub(crate) fn node_id_from_opaque(&self, opaque: usize) -> Option<NodeId> {
        self.opaque_nodes.get(&opaque).copied()
    }

    pub(crate) fn mark_restyle(&self, id: NodeId, hint: RestyleHint) {
        let node = self.handle(id);
        if let Some(slot) = node.slot() {
            slot.insert_restyle_hint(hint);
            node.mark_ancestors_dirty();
        }
    }

    pub(crate) fn mark_full_restyle(&self) {
        self.mark_restyle(self.source.root_element(), RestyleHint::restyle_subtree());
    }
}

impl ElementMetadata {
    fn new(
        element: &SourceElement,
        source_index: usize,
        guard: &SharedRwLock,
        url_data: &UrlExtraData,
    ) -> Result<Self, StyleError> {
        let attributes = element
            .attributes
            .iter()
            .map(|attribute| DomAttribute {
                local_name: LocalName::from(attribute.name.local_name.as_str()),
                namespace: Namespace::from(attribute.name.namespace.as_deref().unwrap_or("")),
                value: attribute.value.clone(),
            })
            .collect::<Vec<_>>()
            .into_boxed_slice();
        let id = find_attribute(&attributes, "", "id")
            .or_else(|| find_attribute(&attributes, XML_NAMESPACE, "id"))
            .map(style::Atom::from);
        let style_attribute = find_attribute(&attributes, "", "style").map(|value| {
            let value = rewrite_declaration_list(value);
            Arc::new(guard.wrap(parse_style_attribute(
                &value,
                url_data,
                None,
                QuirksMode::NoQuirks,
                CssRuleType::Style,
            )))
        });
        let namespace = Namespace::from(element.name.namespace.as_deref().unwrap_or(""));
        let local_name = LocalName::from(element.name.local_name.as_str());
        let body_bgcolor_presentational_hint =
            body_bgcolor_presentational_hint(source_index, &namespace, &local_name, &attributes)?;
        let svg_geometry_presentational_hints =
            svg_geometry_presentational_hints(&namespace, &local_name, &attributes);
        let state = element_state(&namespace, &local_name, &attributes);
        Ok(Self {
            local_name,
            namespace,
            attributes,
            id,
            style_attribute,
            body_bgcolor_presentational_hint,
            svg_geometry_presentational_hints,
            state,
        })
    }

    fn language_attribute(&self) -> Option<&str> {
        find_attribute(&self.attributes, XML_NAMESPACE, "lang")
            .or_else(|| find_attribute(&self.attributes, "", "lang"))
    }
}

fn body_bgcolor_presentational_hint(
    source_index: usize,
    namespace: &Namespace,
    local_name: &LocalName,
    attributes: &[DomAttribute],
) -> Result<Option<AbsoluteColor>, StyleError> {
    if &**namespace != HTML_NAMESPACE || &**local_name != "body" {
        return Ok(None);
    }
    let Some(value) = find_attribute(attributes, "", "bgcolor") else {
        return Ok(None);
    };
    parse_body_bgcolor_presentational_hint(value)
        .map(Some)
        .ok_or_else(|| StyleError::UnsupportedPresentationalHint {
            source_index,
            name: "body@bgcolor",
            value: value.to_owned(),
        })
}

/// `width`/`height` on the `<svg>` element parsed into presentational-hint
/// declarations (SVG 2 §7.2). The EPUB parser folds an SVG-wrapped image
/// into an image node, but the fragment engine styles that node through
/// Stylo keyed by the source `<svg>` element, so the geometry must reach
/// Stylo here — as a hint, which cascades below author styles — rather
/// than through a style string synthesized outside the cascade.
fn svg_geometry_presentational_hints(
    namespace: &Namespace,
    local_name: &LocalName,
    attributes: &[DomAttribute],
) -> Box<[style::properties::PropertyDeclaration]> {
    if &**namespace != SVG_NAMESPACE || &**local_name != "svg" {
        return Box::default();
    }
    let mut hints = Vec::new();
    for (axis, name) in [
        (SvgGeometryAxis::Width, "width"),
        (SvgGeometryAxis::Height, "height"),
    ] {
        let Some(value) = find_attribute(attributes, "", name) else {
            continue;
        };
        if let Some(declaration) = parse_svg_geometry_presentational_hint(axis, value) {
            hints.push(declaration);
        }
    }
    hints.into_boxed_slice()
}

fn element(node: &SourceNode) -> Option<&SourceElement> {
    match &node.kind {
        SourceNodeKind::Element(element) => Some(element),
        SourceNodeKind::Document | SourceNodeKind::Text(_) => None,
    }
}

fn find_attribute<'a>(
    attributes: &'a [DomAttribute],
    namespace: &str,
    local_name: &str,
) -> Option<&'a str> {
    attributes
        .iter()
        .find(|attribute| {
            &*attribute.namespace == namespace && &*attribute.local_name == local_name
        })
        .map(|attribute| attribute.value.as_str())
}

fn element_state(
    namespace: &Namespace,
    local_name: &LocalName,
    attributes: &[DomAttribute],
) -> ElementState {
    if &**namespace != HTML_NAMESPACE {
        return ElementState::empty();
    }
    let can_be_disabled = matches!(
        local_name.as_ref(),
        "button" | "input" | "select" | "textarea"
    );
    if !can_be_disabled {
        return ElementState::empty();
    }
    if find_attribute(attributes, "", "disabled").is_some() {
        ElementState::DISABLED
    } else {
        ElementState::ENABLED
    }
}

#[derive(Clone, Copy)]
pub(crate) struct DomNode<'a> {
    handle: &'a DomHandle,
}

// Stylo's TLS sharing cache erases an element handle to `usize`; any wider
// handle would make that upstream transmute invalid and panic at runtime.
const _: () = assert!(std::mem::size_of::<DomNode<'static>>() == std::mem::size_of::<usize>());

#[cfg(test)]
static_assertions::assert_not_impl_any!(DomStorage: Unpin);

impl<'a> DomNode<'a> {
    pub(crate) fn id(self) -> NodeId {
        self.handle.id
    }

    fn dom(self) -> &'a DomStorage {
        // SAFETY: DomStorage::new fixes every handle to the address of its
        // owning boxed storage before returning it. The private storage is
        // never moved out of that Box, and DomNode's lifetime is borrowed from
        // the handle slice owned by the same storage.
        unsafe { self.handle.owner.as_ref() }
    }

    fn record(self) -> &'a SourceNode {
        self.dom()
            .source
            .node(self.id())
            .expect("Stylo host handle must reference its owning source arena")
    }

    fn metadata(self) -> Option<&'a ElementMetadata> {
        self.dom().elements[self.id().index()].as_ref()
    }

    fn slot(self) -> Option<&'a ElementStyleSlot> {
        self.dom().slots[self.id().index()].as_ref()
    }

    fn with(self, id: NodeId) -> Self {
        self.dom().handle(id)
    }

    pub(crate) fn id_attribute(self) -> Option<&'a str> {
        self.metadata().and_then(|metadata| metadata.id.as_deref())
    }

    pub(crate) fn local_name_string(self) -> &'a str {
        self.metadata()
            .map(|metadata| metadata.local_name.as_ref())
            .unwrap_or("")
    }

    pub(crate) fn primary_styles(self) -> Option<Arc<ComputedValues>> {
        let data: ElementDataRef<'_> = self.slot()?.borrow()?;
        data.styles.get_primary().cloned()
    }

    fn attribute(self, namespace: &str, local_name: &str) -> Option<&'a str> {
        find_attribute(&self.metadata()?.attributes, namespace, local_name)
    }

    fn body_bgcolor_presentational_hint(self) -> Option<AbsoluteColor> {
        self.metadata()?.body_bgcolor_presentational_hint
    }

    fn svg_geometry_presentational_hints(self) -> &'a [style::properties::PropertyDeclaration] {
        self.metadata()
            .map_or(&[], |metadata| &*metadata.svg_geometry_presentational_hints)
    }

    pub(crate) fn inherited_language(self) -> Option<&'a str> {
        self.inherited_language_tag().map(LanguageTag::as_str)
    }

    pub(crate) fn inherited_language_tag(self) -> Option<&'a LanguageTag> {
        self.dom().inherited_languages[self.id().index()].as_ref()
    }

    fn is_element(self) -> bool {
        self.metadata().is_some()
    }

    fn is_text(self) -> bool {
        matches!(self.record().kind, SourceNodeKind::Text(_))
    }

    fn is_document(self) -> bool {
        matches!(self.record().kind, SourceNodeKind::Document)
    }

    fn node_address(self) -> usize {
        std::ptr::from_ref(self.record()).addr()
    }

    fn has_nonempty_text_child(self) -> bool {
        let mut child = self.record().first_child.map(|id| self.with(id));
        while let Some(node) = child {
            match &node.record().kind {
                SourceNodeKind::Element(_) => return true,
                SourceNodeKind::Text(text) if !text.is_empty() => return true,
                SourceNodeKind::Document | SourceNodeKind::Text(_) => {}
            }
            child = node.record().next_sibling.map(|id| node.with(id));
        }
        false
    }

    fn mark_ancestors_dirty(self) {
        let mut current = self.record().parent.map(|id| self.with(id));
        while let Some(node) = current {
            if let Some(slot) = node.slot() {
                slot.dirty_descendants.store(true, Ordering::Relaxed);
            }
            current = node.record().parent.map(|id| node.with(id));
        }
    }

    fn style_attribute(
        self,
    ) -> Option<style::servo_arc::ArcBorrow<'a, Locked<style::properties::PropertyDeclarationBlock>>>
    {
        self.metadata()
            .and_then(|metadata| metadata.style_attribute.as_ref())
            .map(|declarations| declarations.borrow_arc())
    }

    fn current_language_value(self) -> Option<AttrValue> {
        self.attribute(XML_NAMESPACE, "lang")
            .or_else(|| self.attribute("", "lang"))
            .map(AttrValue::from)
    }
}

impl std::fmt::Debug for DomNode<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RitoStyloNode")
            .field("id", &self.id())
            .field("name", &self.local_name_string())
            .finish()
    }
}

impl PartialEq for DomNode<'_> {
    fn eq(&self, other: &Self) -> bool {
        std::ptr::eq(self.handle, other.handle)
    }
}

impl Eq for DomNode<'_> {}

impl std::hash::Hash for DomNode<'_> {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        std::ptr::from_ref(self.handle).hash(state);
    }
}

pub(crate) struct ChildIterator<'a> {
    next: Option<DomNode<'a>>,
}

impl<'a> ChildIterator<'a> {
    fn new(parent: DomNode<'a>) -> Self {
        Self {
            next: parent.record().first_child.map(|id| parent.with(id)),
        }
    }
}

impl<'a> Iterator for ChildIterator<'a> {
    type Item = DomNode<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        let current = self.next.take()?;
        self.next = current.record().next_sibling.map(|id| current.with(id));
        Some(current)
    }
}
