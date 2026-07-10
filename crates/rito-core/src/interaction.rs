pub const NAME: &str = "interaction";
pub const OWNS: &str = "Hit maps, locators, selection, search, anchors, annotations, and footnotes";

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::xhtml::{DocumentNode, ElementAttributes, ElementNode};

#[cfg(test)]
use crate::xhtml::parse_xhtml;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionSummary {
    pub chapter_text_index_ids: Vec<String>,
    pub footnote_keys: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub footnotes: BTreeMap<String, FootnoteEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FootnoteKind {
    Footnote,
    Endnote,
    Rearnote,
    Note,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FootnoteEntry {
    pub kind: FootnoteKind,
    pub text: String,
    pub html: String,
}

#[cfg(test)]
pub(crate) struct InteractionChapterInput<'a> {
    pub idref: &'a str,
    pub href: &'a str,
    pub xhtml_source: &'a str,
}

pub(crate) struct ParsedInteractionChapterInput<'a> {
    pub idref: &'a str,
    pub href: &'a str,
    pub nodes: &'a [DocumentNode],
}

#[cfg(test)]
pub(crate) fn summarize_interaction<'a>(
    chapters: impl IntoIterator<Item = InteractionChapterInput<'a>>,
) -> InteractionSummary {
    let chapters = chapters
        .into_iter()
        .map(|chapter| {
            let parsed =
                parse_xhtml(chapter.xhtml_source).unwrap_or_else(|_| crate::xhtml::ParseResult {
                    nodes: Vec::new(),
                    warnings: Vec::new(),
                    body_attributes: None,
                    stylesheet_hrefs: None,
                    embedded_stylesheets: None,
                });
            ParsedInteractionChapter {
                idref: chapter.idref.to_owned(),
                href: chapter.href.to_owned(),
                nodes: parsed.nodes,
            }
        })
        .collect::<Vec<_>>();

    summarize_interaction_from_parsed(chapters.iter().map(|chapter| {
        ParsedInteractionChapterInput {
            idref: &chapter.idref,
            href: &chapter.href,
            nodes: &chapter.nodes,
        }
    }))
}

pub(crate) fn summarize_interaction_from_parsed<'a>(
    chapters: impl IntoIterator<Item = ParsedInteractionChapterInput<'a>>,
) -> InteractionSummary {
    let chapters = chapters.into_iter().collect::<Vec<_>>();
    let footnote_inputs = chapters
        .iter()
        .map(|chapter| FootnoteFilterChapter {
            idref: chapter.idref,
            href: chapter.href,
            nodes: chapter.nodes,
        })
        .collect::<Vec<_>>();
    let footnote_extraction = extract_referenced_footnotes(&footnote_inputs);
    let footnote_keys = footnote_extraction.footnotes.keys().cloned().collect();
    let mut chapter_text_index_ids = chapters
        .iter()
        .map(|chapter| chapter.idref.to_owned())
        .collect::<Vec<_>>();
    chapter_text_index_ids.sort();

    InteractionSummary {
        chapter_text_index_ids,
        footnote_keys,
        footnotes: footnote_extraction.footnotes,
    }
}

#[cfg(test)]
struct ParsedInteractionChapter {
    idref: String,
    href: String,
    nodes: Vec<DocumentNode>,
}

pub(crate) struct FootnoteFilterChapter<'a> {
    pub(crate) idref: &'a str,
    pub(crate) href: &'a str,
    pub(crate) nodes: &'a [DocumentNode],
}

pub(crate) struct FootnoteExtraction {
    pub(crate) filtered_chapters: BTreeMap<String, Vec<DocumentNode>>,
    pub(crate) footnotes: BTreeMap<String, FootnoteEntry>,
}

