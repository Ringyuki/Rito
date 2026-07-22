//! Fragment-backend adapter: serves session queries from the revision's
//! `FragmentBuiltLayout`.
//!
//! Structure queries (pages, frames, spreads, chapter ranges, anchors) are
//! fully served here. Source-locator and text-interaction queries resolve
//! `Unavailable` for now: the interaction resolvers still consume the
//! retained page representation, and generalizing them over page
//! artifacts is its own cutover step.

use std::{collections::BTreeMap, ops::Range};

use crate::interaction::TextInteractionUnavailableReason;
use crate::layout::{build_spread_slots, SpreadMode};
use crate::render::DisplayCommand;

use super::super::{
    fragment_backend::FragmentBuiltLayout,
    fragment_frame::{number_value, paint_rect_command, rect_value},
    page_artifact::{
        PageArtifact, PageArtifactChapterRange, PageArtifactExactSourceRangeQuery,
        PageArtifactExactTextRangeResolution, PageArtifactFrame, PageArtifactRevisionMetadata,
        PageArtifactSourceRunStart, PageArtifactSpread, PageArtifactTextCaretQuery,
        PageArtifactTextCaretResolution, PageArtifactTextRangeFromPointsQuery,
        PageArtifactTextRangeFromPointsResolution, PageArtifactTextRangeQuery,
        PageArtifactTextRangeToPointQuery, PageArtifactTextSelectionMovementQuery,
        PageArtifactTextSelectionMovementResolution,
    },
    RuntimeRevision,
};

pub(super) struct FragmentChapterEngineSession<'a> {
    revision: &'a RuntimeRevision,
    layout: &'a FragmentBuiltLayout,
}

impl<'a> FragmentChapterEngineSession<'a> {
    pub(super) fn new(revision: &'a RuntimeRevision, layout: &'a FragmentBuiltLayout) -> Self {
        Self { revision, layout }
    }

    pub(super) fn metadata(&self) -> PageArtifactRevisionMetadata {
        PageArtifactRevisionMetadata {
            page_count: self.layout.page_count(),
            spread_count: self.spread_slot_count(),
        }
    }

