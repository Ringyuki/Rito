use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    rc::Rc,
    sync::Arc,
};

use rito_style_contract::{InlineStyleTable, LayoutStyleTable};
use serde_json::{Number, Value};

use crate::{
    epub::{EpubError, EpubResult, LoadedEpubDocument},
    interaction::{FootnoteEntry, FootnoteTargetSet},
    layout::LayoutConfig,
    render::{
        count_display_commands, encode_reader_primitive_list, hash_display_commands, lower,
        summarize_display_list_font_families, summarize_display_list_resource_refs, DisplayCommand,
        ImageSize,
    },
};

use super::{
    fragment_backend::FragmentBuiltLayout, page_artifact::PageArtifactFrame,
    resource::find_image_size, spread::build_spread_slots, RuntimeChapterTextIndex,
    RuntimeDocument, RuntimeFrameCommandBuffer, RuntimeFrameCommandBufferMetadata,
    RuntimeInitialFrameDecision, RuntimeInitialFrameRequest, RuntimePrefetchRequest,
    RuntimePrefetchResponse, RuntimeRevisionExtent, RuntimeRevisionSummary,
};

pub(super) const FRAME_CACHE_CAPACITY: usize = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RuntimeRevisionCoordinateSpace {
    Absolute,
    ChapterLocal { chapter_index: usize },
}

/// The typed style tables one resolved chapter retains.
#[derive(Debug)]
pub(super) struct RuntimeChapterStyleTables {
    pub(super) layout: LayoutStyleTable,
    pub(super) inline: InlineStyleTable,
}

/// One paginated revision: the page table the fragment engine built for
/// a layout configuration, with the style tables, font catalog and
/// interaction state it was built from and a cache of painted frames.
#[derive(Debug)]
pub(super) struct RuntimeRevision {
    pub(super) coordinate_space: RuntimeRevisionCoordinateSpace,
    pub(super) revision_version: u32,
    /// The page and spread counts of `fragment_layout`; hosts navigate by
    /// these numbers.
    pub(super) extent: RuntimeRevisionExtent,
    pub(super) layout_config: LayoutConfig,
    /// Typed style tables per resolved chapter idref; the fragment
    /// pipeline and style diagnostics read these instead of any JSON
    /// style representation.
    pub(super) chapter_style_tables: BTreeMap<String, Rc<RuntimeChapterStyleTables>>,
    pub(super) required_font_face_catalog: Option<Vec<super::RuntimeRequiredFontFace>>,
    pub(super) interactions: RuntimeRevisionInteractions,
    pub(super) frame_cache: BTreeMap<usize, RuntimeCachedFrame>,
    pub(super) frame_cache_order: VecDeque<usize>,
    /// The revision's page table: the book's pages for a whole-book
    /// revision, one chapter's pages for a chapter-local one.
    pub(super) fragment_layout: FragmentBuiltLayout,
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

#[derive(Debug, PartialEq)]
pub(super) struct RuntimeCachedFrame {
    pub(super) command_buffer: RuntimeFrameCommandBuffer,
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

