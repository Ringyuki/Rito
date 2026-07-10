use std::collections::{BTreeMap, VecDeque};

use crate::{
    epub::{EpubError, EpubResult},
    layout::{LayoutConfig, LineBreaking, TextMeasurementMode},
};

use super::{
    chapter_text::runtime_chapter_text_index_entries,
    frame::{
        chapter_window_layout_config, revision_summary, RuntimeChapterTextIndexSource,
        RuntimeRevision, RuntimeRevisionInteractions,
    },
    metadata::layout_key,
    RuntimeDocument, RuntimeRevisionRequest, RuntimeRevisionSummary,
};

impl RuntimeDocument {
    pub fn create_revision(
        &mut self,
        layout_config: &LayoutConfig,
    ) -> EpubResult<RuntimeRevisionSummary> {
        self.create_revision_with_line_breaking(layout_config, LineBreaking::Greedy)
    }

    pub fn create_revision_with_line_breaking(
        &mut self,
        layout_config: &LayoutConfig,
        line_breaking: LineBreaking,
    ) -> EpubResult<RuntimeRevisionSummary> {
        self.create_revision_prefix_with_line_breaking(layout_config, line_breaking, None)
    }

    pub(super) fn create_revision_from_request(
        &mut self,
        request: &RuntimeRevisionRequest,
    ) -> EpubResult<RuntimeRevisionSummary> {
        if let Some(chapter_index) = request.preview_chapter_index {
            self.create_revision_window_with_line_breaking(
                &request.layout_config,
                request.line_breaking,
                chapter_index,
                1,
            )
        } else {
            self.create_revision_prefix_with_line_breaking(
                &request.layout_config,
                request.line_breaking,
                request.preview_chapter_limit,
            )
        }
    }

    pub(super) fn create_revision_prefix_with_line_breaking(
        &mut self,
        layout_config: &LayoutConfig,
        line_breaking: LineBreaking,
        chapter_limit: Option<usize>,
    ) -> EpubResult<RuntimeRevisionSummary> {
        let revision_id = self.create_revision_id();
        let partial_chapter_limit =
            chapter_limit.filter(|limit| *limit < self.document.chapters.len());
        let full_document = partial_chapter_limit.is_none();
        if let Some(limit) = partial_chapter_limit {
            self.document.ensure_chapter_range_loaded(0, limit)?;
            self.document
                .ensure_chapter_image_dimensions_loaded(0, limit)?;
        } else {
            self.document.ensure_all_chapters_loaded()?;
            self.document
                .ensure_chapter_image_dimensions_loaded(0, self.document.chapters.len())?;
        }
        self.ensure_layout_font_resources(layout_config)?;
        let partial_prepared = partial_chapter_limit
            .map(|limit| crate::epub::prepare_loaded_document_prefix(&self.document, limit));
        if partial_prepared.is_none() {
            self.ensure_prepared_all();
        }
        let prepared = partial_prepared
            .as_ref()
            .or(self.prepared.as_ref())
            .ok_or_else(|| EpubError::new("prepared document is unavailable"))?;
        let layout =
            crate::epub::build_prepared_loaded_document_layout_prefix_with_cache_and_line_breaking(
                &self.document,
                prepared,
                layout_config,
                line_breaking,
                prepared.chapters.len(),
                Some(self.text_measurement_cache.clone()),
            );
        let layout_key = layout_key(layout_config)?;
        let summary = revision_summary(&revision_id, &layout_key, &layout);
        self.revisions.insert(
            revision_id,
            RuntimeRevision {
                interactions: runtime_revision_interactions(prepared, full_document),
                layout,
                layout_config: layout_config.clone(),
                frame_cache: BTreeMap::new(),
                frame_cache_order: VecDeque::new(),
            },
        );
        Ok(summary)
    }

