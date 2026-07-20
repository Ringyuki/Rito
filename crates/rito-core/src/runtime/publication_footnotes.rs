use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use crate::{
    epub::{ChapterSourceScanSession, EpubResult, LoadedEpubDocument},
    interaction::{
        FootnoteDefinitionBuilder, FootnoteEntry, FootnoteIndexPlanBuilder, FootnoteTargetSet,
    },
    xhtml::{parse_xhtml, scan_epub_type_attribute_hints, DocumentNode},
};

use super::RuntimeDocument;

/// `(footnotes, pending_keys, complete)` as installed on bounded revisions.
pub(super) type PublicationFootnoteSnapshot = (
    Option<Arc<BTreeMap<String, FootnoteEntry>>>,
    BTreeSet<String>,
    bool,
);

#[derive(Debug, Clone)]
pub(super) struct PublicationFootnoteIndex {
    pub(super) targets: FootnoteTargetSet,
    pub(super) footnotes: Arc<BTreeMap<String, FootnoteEntry>>,
    #[cfg(test)]
    pub(super) source_scan_count: usize,
    #[cfg(test)]
    pub(super) definition_parse_count: usize,
}

#[derive(Debug)]
pub(super) struct PublicationFootnoteProgress {
    chapter_count: usize,
    source_session: ChapterSourceScanSession,
    planning: FootnoteIndexPlanBuilder,
    chapter_targets: BTreeMap<usize, BTreeSet<String>>,
    scanned_chapters: BTreeSet<usize>,
    attempted_definition_keys: BTreeSet<String>,
    footnotes: BTreeMap<String, FootnoteEntry>,
    #[cfg(test)]
    source_scan_count: usize,
    #[cfg(test)]
    definition_parse_count: usize,
}

impl PublicationFootnoteProgress {
    fn new(document: &LoadedEpubDocument) -> Self {
        Self {
            chapter_count: document.chapters.len(),
            source_session: document.chapter_source_scan_session(),
            planning: FootnoteIndexPlanBuilder::new(
                document.chapters.iter().map(|chapter| chapter.href.clone()),
            ),
            chapter_targets: BTreeMap::new(),
            scanned_chapters: BTreeSet::new(),
            attempted_definition_keys: BTreeSet::new(),
            footnotes: BTreeMap::new(),
            #[cfg(test)]
            source_scan_count: 0,
            #[cfg(test)]
            definition_parse_count: 0,
        }
    }

    fn scan_chapter(
        &mut self,
        document: &LoadedEpubDocument,
        chapter_index: usize,
    ) -> EpubResult<()> {
        if self.scanned_chapters.contains(&chapter_index) {
            return Ok(());
        }
        let mut chapter_targets = BTreeSet::new();
        let planning = &mut self.planning;
        #[cfg(test)]
        let source_scan_count = &mut self.source_scan_count;
        document.visit_available_chapter_source_with_session(
            &mut self.source_session,
            chapter_index,
            |_index, chapter, source| {
                #[cfg(test)]
                {
                    *source_scan_count += 1;
                }
                let hints = scan_epub_type_attribute_hints(source).unwrap_or_default();
                chapter_targets = planning.discover(chapter_index, &chapter.href, &hints);
            },
        )?;
        self.chapter_targets.insert(chapter_index, chapter_targets);
        self.scanned_chapters.insert(chapter_index);
        Ok(())
    }

    fn advance_once(&mut self, document: &LoadedEpubDocument) -> EpubResult<()> {
        if let Some(chapter_index) =
            (0..document.chapters.len()).find(|index| !self.scanned_chapters.contains(index))
        {
            return self.scan_chapter(document, chapter_index);
        }

        let Some((chapter_index, keys)) = self
            .planning
            .next_definition_work(&self.attempted_definition_keys)
        else {
            return Ok(());
        };

        let targets = self.planning.target_set();
        let mut definitions = FootnoteDefinitionBuilder::new(&targets);
        #[cfg(test)]
        let definition_parse_count = &mut self.definition_parse_count;
        document.visit_available_chapter_source_with_session(
            &mut self.source_session,
            chapter_index,
            |_index, chapter, source| {
                #[cfg(test)]
                {
                    *definition_parse_count += 1;
                }
                definitions.discover(&chapter.href, &parse_nodes(source));
            },
        )?;
        self.footnotes.extend(definitions.finish());
        self.attempted_definition_keys.extend(keys);
        Ok(())
    }

