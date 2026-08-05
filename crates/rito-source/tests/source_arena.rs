use std::sync::Arc;

use rito_source::{SourceArena, SourceError, SourceNodeKind, MAX_SOURCE_DEPTH};
use static_assertions::{assert_impl_all, assert_not_impl_any};

assert_not_impl_any!(SourceArena: Clone);
assert_impl_all!(SourceArena: Send, Sync);

#[test]
fn preserves_namespaces_attributes_and_whitespace_text() {
    let arena = SourceArena::from_xhtml(
        r#"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><p id="target" xml:lang="ja" epub:type="note"> x </p></body></html>"#,
    )
    .unwrap();
    let target = arena.find_element_by_id("target").unwrap();
    let element = arena.node(target).unwrap().as_element().unwrap();

    assert_eq!(
        element.name.namespace.as_deref(),
        Some("http://www.w3.org/1999/xhtml")
    );
    assert_eq!(element.attribute("id"), Some("target"));
    assert_eq!(
        element.attribute_ns(Some("http://www.w3.org/XML/1998/namespace"), "lang"),
        Some("ja")
    );
    assert_eq!(
        element.attribute_ns(Some("http://www.idpf.org/2007/ops"), "type"),
        Some("note")
    );
    let text = arena.children(target).next().unwrap().1;
    assert_eq!(text.as_text(), Some(" x "));
}

#[test]
fn exposes_stable_read_only_parent_sibling_and_document_order_navigation() {
    let arena = Arc::new(
        SourceArena::from_xhtml("<html><body><a id='a'><x/></a><b/><c/></body></html>").unwrap(),
    );
    let shared = Arc::clone(&arena);
    assert!(Arc::ptr_eq(&arena, &shared));

    let body = arena
        .descendants(arena.root())
        .find(|(_, node)| {
            node.as_element()
                .is_some_and(|element| element.name.local_name == "body")
        })
        .map(|(id, _)| id)
        .unwrap();
    let children = arena.children(body).collect::<Vec<_>>();
    let names = children
        .iter()
        .map(|(_, node)| node.as_element().unwrap().name.local_name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(names, ["a", "b", "c"]);

    let first = children[0].0;
    let second = children[1].0;
    let third = children[2].0;
    assert_eq!(arena.find_element_by_id("a"), Some(first));
    assert_eq!(arena.node(first).unwrap().parent, Some(body));
    assert_eq!(arena.node(second).unwrap().previous_sibling, Some(first));
    assert_eq!(arena.node(second).unwrap().next_sibling, Some(third));
    assert_eq!(arena.node(body).unwrap().last_child, Some(third));

    let descendant_names = arena
        .descendants(body)
        .filter_map(|(_, node)| node.as_element())
        .map(|element| element.name.local_name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(descendant_names, ["a", "x", "b", "c"]);
    assert_eq!(shared.node(first), arena.node(first));
}

#[test]
fn document_owns_exactly_one_root_element() {
    let arena = SourceArena::from_xhtml("<html><body/></html>").unwrap();
    let document_children = arena.children(arena.document()).collect::<Vec<_>>();
    assert_eq!(document_children.len(), 1);
    assert_eq!(document_children[0].0, arena.root());
    assert!(matches!(
        arena.node(arena.document()).unwrap().kind,
        SourceNodeKind::Document
    ));
    assert_eq!(arena.root(), arena.root_element());
    assert!(!arena.is_empty());
    assert_eq!(arena.iter().len(), arena.len());
}

#[test]
fn bounds_depth_before_the_recursive_xml_parser_runs() {
    let accepted = format!(
        "{}x{}",
        "<n>".repeat(MAX_SOURCE_DEPTH),
        "</n>".repeat(MAX_SOURCE_DEPTH)
    );
    assert_eq!(
        SourceArena::from_xhtml(&accepted).unwrap().len(),
        MAX_SOURCE_DEPTH + 2
    );

    let rejected = format!(
        "{}x{}",
        "<n>".repeat(MAX_SOURCE_DEPTH + 1),
        "</n>".repeat(MAX_SOURCE_DEPTH + 1)
    );
    assert!(matches!(
        SourceArena::from_xhtml(&rejected),
        Err(SourceError::TooDeep)
    ));
}

#[test]
fn renders_internal_dtd_entity_references_literally_without_expanding_them() {
    // The DTD is stripped and never expanded; the reference survives as
    // literal text, the way browsers render an undefined entity.
    let arena = SourceArena::from_xhtml(
        r#"<?xml version="1.0"?><!DOCTYPE html [<!ENTITY sample "expanded">]><html xmlns="http://www.w3.org/1999/xhtml"><body><p id="target">&sample;</p></body></html>"#,
    )
    .unwrap();
    let text: String = arena
        .iter()
        .filter_map(|(_, node)| match &node.kind {
            SourceNodeKind::Text(text) => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(text, "&sample;");
    assert!(!text.contains("expanded"));
}

#[test]
fn renders_recursive_dtd_entities_literally_without_expanding_them() {
    let arena = SourceArena::from_xhtml(
        r#"<!DOCTYPE html [<!ENTITY loop "&loop;">]><html><body>&loop;</body></html>"#,
    )
    .unwrap();
    let text: String = arena
        .iter()
        .filter_map(|(_, node)| match &node.kind {
            SourceNodeKind::Text(text) => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(text, "&loop;");
}

#[test]
fn accepts_external_document_type_without_loading_it() {
    let arena = SourceArena::from_xhtml(
        r#"<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "https://example.invalid/xhtml11.dtd"><html><body><p id="target">safe</p></body></html>"#,
    )
    .unwrap();
    let target = arena.find_element_by_id("target").unwrap();
    assert_eq!(
        arena.children(target).next().unwrap().1.as_text(),
        Some("safe")
    );
}

#[test]
fn canonical_entrypoint_repairs_supported_legacy_epub_forms() {
    let arena = SourceArena::from_xhtml(
        "<?xml version='1.0'?><html><body><p id='target'>a&nbsp;<br>b</p></body></html>",
    )
    .unwrap();
    let target = arena.find_element_by_id("target").unwrap();
    let children = arena.children(target).collect::<Vec<_>>();
    assert_eq!(children[0].1.as_text(), Some("a\u{a0}"));
    assert_eq!(children[1].1.as_element().unwrap().name.local_name, "br");
    assert_eq!(children[2].1.as_text(), Some("b"));
}

#[test]
fn malformed_non_void_markup_recovers_like_a_browser() {
    // A mis-nested inline element implicitly closes at its ancestor's
    // close, the way every browser's HTML recovery reads it — a
    // malformed calibre chapter must lay instead of vanishing from the
    // book (b39's 生日劵 story, an unclosed div).
    let arena = SourceArena::from_xhtml("<html><body><p><strong>text</p></body></html>")
        .expect("recovers");
    let text: String = arena
        .descendants(arena.root())
        .filter_map(|(_, node)| node.as_text().map(str::to_owned))
        .collect();
    assert_eq!(text, "text");
}