    pub(super) fn create_revision_window_with_line_breaking(
        &mut self,
        layout_config: &LayoutConfig,
        line_breaking: LineBreaking,
        chapter_start: usize,
        chapter_count: usize,
    ) -> EpubResult<RuntimeRevisionSummary> {
        if chapter_start >= self.document.chapters.len() {
            return Err(EpubError::new(format!(
                "chapter window start out of range: {chapter_start}"
            )));
        }
        if chapter_count == 0 {
            return Err(EpubError::new(
                "chapter window count must be greater than zero",
            ));
        }
        self.document
            .ensure_chapter_range_loaded(chapter_start, chapter_count)?;
        self.document
            .ensure_chapter_image_dimensions_loaded(chapter_start, chapter_count)?;
        self.ensure_layout_font_resources(layout_config)?;
        let revision_id = self.create_revision_id();
        let prepared = self.prepare_cached_document_window(chapter_start, chapter_count)?;
        let window_layout_config = chapter_window_layout_config(layout_config);
        let layout =
            crate::epub::build_prepared_loaded_document_layout_window_with_cache_and_line_breaking(
                &self.document,
                &prepared,
                &window_layout_config,
                line_breaking,
                0,
                prepared.chapters.len(),
                Some(self.text_measurement_cache.clone()),
            );
        let layout_key = layout_key(&window_layout_config)?;
        let summary = revision_summary(&revision_id, &layout_key, &layout);
        self.revisions.insert(
            revision_id,
            RuntimeRevision {
                interactions: runtime_revision_interactions(&prepared, false),
                layout,
                layout_config: window_layout_config,
                frame_cache: BTreeMap::new(),
                frame_cache_order: VecDeque::new(),
            },
        );
        Ok(summary)
    }

    fn create_revision_id(&mut self) -> String {
        let revision_id = format!("rev-{}", self.next_revision_index);
        self.next_revision_index += 1;
        revision_id
    }

    fn ensure_layout_font_resources(&mut self, layout_config: &LayoutConfig) -> EpubResult<()> {
        if layout_config.text_measurement == TextMeasurementMode::FontAware {
            self.document.ensure_all_fonts_loaded()?;
        }
        Ok(())
    }

    fn prepare_cached_document_window(
        &mut self,
        chapter_start: usize,
        chapter_count: usize,
    ) -> EpubResult<crate::epub::PreparedLoadedDocument> {
        let end = chapter_start
            .saturating_add(chapter_count)
            .min(self.document.chapters.len());
        let mut chapters = Vec::new();
        for index in chapter_start..end {
            chapters.push(self.parsed_chapter(index)?.clone());
        }
        let base = self.prepared_base().clone();
        Ok(crate::epub::prepare_loaded_document_with_base(
            &base, chapters,
        ))
    }

    fn parsed_chapter(
        &mut self,
        index: usize,
    ) -> EpubResult<&crate::epub::ParsedLoadedChapterSource> {
        let chapter = self
            .document
            .chapters
            .get(index)
            .ok_or_else(|| EpubError::new(format!("chapter index out of range: {index}")))?;
        Ok(self
            .parsed_chapters
            .entry(index)
            .or_insert_with(|| crate::epub::parsed_loaded_chapter_source(chapter)))
    }

    fn prepared_base(&mut self) -> &crate::epub::PreparedLoadedDocumentBase {
        self.prepared_base
            .get_or_insert_with(|| crate::epub::prepare_loaded_document_base(&self.document))
    }

    pub(super) fn ensure_prepared_all(&mut self) {
        if self.prepared.is_none() {
            self.prepared = Some(crate::epub::prepare_loaded_document(&self.document));
        }
    }
}

fn runtime_revision_interactions(
    prepared: &crate::epub::PreparedLoadedDocument,
    full_document: bool,
) -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        footnotes: prepared.interaction.footnotes.clone(),
        chapter_text_indices: if full_document {
            RuntimeChapterTextIndexSource::FullDocument
        } else {
            RuntimeChapterTextIndexSource::Materialized(runtime_chapter_text_index_entries(
                prepared,
            ))
        },
    }
}
