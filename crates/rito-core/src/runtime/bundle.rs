use crate::epub::{EpubError, EpubResult};
use crate::layout::summarize_layout_font_families;

use super::revision_fonts::required_font_faces_for_revision;
use super::{
    frame::revision_summary,
    metadata::layout_key,
    navigation::{runtime_revision_navigation, runtime_toc_targets},
    RuntimeActiveChapterPreviewRevisionRequest, RuntimeChapterTextIndices,
    RuntimeCreatedRevisionBundle, RuntimeCreatedViewRevision, RuntimeDocument, RuntimeFootnotes,
    RuntimeFullRevisionBundleRequest, RuntimeInitialFrameDecision, RuntimeInitialFrameRequest,
    RuntimeInitialPreviewRevisionRequest, RuntimePreviewRevisionBundleRequest,
    RuntimeRevisionBundle, RuntimeRevisionRequest, RuntimeSourceLocator,
    RuntimeSourceLocatorResolution, RuntimeTocTargets, RuntimeViewRevisionDisplay,
    RuntimeViewRevisionFollowUp, RuntimeViewRevisionKind, RuntimeViewRevisionMetadata,
    RuntimeViewRevisionMode, RuntimeViewRevisionRequest, DEFAULT_DEFERRED_FULL_REFLOW_DELAY_MS,
    DEFAULT_INITIAL_PREVIEW_CHAPTER_LIMIT,
};

impl RuntimeDocument {
    fn create_revision_bundle(
        &mut self,
        request: RuntimeRevisionRequest,
        include_toc_targets: bool,
        initial_frame_request: RuntimeInitialFrameRequest,
    ) -> EpubResult<RuntimeCreatedRevisionBundle> {
        let preview = request.is_preview();
        let revision = self.create_revision_from_request(&request)?;
        let revision_id = revision.revision_id.clone();
        let bundle = self.revision_bundle(&revision_id, include_toc_targets)?;
        let initial_frame = if revision.spread_count == 0 {
            None
        } else {
            self.initial_frame_decision(&revision_id, initial_frame_request)?
        };
        Ok(RuntimeCreatedRevisionBundle {
            bundle,
            initial_frame,
            preview,
        })
    }

    pub fn create_full_revision_bundle(
        &mut self,
        request: RuntimeFullRevisionBundleRequest,
    ) -> EpubResult<RuntimeCreatedRevisionBundle> {
        self.create_full_revision_bundle_with_metadata(
            request,
            RuntimeViewRevisionMetadata::Complete,
            None,
        )
    }

    fn create_full_revision_bundle_with_metadata(
        &mut self,
        request: RuntimeFullRevisionBundleRequest,
        metadata: RuntimeViewRevisionMetadata,
        preserve_locator: Option<RuntimeSourceLocator>,
    ) -> EpubResult<RuntimeCreatedRevisionBundle> {
        let revision = self.create_revision_from_request(&super::RuntimeRevisionRequest {
            layout_config: request.layout_config,
            line_breaking: request.line_breaking,
            preview_chapter_limit: None,
            preview_chapter_index: None,
        })?;
        let revision_id = revision.revision_id.clone();
        let bundle = self.revision_bundle_with_metadata(&revision_id, true, metadata)?;
        let initial_frame = if revision.spread_count == 0 {
            None
        } else {
            match self.view_initial_frame_decision(
                &revision_id,
                request
                    .active_spread_index
                    .min(revision.spread_count.saturating_sub(1)),
                preserve_locator,
                None,
            ) {
                Ok(decision) => decision,
                Err(error) => {
                    self.release_revision(&revision_id);
                    return Err(error);
                }
            }
        };
        Ok(RuntimeCreatedRevisionBundle {
            bundle,
            initial_frame,
            preview: false,
        })
    }

    pub fn create_initial_preview_revision_bundle(
        &mut self,
        request: RuntimeInitialPreviewRevisionRequest,
    ) -> EpubResult<RuntimeCreatedRevisionBundle> {
        self.create_revision_bundle(
            RuntimeRevisionRequest {
                layout_config: request.layout_config,
                line_breaking: request.line_breaking,
                preview_chapter_limit: Some(DEFAULT_INITIAL_PREVIEW_CHAPTER_LIMIT),
                preview_chapter_index: None,
            },
            false,
            RuntimeInitialFrameRequest {
                spread_index: Some(0),
                anchor_progress: None,
            },
        )
    }

