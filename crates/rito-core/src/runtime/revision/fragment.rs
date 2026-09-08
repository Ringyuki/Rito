use std::collections::BTreeMap;

use crate::{
    epub::{self, EpubError, EpubResult, PreparedLoadedDocument},
    layout::{build_spread_slots, create_empty_runtime_layout, LayoutConfig, LineBreaking},
};

use super::super::{
    fragment_backend::FragmentBuiltLayout,
    frame::{
        revision_summary, RuntimeChapterStyleTables, RuntimeChapterTextIndexSource,
        RuntimeRevision, RuntimeRevisionInteractions,
    },
    metadata::layout_key,
    RuntimeDocument, RuntimeRevisionExtent, RuntimeRevisionSummary,
};

impl RuntimeDocument {
    /// Publishes one complete book, while preparation and shaping scratch data
    /// belong to just one chapter at a time. Final page artifacts remain resident.
    pub(super) fn create_fragment_revision(
        &mut self,
        layout_config: LayoutConfig,
        _line_breaking: LineBreaking,
    ) -> EpubResult<RuntimeRevisionSummary> {
        let revision_id = self.create_revision_id();
        let (config, (fragment_layout, tables, catalog, interactions, key)) = self
            .run_with_owned_layout_config(layout_config, |document, config| {
                document.ensure_layout_font_resources(config)?;
                // Complete cross-chapter footnote classification before filtering
                // any chapter. The index scans source entries without retaining them.
                let index = document.publication_footnote_index()?.clone();
                document.prepared_base();
                let available_families =
                    epub::shapeable_publication_families_for_layout_with_sources(
                        &document.document,
                        document.resolved_font_face_sources(),
                        config,
                        &document
                            .pinned_font_policy
                            .measurement_faces_for_layout(config),
                    );
                let mut tables = BTreeMap::new();
                let mut chapters = Vec::with_capacity(document.document.chapters.len());
                let mut anchors = BTreeMap::new();
                let mut page_index = 0;
                for chapter_index in 0..document.document.chapters.len() {
                    let was_loaded = document.document.chapters[chapter_index].source_loaded;
                    let result = (|| {
                        document.document.ensure_chapter_loaded(chapter_index)?;
                        document
                            .document
                            .ensure_chapter_image_dimensions_loaded(chapter_index, 1)?;
                        let prepared = document.prepare_fragment_chapter(chapter_index)?;
                        let chapter_tables = {
                            let mut fallbacks =
                                document.pinned_font_policy.family_fallbacks_for_layout(
                                    config,
                                    &document.document.package.metadata.language,
                                );
                            if let Some(policy) = fallbacks.as_mut() {
                                policy
                                    .set_available_publication_families(available_families.clone());
                            }
                            let chapter = epub::prepare_runtime_layout_chapter(
                                &prepared,
                                config,
                                fallbacks.as_ref(),
                            )?
                            .ok_or_else(|| {
                                EpubError::new("chapter style tables are unavailable")
                            })?;
                            RuntimeChapterStyleTables {
                                layout: chapter.layout_style_table,
                                inline: chapter.inline_style_table,
                            }
                        };
                        let idref = &prepared.chapters[0].source.idref;
                        let built = document.formatting_tree_from_prepared(
                            &prepared,
                            &chapter_tables,
                            idref,
                            true,
                        )?;
                        let idref = idref.clone();
                        // The formatting tree owns its inputs; parsed and projected
                        // source data can be dropped before allocating page results.
                        drop(prepared);
                        document.release_fragment_chapter_source(chapter_index, was_loaded);
                        let chapter = document
                            .paginate_built_chapter(
                                &built,
                                config,
                                &idref,
                                page_index,
                                &mut anchors,
                            )
                            .map_err(EpubError::new)?;
                        tables.insert(idref, chapter_tables);
                        Ok::<_, EpubError>(chapter)
                    })();
                    // Restore laziness even when chapter preparation fails. Keep
                    // sources that existed before this build for other live users.
                    document.release_fragment_chapter_source(chapter_index, was_loaded);
                    if let Some(engine) = document.fragment_engine.get().and_then(Option::as_ref) {
                        engine.engine.clear_inline_cache();
                    }
                    let chapter = result?;
                    page_index += chapter.pages.len();
                    chapters.push(chapter);
                }
                let mut layout = FragmentBuiltLayout::new(chapters);
                layout.anchors = anchors;
                if layout.page_count() == 0 {
                    return Err(EpubError::new("fragment pagination produced no pages"));
                }
                let catalog = document.required_font_face_catalog_from_faces(
                    epub::publication_font_face_catalog(
                        &document.document,
                        document.resolved_font_face_sources(),
                    ),
                );
                let interactions = RuntimeRevisionInteractions {
                    publication_footnotes: Some(index.footnotes),
                    footnotes: BTreeMap::new(),
                    pending_footnote_keys: Default::default(),
                    footnote_index_complete: true,
                    chapter_text_indices: RuntimeChapterTextIndexSource::FullDocument,
                    completed_chapter_idrefs: document
                        .document
                        .chapters
                        .iter()
                        .map(|c| c.idref.clone())
                        .collect(),
                };
                Ok((
                    layout,
                    tables,
                    catalog,
                    interactions,
                    layout_key(config, &document.pinned_font_policy)?,
                ))
            })?;
        let extent = RuntimeRevisionExtent {
            page_count: fragment_layout.page_count(),
            spread_count: build_spread_slots(
                fragment_layout.page_count(),
                fragment_layout.chapter_start_pages(),
                &config,
            )
            .len(),
        };
        let mut revision = RuntimeRevision::completed(
            create_empty_runtime_layout(self.document.chapters.len(), &config),
            config,
            tables,
            catalog,
            interactions,
        );
        revision.known_extent = extent;
        revision.final_extent = Some(extent);
        revision.fragment_layout = Some(fragment_layout);
        let summary = revision_summary(&revision_id, &key, &revision);
        self.insert_new_revision(revision_id, revision);
        Ok(summary)
    }

    /// Reconstructs a single chapter for pagination or an explicit diagnostic.
    /// Neither the parsed-chapter cache nor whole-book preparation grows here.
    pub(in crate::runtime) fn prepare_fragment_chapter(
        &self,
        chapter_index: usize,
    ) -> EpubResult<PreparedLoadedDocument> {
        let mut parsed = None;
        let mut scan = self.document.chapter_source_scan_session();
        self.document.visit_available_chapter_source_with_session(
            &mut scan,
            chapter_index,
            |_, chapter, source| {
                parsed = Some(epub::parsed_loaded_chapter_source_from_text(
                    chapter, source,
                ));
            },
        )?;
        let parsed = parsed.ok_or_else(|| {
            EpubError::new(format!("chapter source is unavailable: {chapter_index}"))
        })?;
        let transient_base;
        let base = if let Some(base) = self.prepared_base.as_ref() {
            base
        } else {
            transient_base = epub::prepare_loaded_document_base(&self.document);
            &transient_base
        };
        let index = self
            .publication_footnotes
            .get()
            .ok_or_else(|| EpubError::new("publication footnote index is unavailable"))?;
        Ok(
            epub::prepare_loaded_document_with_base_and_footnote_targets(
                base,
                vec![parsed],
                &index.targets,
            ),
        )
    }

    fn release_fragment_chapter_source(&mut self, chapter_index: usize, was_loaded: bool) {
        if was_loaded || self.document.archive_source.is_none() {
            return;
        }
        let chapter = &mut self.document.chapters[chapter_index];
        chapter.xhtml_source = String::new();
        chapter.source_loaded = false;
        chapter.image_refs = None;
    }
}
