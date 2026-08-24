use std::collections::{BTreeMap, BTreeSet};

use crate::xhtml::{DocumentNode, EpubTypeAttributeHint};

use super::{
    children, footnote_content, footnote_identity, node::parse_footnote_kind,
    resolve_noteref_target, FootnoteEntry, FootnoteTargetSet, HrefResolver,
};
#[cfg(test)]
use super::{noteref_target, FootnoteKind};

/// First-stage publication planner over lightweight source attributes.
///
/// It discovers the complete cross-chapter target set while retaining only
/// definition keys and chapter indices. No `DocumentNode` is kept. Once all
/// forward and backward references are known, only chapters that can own a
/// referenced definition are selected for semantic parsing.
#[derive(Debug)]
pub(crate) struct FootnoteIndexPlanBuilder {
    resolver: HrefResolver,
    targets: BTreeSet<String>,
    definition_keys: BTreeMap<usize, BTreeSet<String>>,
}

#[cfg(test)]
#[derive(Debug, Clone)]
pub(crate) struct FootnoteIndexPlan {
    pub(crate) targets: FootnoteTargetSet,
    pub(crate) definition_chapter_indices: Vec<usize>,
}

/// Second-stage extractor over the small set of selected semantic chapters.
/// It serializes referenced definitions directly from borrowed nodes and never
/// clones candidate subtrees. A targeted outer definition owns nested targeted
/// definitions, matching the compatibility collector.
pub(crate) struct FootnoteDefinitionBuilder {
    targets: FootnoteTargetSet,
    footnotes: BTreeMap<String, FootnoteEntry>,
}

impl FootnoteIndexPlanBuilder {
    pub(crate) fn new(hrefs: impl IntoIterator<Item = String>) -> Self {
        Self {
            resolver: HrefResolver::new(hrefs),
            targets: BTreeSet::new(),
            definition_keys: BTreeMap::new(),
        }
    }

    pub(crate) fn discover(
        &mut self,
        chapter_index: usize,
        chapter_href: &str,
        hints: &[EpubTypeAttributeHint],
    ) -> BTreeSet<String> {
        let mut chapter_targets = BTreeSet::new();
        for hint in hints {
            if hint
                .epub_type
                .split_whitespace()
                .any(|token| token == "noteref")
            {
                if let Some(target) = hint
                    .href
                    .as_deref()
                    .and_then(|href| resolve_noteref_target(href, chapter_href, &self.resolver))
                {
                    chapter_targets.insert(target.clone());
                    self.targets.insert(target);
                }
            }
            if !hint.is_block
                || !hint
                    .epub_type
                    .split_whitespace()
                    .any(|token| parse_footnote_kind(token).is_some())
            {
                continue;
            }
            let Some(id) = hint.id.as_deref() else {
                continue;
            };
            self.definition_keys
                .entry(chapter_index)
                .or_default()
                .insert(format!("{chapter_href}#{id}"));
        }
        chapter_targets
    }

    #[cfg(test)]
    pub(crate) fn finish(self) -> FootnoteIndexPlan {
        self.snapshot()
    }

    pub(crate) fn target_set(&self) -> FootnoteTargetSet {
        FootnoteTargetSet::new(self.targets.clone())
    }

    pub(crate) fn next_definition_work(
        &self,
        attempted: &BTreeSet<String>,
    ) -> Option<(usize, BTreeSet<String>)> {
        self.definition_keys
            .iter()
            .find_map(|(chapter_index, keys)| {
                let keys = keys
                    .iter()
                    .filter(|key| self.targets.contains(*key) && !attempted.contains(*key))
                    .cloned()
                    .collect::<BTreeSet<_>>();
                (!keys.is_empty()).then_some((*chapter_index, keys))
            })
    }

    pub(crate) fn definition_work_complete(&self, attempted: &BTreeSet<String>) -> bool {
        self.definition_keys
            .values()
            .flatten()
            .all(|key| !self.targets.contains(key) || attempted.contains(key))
    }

    #[cfg(test)]
    pub(crate) fn snapshot(&self) -> FootnoteIndexPlan {
        let targets = self.target_set();
        let definition_chapter_indices = self
            .definition_keys
            .iter()
            .filter(|(_, keys)| keys.iter().any(|key| targets.contains(key)))
            .map(|(chapter_index, _)| *chapter_index)
            .collect();
        FootnoteIndexPlan {
            targets,
            definition_chapter_indices,
        }
    }
}

