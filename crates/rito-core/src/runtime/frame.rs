use std::{
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
    sync::Arc,
};

use rito_style_contract::{InlineStyleTable, LayoutStyleTable};

use crate::{
    epub::{EpubError, EpubResult, LoadedEpubDocument},
    interaction::{FootnoteEntry, FootnoteTargetSet},
    layout::LayoutConfig,
    render::{summarize_display_list_resource_refs, DisplayCommand, ImageSize},
};

use super::{
    fragment_backend::FragmentBuiltLayout, resource::find_image_size, spread::build_spread_slots,
    RuntimeDocument, RuntimeRevisionExtent, RuntimeRevisionSummary,
};

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
/// interaction state it was built from.
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

    /// The typed display commands a spread paints, for tests that assert
    /// on painted text and geometry; frames reach hosts only as the lowered
    /// primitive bytes.
    #[cfg(test)]
    pub(super) fn frame_commands_for_tests(
        &self,
        revision_id: &str,
        spread_index: usize,
    ) -> EpubResult<super::page_artifact::PageArtifactFrame> {
        let revision = self
            .any_revision(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        revision
            .chapter_engine_session()
            .frame(spread_index, 1.0)?
            .ok_or_else(|| EpubError::new(format!("unknown spread index: {spread_index}")))
    }

    /// The image hrefs a spread's display commands name, as the chapter
    /// source wrote them: what a host is told to read for the spread.
    #[cfg(test)]
    pub(crate) fn frame_image_hrefs_for_tests(
        &self,
        revision_id: &str,
        spread_index: usize,
    ) -> EpubResult<Vec<String>> {
        let frame = self.frame_commands_for_tests(revision_id, spread_index)?;
        Ok(summarize_display_list_resource_refs(&frame.commands).images)
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
}
