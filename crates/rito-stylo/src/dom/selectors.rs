use selectors::{
    attr::{AttrSelectorOperation, CaseSensitivity, NamespaceConstraint},
    bloom::BLOOM_HASH_MASK,
    matching::{ElementSelectorFlags, MatchingContext},
    Element, OpaqueElement,
};
use style::{
    bloom::each_relevant_element_hash,
    selector_parser::{NonTSPseudoClass, PseudoElement, SelectorImpl},
    values::AtomIdent,
    CaseSensitivityExt, Namespace,
};

use super::{DomNode, HTML_NAMESPACE};

impl Element for DomNode<'_> {
    type Impl = SelectorImpl;

    fn opaque(&self) -> OpaqueElement {
        OpaqueElement::new(self.record())
    }

    fn parent_element(&self) -> Option<Self> {
        style::dom::TElement::traversal_parent(self)
    }

    fn parent_node_is_shadow_root(&self) -> bool {
        false
    }

    fn containing_shadow_host(&self) -> Option<Self> {
        None
    }

    fn is_pseudo_element(&self) -> bool {
        false
    }

    fn prev_sibling_element(&self) -> Option<Self> {
        let mut sibling = self.record().previous_sibling.map(|id| self.with(id));
        while let Some(node) = sibling {
            if node.is_element() {
                return Some(node);
            }
            sibling = node.record().previous_sibling.map(|id| node.with(id));
        }
        None
    }

    fn next_sibling_element(&self) -> Option<Self> {
        let mut sibling = self.record().next_sibling.map(|id| self.with(id));
        while let Some(node) = sibling {
            if node.is_element() {
                return Some(node);
            }
            sibling = node.record().next_sibling.map(|id| node.with(id));
        }
        None
    }

    fn first_element_child(&self) -> Option<Self> {
        let mut child = self.record().first_child.map(|id| self.with(id));
        while let Some(node) = child {
            if node.is_element() {
                return Some(node);
            }
            child = node.record().next_sibling.map(|id| node.with(id));
        }
        None
    }

    fn is_html_element_in_html_document(&self) -> bool {
        false
    }

    fn has_local_name(
        &self,
        local_name: &<SelectorImpl as selectors::parser::SelectorImpl>::BorrowedLocalName,
    ) -> bool {
        self.metadata()
            .is_some_and(|metadata| &*metadata.local_name == local_name)
    }

    fn has_namespace(
        &self,
        namespace: &<SelectorImpl as selectors::parser::SelectorImpl>::BorrowedNamespaceUrl,
    ) -> bool {
        self.metadata()
            .is_some_and(|metadata| &*metadata.namespace == namespace)
    }

    fn is_same_type(&self, other: &Self) -> bool {
        self.metadata()
            .zip(other.metadata())
            .is_some_and(|(left, right)| {
                left.local_name == right.local_name && left.namespace == right.namespace
            })
    }

    fn attr_matches(
        &self,
        namespace: &NamespaceConstraint<
            &<SelectorImpl as selectors::parser::SelectorImpl>::NamespaceUrl,
        >,
        local_name: &<SelectorImpl as selectors::parser::SelectorImpl>::LocalName,
        operation: &AttrSelectorOperation<
            &<SelectorImpl as selectors::parser::SelectorImpl>::AttrValue,
        >,
    ) -> bool {
        self.metadata().is_some_and(|metadata| {
            metadata.attributes.iter().any(|attribute| {
                attribute.local_name == *local_name
                    && namespace_matches(namespace, &attribute.namespace)
                    && operation.eval_str(&attribute.value)
            })
        })
    }

    fn match_non_ts_pseudo_class(
        &self,
        pseudo_class: &NonTSPseudoClass,
        _context: &mut MatchingContext<SelectorImpl>,
    ) -> bool {
        match pseudo_class {
            NonTSPseudoClass::Active => self.state_contains(style_dom::ElementState::ACTIVE),
            NonTSPseudoClass::AnyLink | NonTSPseudoClass::Link => self.is_link(),
            NonTSPseudoClass::Checked => self.state_contains(style_dom::ElementState::CHECKED),
            NonTSPseudoClass::Valid => self.state_contains(style_dom::ElementState::VALID),
            NonTSPseudoClass::Invalid => self.state_contains(style_dom::ElementState::INVALID),
            NonTSPseudoClass::Defined => self.state_contains(style_dom::ElementState::DEFINED),
            NonTSPseudoClass::Disabled => self.state_contains(style_dom::ElementState::DISABLED),
            NonTSPseudoClass::Enabled => self.state_contains(style_dom::ElementState::ENABLED),
            NonTSPseudoClass::Focus => self.state_contains(style_dom::ElementState::FOCUS),
            NonTSPseudoClass::FocusWithin => {
                self.state_contains(style_dom::ElementState::FOCUS_WITHIN)
            }
            NonTSPseudoClass::FocusVisible => {
                self.state_contains(style_dom::ElementState::FOCUSRING)
            }
            NonTSPseudoClass::Fullscreen => {
                self.state_contains(style_dom::ElementState::FULLSCREEN)
            }
            NonTSPseudoClass::Hover => self.state_contains(style_dom::ElementState::HOVER),
            NonTSPseudoClass::Indeterminate => {
                self.state_contains(style_dom::ElementState::INDETERMINATE)
            }
            NonTSPseudoClass::Lang(language) => {
                style::dom::TElement::match_element_lang(self, None, language)
            }
            NonTSPseudoClass::CustomState(state) => self.has_custom_state(&state.0),
            NonTSPseudoClass::PlaceholderShown => {
                self.state_contains(style_dom::ElementState::PLACEHOLDER_SHOWN)
            }
            NonTSPseudoClass::ReadWrite => self.state_contains(style_dom::ElementState::READWRITE),
            NonTSPseudoClass::ReadOnly => self.state_contains(style_dom::ElementState::READONLY),
            NonTSPseudoClass::ServoNonZeroBorder => false,
            NonTSPseudoClass::Target => self.state_contains(style_dom::ElementState::URLTARGET),
            NonTSPseudoClass::Visited => false,
            NonTSPseudoClass::Autofill => self.state_contains(style_dom::ElementState::AUTOFILL),
            NonTSPseudoClass::Default => self.state_contains(style_dom::ElementState::DEFAULT),
            NonTSPseudoClass::InRange => self.state_contains(style_dom::ElementState::INRANGE),
            NonTSPseudoClass::Modal => self.state_contains(style_dom::ElementState::MODAL),
            NonTSPseudoClass::Open => self.state_contains(style_dom::ElementState::OPEN),
            NonTSPseudoClass::Optional => self.state_contains(style_dom::ElementState::OPTIONAL_),
            NonTSPseudoClass::OutOfRange => {
                self.state_contains(style_dom::ElementState::OUTOFRANGE)
            }
            NonTSPseudoClass::PopoverOpen => {
                self.state_contains(style_dom::ElementState::POPOVER_OPEN)
            }
            NonTSPseudoClass::Required => self.state_contains(style_dom::ElementState::REQUIRED),
            NonTSPseudoClass::UserInvalid => {
                self.state_contains(style_dom::ElementState::USER_INVALID)
            }
            NonTSPseudoClass::UserValid => self.state_contains(style_dom::ElementState::USER_VALID),
            NonTSPseudoClass::MozMeterOptimum => {
                self.state_contains(style_dom::ElementState::OPTIMUM)
            }
            NonTSPseudoClass::MozMeterSubOptimum => {
                self.state_contains(style_dom::ElementState::SUB_OPTIMUM)
            }
            NonTSPseudoClass::MozMeterSubSubOptimum => {
                self.state_contains(style_dom::ElementState::SUB_SUB_OPTIMUM)
            }
        }
    }

    fn match_pseudo_element(
        &self,
        _pseudo: &PseudoElement,
        _context: &mut MatchingContext<SelectorImpl>,
    ) -> bool {
        false
    }

    fn apply_selector_flags(&self, flags: ElementSelectorFlags) {
        if let Some(slot) = self.slot() {
            slot.selector_flags
                .set(slot.selector_flags.get() | flags.for_self());
        }
        if let Some(parent) = style::dom::TNode::parent_node(self) {
            if let Some(slot) = parent.slot() {
                slot.selector_flags
                    .set(slot.selector_flags.get() | flags.for_parent());
            }
        }
    }

    fn is_link(&self) -> bool {
        self.metadata().is_some_and(|metadata| {
            &*metadata.namespace == HTML_NAMESPACE
                && matches!(metadata.local_name.as_ref(), "a" | "area")
                && self.attribute("", "href").is_some()
        })
    }

    fn is_html_slot_element(&self) -> bool {
        self.metadata().is_some_and(|metadata| {
            &*metadata.namespace == HTML_NAMESPACE && &*metadata.local_name == "slot"
        })
    }

    fn has_id(&self, id: &AtomIdent, case_sensitivity: CaseSensitivity) -> bool {
        self.metadata()
            .and_then(|metadata| metadata.id.as_ref())
            .is_some_and(|actual| case_sensitivity.eq_atom(actual, id))
    }

    fn has_class(&self, expected: &AtomIdent, case_sensitivity: CaseSensitivity) -> bool {
        self.attribute("", "class").is_some_and(|classes| {
            classes.split_ascii_whitespace().any(|class| {
                let actual = style::Atom::from(class);
                case_sensitivity.eq_atom(&actual, expected)
            })
        })
    }

    fn imported_part(&self, _name: &AtomIdent) -> Option<AtomIdent> {
        None
    }

    fn is_part(&self, _name: &AtomIdent) -> bool {
        false
    }

    fn is_empty(&self) -> bool {
        !self.has_nonempty_text_child()
    }

    fn is_root(&self) -> bool {
        self.record()
            .parent
            .is_some_and(|parent| self.with(parent).is_document())
    }

    fn has_custom_state(&self, _name: &AtomIdent) -> bool {
        false
    }

    fn add_element_unique_hashes(&self, filter: &mut selectors::bloom::BloomFilter) -> bool {
        each_relevant_element_hash(*self, |hash| filter.insert_hash(hash & BLOOM_HASH_MASK));
        true
    }
}

impl DomNode<'_> {
    fn state_contains(self, state: style_dom::ElementState) -> bool {
        self.metadata()
            .is_some_and(|metadata| metadata.state.contains(state))
    }
}

fn namespace_matches(
    constraint: &NamespaceConstraint<
        &<SelectorImpl as selectors::parser::SelectorImpl>::NamespaceUrl,
    >,
    actual: &Namespace,
) -> bool {
    match constraint {
        NamespaceConstraint::Any => true,
        NamespaceConstraint::Specific(expected) => **expected == *actual,
    }
}
