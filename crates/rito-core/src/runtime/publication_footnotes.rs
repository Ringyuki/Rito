use std::collections::BTreeMap;

use crate::{
    epub::{EpubResult, LoadedEpubDocument},
    interaction::{
        collect_footnote_entries_for_targets, FootnoteEntry, FootnoteFilterChapter,
        FootnoteTargetDiscovery, FootnoteTargetSet,
    },
    xhtml::{parse_xhtml, DocumentNode},
};

use super::RuntimeDocument;

#[derive(Debug)]
pub(super) struct PublicationFootnoteIndex {
    pub(super) targets: FootnoteTargetSet,
    pub(super) footnotes: BTreeMap<String, FootnoteEntry>,
}

impl RuntimeDocument {
    /// Builds the immutable publication index on first use. The cold path
    /// performs two XHTML-only spine scans: one for noteref targets and one for
    /// matching definitions. Parsed trees are dropped per chapter and the
    /// result is reused by later partial revisions. Unreadable future sources
    /// are skipped so their existing load failure remains deferred.
    pub(super) fn publication_footnote_index(&mut self) -> EpubResult<&PublicationFootnoteIndex> {
        if self.publication_footnotes.get().is_none() {
            let index = build_publication_footnote_index(&self.document)?;
            self.publication_footnotes
                .set(index)
                .expect("publication footnote index is initialized once");
            #[cfg(test)]
            {
                self.publication_footnote_scan_count += 1;
            }
        }
        Ok(self
            .publication_footnotes
            .get()
            .expect("publication footnote index was initialized"))
    }

    #[cfg(test)]
    pub(super) fn publication_footnote_scan_count(&self) -> usize {
        self.publication_footnote_scan_count
    }
}

fn build_publication_footnote_index(
    document: &LoadedEpubDocument,
) -> EpubResult<PublicationFootnoteIndex> {
    let mut discovery =
        FootnoteTargetDiscovery::new(document.chapters.iter().map(|chapter| chapter.href.clone()));
    document.visit_available_chapter_sources(|chapter, source| {
        let nodes = parse_nodes(source);
        discovery.discover(&chapter.href, &nodes);
    })?;
    let targets = discovery.finish();
    let mut footnotes = BTreeMap::new();
    document.visit_available_chapter_sources(|chapter, source| {
        let nodes = parse_nodes(source);
        footnotes.extend(collect_footnote_entries_for_targets(
            &[FootnoteFilterChapter {
                idref: &chapter.idref,
                href: &chapter.href,
                nodes: &nodes,
            }],
            &targets,
        ));
    })?;
    Ok(PublicationFootnoteIndex { targets, footnotes })
}

fn parse_nodes(source: &str) -> Vec<DocumentNode> {
    parse_xhtml(source)
        .map(|parsed| parsed.nodes)
        .unwrap_or_default()
}
