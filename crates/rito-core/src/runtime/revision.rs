use std::{collections::BTreeMap, sync::Arc};

use crate::{
    epub::{EpubError, EpubResult},
    layout::{LayoutConfig, LineBreaking, TextMeasurementMode},
};

use super::{
    chapter_text::runtime_chapter_text_index_entries,
    cleanup::PendingRuntimeRevisionCleanup,
    frame::{
        into_chapter_window_layout_config, revision_summary, RuntimeChapterTextIndexSource,
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
        request: RuntimeRevisionRequest,
    ) -> EpubResult<RuntimeRevisionSummary> {
        let RuntimeRevisionRequest {
            layout_config,
            line_breaking,
            preview_chapter_limit,
            preview_chapter_index,
        } = request;
        if let Some(chapter_index) = preview_chapter_index {
            self.create_revision_window_with_owned_layout_config(
                layout_config,
                line_breaking,
                chapter_index,
                1,
            )
        } else {
            self.create_revision_prefix_with_owned_layout_config(
                layout_config,
                line_breaking,
                preview_chapter_limit,
            )
        }
    }

    pub(super) fn create_revision_prefix_with_line_breaking(
        &mut self,
        layout_config: &LayoutConfig,
        line_breaking: LineBreaking,
        chapter_limit: Option<usize>,
    ) -> EpubResult<RuntimeRevisionSummary> {
        self.create_revision_prefix_with_owned_layout_config(
            layout_config.clone(),
            line_breaking,
            chapter_limit,
        )
    }

    fn create_revision_prefix_with_owned_layout_config(
        &mut self,
        layout_config: LayoutConfig,
        line_breaking: LineBreaking,
        chapter_limit: Option<usize>,
    ) -> EpubResult<RuntimeRevisionSummary> {
        if self.fragment_page_table_enabled && chapter_limit.is_none() {
            return self.create_fragment_revision(layout_config, line_breaking);
        }
        let revision_id = self.create_revision_id();
        let (
            layout_config,
            (layout, chapter_style_tables, required_font_face_catalog, interactions, layout_key),
        ) = self.run_with_owned_layout_config(layout_config, |document, layout_config| {
            let partial_chapter_limit =
                chapter_limit.filter(|limit| *limit < document.document.chapters.len());
            let full_document = partial_chapter_limit.is_none();
            if let Some(limit) = partial_chapter_limit {
                document.document.ensure_chapter_range_loaded(0, limit)?;
                document
                    .document
                    .ensure_chapter_image_dimensions_loaded(0, limit)?;
            } else {
                document.document.ensure_all_chapters_loaded()?;
                document
                    .document
                    .ensure_chapter_image_dimensions_loaded(0, document.document.chapters.len())?;
            }
            document.ensure_layout_font_resources(layout_config)?;
            let partial_data = if let Some(limit) = partial_chapter_limit {
                let (targets, footnotes) = {
                    let index = document.publication_footnote_index()?;
                    (index.targets.clone(), index.footnotes.clone())
                };
                let prepared = document.prepare_cached_document_window(0, limit, &targets)?;
                Some((prepared, footnotes, targets))
            } else {
                None
            };
            let partial_prepared = partial_data.as_ref().map(|(prepared, _, _)| prepared);
            if partial_prepared.is_none() {
                document.ensure_prepared_all();
            }
            let prepared = partial_prepared
                .or(document.prepared.as_ref())
                .ok_or_else(|| EpubError::new("prepared document is unavailable"))?;
            let pinned_faces = document
                .pinned_font_policy
                .measurement_faces_for_layout(layout_config);
            let font_fallbacks = document.pinned_font_policy.family_fallbacks_for_layout(
                layout_config,
                &document.document.package.metadata.language,
            );
            let built = crate::epub::build_prepared_loaded_document_runtime_layout(
                &document.document,
                prepared,
                layout_config,
                crate::epub::PreparedRuntimeLayoutOptions {
                    chapter_start: 0,
                    chapter_count: prepared.chapters.len(),
                    line_breaking,
                    text_measurement_cache: Some(document.text_measurement_cache.clone()),
                    pinned_faces,
                    font_fallbacks,
                },
            )?;
            let required_font_face_catalog =
                document.required_font_face_catalog_from_faces(built.shapeable_publication_faces);
            let layout_key = layout_key(layout_config, &document.pinned_font_policy)?;
            let interactions = match &partial_data {
                Some((_, footnotes, targets)) => {
                    partial_revision_interactions(prepared, footnotes.clone(), targets)
                }
                None => runtime_revision_interactions(prepared, full_document),
            };
            Ok((
                built.layout,
                chapter_style_table_map(built.chapter_style_tables),
                required_font_face_catalog,
                interactions,
                layout_key,
            ))
        })?;
        let revision = RuntimeRevision::completed(
            layout,
            layout_config,
            chapter_style_tables,
            required_font_face_catalog,
            interactions,
        );
        self.insert_new_revision(revision_id.clone(), revision);
        self.try_attach_fragment_page_table(&revision_id);
        let revision = self
            .any_revision(&revision_id)
            .expect("the revision was just inserted");
        let summary = revision_summary(&revision_id, &layout_key, revision);
        Ok(summary)
    }

    /// Builds a whole-book revision paginated by the fragment engine
    /// alone: style projection runs, the retained layout engine does not.
    /// The revision keeps an empty retained scaffold only because the
    /// storage type still requires one; every query serves from the
    /// fragment page table.
    fn create_fragment_revision(
        &mut self,
        layout_config: LayoutConfig,
        line_breaking: LineBreaking,
    ) -> EpubResult<RuntimeRevisionSummary> {
        // The fragment engine's line breaking is its own; the retained
        // engine's greedy/optimal switch does not apply.
        let _ = line_breaking;
        let revision_id = self.create_revision_id();
        let (
            layout_config,
            (
                chapter_count,
                chapter_style_tables,
                required_font_face_catalog,
                interactions,
                layout_key,
            ),
        ) = self.run_with_owned_layout_config(layout_config, |document, layout_config| {
            document.document.ensure_all_chapters_loaded()?;
            document
                .document
                .ensure_chapter_image_dimensions_loaded(0, document.document.chapters.len())?;
            document.ensure_layout_font_resources(layout_config)?;
            document.ensure_prepared_all();
            let prepared = document
                .prepared
                .as_ref()
                .ok_or_else(|| EpubError::new("prepared document is unavailable"))?;
            let pinned_faces = document
                .pinned_font_policy
                .measurement_faces_for_layout(layout_config);
            let font_fallbacks = document.pinned_font_policy.family_fallbacks_for_layout(
                layout_config,
                &document.document.package.metadata.language,
            );
            let projected = crate::epub::project_prepared_document_styles(
                &document.document,
                prepared,
                layout_config,
                crate::epub::PreparedRuntimeLayoutOptions {
                    chapter_start: 0,
                    chapter_count: prepared.chapters.len(),
                    line_breaking: LineBreaking::Greedy,
                    text_measurement_cache: Some(document.text_measurement_cache.clone()),
                    pinned_faces,
                    font_fallbacks,
                },
            )?;
            // The fragment engine shapes with every publication face; the
            // canvas must register them all too, so the catalog is the
            // full `@font-face` set rather than the host-measurable one.
            let _ = projected.shapeable_publication_faces;
            let catalog_faces = crate::epub::publication_font_face_catalog(
                &document.document,
                document.resolved_font_face_sources(),
            );
            let required_font_face_catalog =
                document.required_font_face_catalog_from_faces(catalog_faces);
            let layout_key = layout_key(layout_config, &document.pinned_font_policy)?;
            let interactions = runtime_revision_interactions(prepared, true);
            Ok((
                prepared.chapters.len(),
                chapter_style_table_map(projected.chapter_style_tables),
                required_font_face_catalog,
                interactions,
                layout_key,
            ))
        })?;
        let revision = RuntimeRevision::completed(
            crate::layout::create_empty_runtime_layout(chapter_count, &layout_config),
            layout_config,
            chapter_style_tables,
            required_font_face_catalog,
            interactions,
        );
        self.insert_new_revision(revision_id.clone(), revision);
        self.try_attach_fragment_page_table(&revision_id);
        let revision = self
            .any_revision(&revision_id)
            .expect("the revision was just inserted");
        if revision.fragment_layout.is_none() {
            let reason = self
                .fragment_page_table_rejection_reason(&revision_id)
                .unwrap_or_else(|| "unknown".to_owned());
            self.release_revision(&revision_id);
            return Err(EpubError::new(format!(
                "fragment pagination failed: {reason}"
            )));
        }
        let revision = self
            .any_revision(&revision_id)
            .expect("the revision was just inserted");
        let summary = revision_summary(&revision_id, &layout_key, revision);
        Ok(summary)
    }

    #[cfg(test)]
    pub(super) fn create_revision_window_with_line_breaking(
        &mut self,
        layout_config: &LayoutConfig,
        line_breaking: LineBreaking,
        chapter_start: usize,
        chapter_count: usize,
    ) -> EpubResult<RuntimeRevisionSummary> {
        self.create_revision_window_with_owned_layout_config(
            layout_config.clone(),
            line_breaking,
            chapter_start,
            chapter_count,
        )
    }

    fn create_revision_window_with_owned_layout_config(
        &mut self,
        layout_config: LayoutConfig,
        line_breaking: LineBreaking,
        chapter_start: usize,
        chapter_count: usize,
    ) -> EpubResult<RuntimeRevisionSummary> {
        let layout_config = into_chapter_window_layout_config(layout_config);
        let (
            layout_config,
            (
                revision_id,
                layout,
                chapter_style_tables,
                required_font_face_catalog,
                interactions,
                layout_key,
            ),
        ) = self.run_with_owned_layout_config(layout_config, |document, layout_config| {
            if chapter_start >= document.document.chapters.len() {
                return Err(EpubError::new(format!(
                    "chapter window start out of range: {chapter_start}"
                )));
            }
            if chapter_count == 0 {
                return Err(EpubError::new(
                    "chapter window count must be greater than zero",
                ));
            }
            document
                .document
                .ensure_chapter_range_loaded(chapter_start, chapter_count)?;
            document
                .document
                .ensure_chapter_image_dimensions_loaded(chapter_start, chapter_count)?;
            document.ensure_layout_font_resources(layout_config)?;
            let revision_id = document.create_revision_id();
            let (targets, footnotes) = {
                let index = document.publication_footnote_index()?;
                (index.targets.clone(), index.footnotes.clone())
            };
            let prepared =
                document.prepare_cached_document_window(chapter_start, chapter_count, &targets)?;
            let pinned_faces = document
                .pinned_font_policy
                .measurement_faces_for_layout(layout_config);
            let font_fallbacks = document.pinned_font_policy.family_fallbacks_for_layout(
                layout_config,
                &document.document.package.metadata.language,
            );
            let prepared_chapter_count = prepared.chapters.len();
            let built = crate::epub::build_prepared_loaded_document_runtime_layout(
                &document.document,
                &prepared,
                layout_config,
                crate::epub::PreparedRuntimeLayoutOptions {
                    chapter_start: 0,
                    chapter_count: prepared_chapter_count,
                    line_breaking,
                    text_measurement_cache: Some(document.text_measurement_cache.clone()),
                    pinned_faces,
                    font_fallbacks,
                },
            )?;
            let required_font_face_catalog =
                document.required_font_face_catalog_from_faces(built.shapeable_publication_faces);
            let layout_key = layout_key(layout_config, &document.pinned_font_policy)?;
            Ok((
                revision_id,
                built.layout,
                chapter_style_table_map(built.chapter_style_tables),
                required_font_face_catalog,
                partial_revision_interactions(&prepared, footnotes, &targets),
                layout_key,
            ))
        })?;
        let revision = RuntimeRevision::completed(
            layout,
            layout_config,
            chapter_style_tables,
            required_font_face_catalog,
            interactions,
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
        Ok(self.parsed_chapters.entry(index).or_insert_with(|| {
            #[cfg(any(test, feature = "bench-internals"))]
            let _probe_timer = crate::layout::bounded_work_probe::start_timing(
                crate::layout::bounded_work_probe::ContinuationTimingStage::ChapterParse,
            );
            crate::epub::parsed_loaded_chapter_source(chapter)
        }))
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
                        .clone()
                })
                .collect::<Vec<_>>();
            let base = self.prepared_base().clone();
            self.prepared = Some(crate::epub::prepare_loaded_document_with_base(
                &base, chapters,
            ));
        }
    }
}

fn partial_revision_interactions(
    prepared: &crate::epub::PreparedLoadedDocument,
    footnotes: Arc<BTreeMap<String, crate::interaction::FootnoteEntry>>,
    targets: &crate::interaction::FootnoteTargetSet,
) -> RuntimeRevisionInteractions {
    let mut interactions = runtime_revision_interactions(prepared, false);
    interactions.pending_footnote_keys = crate::interaction::FootnoteTargetSet::new(
        targets
            .iter()
            .filter(|key| !footnotes.contains_key(key.as_str()))
            .cloned()
            .collect(),
    );
    interactions.footnote_index_complete = true;
    interactions.publication_footnotes = Some(footnotes);
    interactions
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
) -> std::collections::BTreeMap<String, super::frame::RuntimeChapterStyleTables> {
    tables
        .into_iter()
        .map(|chapter| {
            (
                chapter.idref,
                super::frame::RuntimeChapterStyleTables {
                    layout: chapter.layout,
                    inline: chapter.inline,
                },
            )
        })
        .collect()
}
