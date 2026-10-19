use std::collections::BTreeMap;
use std::rc::Rc;

mod error;
mod whole_book;

use crate::{
    epub::{EpubError, EpubResult},
    layout::LayoutConfig,
};

use super::{
    cleanup::PendingRuntimeRevisionCleanup,
    fragment_backend::FragmentTableBuild,
    frame::{
        revision_summary, RuntimeRevision, RuntimeRevisionCoordinateSpace,
        RuntimeRevisionInteractions,
    },
    metadata::layout_key,
    RuntimeDocument, RuntimeRevisionSummary,
};

/// A whole-book revision being laid out a few pages at a time
/// ([`RuntimeDocument::advance_revision`]): its styles and the page table
/// paginated so far.
pub(in crate::runtime) struct RevisionBuild {
    revision_id: String,
    layout_config: LayoutConfig,
    layout_key: String,
    chapter_style_tables: BTreeMap<String, Rc<super::frame::RuntimeChapterStyleTables>>,
    required_font_face_catalog: Option<Vec<super::RuntimeRequiredFontFace>>,
    interactions: RuntimeRevisionInteractions,
    table: FragmentTableBuild,
}

impl std::fmt::Debug for RevisionBuild {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RevisionBuild")
            .field("revision_id", &self.revision_id)
            .field("pages", &self.table.pages())
            .finish_non_exhaustive()
    }
}

/// Where laying a whole-book revision out stands after a step.
pub(in crate::runtime) enum RevisionProgress {
    /// Pages remain; the build resumes where the step stopped.
    Pending(Box<RevisionBuild>),
    /// The book is laid out and the revision inserted.
    Done(RuntimeRevisionSummary),
}

impl RuntimeDocument {
    /// Style projection runs, the fragment engine paginates every
    /// chapter, and the revision is inserted with its complete page
    /// table. A chapter that fails to build or paginate fails the call
    /// with its reason and leaves no revision behind.
    pub(super) fn build_revision(
        &mut self,
        layout_config: &LayoutConfig,
    ) -> EpubResult<RuntimeRevisionSummary> {
        let build = self.begin_revision(layout_config)?;
        match self.advance_revision(build, usize::MAX)? {
            RevisionProgress::Done(summary) => Ok(summary),
            RevisionProgress::Pending(_) => {
                unreachable!("a step without a page limit ends the book")
            }
        }
    }

    /// The publication's number of chapters.
    pub(in crate::runtime) fn chapter_count(&self) -> usize {
        self.document.chapters.len()
    }

    /// Readies chapter `index` for a whole-book revision laid out with
    /// `layout_config` — its source read, its images measured, its markup
    /// parsed and its styles resolved — so [`Self::begin_revision`] finds
    /// it done. Laying the book out behind the page shown, a host readies a
    /// chapter a step, so no step holds the reader for the whole book.
    pub(in crate::runtime) fn prepare_revision_chapter(
        &mut self,
        layout_config: &LayoutConfig,
        index: usize,
    ) -> EpubResult<()> {
        self.document.ensure_chapter_loaded(index)?;
        self.document
            .ensure_chapter_image_dimensions_loaded(index, 1)?;
        let chapter = self.parsed_chapter(index)?;
        self.prepared_base();
        let ledger = &self
            .prepared_base
            .as_ref()
            .expect("the prepared base was just made")
            .stylesheet_ledger;
        self.chapter_styles
            .tables(ledger, &[chapter], layout_config)?;
        Ok(())
    }

