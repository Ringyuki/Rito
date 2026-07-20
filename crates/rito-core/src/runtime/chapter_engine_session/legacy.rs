use std::{collections::BTreeMap, ops::Range};

mod interaction;

use crate::layout::{
    build_display_list_frame_commands, build_spread_slots, collect_anchor_pages,
    collect_source_run_starts, DisplayListFrameCommands, LayoutRuntimePage, LayoutSourceRunStart,
    PaginationFlowChapterRange,
};

use super::super::{
    page_artifact::{
        PageArtifact, PageArtifactChapterRange, PageArtifactFrame, PageArtifactRevisionMetadata,
        PageArtifactSourceRunStart, PageArtifactSpread,
    },
    RuntimeRevision,
};

pub(super) struct LegacyChapterEngineSession<'a> {
    revision: &'a RuntimeRevision,
}

impl<'a> LegacyChapterEngineSession<'a> {
    pub(super) fn new(revision: &'a RuntimeRevision) -> Self {
        Self { revision }
    }

    pub(super) fn metadata(&self) -> PageArtifactRevisionMetadata {
        PageArtifactRevisionMetadata {
            page_count: self.revision.known_extent.page_count,
            spread_count: self.revision.known_extent.spread_count,
        }
    }

    pub(super) fn page(&self, page_index: usize) -> Option<&'a dyn PageArtifact> {
        self.revision
            .layout
            .pages
            .get(page_index)
            .map(|page| page as &dyn PageArtifact)
    }

    pub(super) fn frame(&self, spread_index: usize) -> Option<PageArtifactFrame> {
        build_display_list_frame_commands(
            &self.revision.layout.pages,
            &self.revision.layout.chapter_start_pages,
            &self.revision.layout_config,
            spread_index,
        )
        .map(frame_artifact)
    }

    pub(super) fn spreads(&self) -> Vec<PageArtifactSpread> {
        build_spread_slots(
            self.revision.known_extent.page_count,
            &self.revision.layout.chapter_start_pages,
            &self.revision.layout_config,
        )
        .into_iter()
        .take(self.revision.known_extent.spread_count)
        .map(|spread| PageArtifactSpread {
            spread_index: spread.index,
            left_page_index: spread.left_page_index,
            right_page_index: spread.right_page_index,
        })
        .collect()
    }

    pub(super) fn known_chapters(&self) -> BTreeMap<String, PageArtifactChapterRange> {
        self.revision
            .layout
            .summary
            .pagination_flow
            .chapter_map
            .iter()
            .filter_map(|(idref, range)| {
                known_chapter_range(range, self.revision.known_extent.page_count)
                    .map(|range| (idref.clone(), range))
            })
            .collect()
    }

    pub(super) fn known_chapter(&self, idref: &str) -> Option<PageArtifactChapterRange> {
        let range = self
            .revision
            .layout
            .summary
            .pagination_flow
            .chapter_map
            .get(idref)?;
        known_chapter_range(range, self.revision.known_extent.page_count)
    }

    pub(super) fn anchor_pages(&self, range: Range<usize>) -> Option<BTreeMap<String, usize>> {
        let pages = self.known_pages(range)?;
        Some(collect_anchor_pages(pages))
    }

    pub(super) fn source_run_starts(
        &self,
        range: Range<usize>,
    ) -> Option<Vec<PageArtifactSourceRunStart>> {
        let pages = self.known_pages(range)?;
        Some(
            collect_source_run_starts(pages)
                .into_iter()
                .map(source_run_start)
                .collect(),
        )
    }

    fn known_pages(&self, range: Range<usize>) -> Option<&'a [LayoutRuntimePage]> {
        if range.start > range.end || range.end > self.revision.known_extent.page_count {
            return None;
        }
        self.revision.layout.pages.get(range)
    }
}

fn known_chapter_range(
    range: &PaginationFlowChapterRange,
    known_page_count: usize,
) -> Option<PageArtifactChapterRange> {
    if range.start_page >= known_page_count {
        return None;
    }
    let end_page = range.end_page.min(known_page_count - 1);
    Some(PageArtifactChapterRange {
        start_page: range.start_page,
        end_page,
        page_count: end_page - range.start_page + 1,
        block_count: range.block_count,
    })
}

fn source_run_start(start: LayoutSourceRunStart) -> PageArtifactSourceRunStart {
    PageArtifactSourceRunStart {
        page_index: start.page_index,
        node_path: start.node_path,
        text_offset: start.text_offset,
        text_length: start.text_length,
    }
}

fn frame_artifact(frame: DisplayListFrameCommands) -> PageArtifactFrame {
    PageArtifactFrame {
        spread_index: frame.spread_index,
        page_indexes: frame.page_indexes,
        commands: frame.commands,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_frame_does_not_leak_its_layout_container() {
        let frame = frame_artifact(DisplayListFrameCommands {
            spread_index: 3,
            page_indexes: vec![5, 6],
            commands: Vec::new(),
        });

        assert_eq!(frame.spread_index, 3);
        assert_eq!(frame.page_indexes, vec![5, 6]);
        assert!(frame.commands.is_empty());
    }
}
