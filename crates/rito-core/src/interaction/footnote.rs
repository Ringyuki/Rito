use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

use serde::{Deserialize, Serialize};

use crate::xhtml::{DocumentNode, ElementNode};

mod content;
mod href;
mod node;

#[cfg(test)]
mod tests;

use content::footnote_content;
use href::{decode_fragment, HrefResolver};
use node::{children, element_attributes, footnote_kind, is_noteref};

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
    /// Allowlist-sanitized HTML fragment preserving safe footnote structure.
    pub html: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct FootnoteTargetSet(Arc<BTreeSet<String>>);

impl FootnoteTargetSet {
    fn new(targets: BTreeSet<String>) -> Self {
        Self(Arc::new(targets))
    }

    fn contains(&self, target: &str) -> bool {
        self.0.contains(target)
    }
}

pub(crate) struct FootnoteTargetDiscovery {
    resolver: HrefResolver,
    targets: BTreeSet<String>,
}

impl FootnoteTargetDiscovery {
    pub(crate) fn new(hrefs: impl IntoIterator<Item = String>) -> Self {
        Self {
            resolver: HrefResolver::new(hrefs),
            targets: BTreeSet::new(),
        }
    }

    pub(crate) fn discover(&mut self, chapter_href: &str, nodes: &[DocumentNode]) {
        collect_noteref_targets(nodes, chapter_href, &self.resolver, &mut self.targets);
    }

    pub(crate) fn finish(self) -> FootnoteTargetSet {
        FootnoteTargetSet::new(self.targets)
    }
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

pub(crate) fn discover_footnote_targets(
    chapters: &[FootnoteFilterChapter<'_>],
) -> FootnoteTargetSet {
    let mut discovery =
        FootnoteTargetDiscovery::new(chapters.iter().map(|chapter| chapter.href.to_owned()));
    for chapter in chapters {
        discovery.discover(chapter.href, chapter.nodes);
    }
    discovery.finish()
}

pub(crate) fn extract_footnotes_for_targets(
    chapters: &[FootnoteFilterChapter<'_>],
    targets: &FootnoteTargetSet,
) -> FootnoteExtraction {
    let mut footnotes = BTreeMap::new();
    let filtered_chapters = chapters
        .iter()
        .map(|chapter| {
            (
                chapter.idref.to_owned(),
                remove_matching_footnotes(chapter.nodes, chapter.href, targets, &mut footnotes),
            )
        })
        .collect();
    FootnoteExtraction {
        filtered_chapters,
        footnotes,
    }
}

pub(crate) fn collect_footnote_entries_for_targets(
    chapters: &[FootnoteFilterChapter<'_>],
    targets: &FootnoteTargetSet,
) -> BTreeMap<String, FootnoteEntry> {
    let mut footnotes = BTreeMap::new();
    for chapter in chapters {
        collect_matching_footnotes(chapter.nodes, chapter.href, targets, &mut footnotes);
    }
    footnotes
}

#[cfg(test)]
fn extract_referenced_footnotes(chapters: &[FootnoteFilterChapter<'_>]) -> FootnoteExtraction {
    let targets = discover_footnote_targets(chapters);
    extract_footnotes_for_targets(chapters, &targets)
}

#[cfg(test)]
fn filter_referenced_footnotes(
    chapters: &[FootnoteFilterChapter<'_>],
) -> BTreeMap<String, Vec<DocumentNode>> {
    extract_referenced_footnotes(chapters).filtered_chapters
}

fn collect_noteref_targets(
    nodes: &[DocumentNode],
    chapter_href: &str,
    resolver: &HrefResolver,
    targets: &mut BTreeSet<String>,
) {
    for node in nodes {
        if is_noteref(node) {
            let target = element_attributes(node)
                .and_then(|attributes| attributes.href.as_deref())
                .and_then(|href| resolve_noteref_target(href, chapter_href, resolver));
            if let Some(target) = target {
                targets.insert(target);
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
    let fragment = decode_fragment(fragment);
    if hash_index == 0 {
        return Some(format!("{chapter_href}#{fragment}"));
    }
    resolver
        .resolve(chapter_href, &href[..hash_index])
        .map(|resolved| format!("{resolved}#{fragment}"))
}

fn collect_matching_footnotes(
    nodes: &[DocumentNode],
    chapter_href: &str,
    targets: &FootnoteTargetSet,
    footnotes: &mut BTreeMap<String, FootnoteEntry>,
) {
    for node in nodes {
        if let Some((key, entry)) = referenced_footnote_entry(node, chapter_href, targets) {
            footnotes.insert(key, entry);
        } else if let Some(children) = children(node) {
            collect_matching_footnotes(children, chapter_href, targets, footnotes);
        }
    }
}

fn remove_matching_footnotes(
    nodes: &[DocumentNode],
    chapter_href: &str,
    targets: &FootnoteTargetSet,
    footnotes: &mut BTreeMap<String, FootnoteEntry>,
) -> Vec<DocumentNode> {
    let mut filtered = Vec::with_capacity(nodes.len());
    for node in nodes {
        if let Some((key, entry)) = referenced_footnote_entry(node, chapter_href, targets) {
            footnotes.insert(key, entry);
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
    targets: &FootnoteTargetSet,
) -> Option<(String, FootnoteEntry)> {
    let kind = footnote_kind(node)?;
    let id = element_attributes(node)?.id.as_deref()?;
    let key = format!("{chapter_href}#{id}");
    if !targets.contains(&key) {
        return None;
    }
    let (text, html) = footnote_content(children(node).unwrap_or_default());
    Some((key, FootnoteEntry { kind, text, html }))
}

fn remove_child_footnotes(
    node: &DocumentNode,
    chapter_href: &str,
    targets: &FootnoteTargetSet,
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
    targets: &FootnoteTargetSet,
    footnotes: &mut BTreeMap<String, FootnoteEntry>,
) -> ElementNode {
    let mut filtered = element.clone();
    filtered.children =
        remove_matching_footnotes(&element.children, chapter_href, targets, footnotes);
    filtered
}
