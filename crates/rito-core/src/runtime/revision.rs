use std::collections::BTreeMap;
use std::rc::Rc;

mod error;
mod whole_book;

use crate::{
    epub::{EpubError, EpubResult},
    layout::LayoutConfig,
};

use super::{
    chapter_text::runtime_chapter_text_index_entries,
    cleanup::PendingRuntimeRevisionCleanup,
    frame::{
        revision_summary, RuntimeChapterTextIndexSource, RuntimeRevision,
        RuntimeRevisionCoordinateSpace, RuntimeRevisionInteractions,
    },
    metadata::layout_key,
    RuntimeDocument, RuntimeRevisionSummary,
};

impl RuntimeDocument {
    /// Style projection runs, the fragment engine paginates every
    /// chapter, and the revision is inserted with its complete page
    /// table. A chapter that fails to build or paginate fails the call
    /// with its reason and leaves no revision behind.
    pub(super) fn build_revision(
        &mut self,
        layout_config: &LayoutConfig,
    ) -> EpubResult<RuntimeRevisionSummary> {
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
            let chapter_style_tables = crate::epub::project_prepared_document_styles(
                prepared,
                layout_config,
                0,
                prepared.chapters.len(),
            )?;
            let required_font_face_catalog = document.required_font_face_catalog();
            let layout_key = layout_key(layout_config, &document.pinned_font_policy)?;
            let interactions = runtime_revision_interactions(prepared, true);
            (
                chapter_style_table_map(chapter_style_tables),
                required_font_face_catalog,
                interactions,
                layout_key,
            )
        };
        let fragment_layout = self
            .build_fragment_page_table(&layout_config, &chapter_style_tables)
            .map_err(|reason| EpubError::new(format!("fragment pagination failed: {reason}")))?;
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
        Ok(summary)
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
        chapter_text_indices: if full_document {
            RuntimeChapterTextIndexSource::FullDocument
        } else {
            RuntimeChapterTextIndexSource::Materialized(runtime_chapter_text_index_entries(
                prepared,
            ))
        },
    }
}

fn chapter_style_table_map(
    tables: Vec<crate::epub::ChapterStyleTable>,
) -> std::collections::BTreeMap<String, Rc<super::frame::RuntimeChapterStyleTables>> {
    tables
        .into_iter()
        .map(|chapter| {
            (
                chapter.idref,
                Rc::new(super::frame::RuntimeChapterStyleTables {
                    layout: chapter.layout,
                    inline: chapter.inline,
                }),
            )
        })
        .collect()
}