    pub fn create_active_chapter_preview_revision_bundle(
        &mut self,
        request: RuntimeActiveChapterPreviewRevisionRequest,
    ) -> EpubResult<Option<RuntimeCreatedRevisionBundle>> {
        let Some(preview) = self
            .active_chapter_preview(&request.previous_revision_id, request.active_spread_index)?
        else {
            return Ok(None);
        };
        let mut creation = self.create_revision_bundle(
            RuntimeRevisionRequest {
                layout_config: request.layout_config,
                line_breaking: request.line_breaking,
                preview_chapter_limit: None,
                preview_chapter_index: Some(preview.chapter_index),
            },
            false,
            RuntimeInitialFrameRequest {
                spread_index: None,
                anchor_progress: Some(preview.progress),
            },
        )?;
        if let Some(initial_frame) = &mut creation.initial_frame {
            initial_frame.display_spread_index = request.active_spread_index;
        }
        Ok(Some(creation))
    }

    pub fn create_preview_revision_bundle(
        &mut self,
        request: RuntimePreviewRevisionBundleRequest,
    ) -> EpubResult<Option<RuntimeCreatedRevisionBundle>> {
        match (request.previous_revision_id, request.active_spread_index) {
            (Some(previous_revision_id), Some(active_spread_index)) => self
                .create_active_chapter_preview_revision_bundle(
                    RuntimeActiveChapterPreviewRevisionRequest {
                        layout_config: request.layout_config,
                        line_breaking: request.line_breaking,
                        previous_revision_id,
                        active_spread_index,
                    },
                ),
            _ => self
                .create_initial_preview_revision_bundle(RuntimeInitialPreviewRevisionRequest {
                    layout_config: request.layout_config,
                    line_breaking: request.line_breaking,
                })
                .map(Some),
        }
    }

    pub fn create_view_revision_bundle(
        &mut self,
        request: RuntimeViewRevisionRequest,
    ) -> EpubResult<RuntimeCreatedViewRevision> {
        self.create_view_revision_bundle_with_metadata(
            request,
            RuntimeViewRevisionMetadata::Complete,
        )
    }

    #[doc(hidden)]
    pub fn create_view_revision_bundle_with_metadata(
        &mut self,
        request: RuntimeViewRevisionRequest,
        metadata: RuntimeViewRevisionMetadata,
    ) -> EpubResult<RuntimeCreatedViewRevision> {
        match request.mode {
            RuntimeViewRevisionMode::Full => self
                .create_full_revision_bundle_with_metadata(
                    RuntimeFullRevisionBundleRequest {
                        layout_config: request.layout_config,
                        line_breaking: request.line_breaking,
                        active_spread_index: request.active_spread_index,
                    },
                    metadata,
                    request.preserve_locator,
                )
                .map(|revision| RuntimeCreatedViewRevision {
                    kind: RuntimeViewRevisionKind::Full,
                    display: RuntimeViewRevisionDisplay::Revision,
                    follow_up: None,
                    revision,
                }),
            RuntimeViewRevisionMode::Preview => {
                let preview =
                    self.create_preview_revision_bundle(RuntimePreviewRevisionBundleRequest {
                        layout_config: request.layout_config.clone(),
                        line_breaking: request.line_breaking,
                        previous_revision_id: request.previous_revision_id.clone(),
                        active_spread_index: Some(request.active_spread_index),
                    })?;
                if let Some(mut revision) = preview {
                    let revision_id = revision.bundle.revision.revision_id.clone();
                    if let Some(locator) = request.preserve_locator.clone() {
                        let display_spread_index = request
                            .previous_revision_id
                            .as_ref()
                            .map(|_| request.active_spread_index);
                        revision.initial_frame = match self.view_initial_frame_decision(
                            &revision_id,
                            request.active_spread_index,
                            Some(locator),
                            display_spread_index,
                        ) {
                            Ok(decision) => decision,
                            Err(error) => {
                                self.release_revision(&revision_id);
                                return Err(error);
                            }
                        };
                    }
                    return Ok(RuntimeCreatedViewRevision {
                        kind: RuntimeViewRevisionKind::Preview,
                        display: if request.previous_revision_id.is_some() {
                            RuntimeViewRevisionDisplay::VisualPreview
                        } else {
                            RuntimeViewRevisionDisplay::Revision
                        },
                        follow_up: revision.preview.then(|| RuntimeViewRevisionFollowUp {
                            delay_ms: DEFAULT_DEFERRED_FULL_REFLOW_DELAY_MS,
                            request: RuntimeViewRevisionRequest {
                                layout_config: request.layout_config,
                                line_breaking: request.line_breaking,
                                active_spread_index: request.active_spread_index,
                                previous_revision_id: Some(
                                    request.previous_revision_id.unwrap_or(revision_id),
                                ),
                                preserve_locator: request.preserve_locator,
                                mode: RuntimeViewRevisionMode::Full,
                            },
                        }),
                        revision,
                    });
                }
                self.create_full_revision_bundle_with_metadata(
                    RuntimeFullRevisionBundleRequest {
                        layout_config: request.layout_config,
                        line_breaking: request.line_breaking,
                        active_spread_index: request.active_spread_index,
                    },
                    metadata,
                    request.preserve_locator,
                )
                .map(|revision| RuntimeCreatedViewRevision {
                    kind: RuntimeViewRevisionKind::Full,
                    display: RuntimeViewRevisionDisplay::Revision,
                    follow_up: None,
                    revision,
                })
            }
        }
    }