    fn is_complete(&self) -> bool {
        if self.scanned_chapters.len() != self.chapter_count {
            return false;
        }
        self.planning
            .definition_work_complete(&self.attempted_definition_keys)
    }

    fn take_index(&mut self) -> PublicationFootnoteIndex {
        PublicationFootnoteIndex {
            targets: self.planning.target_set(),
            footnotes: Arc::new(std::mem::take(&mut self.footnotes)),
            #[cfg(test)]
            source_scan_count: self.source_scan_count,
            #[cfg(test)]
            definition_parse_count: self.definition_parse_count,
        }
    }

    fn record_prepared_footnotes(&mut self, footnotes: BTreeMap<String, FootnoteEntry>) {
        self.footnotes.extend(footnotes);
    }

    fn targets(&self) -> FootnoteTargetSet {
        self.planning.target_set()
    }

    fn chapter_interactions(
        &self,
        chapter_index: usize,
    ) -> (BTreeMap<String, FootnoteEntry>, BTreeSet<String>, bool) {
        let chapter_targets = self
            .chapter_targets
            .get(&chapter_index)
            .cloned()
            .unwrap_or_default();
        let footnotes = chapter_targets
            .iter()
            .filter_map(|key| {
                self.footnotes
                    .get(key)
                    .map(|entry| (key.clone(), entry.clone()))
            })
            .collect::<BTreeMap<_, _>>();
        let pending = chapter_targets
            .into_iter()
            .filter(|key| !footnotes.contains_key(key))
            .collect();
        (footnotes, pending, self.is_complete())
    }
}

impl RuntimeDocument {
    /// Explicit compatibility API. It drains the cooperative index to a final
    /// immutable snapshot; Reader-v1 foreground paths never call this method.
    pub(super) fn publication_footnote_index(&mut self) -> EpubResult<&PublicationFootnoteIndex> {
        while self.publication_footnotes.get().is_none() {
            self.advance_publication_footnote_index_once()?;
        }
        Ok(self
            .publication_footnotes
            .get()
            .expect("publication footnote index was initialized"))
    }

    /// Performs at most one source scan or one selected definition parse.
    /// Returns true only after every spine source and selected definition has
    /// been accounted for.
    pub(super) fn advance_publication_footnote_index_once(&mut self) -> EpubResult<bool> {
        if self.publication_footnotes.get().is_some() {
            return Ok(true);
        }
        let mut progress = self
            .publication_footnote_progress
            .take()
            .unwrap_or_else(|| PublicationFootnoteProgress::new(&self.document));
        let advance = progress.advance_once(&self.document);
        if let Err(error) = advance {
            self.publication_footnote_progress = Some(progress);
            return Err(error);
        }
        let complete = progress.is_complete();
        if complete {
            progress.source_session.release();
            self.publication_footnotes
                .set(progress.take_index())
                .expect("publication footnote index is initialized once");
            #[cfg(test)]
            {
                self.publication_footnote_scan_count += 1;
            }
        }
        self.publication_footnote_progress = Some(progress);
        Ok(complete)
    }

    pub(super) fn publication_footnote_index_is_complete(&self) -> bool {
        self.publication_footnotes.get().is_some()
    }

