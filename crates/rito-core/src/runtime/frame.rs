use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    sync::Arc,
};

use rito_style_contract::{InlineStyleTableV1, LayoutStyleTableV1};
use serde_json::{Number, Value};

use crate::{
    epub::{EpubError, EpubResult},
    interaction::{FootnoteEntry, FootnoteTargetSet},
    layout::{BuiltLayout, LayoutConfig},
    render::{
        count_display_commands, display_command_values, hash_display_commands,
        pack_display_commands, summarize_display_list_font_families,
        summarize_display_list_resource_refs, PackedDisplayCommandBufferMetadata,
    },
};

use super::{
    page_artifact::PageArtifactFrame, RuntimeChapterTextIndex, RuntimeDocument, RuntimeFrame,
    RuntimeFrameCommandBuffer, RuntimeFrameCommandBufferMetadata, RuntimeInitialFrameDecision,
    RuntimeInitialFrameRequest, RuntimePrefetchRequest, RuntimePrefetchResponse,
    RuntimeRevisionExtent, RuntimeRevisionStatus, RuntimeRevisionSummary,
};

pub(super) const FRAME_CACHE_CAPACITY: usize = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RuntimeRevisionCoordinateSpace {
    Absolute,
    ChapterLocal {
        chapter_index: usize,
        local_page_cap: usize,
        page_cap_reached: bool,
    },
}

/// The typed style tables one resolved chapter retains.
#[derive(Debug)]
pub(super) struct RuntimeChapterStyleTables {
    pub(super) layout: LayoutStyleTableV1,
    pub(super) inline: InlineStyleTableV1,
}

#[derive(Debug)]
pub(super) struct RuntimeRevision {
    pub(super) coordinate_space: RuntimeRevisionCoordinateSpace,
    pub(super) revision_version: u32,
    pub(super) status: RuntimeRevisionStatus,
    pub(super) known_extent: RuntimeRevisionExtent,
    pub(super) final_extent: Option<RuntimeRevisionExtent>,
    pub(super) layout: BuiltLayout,
    pub(super) layout_config: LayoutConfig,
    /// Typed style tables per resolved chapter idref. Populated
    /// whole-revision on eager builds and per chapter as continuations
    /// publish; the fragment pipeline and style diagnostics read these
    /// instead of any JSON style representation.
    pub(super) chapter_style_tables: BTreeMap<String, RuntimeChapterStyleTables>,
    pub(super) required_font_face_catalog: Option<Vec<super::RuntimeRequiredFontFace>>,
    pub(super) interactions: RuntimeRevisionInteractions,
    pub(super) frame_cache: BTreeMap<usize, RuntimeCachedFrame>,
    pub(super) frame_cache_order: VecDeque<usize>,
    /// Whole-book fragment page table. `Some` makes the fragment engine
    /// this revision's pagination authority and idles the bridge above.
    pub(super) fragment_layout: Option<super::fragment_backend::FragmentBuiltLayout>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RuntimeRevisionInteractions {
    /// Immutable publication-wide definitions. Publication revisions share
    /// this allocation; chapter-local revisions normally leave it absent.
    pub(super) publication_footnotes: Option<Arc<BTreeMap<String, FootnoteEntry>>>,
    /// Small revision-local overlay (normally only targets referenced by the
    /// active chapter).
    pub(super) footnotes: BTreeMap<String, FootnoteEntry>,
    pub(super) pending_footnote_keys: FootnoteTargetSet,
    pub(super) footnote_index_complete: bool,
    pub(super) chapter_text_indices: RuntimeChapterTextIndexSource,
    pub(super) completed_chapter_idrefs: BTreeSet<String>,
}

impl RuntimeRevisionInteractions {
    pub(super) fn footnote(&self, key: &str) -> Option<&FootnoteEntry> {
        self.footnotes.get(key).or_else(|| {
            self.publication_footnotes
                .as_deref()
                .and_then(|footnotes| footnotes.get(key))
        })
    }