pub(crate) fn filter_referenced_footnotes(
    chapters: &[FootnoteFilterChapter<'_>],
) -> BTreeMap<String, Vec<DocumentNode>> {
    extract_referenced_footnotes(chapters).filtered_chapters
}

pub(crate) fn extract_referenced_footnotes(
    chapters: &[FootnoteFilterChapter<'_>],
) -> FootnoteExtraction {
    let resolver = HrefResolver::new(chapters.iter().map(|chapter| chapter.href.to_owned()));
    let mut targets = BTreeSet::new();
    for chapter in chapters {
        collect_noteref_targets(chapter.nodes, chapter.href, &resolver, &mut targets);
    }
    let mut footnotes = BTreeMap::new();

    let filtered_chapters = chapters
        .iter()
        .map(|chapter| {
            (
                chapter.idref.to_owned(),
                remove_matching_footnotes(chapter.nodes, chapter.href, &targets, &mut footnotes),
            )
        })
        .collect();
    FootnoteExtraction {
        filtered_chapters,
        footnotes,
    }
}

fn collect_noteref_targets(
    nodes: &[DocumentNode],
    chapter_href: &str,
    resolver: &HrefResolver,
    targets: &mut BTreeSet<String>,
) {
    for node in nodes {
        if is_noteref(node) {
            if let Some(href) =
                element_attributes(node).and_then(|attributes| attributes.href.as_deref())
            {
                if let Some(target) = resolve_noteref_target(href, chapter_href, resolver) {
                    targets.insert(target);
                }
            }
        }
        if let Some(children) = children(node) {
            collect_noteref_targets(children, chapter_href, resolver, targets);
        }
    }
}

fn resolve_noteref_target(
    href: &str,
    chapter_href: &str,
    resolver: &HrefResolver,
) -> Option<String> {
    let hash_index = href.find('#')?;
    let fragment = href[hash_index + 1..].trim();
    if fragment.is_empty() {
        return None;
    }
    if hash_index == 0 {
        return Some(format!("{chapter_href}#{fragment}"));
    }

    let file_part = &href[..hash_index];
    resolver
        .resolve(file_part)
        .map(|resolved| format!("{resolved}#{fragment}"))
}

fn remove_matching_footnotes(
    nodes: &[DocumentNode],
    chapter_href: &str,
    targets: &BTreeSet<String>,
    footnotes: &mut BTreeMap<String, FootnoteEntry>,
) -> Vec<DocumentNode> {
    let mut filtered = Vec::with_capacity(nodes.len());
    for node in nodes {
        if let Some(entry) = referenced_footnote_entry(node, chapter_href, targets) {
            footnotes.insert(entry.0, entry.1);
            continue;
        }
        filtered.push(remove_child_footnotes(
            node,
            chapter_href,
            targets,
            footnotes,
        ));
    }
    filtered
}

fn referenced_footnote_entry(
    node: &DocumentNode,
    chapter_href: &str,
    targets: &BTreeSet<String>,
) -> Option<(String, FootnoteEntry)> {
    let kind = footnote_kind(node)?;
    let id = element_attributes(node).and_then(|attributes| attributes.id.as_deref())?;
    let key = format!("{chapter_href}#{id}");
    if !targets.contains(&key) {
        return None;
    }
    let note_children = children(node).unwrap_or(&[]);
    Some((
        key,
        FootnoteEntry {
            kind,
            text: collect_text(note_children),
            html: serialize_html(note_children),
        },
    ))
}

fn remove_child_footnotes(
    node: &DocumentNode,
    chapter_href: &str,
    targets: &BTreeSet<String>,
    footnotes: &mut BTreeMap<String, FootnoteEntry>,
) -> DocumentNode {
    match node {
        DocumentNode::Block(element) => {
            DocumentNode::Block(filtered_element(element, chapter_href, targets, footnotes))
        }
        DocumentNode::Inline(element) => {
            DocumentNode::Inline(filtered_element(element, chapter_href, targets, footnotes))
        }
        DocumentNode::Image(image) => DocumentNode::Image(image.clone()),
        DocumentNode::Text(text) => DocumentNode::Text(text.clone()),
    }
}

fn filtered_element(
    element: &ElementNode,
    chapter_href: &str,
    targets: &BTreeSet<String>,
    footnotes: &mut BTreeMap<String, FootnoteEntry>,
) -> ElementNode {
    let mut filtered = element.clone();
    filtered.children =
        remove_matching_footnotes(&element.children, chapter_href, targets, footnotes);
    filtered
}

fn is_noteref(node: &DocumentNode) -> bool {
    matches!(node, DocumentNode::Block(_) | DocumentNode::Inline(_))
        && has_epub_type(node, |token| token == "noteref")
}

fn footnote_kind(node: &DocumentNode) -> Option<FootnoteKind> {
    if !matches!(node, DocumentNode::Block(_)) {
        return None;
    }
    element_attributes(node)
        .and_then(|attributes| attributes.all_attributes.as_ref())
        .and_then(|attributes| attributes.get("epub:type"))
        .and_then(|value| value.split_whitespace().find_map(parse_footnote_kind))
}

fn parse_footnote_kind(token: &str) -> Option<FootnoteKind> {
    match token {
        "footnote" => Some(FootnoteKind::Footnote),
        "endnote" => Some(FootnoteKind::Endnote),
        "rearnote" => Some(FootnoteKind::Rearnote),
        "note" => Some(FootnoteKind::Note),
        _ => None,
    }
}

fn collect_text(nodes: &[DocumentNode]) -> String {
    let mut text = String::new();
    for node in nodes {
        match node {
            DocumentNode::Text(text_node) => text.push_str(&text_node.content),
            DocumentNode::Block(element) => {
                let nested = collect_text(&element.children);
                let nested = nested.trim();
                if !nested.is_empty() {
                    if !text.is_empty() && !text.ends_with(' ') {
                        text.push(' ');
                    }
                    text.push_str(nested);
                }
            }
            DocumentNode::Inline(element) => text.push_str(&collect_text(&element.children)),
            DocumentNode::Image(_) => {}
        }
    }
    text.trim().to_owned()
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
        DocumentNode::Block(element) | DocumentNode::Inline(element) => {
            format!(
                "<{}{}>{}</{}>",
                element.tag,
                serialize_attrs(element.attributes.as_ref()),
                serialize_html(&element.children),
                element.tag
            )
        }
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

fn has_epub_type(node: &DocumentNode, predicate: impl Fn(&str) -> bool) -> bool {
    element_attributes(node)
        .and_then(|attributes| attributes.all_attributes.as_ref())
        .and_then(|attributes| attributes.get("epub:type"))
        .is_some_and(|value| value.split_whitespace().any(predicate))
}

fn element_attributes(node: &DocumentNode) -> Option<&ElementAttributes> {
    match node {
        DocumentNode::Block(element) | DocumentNode::Inline(element) => element.attributes.as_ref(),
        DocumentNode::Image(image) => image.attributes.as_ref(),
        DocumentNode::Text(_) => None,
    }
}

fn children(node: &DocumentNode) -> Option<&[DocumentNode]> {
    match node {
        DocumentNode::Block(ElementNode { children, .. })
        | DocumentNode::Inline(ElementNode { children, .. }) => Some(children),
        DocumentNode::Image(_) | DocumentNode::Text(_) => None,
    }
}

struct HrefResolver {
    by_href: BTreeSet<String>,
    by_basename: BTreeMap<String, Option<String>>,
    by_suffix: BTreeMap<String, Option<String>>,
}

impl HrefResolver {
    fn new(hrefs: impl IntoIterator<Item = String>) -> Self {
        let mut resolver = Self {
            by_href: BTreeSet::new(),
            by_basename: BTreeMap::new(),
            by_suffix: BTreeMap::new(),
        };
        for href in hrefs {
            resolver.add_href(href);
        }
        resolver
    }

    fn add_href(&mut self, href: String) {
        self.by_href.insert(href.clone());
        let parts = href.split('/').collect::<Vec<_>>();
        for index in 1..parts.len() {
            insert_unique(&mut self.by_suffix, parts[index..].join("/"), href.clone());
        }
        if let Some(basename) = parts.last() {
            insert_unique(&mut self.by_basename, (*basename).to_owned(), href);
        }
    }

    fn resolve(&self, src: &str) -> Option<String> {
        if self.by_href.contains(src) {
            return Some(src.to_owned());
        }

        let normalized = strip_relative_prefix(src);
        if let Some(Some(href)) = self.by_suffix.get(&normalized) {
            return Some(href.clone());
        }
        if normalized != src && self.by_href.contains(&normalized) {
            return Some(normalized);
        }

        let parts = normalized.split('/').collect::<Vec<_>>();
        for index in 1..parts.len() {
            let suffix = parts[index..].join("/");
            if self.by_href.contains(&suffix) {
                return Some(suffix);
            }
        }

        parts
            .last()
            .and_then(|basename| self.by_basename.get(*basename))
            .and_then(Clone::clone)
    }
}

fn insert_unique(map: &mut BTreeMap<String, Option<String>>, key: String, value: String) {
    map.entry(key)
        .and_modify(|entry| *entry = None)
        .or_insert(Some(value));
}

fn strip_relative_prefix(src: &str) -> String {
    let mut result = src;
    while let Some(rest) = result.strip_prefix("../") {
        result = rest;
    }
    result.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn footnote_filter_removes_only_referenced_same_chapter_notes() {
        let parsed = parse_xhtml(
            r##"
            <html xmlns:epub="http://www.idpf.org/2007/ops">
              <body>
                <p>Body<a epub:type="noteref" href="#fn1">1</a></p>
                <aside epub:type="footnote" id="fn1"><p>Referenced <a href="more.xhtml">note</a></p></aside>
                <aside epub:type="footnote" id="fn2"><p>Unreferenced note</p></aside>
              </body>
            </html>
            "##,
        )
        .expect("parse chapter");
        let extracted = extract_referenced_footnotes(&[FootnoteFilterChapter {
            idref: "ch1",
            href: "Text/ch1.xhtml",
            nodes: &parsed.nodes,
        }]);
        let nodes = extracted
            .filtered_chapters
            .get("ch1")
            .expect("filtered chapter");
        let footnote = extracted
            .footnotes
            .get("Text/ch1.xhtml#fn1")
            .expect("referenced footnote is extracted");

        assert!(!contains_element_id(nodes, "fn1"));
        assert!(contains_element_id(nodes, "fn2"));
        assert_eq!(footnote.kind, FootnoteKind::Footnote);
        assert_eq!(footnote.text, "Referenced note");
        assert_eq!(
            footnote.html,
            r#"<p>Referenced <a href="more.xhtml">note</a></p>"#
        );
    }

    #[test]
    fn footnote_filter_resolves_cross_chapter_noterefs() {
        let body = parse_xhtml(
            r##"
            <html xmlns:epub="http://www.idpf.org/2007/ops">
              <body><p><a epub:type="noteref" href="../Text/notes.xhtml#fn1">1</a></p></body>
            </html>
            "##,
        )
        .expect("parse body chapter");
        let notes = parse_xhtml(
            r##"
            <html xmlns:epub="http://www.idpf.org/2007/ops">
              <body><aside epub:type="footnote" id="fn1"><p>Cross note</p></aside></body>
            </html>
            "##,
        )
        .expect("parse notes chapter");
        let filtered = filter_referenced_footnotes(&[
            FootnoteFilterChapter {
                idref: "body",
                href: "Text/body.xhtml",
                nodes: &body.nodes,
            },
            FootnoteFilterChapter {
                idref: "notes",
                href: "Text/notes.xhtml",
                nodes: &notes.nodes,
            },
        ]);
        let notes = filtered.get("notes").expect("filtered notes chapter");

        assert!(!contains_element_id(notes, "fn1"));
    }

    #[test]
    fn summarize_interaction_includes_structured_footnotes() {
        let summary = summarize_interaction([InteractionChapterInput {
            idref: "ch1",
            href: "Text/ch1.xhtml",
            xhtml_source: r##"
            <html xmlns:epub="http://www.idpf.org/2007/ops">
              <body>
                <p>Body<a epub:type="noteref" href="#fn1">1</a></p>
                <aside epub:type="endnote" id="fn1"><p>Referenced &amp; escaped</p></aside>
              </body>
            </html>
            "##,
        }]);
        let footnote = summary
            .footnotes
            .get("Text/ch1.xhtml#fn1")
            .expect("footnote entry is retained");

        assert_eq!(summary.footnote_keys, vec!["Text/ch1.xhtml#fn1"]);
        assert_eq!(footnote.kind, FootnoteKind::Endnote);
        assert_eq!(footnote.text, "Referenced & escaped");
        assert_eq!(footnote.html, "<p>Referenced &amp; escaped</p>");
    }

    fn contains_element_id(nodes: &[DocumentNode], id: &str) -> bool {
        nodes.iter().any(|node| {
            element_attributes(node).and_then(|attributes| attributes.id.as_deref()) == Some(id)
                || children(node).is_some_and(|children| contains_element_id(children, id))
        })
    }
}