    fn view_initial_frame_decision(
        &mut self,
        revision_id: &str,
        fallback_spread_index: usize,
        preserve_locator: Option<RuntimeSourceLocator>,
        display_spread_index: Option<usize>,
    ) -> EpubResult<Option<RuntimeInitialFrameDecision>> {
        let spread_index = match preserve_locator {
            Some(locator) => match self.resolve_source_locator(revision_id, locator) {
                Ok(RuntimeSourceLocatorResolution::Resolved { spread_index, .. }) => spread_index,
                Ok(RuntimeSourceLocatorResolution::Pending { reason, .. }) => {
                    return Err(EpubError::new(format!(
                        "preserve locator has no page projection: {reason:?}"
                    )));
                }
                Err(error) => {
                    return Err(EpubError::new(format!("invalid preserve locator: {error}")));
                }
            },
            None => fallback_spread_index,
        };
        let mut decision = self.initial_frame_decision(
            revision_id,
            RuntimeInitialFrameRequest {
                spread_index: Some(spread_index),
                anchor_progress: None,
            },
        )?;
        if let (Some(decision), Some(display_spread_index)) = (&mut decision, display_spread_index)
        {
            decision.display_spread_index = display_spread_index;
        }
        Ok(decision)
    }

    pub fn revision_bundle(
        &self,
        revision_id: &str,
        include_toc_targets: bool,
    ) -> EpubResult<RuntimeRevisionBundle> {
        self.revision_bundle_with_metadata(
            revision_id,
            include_toc_targets,
            RuntimeViewRevisionMetadata::Complete,
        )
    }

    fn revision_bundle_with_metadata(
        &self,
        revision_id: &str,
        include_toc_targets: bool,
        metadata: RuntimeViewRevisionMetadata,
    ) -> EpubResult<RuntimeRevisionBundle> {
        let (revision, navigation, toc_targets) =
            self.revision_bundle_navigation(revision_id, include_toc_targets)?;
        let revision_record = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        let font_families = summarize_layout_font_families(&revision_record.layout.pages);
        let required_font_faces = revision_record
            .required_font_face_catalog
            .as_deref()
            .map(|catalog| required_font_faces_for_revision(revision_id, catalog, &font_families));
        Ok(RuntimeRevisionBundle {
            revision,
            navigation,
            toc_targets,
            footnotes: RuntimeFootnotes {
                revision_id: revision_id.to_owned(),
                entries: revision_record.interactions.footnotes.clone(),
            },
            chapter_text_indices: RuntimeChapterTextIndices {
                revision_id: revision_id.to_owned(),
                entries: match metadata {
                    RuntimeViewRevisionMetadata::Complete => {
                        self.chapter_text_indices_for_revision(revision_id)?.clone()
                    }
                    RuntimeViewRevisionMetadata::OmitFullChapterTextIndices => Default::default(),
                },
            },
            font_families,
            required_font_faces,
        })
    }

    pub(super) fn revision_bundle_navigation(
        &self,
        revision_id: &str,
        include_toc_targets: bool,
    ) -> EpubResult<(
        super::RuntimeRevisionSummary,
        super::RuntimeRevisionNavigation,
        RuntimeTocTargets,
    )> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        let key = layout_key(&revision.layout_config, &self.pinned_font_policy)?;
        let summary = revision_summary(revision_id, &key, revision);
        let navigation = runtime_revision_navigation(revision_id, &self.document, revision);
        let toc_targets = if include_toc_targets {
            runtime_toc_targets(revision_id, &self.document, revision)
        } else {
            RuntimeTocTargets {
                revision_id: revision_id.to_owned(),
                targets: Vec::new(),
            }
        };
        Ok((summary, navigation, toc_targets))
    }
}
