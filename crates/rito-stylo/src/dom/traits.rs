#![allow(unsafe_code)]

use std::sync::atomic::Ordering;

use selectors::{matching::ElementSelectorFlags, sink::Push};
use style::{
    animation::AnimationSetKey,
    applicable_declarations::ApplicableDeclarationBlock,
    context::{QuirksMode, SharedStyleContext},
    data::{ElementDataMut, ElementDataRef},
    dom::{AttributeProvider, LayoutIterator, NodeInfo, TDocument, TElement, TNode, TShadowRoot},
    properties::{ComputedValues, Importance, PropertyDeclaration, PropertyDeclarationBlock},
    rule_tree::{CascadeLevel, CascadeOrigin},
    selector_parser::{AttrValue, Lang, PseudoElement, RestyleDamage},
    servo_arc::{Arc, ArcBorrow},
    shared_lock::{Locked, SharedRwLock},
    stylesheets::{layer_rule::LayerOrder, scope_rule::ImplicitScopeRoot},
    stylist::CascadeData,
    values::computed::Display,
    values::AtomIdent,
    LocalName, Namespace,
};
use style_dom::ElementState;

use super::{ChildIterator, DomNode, HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE};

impl NodeInfo for DomNode<'_> {
    fn is_element(&self) -> bool {
        (*self).is_element()
    }

    fn is_text_node(&self) -> bool {
        (*self).is_text()
    }
}

impl<'a> TDocument for DomNode<'a> {
    type ConcreteNode = DomNode<'a>;

    fn as_node(&self) -> Self::ConcreteNode {
        *self
    }

    fn is_html_document(&self) -> bool {
        false
    }

    fn quirks_mode(&self) -> QuirksMode {
        QuirksMode::NoQuirks
    }

    fn shared_lock(&self) -> &SharedRwLock {
        self.dom().shared_lock()
    }
}

impl<'a> TNode for DomNode<'a> {
    type ConcreteElement = DomNode<'a>;
    type ConcreteDocument = DomNode<'a>;
    type ConcreteShadowRoot = DomNode<'a>;

    fn parent_node(&self) -> Option<Self> {
        self.record().parent.map(|id| self.with(id))
    }

    fn first_child(&self) -> Option<Self> {
        self.record().first_child.map(|id| self.with(id))
    }

    fn last_child(&self) -> Option<Self> {
        self.record().last_child.map(|id| self.with(id))
    }

    fn prev_sibling(&self) -> Option<Self> {
        self.record().previous_sibling.map(|id| self.with(id))
    }

    fn next_sibling(&self) -> Option<Self> {
        self.record().next_sibling.map(|id| self.with(id))
    }

    fn owner_doc(&self) -> Self::ConcreteDocument {
        self.dom().document()
    }

    fn is_in_document(&self) -> bool {
        true
    }

    fn traversal_parent(&self) -> Option<Self::ConcreteElement> {
        let mut parent = self.parent_node();
        while let Some(node) = parent {
            if node.is_element() {
                return Some(node);
            }
            parent = node.parent_node();
        }
        None
    }

    fn opaque(&self) -> style::dom::OpaqueNode {
        style::dom::OpaqueNode(self.node_address())
    }

    fn debug_id(self) -> usize {
        self.id().index()
    }

    fn as_element(&self) -> Option<Self::ConcreteElement> {
        self.is_element().then_some(*self)
    }

    fn as_document(&self) -> Option<Self::ConcreteDocument> {
        self.is_document().then_some(*self)
    }

    fn as_shadow_root(&self) -> Option<Self::ConcreteShadowRoot> {
        None
    }
}

impl<'a> TShadowRoot for DomNode<'a> {
    type ConcreteNode = DomNode<'a>;

    fn as_node(&self) -> Self::ConcreteNode {
        *self
    }

    fn host(&self) -> <Self::ConcreteNode as TNode>::ConcreteElement {
        panic!("Rito EPUB documents do not expose shadow roots")
    }

