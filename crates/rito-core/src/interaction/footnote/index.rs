use std::collections::{BTreeMap, BTreeSet};

use crate::xhtml::DocumentNode;

use super::{
    children, footnote_content, footnote_identity, noteref_target, FootnoteEntry, FootnoteKind,
    FootnoteTargetSet, HrefResolver,
};

/// Single-pass publication footnote discovery.
///
/// Every available chapter source is parsed and its tree visited once. Noteref
/// targets are known only after the last chapter, so typed note definitions are
/// retained as a candidate tree and filtered in `finish`. The tree preserves
/// the old two-pass rule that a targeted outer note owns any targeted nested
/// notes.
pub(crate) struct FootnoteIndexBuilder {
    resolver: HrefResolver,
    targets: BTreeSet<String>,
    candidates: Vec<FootnoteCandidate>,
}

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

struct FootnoteCandidate {
    key: String,
    kind: FootnoteKind,
    content: Vec<DocumentNode>,
    nested: Vec<FootnoteCandidate>,
}

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