    /// Foreground admission scans only the chapter being opened. This is the
    /// hard upper bound that prevents a large spine from delaying first paint.
    pub(super) fn prepare_chapter_footnote_targets(
        &mut self,
        chapter_index: usize,
    ) -> EpubResult<FootnoteTargetSet> {
        if let Some(index) = self.publication_footnotes.get() {
            return Ok(index.targets.clone());
        }
        let mut progress = self
            .publication_footnote_progress
            .take()
            .unwrap_or_else(|| PublicationFootnoteProgress::new(&self.document));
        let scan = progress.scan_chapter(&self.document, chapter_index);
        if let Err(error) = scan {
            self.publication_footnote_progress = Some(progress);
            return Err(error);
        }
        let targets = progress.targets();
        self.publication_footnote_progress = Some(progress);
        Ok(targets)
    }

    pub(super) fn record_prepared_chapter_footnotes(
        &mut self,
        footnotes: BTreeMap<String, FootnoteEntry>,
    ) {
        if self.publication_footnotes.get().is_some() || footnotes.is_empty() {
            return;
        }
        if self.publication_footnote_progress.is_none() {
            self.publication_footnote_progress =
                Some(PublicationFootnoteProgress::new(&self.document));
        }
        self.publication_footnote_progress
            .as_mut()
            .expect("publication footnote progress was initialized")
            .record_prepared_footnotes(footnotes);
    }

    pub(super) fn chapter_footnote_interactions(
        &self,
        chapter_index: usize,
    ) -> (BTreeMap<String, FootnoteEntry>, BTreeSet<String>, bool) {
        if let Some(index) = self.publication_footnotes.get() {
            let chapter_targets = self
                .publication_footnote_progress
                .as_ref()
                .and_then(|progress| progress.chapter_targets.get(&chapter_index))
                .cloned()
                .unwrap_or_default();
            let footnotes = chapter_targets
                .iter()
                .filter_map(|key| {
                    index
                        .footnotes
                        .get(key)
                        .map(|entry| (key.clone(), entry.clone()))
                })
                .collect::<BTreeMap<_, _>>();
            let pending = chapter_targets
                .into_iter()
                .filter(|key| !footnotes.contains_key(key))
                .collect();
            return (footnotes, pending, true);
        }
        self.publication_footnote_progress
            .as_ref()
            .map(|progress| progress.chapter_interactions(chapter_index))
            .unwrap_or_else(|| (BTreeMap::new(), BTreeSet::new(), false))
    }

    pub(super) fn publication_footnote_snapshot(&self) -> PublicationFootnoteSnapshot {
        if let Some(index) = self.publication_footnotes.get() {
            let pending = index
                .targets
                .iter()
                .filter(|key| !index.footnotes.contains_key(key.as_str()))
                .cloned()
                .collect();
            return (Some(Arc::clone(&index.footnotes)), pending, true);
        }
        // Partial publication state stays private to the cooperative builder.
        // Foreground revisions install only their bounded chapter-local overlay.
        (None, BTreeSet::new(), false)
    }

    #[cfg(test)]
    pub(super) fn publication_footnote_scan_count(&self) -> usize {
        self.publication_footnote_scan_count
    }

    #[cfg(test)]
    pub(super) fn publication_footnote_source_scan_count(&self) -> usize {
        self.publication_footnotes
            .get()
            .map(|index| index.source_scan_count)
            .or_else(|| {
                self.publication_footnote_progress
                    .as_ref()
                    .map(|progress| progress.source_scan_count)
            })
            .unwrap_or(0)
    }

    #[cfg(test)]
    pub(super) fn publication_footnote_definition_parse_count(&self) -> usize {
        self.publication_footnotes
            .get()
            .map(|index| index.definition_parse_count)
            .or_else(|| {
                self.publication_footnote_progress
                    .as_ref()
                    .map(|progress| progress.definition_parse_count)
            })
            .unwrap_or(0)
    }
}

fn parse_nodes(source: &str) -> Vec<DocumentNode> {
    parse_xhtml(source)
        .map(|parsed| parsed.nodes)
        .unwrap_or_default()
}