    fn style_data<'b>(&self) -> Option<&'b CascadeData>
    where
        Self: 'b,
    {
        None
    }

    fn implicit_scope_for_sheet(&self, _sheet_index: usize) -> Option<ImplicitScopeRoot> {
        None
    }
}

impl AttributeProvider for DomNode<'_> {
    fn get_attr(&self, local_name: &LocalName, namespace: &Namespace) -> Option<String> {
        self.metadata()?
            .attributes
            .iter()
            .find(|attribute| {
                attribute.local_name == *local_name && attribute.namespace == *namespace
            })
            .map(|attribute| attribute.value.clone())
    }
}

impl<'a> TElement for DomNode<'a> {
    type ConcreteNode = DomNode<'a>;
    type TraversalChildrenIterator = ChildIterator<'a>;

    fn as_node(&self) -> Self::ConcreteNode {
        *self
    }

    fn traversal_children(&self) -> LayoutIterator<Self::TraversalChildrenIterator> {
        LayoutIterator(ChildIterator::new(*self))
    }

    fn is_html_element(&self) -> bool {
        self.metadata()
            .is_some_and(|metadata| &*metadata.namespace == HTML_NAMESPACE)
    }

    fn is_mathml_element(&self) -> bool {
        self.metadata()
            .is_some_and(|metadata| &*metadata.namespace == MATHML_NAMESPACE)
    }

    fn is_svg_element(&self) -> bool {
        self.metadata()
            .is_some_and(|metadata| &*metadata.namespace == SVG_NAMESPACE)
    }