    pub(super) fn contains_footnote(&self, key: &str) -> bool {
        self.footnote(key).is_some()
    }

    pub(super) fn owned_footnotes(&self) -> BTreeMap<String, FootnoteEntry> {
        let mut footnotes = self
            .publication_footnotes
            .as_deref()
            .cloned()
            .unwrap_or_default();
        footnotes.extend(self.footnotes.clone());
        footnotes
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum RuntimeChapterTextIndexSource {
    FullDocument,
    Materialized(BTreeMap<String, RuntimeChapterTextIndex>),
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct RuntimeCachedFrame {
    pub(super) frame: Option<RuntimeFrame>,
    pub(super) command_buffer: RuntimeFrameCommandBuffer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeFrameCachePayload {
    PackedOnly,
    IncludeJson,
}

#[derive(Debug, Default)]
pub(super) struct RuntimeFrameCacheOwner {
    pub(super) frames: BTreeMap<usize, RuntimeCachedFrame>,
    pub(super) order: VecDeque<usize>,
}

impl RuntimeRevision {
    /// True while this revision paginates the whole publication, so its
    /// page and spread indexes are book-wide numbers. Chapter-local
    /// revisions number within a rollover window instead.
    pub(super) const fn is_absolute_coordinate_space(&self) -> bool {
        matches!(
            self.coordinate_space,
            RuntimeRevisionCoordinateSpace::Absolute
        )
    }

    pub(super) fn completed(
        layout: BuiltLayout,
        layout_config: LayoutConfig,
        chapter_style_tables: BTreeMap<String, RuntimeChapterStyleTables>,
        required_font_face_catalog: Option<Vec<super::RuntimeRequiredFontFace>>,
        interactions: RuntimeRevisionInteractions,
    ) -> Self {
        let extent = revision_extent(&layout);
        Self {
            coordinate_space: RuntimeRevisionCoordinateSpace::Absolute,
            revision_version: 0,
            status: RuntimeRevisionStatus::Complete,
            known_extent: extent,
            final_extent: Some(extent),
            layout,
            layout_config,
            chapter_style_tables,
            required_font_face_catalog,
            interactions,
            frame_cache: BTreeMap::new(),
            frame_cache_order: VecDeque::new(),
            fragment_layout: None,
        }
    }

    pub(super) fn warming(
        layout: BuiltLayout,
        layout_config: LayoutConfig,
        required_font_face_catalog: Option<Vec<super::RuntimeRequiredFontFace>>,
        interactions: RuntimeRevisionInteractions,
    ) -> Self {
        Self {
            coordinate_space: RuntimeRevisionCoordinateSpace::Absolute,
            revision_version: 0,
            status: RuntimeRevisionStatus::Warming,
            known_extent: RuntimeRevisionExtent {
                page_count: 0,
                spread_count: 0,
            },
            final_extent: None,
            layout,
            layout_config,
            chapter_style_tables: BTreeMap::new(),
            required_font_face_catalog,
            interactions,
            frame_cache: BTreeMap::new(),
            frame_cache_order: VecDeque::new(),
            fragment_layout: None,
        }
    }

    pub(super) fn warming_chapter_local(
        layout: BuiltLayout,
        layout_config: LayoutConfig,
        required_font_face_catalog: Option<Vec<super::RuntimeRequiredFontFace>>,
        interactions: RuntimeRevisionInteractions,
        chapter_index: usize,
        local_page_cap: usize,
    ) -> Self {
        let mut revision = Self::warming(
            layout,
            layout_config,
            required_font_face_catalog,
            interactions,
        );
        revision.coordinate_space = RuntimeRevisionCoordinateSpace::ChapterLocal {
            chapter_index,
            local_page_cap,
            page_cap_reached: false,
        };
        revision
    }

    pub(super) fn take_frame_cache(&mut self) -> RuntimeFrameCacheOwner {
        RuntimeFrameCacheOwner {
            frames: std::mem::take(&mut self.frame_cache),
            order: std::mem::take(&mut self.frame_cache_order),
        }
    }
}

pub(super) fn revision_summary(
    revision_id: &str,
    layout_key: &str,
    revision: &RuntimeRevision,
) -> RuntimeRevisionSummary {
    let known_extent = revision.known_extent;
    RuntimeRevisionSummary {
        revision_id: revision_id.to_owned(),
        revision_version: revision.revision_version,
        layout_key: layout_key.to_owned(),
        status: revision.status,
        known_extent,
        final_extent: revision.final_extent,
        page_count: known_extent.page_count,
        spread_count: known_extent.spread_count,
        pagination_backend: Some(
            if revision.fragment_layout.is_some() {
                "fragment"
            } else {
                "retained"
            }
            .to_owned(),
        ),
    }
}

fn revision_extent(layout: &BuiltLayout) -> RuntimeRevisionExtent {
    RuntimeRevisionExtent {
        page_count: layout.summary.pagination_flow.page_count,
        spread_count: layout
            .summary
            .pagination_flow
            .display_list_flow
            .spread_count,
    }
}

fn runtime_cached_frame(
    revision_id: &str,
    layout_config: &LayoutConfig,
    frame: PageArtifactFrame,
    payload: RuntimeFrameCachePayload,
) -> RuntimeCachedFrame {
    let spread_index = frame.spread_index;
    let commands = &frame.commands;
    let font_families = summarize_display_list_font_families(commands);
    let packed = pack_display_commands(commands);
    let image_dominated = frame_image_dominated(
        &packed.metadata.command_counts,
        !packed.metadata.resource_table.is_empty(),
    );
    let command_buffer = runtime_frame_command_buffer(RuntimeFrameCommandBufferInput {
        revision_id,
        spread_index,
        width: number_value(layout_config.viewport_width),
        height: number_value(layout_config.viewport_height),
        metadata: packed.metadata,
        bytes: packed.bytes,
        font_families,
        image_dominated,
    });
    let runtime_frame = (payload == RuntimeFrameCachePayload::IncludeJson)
        .then(|| runtime_frame_from_commands(frame, &command_buffer.metadata));
    RuntimeCachedFrame {
        frame: runtime_frame,
        command_buffer,
    }
}

#[cfg(test)]
pub(super) fn chapter_window_layout_config(layout_config: &LayoutConfig) -> LayoutConfig {
    into_chapter_window_layout_config(layout_config.clone())
}

pub(super) fn into_chapter_window_layout_config(mut config: LayoutConfig) -> LayoutConfig {
    config.first_page_alone = false;
    config
}

impl RuntimeDocument {
    pub fn get_frame(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> EpubResult<RuntimeFrame> {
        self.get_frame_inner(revision_id, spread_index)
    }

    pub fn get_frame_command_buffer(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> EpubResult<RuntimeFrameCommandBuffer> {
        Ok(self
            .ensure_frame_cached(revision_id, spread_index)?
            .command_buffer
            .clone())
    }

    /// Returns an owned metadata snapshot without copying the packed bytes.
    pub fn get_frame_command_buffer_metadata(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> EpubResult<RuntimeFrameCommandBufferMetadata> {
        Ok(self
            .ensure_frame_cached(revision_id, spread_index)?
            .command_buffer
            .metadata
            .clone())
    }

    /// Copies the packed command bytes without copying their metadata tables.
    pub fn read_frame_command_buffer(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> EpubResult<Vec<u8>> {
        Ok(self
            .ensure_frame_cached(revision_id, spread_index)?
            .command_buffer
            .bytes
            .clone())
    }

    /// Returns the frame's unique image-resource hrefs without copying its commands.
    ///
    /// `RITOFCB2` currently defines `resource_table` as the canonical sorted
    /// image href set. Extending that table to other resource kinds requires
    /// auditing this projection.
    pub fn get_frame_image_resource_hrefs(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> EpubResult<Vec<String>> {
        Ok(self
            .ensure_frame_cached(revision_id, spread_index)?
            .command_buffer
            .metadata
            .resource_table
            .clone())
    }

    pub fn prefetch_frames(
        &mut self,
        revision_id: &str,
        request: RuntimePrefetchRequest,
    ) -> EpubResult<RuntimePrefetchResponse> {
        self.assert_revision_exists(revision_id)?;
        let mut warmed_spread_indexes = Vec::new();
        let mut missing_spread_indexes = Vec::new();
        for spread_index in unique_spread_indexes(request.spread_indexes) {
            match self.ensure_frame_cached(revision_id, spread_index) {
                Ok(_) => warmed_spread_indexes.push(spread_index),
                Err(_) => missing_spread_indexes.push(spread_index),
            }
        }
        Ok(RuntimePrefetchResponse {
            revision_id: revision_id.to_owned(),
            warmed_spread_indexes,
            missing_spread_indexes,
            cached_frame_count: self.cached_frame_count(revision_id).unwrap_or(0),
        })
    }

    pub fn get_frame_summary(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> EpubResult<RuntimeFrame> {
        self.get_frame_inner(revision_id, spread_index)
    }

    pub fn cached_frame_count(&self, revision_id: &str) -> Option<usize> {
        self.revisions
            .get(revision_id)
            .map(|revision| revision.frame_cache.len())
    }

    pub fn initial_frame_decision(
        &self,
        revision_id: &str,
        request: RuntimeInitialFrameRequest,
    ) -> EpubResult<Option<RuntimeInitialFrameDecision>> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        let spread_count = revision.known_extent.spread_count;
        let Some(spread_index) = initial_frame_index(spread_count, request) else {
            return Ok(None);
        };
        if spread_index >= spread_count {
            return Err(EpubError::new(format!(
                "unknown spread index: {spread_index}"
            )));
        }
        Ok(Some(RuntimeInitialFrameDecision {
            revision_id: revision_id.to_owned(),
            spread_index,
            display_spread_index: spread_index,
        }))
    }

    fn get_frame_inner(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> EpubResult<RuntimeFrame> {
        Ok(self
            .ensure_frame_cached_with_payload(
                revision_id,
                spread_index,
                RuntimeFrameCachePayload::IncludeJson,
            )?
            .frame
            .as_ref()
            .expect("JSON cache request materializes the runtime frame")
            .clone())
    }

    pub(super) fn get_chapter_local_frame_inner(
        &mut self,
        revision_id: &str,
        local_spread_index: usize,
    ) -> EpubResult<RuntimeFrame> {
        Ok(self
            .ensure_chapter_local_frame_cached(
                revision_id,
                local_spread_index,
                RuntimeFrameCachePayload::IncludeJson,
            )?
            .frame
            .as_ref()
            .expect("chapter-local JSON cache request materializes a frame")
            .clone())
    }

    pub(super) fn get_chapter_local_frame_command_buffer_metadata_inner(
        &mut self,
        revision_id: &str,
        local_spread_index: usize,
    ) -> EpubResult<RuntimeFrameCommandBufferMetadata> {
        Ok(self
            .ensure_chapter_local_frame_cached(
                revision_id,
                local_spread_index,
                RuntimeFrameCachePayload::PackedOnly,
            )?
            .command_buffer
            .metadata
            .clone())
    }

    pub(super) fn read_chapter_local_frame_command_buffer_inner(
        &mut self,
        revision_id: &str,
        local_spread_index: usize,
    ) -> EpubResult<Vec<u8>> {
        Ok(self
            .ensure_chapter_local_frame_cached(
                revision_id,
                local_spread_index,
                RuntimeFrameCachePayload::PackedOnly,
            )?
            .command_buffer
            .bytes
            .clone())
    }

    pub(super) fn get_chapter_local_frame_image_resource_hrefs_inner(
        &mut self,
        revision_id: &str,
        local_spread_index: usize,
    ) -> EpubResult<Vec<String>> {
        Ok(self
            .ensure_chapter_local_frame_cached(
                revision_id,
                local_spread_index,
                RuntimeFrameCachePayload::PackedOnly,
            )?
            .command_buffer
            .metadata
            .resource_table
            .clone())
    }

    fn ensure_frame_cached(
        &mut self,
        revision_id: &str,
        spread_index: usize,
    ) -> EpubResult<&RuntimeCachedFrame> {
        self.ensure_frame_cached_with_payload(
            revision_id,
            spread_index,
            RuntimeFrameCachePayload::PackedOnly,
        )
    }

    fn ensure_frame_cached_with_payload(
        &mut self,
        revision_id: &str,
        spread_index: usize,
        payload: RuntimeFrameCachePayload,
    ) -> EpubResult<&RuntimeCachedFrame> {
        let result = self
            .revisions
            .get_mut(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))
            .and_then(|revision| cache_runtime_frame(revision, revision_id, spread_index, payload));
        match result {
            Ok((replaced, evicted)) => {
                if let Some(replaced) = replaced {
                    self.cleanup_queue.enqueue_cached_frame(replaced);
                }
                if let Some(evicted) = evicted {
                    self.cleanup_queue.enqueue_cached_frame(evicted);
                }
                self.service_cleanup_queue();
                self.cached_frame(revision_id, spread_index)
            }
            Err(error) => {
                self.service_cleanup_queue();
                Err(error)
            }
        }
    }

    fn ensure_chapter_local_frame_cached(
        &mut self,
        revision_id: &str,
        local_spread_index: usize,
        payload: RuntimeFrameCachePayload,
    ) -> EpubResult<&RuntimeCachedFrame> {
        let result = self
            .chapter_local_revisions
            .get_mut(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown chapter-local revision: {revision_id}")))
            .and_then(|revision| {
                cache_runtime_frame(revision, revision_id, local_spread_index, payload)
            });
        match result {
            Ok((replaced, evicted)) => {
                if let Some(replaced) = replaced {
                    self.cleanup_queue.enqueue_cached_frame(replaced);
                }
                if let Some(evicted) = evicted {
                    self.cleanup_queue.enqueue_cached_frame(evicted);
                }
                self.service_cleanup_queue();
                self.chapter_local_revisions
                    .get(revision_id)
                    .and_then(|revision| revision.frame_cache.get(&local_spread_index))
                    .ok_or_else(|| {
                        EpubError::new(format!("unknown local spread: {local_spread_index}"))
                    })
            }
            Err(error) => {
                self.service_cleanup_queue();
                Err(error)
            }
        }
    }

    fn cached_frame(
        &self,
        revision_id: &str,
        spread_index: usize,
    ) -> EpubResult<&RuntimeCachedFrame> {
        self.revisions
            .get(revision_id)
            .and_then(|revision| revision.frame_cache.get(&spread_index))
            .ok_or_else(|| EpubError::new(format!("unknown spread index: {spread_index}")))
    }
}

fn cache_runtime_frame(
    revision: &mut RuntimeRevision,
    revision_id: &str,
    spread_index: usize,
    payload: RuntimeFrameCachePayload,
) -> EpubResult<(Option<RuntimeCachedFrame>, Option<RuntimeCachedFrame>)> {
    if spread_index >= revision.known_extent.spread_count {
        return Err(EpubError::new(format!(
            "unknown spread index: {spread_index}"
        )));
    }
    if revision.frame_cache.contains_key(&spread_index) {
        materialize_cached_runtime_frame(revision, spread_index, payload)?;
        touch_cached_frame(revision, spread_index);
        return Ok((None, None));
    }
    let frame_commands = revision
        .chapter_engine_session()
        .frame(spread_index)
        .ok_or_else(|| EpubError::new(format!("unknown spread index: {spread_index}")))?;
    let cached_frame = runtime_cached_frame(
        revision_id,
        &revision.layout_config,
        frame_commands,
        payload,
    );
    let replaced = revision.frame_cache.insert(spread_index, cached_frame);
    touch_cached_frame(revision, spread_index);
    let evicted = evict_oldest_frame(revision);
    Ok((replaced, evicted))
}

fn materialize_cached_runtime_frame(
    revision: &mut RuntimeRevision,
    spread_index: usize,
    payload: RuntimeFrameCachePayload,
) -> EpubResult<()> {
    let needs_json = payload == RuntimeFrameCachePayload::IncludeJson
        && revision
            .frame_cache
            .get(&spread_index)
            .is_some_and(|cached| cached.frame.is_none());
    if !needs_json {
        return Ok(());
    }
    let frame_commands = revision
        .chapter_engine_session()
        .frame(spread_index)
        .ok_or_else(|| EpubError::new(format!("unknown spread index: {spread_index}")))?;
    let runtime_frame = {
        let cached = revision
            .frame_cache
            .get(&spread_index)
            .expect("cached spread still exists");
        let resource_refs = validate_cached_runtime_frame_source(
            &frame_commands,
            &revision.layout_config,
            &cached.command_buffer.metadata,
        )?;
        runtime_frame_from_commands_with_resource_refs(
            frame_commands,
            &cached.command_buffer.metadata,
            resource_refs,
        )
    };
    revision
        .frame_cache
        .get_mut(&spread_index)
        .expect("cached spread still exists")
        .frame = Some(runtime_frame);
    Ok(())
}

fn evict_oldest_frame(revision: &mut RuntimeRevision) -> Option<RuntimeCachedFrame> {
    if revision.frame_cache.len() <= FRAME_CACHE_CAPACITY {
        return None;
    }
    let spread_index = revision
        .frame_cache_order
        .pop_front()
        .expect("over-capacity cache has an LRU entry");
    let evicted = revision
        .frame_cache
        .remove(&spread_index)
        .expect("LRU entry exists in the frame cache");
    debug_assert!(revision.frame_cache.len() <= FRAME_CACHE_CAPACITY);
    Some(evicted)
}

fn touch_cached_frame(revision: &mut RuntimeRevision, spread_index: usize) {
    revision
        .frame_cache_order
        .retain(|cached_spread_index| *cached_spread_index != spread_index);
    revision.frame_cache_order.push_back(spread_index);
}

fn initial_frame_index(spread_count: usize, request: RuntimeInitialFrameRequest) -> Option<usize> {
    if let Some(spread_index) = request.spread_index {
        return Some(spread_index);
    }
    let progress = request.anchor_progress?;
    if spread_count == 0 {
        return None;
    }
    let progress = progress.clamp(0.0, 1.0);
    Some(((spread_count - 1) as f64 * progress).round() as usize)
}

struct RuntimeFrameCommandBufferInput<'a> {
    revision_id: &'a str,
    spread_index: usize,
    width: Value,
    height: Value,
    metadata: PackedDisplayCommandBufferMetadata,
    bytes: Vec<u8>,
    font_families: Vec<String>,
    image_dominated: bool,
}

fn runtime_frame_command_buffer(
    input: RuntimeFrameCommandBufferInput<'_>,
) -> RuntimeFrameCommandBuffer {
    RuntimeFrameCommandBuffer {
        metadata: RuntimeFrameCommandBufferMetadata {
            revision_id: input.revision_id.to_owned(),
            spread_index: input.spread_index,
            width: input.width,
            height: input.height,
            protocol_version: input.metadata.protocol_version,
            command_count: input.metadata.command_count,
            command_counts: input.metadata.command_counts,
            record_stats: input.metadata.record_stats,
            byte_length: input.metadata.byte_length,
            command_hash: input.metadata.command_hash,
            resource_ref_count: input.metadata.resource_ref_count,
            resource_table: input.metadata.resource_table,
            font_families: input.font_families,
            image_dominated: input.image_dominated,
            string_table: input.metadata.string_table,
            payload_table: input.metadata.payload_table,
        },
        bytes: input.bytes,
    }
}

fn runtime_frame_from_commands(
    frame: PageArtifactFrame,
    metadata: &RuntimeFrameCommandBufferMetadata,
) -> RuntimeFrame {
    let resource_refs = summarize_display_list_resource_refs(&frame.commands);
    runtime_frame_from_commands_with_resource_refs(frame, metadata, resource_refs)
}

fn runtime_frame_from_commands_with_resource_refs(
    frame: PageArtifactFrame,
    metadata: &RuntimeFrameCommandBufferMetadata,
    resource_refs: crate::render::DisplayListResourceRefs,
) -> RuntimeFrame {
    let PageArtifactFrame {
        spread_index,
        page_indexes,
        commands,
    } = frame;
    debug_assert_eq!(spread_index, metadata.spread_index);
    debug_assert_eq!(commands.len(), metadata.command_count);
    debug_assert_eq!(count_display_commands(&commands), metadata.command_counts);
    debug_assert_eq!(hash_display_commands(&commands), metadata.command_hash);
    debug_assert_eq!(resource_refs.image_refs, metadata.resource_ref_count);
    debug_assert_eq!(resource_refs.images, metadata.resource_table);
    RuntimeFrame {
        revision_id: metadata.revision_id.clone(),
        spread_index,
        page_indexes,
        width: metadata.width.clone(),
        height: metadata.height.clone(),
        commands: display_command_values(&commands),
        command_count: metadata.command_count,
        command_counts: metadata.command_counts.clone(),
        command_hash: metadata.command_hash.clone(),
        resource_refs,
        font_families: metadata.font_families.clone(),
        image_dominated: metadata.image_dominated,
    }
}

fn validate_cached_runtime_frame_source(
    frame: &PageArtifactFrame,
    layout_config: &LayoutConfig,
    metadata: &RuntimeFrameCommandBufferMetadata,
) -> EpubResult<crate::render::DisplayListResourceRefs> {
    let command_counts = count_display_commands(&frame.commands);
    let command_hash = hash_display_commands(&frame.commands);
    let resource_refs = summarize_display_list_resource_refs(&frame.commands);
    let font_families = summarize_display_list_font_families(&frame.commands);
    let image_dominated = frame_image_dominated(&command_counts, resource_refs.unique_images > 0);
    let matches = frame.spread_index == metadata.spread_index
        && number_value(layout_config.viewport_width) == metadata.width
        && number_value(layout_config.viewport_height) == metadata.height
        && frame.commands.len() == metadata.command_count
        && command_counts == metadata.command_counts
        && command_hash == metadata.command_hash
        && resource_refs.image_refs == metadata.resource_ref_count
        && resource_refs.images == metadata.resource_table
        && font_families == metadata.font_families
        && image_dominated == metadata.image_dominated;
    if !matches {
        return Err(EpubError::new(format!(
            "cached frame projection does not match revision layout: spread {}",
            frame.spread_index
        )));
    }
    Ok(resource_refs)
}

fn frame_image_dominated(
    command_counts: &BTreeMap<String, usize>,
    has_image_resources: bool,
) -> bool {
    has_image_resources
        && !command_counts.contains_key("paintText")
        && !command_counts.contains_key("paintRuby")
}

fn number_value(value: f64) -> Value {
    let rounded = (value * 1000.0).round() / 1000.0;
    if rounded.fract().abs() < f64::EPSILON {
        Value::Number(Number::from(rounded as i64))
    } else {
        Value::Number(Number::from_f64(rounded).unwrap_or_else(|| Number::from(0)))
    }
}

fn unique_spread_indexes(indexes: Vec<usize>) -> Vec<usize> {
    let mut unique = Vec::new();
    for index in indexes {
        if !unique.contains(&index) {
            unique.push(index);
        }
    }
    unique
}