    /// Begins laying a whole-book revision out: style projection runs for
    /// every chapter, and [`Self::advance_revision`] paginates them a few
    /// pages at a time.
    pub(in crate::runtime) fn begin_revision(
        &mut self,
        layout_config: &LayoutConfig,
    ) -> EpubResult<RevisionBuild> {
        let layout_config = layout_config.clone();
        let revision_id = self.create_revision_id();
        let (chapter_style_tables, required_font_face_catalog, interactions, layout_key) = {
            let document = &mut *self;
            let layout_config = &layout_config;
            document.document.ensure_all_chapters_loaded()?;
            document
                .document
                .ensure_chapter_image_dimensions_loaded(0, document.document.chapters.len())?;
            document.ensure_layout_font_resources()?;
            document.ensure_prepared_all();
            let prepared = document
                .prepared
                .as_ref()
                .ok_or_else(|| EpubError::new("prepared document is unavailable"))?;
            let chapter_style_tables = document.chapter_styles.tables(
                &prepared.stylesheet_ledger,
                &prepared.chapters,
                layout_config,
            )?;
            let required_font_face_catalog = document.required_font_face_catalog();
            let layout_key = layout_key(layout_config, &document.pinned_font_policy)?;
            let interactions = runtime_revision_interactions(prepared, true);
            (
                chapter_style_tables.into_iter().collect(),
                required_font_face_catalog,
                interactions,
                layout_key,
            )
        };
        let table = self
            .begin_fragment_page_table(&layout_config)
            .map_err(|reason| EpubError::new(format!("fragment pagination failed: {reason}")))?;
        Ok(RevisionBuild {
            revision_id,
            layout_config,
            layout_key,
            chapter_style_tables,
            required_font_face_catalog,
            interactions,
            table,
        })
    }

    /// Paginates up to `pages` more pages of a whole-book revision, and
    /// inserts it once the book is laid out. A chapter that fails to build
    /// or paginate fails the step and leaves no revision behind.
    pub(in crate::runtime) fn advance_revision(
        &mut self,
        mut build: RevisionBuild,
        pages: usize,
    ) -> EpubResult<RevisionProgress> {
        let done = self
            .advance_fragment_page_table(&mut build.table, &build.chapter_style_tables, pages)
            .map_err(|reason| EpubError::new(format!("fragment pagination failed: {reason}")))?;
        if !done {
            return Ok(RevisionProgress::Pending(Box::new(build)));
        }
        let RevisionBuild {
            revision_id,
            layout_config,
            layout_key,
            chapter_style_tables,
            required_font_face_catalog,
            interactions,
            table,
        } = build;
        let fragment_layout = table.finish();
        if fragment_layout.page_count() == 0 {
            return Err(EpubError::new(
                "fragment pagination failed: the publication paginated to no pages",
            ));
        }
        let revision = RuntimeRevision::new(
            RuntimeRevisionCoordinateSpace::Absolute,
            layout_config,
            chapter_style_tables,
            required_font_face_catalog,
            interactions,
            fragment_layout,
        );
        let summary = revision_summary(&revision_id, &layout_key, &revision);
        self.insert_new_revision(revision_id, revision);
        Ok(RevisionProgress::Done(summary))
    }

    pub(super) fn create_revision_id(&mut self) -> String {
        let revision_id = format!("rev-{}", self.next_revision_index);
        self.next_revision_index = self
            .next_revision_index
            .checked_add(1)
            .expect("runtime revision id space is exhausted");
        revision_id
    }

    pub(super) fn insert_new_revision(&mut self, revision_id: String, revision: RuntimeRevision) {
        if self.revisions.contains_key(&revision_id)
            || self.chapter_local_revisions.contains_key(&revision_id)
        {
            PendingRuntimeRevisionCleanup::new(revision).drain();
            panic!("runtime revision id must be unique");
        }
        assert!(self.revisions.insert(revision_id, revision).is_none());
    }

    pub(super) fn insert_new_chapter_local_revision(
        &mut self,
        revision_id: String,
        revision: RuntimeRevision,
    ) {
        if self.revisions.contains_key(&revision_id)
            || self.chapter_local_revisions.contains_key(&revision_id)
        {
            PendingRuntimeRevisionCleanup::new(revision).drain();
            panic!("runtime revision id must be unique");
        }
        assert!(self
            .chapter_local_revisions
            .insert(revision_id, revision)
            .is_none());
    }

