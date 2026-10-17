//! Projects the boxes the cascade generated for `::before` and `::after`.
//! Each box's computed style goes through the same projection as an
//! element's and is interned in the chapter's tables; its `content` becomes
//! text: strings as written, `attr()` as the element's attribute value.

use rito_style_contract::{
    GeneratedBox, GeneratedBoxTable, GeneratedContentItem, InlineStyleTable, LayoutStyleTable,
    PseudoElementKind,
};
use style::{
    properties::ComputedValues,
    selector_parser::PseudoElement,
    values::generics::counters::{GenericContent, GenericContentItem},
};

use super::inline::generated_inline_style;
use super::layout::generated_layout_style;
use crate::dom::{DomNode, DomStorage};

pub(crate) fn project_generated(
    dom: &DomStorage,
    inline: &mut InlineStyleTable,
    layout: &mut LayoutStyleTable,
) -> GeneratedBoxTable {
    let mut table = GeneratedBoxTable::new();
    for element in dom.element_handles() {
        for (pseudo, kind) in [
            (PseudoElement::Before, PseudoElementKind::Before),
            (PseudoElement::After, PseudoElementKind::After),
        ] {
            let Some(styles) = element.pseudo_styles(&pseudo) else {
                continue;
            };
            let node_index = element.id().index();
            match generated_box(element, &styles, dom, inline, layout) {
                Ok(generated) => table.insert(node_index, kind, generated),
                Err(reason) => table.reject(node_index, kind, reason),
            }
        }
    }
    table
}

fn generated_box(
    element: DomNode<'_>,
    styles: &ComputedValues,
    dom: &DomStorage,
    inline: &mut InlineStyleTable,
    layout: &mut LayoutStyleTable,
) -> Result<GeneratedBox, String> {
    let inline_style = generated_inline_style(element, styles, dom.shared_lock())?;
    let layout_style = generated_layout_style(styles)?;
    Ok(GeneratedBox {
        inline: inline
            .intern(inline_style)
            .map_err(|error| format!("inline style interns: {error}"))?,
        layout: layout
            .intern(layout_style)
            .map_err(|error| format!("layout style interns: {error}"))?,
        content: content(element, styles),
    })
}

fn content(element: DomNode<'_>, styles: &ComputedValues) -> Vec<GeneratedContentItem> {
    let GenericContent::Items(items) = styles.get_counters().clone_content() else {
        return Vec::new();
    };
    // Past `alt_start` is the alternative text for assistive technology,
    // which renders nothing.
    items
        .items
        .iter()
        .take(items.alt_start)
        .map(|item| match item {
            GenericContentItem::String(text) => GeneratedContentItem::Text(text.to_string()),
            GenericContentItem::Attr(attr) => GeneratedContentItem::Text(
                element
                    .attribute(&attr.namespace_url, &attr.attribute)
                    .map_or_else(|| attr.fallback.to_string(), str::to_owned),
            ),
            GenericContentItem::Counter(..) | GenericContentItem::Counters(..) => {
                GeneratedContentItem::Unsupported("counter()")
            }
            GenericContentItem::OpenQuote
            | GenericContentItem::CloseQuote
            | GenericContentItem::NoOpenQuote
            | GenericContentItem::NoCloseQuote => GeneratedContentItem::Unsupported("quote"),
            GenericContentItem::Image(_) => GeneratedContentItem::Unsupported("image"),
        })
        .collect()
}