impl FootnoteDefinitionBuilder {
    pub(crate) fn new(targets: &FootnoteTargetSet) -> Self {
        Self {
            targets: targets.clone(),
            footnotes: BTreeMap::new(),
        }
    }

    pub(crate) fn discover(&mut self, chapter_href: &str, nodes: &[DocumentNode]) {
        collect_referenced_nodes(nodes, chapter_href, &self.targets, &mut self.footnotes);
    }

    pub(crate) fn finish(self) -> BTreeMap<String, FootnoteEntry> {
        self.footnotes
    }
}

/// Semantic footnote collector.
///
/// This retains the all-semantic compatibility path used by focused tests.
/// Candidate trees preserve the rule that a targeted outer note owns any
/// targeted nested notes.
#[cfg(test)]
pub(crate) struct FootnoteIndexBuilder {
    resolver: HrefResolver,
    targets: BTreeSet<String>,
    candidates: Vec<FootnoteCandidate>,
}

#[cfg(test)]
impl FootnoteIndexBuilder {
    pub(crate) fn new(hrefs: impl IntoIterator<Item = String>) -> Self {
        Self {
            resolver: HrefResolver::new(hrefs),
            targets: BTreeSet::new(),
            candidates: Vec::new(),
        }
    }

    pub(crate) fn discover(&mut self, chapter_href: &str, nodes: &[DocumentNode]) {
        self.candidates.extend(collect_index_data(
            nodes,
            chapter_href,
            &self.resolver,
            &mut self.targets,
        ));
    }

    pub(crate) fn finish(self) -> (FootnoteTargetSet, BTreeMap<String, FootnoteEntry>) {
        let targets = FootnoteTargetSet::new(self.targets);
        let mut footnotes = BTreeMap::new();
        collect_referenced_candidates(self.candidates, &targets, &mut footnotes);
        (targets, footnotes)
    }
}

#[cfg(test)]
struct FootnoteCandidate {
    key: String,
    kind: FootnoteKind,
    content: Vec<DocumentNode>,
    nested: Vec<FootnoteCandidate>,
}

#[cfg(test)]
fn collect_index_data(
    nodes: &[DocumentNode],
    chapter_href: &str,
    resolver: &HrefResolver,
    targets: &mut BTreeSet<String>,
) -> Vec<FootnoteCandidate> {
    let mut candidates = Vec::new();
    for node in nodes {
        if let Some(target) = noteref_target(node, chapter_href, resolver) {
            targets.insert(target);
        }
        let nested = children(node)
            .map(|children| collect_index_data(children, chapter_href, resolver, targets))
            .unwrap_or_default();
        let Some((key, kind)) = footnote_identity(node, chapter_href) else {
            candidates.extend(nested);
            continue;
        };
        candidates.push(FootnoteCandidate {
            key,
            kind,
            content: children(node).unwrap_or_default().to_vec(),
            nested,
        });
    }
    candidates
}

#[cfg(test)]
fn collect_referenced_candidates(
    candidates: Vec<FootnoteCandidate>,
    targets: &FootnoteTargetSet,
    footnotes: &mut BTreeMap<String, FootnoteEntry>,
) {
    for candidate in candidates {
        if targets.contains(&candidate.key) {
            let (text, html) = footnote_content(&candidate.content);
            footnotes.insert(
                candidate.key,
                FootnoteEntry {
                    kind: candidate.kind,
                    text,
                    html,
                },
            );
        } else {
            collect_referenced_candidates(candidate.nested, targets, footnotes);
        }
    }
}

fn collect_referenced_nodes(
    nodes: &[DocumentNode],
    chapter_href: &str,
    targets: &FootnoteTargetSet,
    footnotes: &mut BTreeMap<String, FootnoteEntry>,
) {
    for node in nodes {
        if let Some((key, kind)) = footnote_identity(node, chapter_href) {
            if targets.contains(&key) {
                let (text, html) = footnote_content(children(node).unwrap_or_default());
                footnotes.insert(key, FootnoteEntry { kind, text, html });
                continue;
            }
        }
        if let Some(children) = children(node) {
            collect_referenced_nodes(children, chapter_href, targets, footnotes);
        }
    }
}
