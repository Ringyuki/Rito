use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde_json::{Number, Value};

use crate::{
    epub::{EpubError, EpubResult},
    interaction::FootnoteEntry,
    layout::{
        build_display_list_frame_commands, BuiltLayout, DisplayListFrameCommands, LayoutConfig,
    },
    render::{
        count_display_commands, display_command_values, hash_display_commands,
        pack_display_commands, summarize_display_list_font_families,
        summarize_display_list_resource_refs, PackedDisplayCommandBufferMetadata,
    },
};

use super::{
    RuntimeChapterTextIndex, RuntimeDocument, RuntimeFrame, RuntimeFrameCommandBuffer,
    RuntimeFrameCommandBufferMetadata, RuntimeInitialFrameDecision, RuntimeInitialFrameRequest,
    RuntimePrefetchRequest, RuntimePrefetchResponse, RuntimeRevisionExtent, RuntimeRevisionStatus,
    RuntimeRevisionSummary,
};

pub(super) const FRAME_CACHE_CAPACITY: usize = 12;

#[derive(Debug)]
pub(super) struct RuntimeRevision {
    pub(super) revision_version: u32,
    pub(super) status: RuntimeRevisionStatus,
    pub(super) known_extent: RuntimeRevisionExtent,
    pub(super) final_extent: Option<RuntimeRevisionExtent>,
    pub(super) layout: BuiltLayout,
    pub(super) layout_config: LayoutConfig,
    pub(super) required_font_face_catalog: Option<Vec<super::RuntimeRequiredFontFace>>,
    pub(super) interactions: RuntimeRevisionInteractions,
    pub(super) frame_cache: BTreeMap<usize, RuntimeCachedFrame>,
    pub(super) frame_cache_order: VecDeque<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RuntimeRevisionInteractions {
    pub(super) footnotes: BTreeMap<String, FootnoteEntry>,
    pub(super) chapter_text_indices: RuntimeChapterTextIndexSource,
    pub(super) completed_chapter_idrefs: BTreeSet<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum RuntimeChapterTextIndexSource {
    FullDocument,
    Materialized(BTreeMap<String, RuntimeChapterTextIndex>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RuntimeCachedFrame {
    pub(super) frame: RuntimeFrame,
    pub(super) command_buffer: RuntimeFrameCommandBuffer,
}

impl RuntimeRevision {
    pub(super) fn completed(
        layout: BuiltLayout,
        layout_config: LayoutConfig,
        required_font_face_catalog: Option<Vec<super::RuntimeRequiredFontFace>>,
        interactions: RuntimeRevisionInteractions,
    ) -> Self {
        let extent = revision_extent(&layout);
        Self {
            revision_version: 0,
            status: RuntimeRevisionStatus::Complete,
            known_extent: extent,
            final_extent: Some(extent),
            layout,
            layout_config,
            required_font_face_catalog,
            interactions,
            frame_cache: BTreeMap::new(),
            frame_cache_order: VecDeque::new(),
        }
    }

    pub(super) fn warming(
        layout: BuiltLayout,
        layout_config: LayoutConfig,
        required_font_face_catalog: Option<Vec<super::RuntimeRequiredFontFace>>,
        interactions: RuntimeRevisionInteractions,
    ) -> Self {
        Self {
            revision_version: 0,
            status: RuntimeRevisionStatus::Warming,
            known_extent: RuntimeRevisionExtent {
                page_count: 0,
                spread_count: 0,
            },
            final_extent: None,
            layout,
            layout_config,
            required_font_face_catalog,
            interactions,
            frame_cache: BTreeMap::new(),
            frame_cache_order: VecDeque::new(),
        }
    }

    pub(super) fn clear_frame_cache(&mut self) {
        self.frame_cache.clear();
        self.frame_cache_order.clear();
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

pub(super) fn runtime_cached_frame(
    revision_id: &str,
    layout_config: &LayoutConfig,
    frame: DisplayListFrameCommands,
) -> RuntimeCachedFrame {
    let command_values = display_command_values(&frame.commands);
    let command_counts = count_display_commands(&frame.commands);
    let resource_refs = summarize_display_list_resource_refs(&frame.commands);
    let font_families = summarize_display_list_font_families(&frame.commands);
    let image_dominated = frame_image_dominated(&command_counts, &resource_refs);
    let packed = pack_display_commands(&frame.commands);
    let runtime_frame = RuntimeFrame {
        revision_id: revision_id.to_owned(),
        spread_index: frame.spread_index,
        page_indexes: frame.page_indexes.clone(),
        width: number_value(layout_config.viewport_width),
        height: number_value(layout_config.viewport_height),
        commands: command_values,
        command_count: frame.commands.len(),
        command_counts,
        command_hash: hash_display_commands(&frame.commands),
        resource_refs,
        font_families: font_families.clone(),
        image_dominated,
    };
    RuntimeCachedFrame {
        frame: runtime_frame,
        command_buffer: runtime_frame_command_buffer(RuntimeFrameCommandBufferInput {
            revision_id,
            spread_index: frame.spread_index,
            width: number_value(layout_config.viewport_width),
            height: number_value(layout_config.viewport_height),
            metadata: packed.metadata,
            bytes: packed.bytes,
            font_families,
            image_dominated,
        }),
    }
}

pub(super) fn chapter_window_layout_config(layout_config: &LayoutConfig) -> LayoutConfig {
    let mut config = layout_config.clone();
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
        self.ensure_frame_cached(revision_id, spread_index)?;
        Ok(self
            .cached_frame(revision_id, spread_index)?
            .command_buffer
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
            match self.get_frame_inner(revision_id, spread_index) {
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
        self.ensure_frame_cached(revision_id, spread_index)?;
        Ok(self.cached_frame(revision_id, spread_index)?.frame.clone())
    }

    fn ensure_frame_cached(&mut self, revision_id: &str, spread_index: usize) -> EpubResult<()> {
        let revision = self
            .revisions
            .get_mut(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        if spread_index >= revision.known_extent.spread_count {
            return Err(EpubError::new(format!(
                "unknown spread index: {spread_index}"
            )));
        }
        if revision.frame_cache.contains_key(&spread_index) {
            touch_cached_frame(revision, spread_index);
            return Ok(());
        }
        let frame_commands = build_display_list_frame_commands(
            &revision.layout.pages,
            &revision.layout.chapter_start_pages,
            &revision.layout_config,
            spread_index,
        )
        .ok_or_else(|| EpubError::new(format!("unknown spread index: {spread_index}")))?;
        let cached_frame =
            runtime_cached_frame(revision_id, &revision.layout_config, frame_commands);
        revision.frame_cache.insert(spread_index, cached_frame);
        touch_cached_frame(revision, spread_index);
        while revision.frame_cache.len() > FRAME_CACHE_CAPACITY {
            if let Some(evicted) = revision.frame_cache_order.pop_front() {
                revision.frame_cache.remove(&evicted);
            }
        }
        Ok(())
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

fn frame_image_dominated(
    command_counts: &BTreeMap<String, usize>,
    resource_refs: &crate::render::DisplayListResourceRefs,
) -> bool {
    resource_refs.unique_images > 0
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
