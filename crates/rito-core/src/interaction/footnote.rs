use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

use serde::{Deserialize, Serialize};

use crate::xhtml::{DocumentNode, ElementNode};

mod content;
mod href;
mod index;
mod node;

#[cfg(test)]
mod tests;

use content::footnote_content;
use href::{decode_fragment, HrefResolver};
#[cfg(test)]
pub(crate) use index::FootnoteIndexBuilder;
pub(crate) use index::{FootnoteDefinitionBuilder, FootnoteIndexPlanBuilder};
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
    pub(crate) fn new(targets: BTreeSet<String>) -> Self {
        Self(Arc::new(targets))
    }

    pub(crate) fn contains(&self, target: &str) -> bool {
        self.0.contains(target)
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = &String> {
        self.0.iter()
    }

    pub(crate) fn union(&self, other: &Self) -> Self {
        if self.0.is_empty() {
            return other.clone();
        }
        if other.0.is_empty() {
            return self.clone();
        }
        Self::new(self.0.union(&other.0).cloned().collect())
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
        if let Some(target) = noteref_target(node, chapter_href, resolver) {
            targets.insert(target);
        }
        if let Some(children) = children(node) {
            collect_noteref_targets(children, chapter_href, resolver, targets);
        }
    }
}

fn noteref_target(
    node: &DocumentNode,
    chapter_href: &str,
    resolver: &HrefResolver,
) -> Option<String> {
    if !is_noteref(node) {
        return None;
    }
    element_attributes(node)
        .and_then(|attributes| attributes.href.as_deref())
        .and_then(|href| resolve_noteref_target(href, chapter_href, resolver))
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
    let (key, kind) = footnote_identity(node, chapter_href)?;
    if !targets.contains(&key) {
        return None;
    }
    let (text, html) = footnote_content(children(node).unwrap_or_default());
    Some((key, FootnoteEntry { kind, text, html }))
}

fn footnote_identity(node: &DocumentNode, chapter_href: &str) -> Option<(String, FootnoteKind)> {
    let kind = footnote_kind(node)?;
    let id = element_attributes(node)?.id.as_deref()?;
    Some((format!("{chapter_href}#{id}"), kind))
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