    pub(super) fn page(&self, page_index: usize) -> Option<&'a dyn PageArtifact> {
        self.layout
            .page(page_index)
            .map(|page| &page.artifact as &dyn PageArtifact)
    }

    pub(super) fn frame(&self, spread_index: usize) -> Option<PageArtifactFrame> {
        let config = &self.revision.layout_config;
        let spreads = build_spread_slots(
            self.layout.page_count(),
            self.layout.chapter_start_pages(),
            config,
        );
        let spread = spreads.get(spread_index)?;
        let mut page_indexes = vec![spread.left_page_index];
        if config.spread_mode == SpreadMode::Double {
            if let Some(right) = spread.right_page_index {
                page_indexes.push(right);
            }
        }
        // Same frame skeleton as the retained producer: a viewport wash,
        // then each page translated into place, washed, and clipped
        // around its content commands. The page wash is the chapter
        // body's background when it declares one; block-level paint
        // beyond that is excluded by the representability gate.
        let mut commands = Vec::new();
        commands.push(paint_rect_command(
            0.0,
            0.0,
            config.viewport_width,
            config.viewport_height,
            "#ffffff",
        ));
        for (slot, page_index) in page_indexes.iter().enumerate() {
            let (page, chapter) = self.layout.page_with_chapter(*page_index)?;
            let metadata = page.artifact.metadata();
            let offset_x = slot as f64 * (config.page_width + config.spread_gap);
            commands.push(DisplayCommand::push_state());
            commands.push(DisplayCommand::translate(
                number_value(offset_x),
                number_value(0.0),
            ));
            commands.push(paint_rect_command(
                0.0,
                0.0,
                metadata.width,
                metadata.height,
                chapter.page_background.as_deref().unwrap_or("#ffffff"),
            ));
            commands.push(DisplayCommand::push_state());
            commands.push(DisplayCommand::clip_rect(
                rect_value(0.0, 0.0, metadata.width, metadata.height),
                None,
            ));
            commands.extend(page.commands.iter().cloned());
            commands.push(DisplayCommand::pop_state());
            commands.push(DisplayCommand::pop_state());
        }
        Some(PageArtifactFrame {
            spread_index: spread.index,
            page_indexes,
            commands,
        })
    }

    pub(super) fn spreads(&self) -> Vec<PageArtifactSpread> {
        build_spread_slots(
            self.layout.page_count(),
            self.layout.chapter_start_pages(),
            &self.revision.layout_config,
        )
        .into_iter()
        .map(|spread| PageArtifactSpread {
            spread_index: spread.index,
            left_page_index: spread.left_page_index,
            right_page_index: spread.right_page_index,
        })
        .collect()
    }

    pub(super) fn known_chapters(&self) -> BTreeMap<String, PageArtifactChapterRange> {
        self.layout
            .chapters()
            .filter_map(|(chapter, start_page)| {
                chapter_range(chapter.pages.len(), start_page, chapter.block_count)
                    .map(|range| (chapter.idref.clone(), range))
            })
            .collect()
    }

    pub(super) fn known_chapter(&self, idref: &str) -> Option<PageArtifactChapterRange> {
        let (chapter, start_page) = self.layout.chapter(idref)?;
        chapter_range(chapter.pages.len(), start_page, chapter.block_count)
    }

    pub(super) fn anchor_pages(&self, range: Range<usize>) -> Option<BTreeMap<String, usize>> {
        if range.start > range.end || range.end > self.layout.page_count() {
            return None;
        }
        Some(
            self.layout
                .anchors
                .iter()
                .filter(|(_, page)| range.contains(page))
                .map(|(anchor, page)| (anchor.clone(), *page))
                .collect(),
        )
    }

    pub(super) fn source_run_starts(
        &self,
        _range: Range<usize>,
    ) -> Option<Vec<PageArtifactSourceRunStart>> {
        None
    }

    pub(super) fn resolve_exact_source_range(
        &self,
        _query: PageArtifactExactSourceRangeQuery,
    ) -> PageArtifactExactTextRangeResolution {
        PageArtifactExactTextRangeResolution::Unavailable(
            TextInteractionUnavailableReason::SourceUnavailable,
        )
    }

    pub(super) fn resolve_text_caret(
        &self,
        _query: PageArtifactTextCaretQuery,
    ) -> Option<PageArtifactTextCaretResolution> {
        Some(PageArtifactTextCaretResolution::Unavailable(
            TextInteractionUnavailableReason::SourceUnavailable,
        ))
    }

    pub(super) fn resolve_text_range(
        &self,
        _query: PageArtifactTextRangeQuery,
    ) -> PageArtifactExactTextRangeResolution {
        PageArtifactExactTextRangeResolution::Unavailable(
            TextInteractionUnavailableReason::SourceUnavailable,
        )
    }

    pub(super) fn resolve_text_range_to_point(
        &self,
        _query: PageArtifactTextRangeToPointQuery,
    ) -> PageArtifactTextRangeFromPointsResolution {
        PageArtifactTextRangeFromPointsResolution::Unavailable(
            TextInteractionUnavailableReason::SourceUnavailable,
        )
    }

    pub(super) fn resolve_text_range_from_points(
        &self,
        _query: PageArtifactTextRangeFromPointsQuery<'_>,
    ) -> PageArtifactTextRangeFromPointsResolution {
        PageArtifactTextRangeFromPointsResolution::Unavailable(
            TextInteractionUnavailableReason::SourceUnavailable,
        )
    }

    pub(super) fn resolve_text_selection_movement(
        &self,
        _query: PageArtifactTextSelectionMovementQuery<'_>,
    ) -> PageArtifactTextSelectionMovementResolution {
        PageArtifactTextSelectionMovementResolution::Unavailable(
            TextInteractionUnavailableReason::SourceUnavailable,
        )
    }

    fn spread_slot_count(&self) -> usize {
        build_spread_slots(
            self.layout.page_count(),
            self.layout.chapter_start_pages(),
            &self.revision.layout_config,
        )
        .len()
    }
}

fn chapter_range(
    page_count: usize,
    start_page: usize,
    block_count: usize,
) -> Option<PageArtifactChapterRange> {
    if page_count == 0 {
        return None;
    }
    Some(PageArtifactChapterRange {
        start_page,
        end_page: start_page + page_count - 1,
        page_count,
        block_count,
    })
}