    fn style_attribute(&self) -> Option<ArcBorrow<'_, Locked<PropertyDeclarationBlock>>> {
        (*self).style_attribute()
    }

    fn animation_rule(
        &self,
        context: &SharedStyleContext,
    ) -> Option<Arc<Locked<PropertyDeclarationBlock>>> {
        context.animations.get_animation_declarations(
            &AnimationSetKey::new_for_non_pseudo(TNode::opaque(self)),
            context.current_time_for_animations,
            self.dom().shared_lock(),
        )
    }

    fn transition_rule(
        &self,
        context: &SharedStyleContext,
    ) -> Option<Arc<Locked<PropertyDeclarationBlock>>> {
        context.animations.get_transition_declarations(
            &AnimationSetKey::new_for_non_pseudo(TNode::opaque(self)),
            context.current_time_for_animations,
            self.dom().shared_lock(),
        )
    }

    fn state(&self) -> ElementState {
        self.metadata()
            .map(|metadata| metadata.state)
            .unwrap_or_else(ElementState::empty)
    }

    fn has_part_attr(&self) -> bool {
        self.attribute("", "part").is_some()
    }

    fn exports_any_part(&self) -> bool {
        self.attribute("", "exportparts").is_some()
    }

    fn id(&self) -> Option<&style::Atom> {
        self.metadata().and_then(|metadata| metadata.id.as_ref())
    }

    fn each_class<F>(&self, mut callback: F)
    where
        F: FnMut(&AtomIdent),
    {
        let Some(classes) = self.attribute("", "class") else {
            return;
        };
        for class in classes.split_ascii_whitespace() {
            let atom = style::Atom::from(class);
            callback(AtomIdent::cast(&atom));
        }
    }

    fn each_custom_state<F>(&self, _callback: F)
    where
        F: FnMut(&AtomIdent),
    {
    }

    fn each_attr_name<F>(&self, mut callback: F)
    where
        F: FnMut(&LocalName),
    {
        if let Some(metadata) = self.metadata() {
            for attribute in &metadata.attributes {
                callback(&attribute.local_name);
            }
        }
    }

    fn has_dirty_descendants(&self) -> bool {
        self.slot()
            .is_some_and(|slot| slot.dirty_descendants.load(Ordering::Relaxed))
    }

    fn has_snapshot(&self) -> bool {
        false
    }

    fn handled_snapshot(&self) -> bool {
        self.slot()
            .is_some_and(|slot| slot.snapshot_handled.load(Ordering::Relaxed))
    }

    unsafe fn set_handled_snapshot(&self) {
        if let Some(slot) = self.slot() {
            slot.snapshot_handled.store(true, Ordering::Relaxed);
        }
    }

    unsafe fn set_dirty_descendants(&self) {
        if let Some(slot) = self.slot() {
            slot.dirty_descendants.store(true, Ordering::Relaxed);
        }
        self.mark_ancestors_dirty();
    }

    unsafe fn unset_dirty_descendants(&self) {
        if let Some(slot) = self.slot() {
            slot.dirty_descendants.store(false, Ordering::Relaxed);
        }
    }

    fn store_children_to_process(&self, count: isize) {
        if let Some(slot) = self.slot() {
            slot.children_to_process.store(count, Ordering::Relaxed);
        }
    }

    fn did_process_child(&self) -> isize {
        self.slot()
            .map(|slot| slot.children_to_process.fetch_sub(1, Ordering::Relaxed) - 1)
            .unwrap_or(0)
    }

    unsafe fn ensure_data(&self) -> ElementDataMut<'_> {
        // SAFETY: the adapter always performs a sequential traversal while
        // holding exclusive access to the owning StyleDocument.
        unsafe {
            self.slot()
                .expect("element must have a style slot")
                .ensure()
        }
    }

    unsafe fn clear_data(&self) {
        // SAFETY: same exclusive traversal invariant as `ensure_data`.
        unsafe { self.slot().expect("element must have a style slot").clear() }
    }

    fn has_data(&self) -> bool {
        self.slot().is_some_and(|slot| slot.has_data())
    }

    fn borrow_data(&self) -> Option<ElementDataRef<'_>> {
        self.slot()?.borrow()
    }

    fn mutate_data(&self) -> Option<ElementDataMut<'_>> {
        self.slot()?.mutate()
    }

    fn skip_item_display_fixup(&self) -> bool {
        false
    }

    fn may_have_animations(&self) -> bool {
        true
    }

    fn has_animations(&self, context: &SharedStyleContext) -> bool {
        self.has_css_animations(context, None) || self.has_css_transitions(context, None)
    }

    fn has_css_animations(
        &self,
        context: &SharedStyleContext,
        pseudo_element: Option<PseudoElement>,
    ) -> bool {
        context
            .animations
            .has_active_animations(&AnimationSetKey::new(TNode::opaque(self), pseudo_element))
    }

    fn has_css_transitions(
        &self,
        context: &SharedStyleContext,
        pseudo_element: Option<PseudoElement>,
    ) -> bool {
        context
            .animations
            .has_active_transitions(&AnimationSetKey::new(TNode::opaque(self), pseudo_element))
    }

    fn shadow_root(&self) -> Option<<Self::ConcreteNode as TNode>::ConcreteShadowRoot> {
        None
    }

    fn containing_shadow(&self) -> Option<<Self::ConcreteNode as TNode>::ConcreteShadowRoot> {
        None
    }

    fn lang_attr(&self) -> Option<AttrValue> {
        self.current_language_value()
    }

    fn match_element_lang(
        &self,
        override_lang: Option<Option<AttrValue>>,
        expected: &Lang,
    ) -> bool {
        let actual = match override_lang {
            Some(Some(value)) => value.as_ref().to_owned(),
            Some(None) => return false,
            None => self.inherited_language().unwrap_or_default().to_owned(),
        };
        language_matches(&actual, expected)
    }

    fn is_html_document_body_element(&self) -> bool {
        false
    }

    fn synthesize_presentational_hints_for_legacy_attributes<V>(
        &self,
        _visited_handling: selectors::matching::VisitedHandlingMode,
        hints: &mut V,
    ) where
        V: Push<ApplicableDeclarationBlock>,
    {
        if self.is_svg_element() {
            // `width`/`height` on `<svg>` are presentation attributes
            // (SVG 2 §7.2): author-level declarations below every author
            // stylesheet rule, which is exactly the pres-hints cascade
            // origin.
            for declaration in (*self).svg_geometry_presentational_hints() {
                push_presentational_hint(*self, hints, declaration.clone());
            }
            return;
        }
        if !self.is_html_element() {
            return;
        }

        if let Some(color) = (*self).body_bgcolor_presentational_hint() {
            push_presentational_hint(
                *self,
                hints,
                PropertyDeclaration::BackgroundColor(color.into()),
            );
        }

        let Some(value) = self.attribute("", "dir") else {
            return;
        };
        let direction = if value.eq_ignore_ascii_case("ltr") {
            style::properties::longhands::direction::SpecifiedValue::Ltr
        } else if value.eq_ignore_ascii_case("rtl") {
            style::properties::longhands::direction::SpecifiedValue::Rtl
        } else {
            // `dir=auto` requires the HTML first-strong-direction algorithm.
            // It must not be approximated as a fixed CSS direction value.
            return;
        };

        push_presentational_hint(*self, hints, PropertyDeclaration::Direction(direction));
    }

    fn local_name(
        &self,
    ) -> &<style::selector_parser::SelectorImpl as selectors::parser::SelectorImpl>::BorrowedLocalName
    {
        &self.metadata().expect("element handle required").local_name
    }

    fn namespace(
        &self,
    ) -> &<style::selector_parser::SelectorImpl as selectors::parser::SelectorImpl>::BorrowedNamespaceUrl
    {
        &self.metadata().expect("element handle required").namespace
    }

    fn query_container_size(
        &self,
        _display: &Display,
    ) -> euclid::default::Size2D<Option<style::values::computed::Au>> {
        Default::default()
    }

    fn has_selector_flags(&self, flags: ElementSelectorFlags) -> bool {
        self.slot()
            .is_some_and(|slot| slot.selector_flags.get().contains(flags))
    }

    fn relative_selector_search_direction(&self) -> ElementSelectorFlags {
        let flags = self
            .slot()
            .map(|slot| slot.selector_flags.get())
            .unwrap_or_else(ElementSelectorFlags::empty);
        for direction in [
            ElementSelectorFlags::RELATIVE_SELECTOR_SEARCH_DIRECTION_ANCESTOR_SIBLING,
            ElementSelectorFlags::RELATIVE_SELECTOR_SEARCH_DIRECTION_ANCESTOR,
            ElementSelectorFlags::RELATIVE_SELECTOR_SEARCH_DIRECTION_SIBLING,
        ] {
            if flags.contains(direction) {
                return direction;
            }
        }
        ElementSelectorFlags::empty()
    }

    fn compute_layout_damage(_old: &ComputedValues, _new: &ComputedValues) -> RestyleDamage {
        RestyleDamage::reconstruct()
    }
}

fn push_presentational_hint<V>(
    element: DomNode<'_>,
    hints: &mut V,
    declaration: PropertyDeclaration,
) where
    V: Push<ApplicableDeclarationBlock>,
{
    let block = PropertyDeclarationBlock::with_one(declaration, Importance::Normal);
    hints.push(ApplicableDeclarationBlock::from_declarations(
        Arc::new(element.dom().shared_lock().wrap(block)),
        CascadeLevel::new(CascadeOrigin::PresHints),
        LayerOrder::root(),
    ));
}

fn language_matches(actual: &str, expected: &str) -> bool {
    if actual.is_empty() {
        return false;
    }
    if expected == "*" {
        return true;
    }
    actual.eq_ignore_ascii_case(expected)
        || actual
            .get(..expected.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(expected))
            && actual.as_bytes().get(expected.len()) == Some(&b'-')
}

#[cfg(test)]
mod tests {
    use super::language_matches;

    #[test]
    fn css_language_ranges_match_exact_or_hyphenated_prefixes() {
        assert!(language_matches("ja", "JA"));
        assert!(language_matches("ja-JP", "ja"));
        assert!(!language_matches("javanese", "ja"));
        assert!(!language_matches("", "*"));
    }
}
