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
        let partial_data = if let Some(limit) = partial_chapter_limit {
            let (targets, footnotes) = {
                let index = self.publication_footnote_index()?;
                (index.targets.clone(), index.footnotes.clone())
            };
            let prepared = self.prepare_cached_document_window(0, limit, &targets)?;
            Some((prepared, footnotes))
        } else {
            None
        };
        let partial_prepared = partial_data.as_ref().map(|(prepared, _)| prepared);
        if partial_prepared.is_none() {
            self.ensure_prepared_all();
        }
        let prepared = partial_prepared
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
        let layout_key = layout_key(layout_config, &self.pinned_font_policy)?;
        let interactions = match &partial_data {
            Some((_, footnotes)) => partial_revision_interactions(prepared, footnotes.clone()),
            None => runtime_revision_interactions(prepared, full_document),
        };
        let revision = RuntimeRevision::completed(layout, layout_config.clone(), interactions);
        let summary = revision_summary(&revision_id, &layout_key, &revision);
        self.revisions.insert(revision_id, revision);
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
        let (targets, footnotes) = {
            let index = self.publication_footnote_index()?;
            (index.targets.clone(), index.footnotes.clone())
        };
        let prepared =
            self.prepare_cached_document_window(chapter_start, chapter_count, &targets)?;
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
        let layout_key = layout_key(&window_layout_config, &self.pinned_font_policy)?;
        let revision = RuntimeRevision::completed(
            layout,
            window_layout_config,
            partial_revision_interactions(&prepared, footnotes),
        );
        let summary = revision_summary(&revision_id, &layout_key, &revision);
        self.revisions.insert(revision_id, revision);
        Ok(summary)
    }

    pub(super) fn create_revision_id(&mut self) -> String {
        let revision_id = format!("rev-{}", self.next_revision_index);
        self.next_revision_index += 1;
        revision_id
    }

    pub(super) fn ensure_layout_font_resources(
        &mut self,
        layout_config: &LayoutConfig,
    ) -> EpubResult<()> {
        if layout_config.text_measurement == TextMeasurementMode::FontAware {
            self.document.ensure_all_fonts_loaded()?;
        }
        Ok(())
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
        Vec<crate::epub::ParsedLoadedChapterSource>,
    )> {
        let end = chapter_start
            .saturating_add(chapter_count)
            .min(self.document.chapters.len());
        let mut chapters = Vec::new();
        for index in chapter_start..end {
            chapters.push(self.parsed_chapter(index)?.clone());
        }
        let live_resources = crate::epub::loaded_document_resources(&self.document);
        let base = self.prepared_base();
        base.resources = live_resources;
        let base = base.clone();
        Ok((base, chapters))
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

    fn prepared_base(&mut self) -> &mut crate::epub::PreparedLoadedDocumentBase {
        self.prepared_base
            .get_or_insert_with(|| crate::epub::prepare_loaded_document_base(&self.document))
    }

    pub(super) fn ensure_prepared_all(&mut self) {
        if self.prepared.is_none() {
            self.prepared = Some(crate::epub::prepare_loaded_document(&self.document));
        }
    }
}

fn partial_revision_interactions(
    prepared: &crate::epub::PreparedLoadedDocument,
    footnotes: std::collections::BTreeMap<String, crate::interaction::FootnoteEntry>,
) -> RuntimeRevisionInteractions {
    let mut interactions = runtime_revision_interactions(prepared, false);
    interactions.footnotes = footnotes;
    interactions
}

pub(super) fn runtime_revision_interactions(
    prepared: &crate::epub::PreparedLoadedDocument,
    full_document: bool,
) -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        footnotes: prepared.interaction.footnotes.clone(),
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
