use std::collections::BTreeSet;

use crate::{
    layout::{
        runtime_session::RuntimeChapterLayoutSession, LayoutConfig, LayoutRuntimePage, LineBreaking,
    },
    runtime::frame::RuntimeRevisionInteractions,
};

/// Experimental core-only continuation state.
///
/// Preparing one chapter at a time preserves same-chapter footnote filtering.
/// Cross-chapter noteref filtering still requires a publication-wide lightweight
/// target index (or relayout when a later chapter references an earlier one), so
/// this opt-in path is not yet a universal eager-equivalence claim.
#[derive(Debug)]
pub(in crate::runtime) struct RuntimeContinuationRecord {
    pub(in crate::runtime) revision_id: String,
    pub(super) revision_version: u32,
    pub(super) layout_key: String,
    pub(super) layout_config: LayoutConfig,
    pub(super) line_breaking: LineBreaking,
    pub(super) next_chapter_index: usize,
    pub(super) chapter_count: usize,
    pub(super) current: Option<RuntimeChapterContinuation>,
    pub(super) published_page_count: usize,
    pub(super) chapter_start_pages: BTreeSet<usize>,
}

impl RuntimeContinuationRecord {
    pub(super) fn new(
        revision_id: String,
        layout_key: String,
        layout_config: LayoutConfig,
        line_breaking: LineBreaking,
        chapter_count: usize,
    ) -> Self {
        Self {
            revision_id,
            revision_version: 0,
            layout_key,
            layout_config,
            line_breaking,
            next_chapter_index: 0,
            chapter_count,
            current: None,
            published_page_count: 0,
            chapter_start_pages: BTreeSet::new(),
        }
    }

    pub(super) fn is_complete(&self) -> bool {
        self.current.is_none() && self.next_chapter_index == self.chapter_count
    }
}

#[derive(Debug)]
pub(super) struct RuntimeChapterContinuation {
    pub(super) idref: String,
    pub(super) session: RuntimeChapterLayoutSession,
    pub(super) interactions: RuntimeRevisionInteractions,
    pub(super) unpublished_pages: Vec<LayoutRuntimePage>,
    pub(super) has_published_pages: bool,
}

#[derive(Default)]
pub(super) struct RuntimeContinuationWork {
    pub(super) batches: Vec<RuntimeChapterPageBatch>,
    pub(super) available_interactions: Vec<RuntimeRevisionInteractions>,
    pub(super) completed_chapter_idrefs: BTreeSet<String>,
    pub(super) processed_top_level_nodes: usize,
    pub(super) complete: bool,
}

pub(super) struct RuntimeChapterPageBatch {
    pub(super) idref: String,
    pub(super) block_count: usize,
    pub(super) pages: Vec<LayoutRuntimePage>,
}