    /// A revision over an already paginated page table. The extent is
    /// the table's page count and the spread count the layout
    /// configuration's spread mode makes of those pages.
    pub(super) fn new(
        coordinate_space: RuntimeRevisionCoordinateSpace,
        layout_config: LayoutConfig,
        chapter_style_tables: BTreeMap<String, Rc<RuntimeChapterStyleTables>>,
        required_font_face_catalog: Option<Vec<super::RuntimeRequiredFontFace>>,
        interactions: RuntimeRevisionInteractions,
        fragment_layout: FragmentBuiltLayout,
    ) -> Self {
        let page_count = fragment_layout.page_count();
        let spread_count = build_spread_slots(
            page_count,
            fragment_layout.chapter_start_pages(),
            &layout_config,
        )
        .len();
        Self {
            coordinate_space,
            revision_version: 0,
            extent: RuntimeRevisionExtent {
                page_count,
                spread_count,
            },
            layout_config,
            chapter_style_tables,
            required_font_face_catalog,
            interactions,
            frame_cache: BTreeMap::new(),
            frame_cache_order: VecDeque::new(),
            fragment_layout,
        }
    }
}

pub(super) fn revision_summary(
    revision_id: &str,
    layout_key: &str,
    revision: &RuntimeRevision,
) -> RuntimeRevisionSummary {
    RuntimeRevisionSummary {
        revision_id: revision_id.to_owned(),
        revision_version: revision.revision_version,
        layout_key: layout_key.to_owned(),
        page_count: revision.extent.page_count,
        spread_count: revision.extent.spread_count,
    }
}

/// Caches a spread's frame: its display commands lowered to the device
/// grid at `ratio` and encoded as the `RITODL1` primitive list hosts blit,
/// beside the semantic summary (counts, hash, resources, fonts) that
/// identifies the frame. Background images size against the publication's
/// resource table, so their dimensions are loaded first.
fn runtime_cached_frame(
    revision_id: &str,
    layout_config: &LayoutConfig,
    frame: PageArtifactFrame,
    ratio: f64,
    document: &mut LoadedEpubDocument,
) -> EpubResult<RuntimeCachedFrame> {
    let spread_index = frame.spread_index;
    let commands = &frame.commands;
    let command_counts = count_display_commands(commands);
    let command_hash = hash_display_commands(commands);
    let resource_refs = summarize_display_list_resource_refs(commands);
    let font_families = summarize_display_list_font_families(commands);
    let image_dominated = frame_image_dominated(&command_counts, !resource_refs.images.is_empty());
    let encoded = lower_frame_commands(commands, ratio, document)?;
    let metadata = RuntimeFrameCommandBufferMetadata {
        revision_id: revision_id.to_owned(),
        spread_index,
        width: number_value(layout_config.viewport_width),
        height: number_value(layout_config.viewport_height),
        protocol_version: encoded.format_version,
        ratio,
        command_count: commands.len(),
        command_counts,
        primitive_count: encoded.command_count as usize,
        byte_length: encoded.bytes.len(),
        command_hash,
        resource_ref_count: resource_refs.image_refs,
        resource_table: resource_refs.images.clone(),
        font_families,
        image_dominated,
    };
    Ok(RuntimeCachedFrame {
        command_buffer: RuntimeFrameCommandBuffer {
            metadata,
            bytes: encoded.bytes,
        },
    })
}

/// Lowers a frame's display commands at `ratio` and encodes the primitive
/// list, loading the intrinsic size of every image the frame references
/// first so background images can be sized and tiled.
fn lower_frame_commands(
    commands: &[DisplayCommand],
    ratio: f64,
    document: &mut LoadedEpubDocument,
) -> EpubResult<crate::render::ReaderEncodedDisplayList> {
    document.ensure_frame_image_sizes(commands)?;
    let images = |href: &str| find_image_size(&document.images, href);
    let lowered =
        lower(commands, ratio, &images).map_err(|error| EpubError::new(error.to_string()))?;
    encode_reader_primitive_list(&lowered).map_err(|error| EpubError::new(error.to_string()))
}

impl LoadedEpubDocument {
    /// Loads the dimensions of every image a frame's display commands
    /// reference, so the lowering can size them.
    pub(super) fn ensure_frame_image_sizes(
        &mut self,
        commands: &[DisplayCommand],
    ) -> EpubResult<()> {
        let refs = summarize_display_list_resource_refs(commands);
        if refs.images.is_empty() {
            return Ok(());
        }
        self.ensure_image_dimensions_loaded_for_refs(&refs.images)?;
        Ok(())
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
    /// Sets the device pixels per CSS pixel frames are painted at. Every
    /// raster snap lands on that grid; pagination is identical at every
    /// ratio. Frames cached on the old grid are dropped — the same
    /// page numbers, repainted.
    pub fn set_render_ratio(&mut self, ratio: f64) -> EpubResult<()> {
        if !ratio.is_finite() || ratio <= 0.0 {
            return Err(EpubError::new(format!(
                "render ratio must be finite and positive, got {ratio}"
            )));
        }
        if self.render_ratio.get() == ratio {
            return Ok(());
        }
        self.render_ratio.set(ratio);
        let mut dropped = Vec::new();
        for revision in self
            .revisions
            .values_mut()
            .chain(self.chapter_local_revisions.values_mut())
        {
            dropped.extend(std::mem::take(&mut revision.frame_cache).into_values());
            revision.frame_cache_order.clear();
        }
        for frame in dropped {
            self.cleanup_queue.enqueue_cached_frame(frame);
        }
        self.service_cleanup_queue();
        Ok(())
    }

    /// The ratio document-level frames are currently painted at.
    pub fn render_ratio(&self) -> f64 {
        self.render_ratio.get()
    }

    /// An image's intrinsic size once its dimensions are loaded; the paint
    /// lowering sizes background images by it.
    pub(super) fn image_size(&self, href: &str) -> Option<ImageSize> {
        find_image_size(&self.document.images, href)
    }

    /// Loads the dimensions of every image a frame's display commands
    /// reference, so lowering the frame can size them.
    pub(super) fn ensure_frame_image_sizes(
        &mut self,
        commands: &[DisplayCommand],
    ) -> EpubResult<()> {
        self.document.ensure_frame_image_sizes(commands)
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

    /// The typed display commands a spread paints, for tests that assert
    /// on painted text and geometry; frames reach hosts only as the lowered
    /// primitive bytes.
    #[cfg(test)]
    pub(super) fn frame_commands_for_tests(
        &self,
        revision_id: &str,
        spread_index: usize,
    ) -> EpubResult<PageArtifactFrame> {
        let revision = self
            .any_revision(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        revision
            .chapter_engine_session()
            .frame(spread_index, self.render_ratio.get())?
            .ok_or_else(|| EpubError::new(format!("unknown spread index: {spread_index}")))
    }

    /// The page indexes a published spread shows, in reading order,
    /// without painting it.
    pub fn spread_page_indexes(
        &self,
        revision_id: &str,
        spread_index: usize,
    ) -> EpubResult<Vec<usize>> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        revision
            .chapter_engine_session()
            .spread_pages(spread_index)
            .ok_or_else(|| EpubError::new(format!("unknown spread index: {spread_index}")))
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
        let spread_count = revision.extent.spread_count;
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

    pub(super) fn get_chapter_local_frame_command_buffer_metadata_inner(
        &mut self,
        revision_id: &str,
        local_spread_index: usize,
    ) -> EpubResult<RuntimeFrameCommandBufferMetadata> {
        Ok(self
            .ensure_chapter_local_frame_cached(revision_id, local_spread_index)?
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
            .ensure_chapter_local_frame_cached(revision_id, local_spread_index)?
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
            .ensure_chapter_local_frame_cached(revision_id, local_spread_index)?
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
        let ratio = self.render_ratio.get();
        let document = &mut self.document;
        let result = self
            .revisions
            .get_mut(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))
            .and_then(|revision| {
                cache_runtime_frame(revision, revision_id, spread_index, ratio, document)
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
    ) -> EpubResult<&RuntimeCachedFrame> {
        let ratio = self.render_ratio.get();
        let document = &mut self.document;
        let result = self
            .chapter_local_revisions
            .get_mut(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown chapter-local revision: {revision_id}")))
            .and_then(|revision| {
                cache_runtime_frame(revision, revision_id, local_spread_index, ratio, document)
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
    ratio: f64,
    document: &mut LoadedEpubDocument,
) -> EpubResult<(Option<RuntimeCachedFrame>, Option<RuntimeCachedFrame>)> {
    if spread_index >= revision.extent.spread_count {
        return Err(EpubError::new(format!(
            "unknown spread index: {spread_index}"
        )));
    }
    if revision.frame_cache.contains_key(&spread_index) {
        touch_cached_frame(revision, spread_index);
        return Ok((None, None));
    }
    let frame_commands = revision
        .chapter_engine_session()
        .frame(spread_index, ratio)?
        .ok_or_else(|| EpubError::new(format!("unknown spread index: {spread_index}")))?;
    let cached_frame = runtime_cached_frame(
        revision_id,
        &revision.layout_config,
        frame_commands,
        ratio,
        document,
    )?;
    let replaced = revision.frame_cache.insert(spread_index, cached_frame);
    touch_cached_frame(revision, spread_index);
    let evicted = evict_oldest_frame(revision);
    Ok((replaced, evicted))
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
