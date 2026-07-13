use std::collections::BTreeMap;

use crate::{
    epub::{EpubResult, LoadedEpubDocument},
    interaction::{FootnoteEntry, FootnoteIndexBuilder, FootnoteTargetSet},
    xhtml::{parse_xhtml, DocumentNode},
};

use super::RuntimeDocument;

#[derive(Debug)]
pub(super) struct PublicationFootnoteIndex {
    pub(super) targets: FootnoteTargetSet,
    pub(super) footnotes: BTreeMap<String, FootnoteEntry>,
    #[cfg(test)]
    pub(super) source_parse_count: usize,
}

impl RuntimeDocument {
    /// Builds the immutable publication index on first use. The cold path
    /// performs one XHTML-only spine scan that collects noteref targets and
    /// candidate definitions together. Parsed trees are dropped per chapter;
    /// candidates are filtered once all cross-chapter targets are known. The
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
        FootnoteIndexBuilder::new(document.chapters.iter().map(|chapter| chapter.href.clone()));
    #[cfg(test)]
    let mut source_parse_count = 0;
    document.visit_available_chapter_sources(|chapter, source| {
        #[cfg(test)]
        {
            source_parse_count += 1;
        }
        let nodes = parse_nodes(source);
        discovery.discover(&chapter.href, &nodes);
    })?;
    let (targets, footnotes) = discovery.finish();
    Ok(PublicationFootnoteIndex {
        targets,
        footnotes,
        #[cfg(test)]
        source_parse_count,
    })
}

fn parse_nodes(source: &str) -> Vec<DocumentNode> {
    parse_xhtml(source)
        .map(|parsed| parsed.nodes)
        .unwrap_or_default()
}