    /// The engine shapes with real font bytes, so every publication face
    /// loads before the first layout.
    pub(super) fn ensure_layout_font_resources(&mut self) -> EpubResult<()> {
        self.document.ensure_all_fonts_loaded()
    }

    pub(super) fn prepare_cached_document_window(
        &mut self,
        chapter_start: usize,
        chapter_count: usize,
        targets: &crate::interaction::FootnoteTargetSet,
    ) -> EpubResult<crate::epub::PreparedLoadedDocument> {
        let (base, chapters) =
            self.prepare_cached_document_window_parts(chapter_start, chapter_count)?;
        Ok(
            crate::epub::prepare_loaded_document_with_base_and_footnote_targets(
                &base, chapters, targets,
            ),
        )
    }

    fn prepare_cached_document_window_parts(
        &mut self,
        chapter_start: usize,
        chapter_count: usize,
    ) -> EpubResult<(
        crate::epub::PreparedLoadedDocumentBase,
        Vec<Rc<crate::epub::ParsedLoadedChapterSource>>,
    )> {
        let end = chapter_start
            .saturating_add(chapter_count)
            .min(self.document.chapters.len());
        let mut chapters = Vec::new();
        for index in chapter_start..end {
            chapters.push(self.parsed_chapter(index)?);
        }
        let live_resources = crate::epub::loaded_document_resources(&self.document);
        let base = self.prepared_base();
        base.resources = live_resources;
        let base = base.clone();
        Ok((base, chapters))
    }

    /// Parses the chapter on first use and hands out a handle to that one
    /// parse: the cache and every prepared document that includes the
    /// chapter share it.
    fn parsed_chapter(
        &mut self,
        index: usize,
    ) -> EpubResult<Rc<crate::epub::ParsedLoadedChapterSource>> {
        let chapter = self
            .document
            .chapters
            .get(index)
            .ok_or_else(|| EpubError::new(format!("chapter index out of range: {index}")))?;
        Ok(Rc::clone(self.parsed_chapters.entry(index).or_insert_with(
            || Rc::new(crate::epub::parsed_loaded_chapter_source(chapter)),
        )))
    }

    fn prepared_base(&mut self) -> &mut crate::epub::PreparedLoadedDocumentBase {
        self.prepared_base
            .get_or_insert_with(|| crate::epub::prepare_loaded_document_base(&self.document))
    }

    pub(super) fn ensure_prepared_all(&mut self) {
        if self.prepared.is_none() {
            let chapters = (0..self.document.chapters.len())
                .map(|index| {
                    self.parsed_chapter(index)
                        .expect("loaded chapter index must remain valid")
                })
                .collect::<Vec<_>>();
            let base = self.prepared_base().clone();
            self.prepared = Some(Rc::new(crate::epub::prepare_loaded_document_with_base(
                &base, chapters,
            )));
        }
    }
}
pub(super) fn runtime_revision_interactions(
    prepared: &crate::epub::PreparedLoadedDocument,
    full_document: bool,
) -> RuntimeRevisionInteractions {
    runtime_revision_interactions_with_footnotes(
        prepared,
        full_document,
        prepared.interaction.footnotes.clone(),
    )
}

pub(super) fn runtime_chapter_revision_interactions(
    prepared: &crate::epub::PreparedLoadedDocument,
) -> RuntimeRevisionInteractions {
    runtime_revision_interactions_with_footnotes(prepared, false, BTreeMap::new())
}

fn runtime_revision_interactions_with_footnotes(
    prepared: &crate::epub::PreparedLoadedDocument,
    full_document: bool,
    footnotes: BTreeMap<String, crate::interaction::FootnoteEntry>,
) -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        publication_footnotes: None,
        footnotes,
        pending_footnote_keys: crate::interaction::FootnoteTargetSet::default(),
        footnote_index_complete: full_document,
        completed_chapter_idrefs: prepared
            .chapters
            .iter()
            .map(|chapter| chapter.source.idref.clone())
            .collect(),
    }
}
