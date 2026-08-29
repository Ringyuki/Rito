use std::collections::{BTreeMap, BTreeSet};

use crate::{
    layout::{
        runtime_session::RuntimeChapterLayoutSession, LayoutConfig, LayoutRuntimePage, LineBreaking,
    },
    runtime::frame::RuntimeRevisionInteractions,
    runtime::RuntimeSourceLocator,
};

#[derive(Debug, Default)]
pub(in crate::runtime) struct RuntimeContinuationStore {
    by_cursor: BTreeMap<String, RuntimeContinuationRecord>,
    active_cursor_by_revision: BTreeMap<String, String>,
}

impl RuntimeContinuationStore {
    pub(in crate::runtime) fn get(&self, cursor: &str) -> Option<&RuntimeContinuationRecord> {
        self.by_cursor.get(cursor)
    }

    pub(in crate::runtime) fn insert_new(
        &mut self,
        cursor: String,
        continuation: RuntimeContinuationRecord,
    ) {
        let revision_id = continuation.revision_id.clone();
        self.assert_matching_lengths();
        assert!(
            !self.by_cursor.contains_key(&cursor),
            "continuation cursor must be unique"
        );
        assert!(
            !self.active_cursor_by_revision.contains_key(&revision_id),
            "revision must not already own an active continuation cursor"
        );
        assert!(self
            .by_cursor
            .insert(cursor.clone(), continuation)
            .is_none());
        assert!(self
            .active_cursor_by_revision
            .insert(revision_id, cursor)
            .is_none());
        self.assert_matching_lengths();
    }

    pub(in crate::runtime) fn take_exact(
        &mut self,
        revision_id: &str,
        cursor: &str,
    ) -> RuntimeContinuationRecord {
        self.assert_matching_lengths();
        let continuation = self
            .by_cursor
            .get(cursor)
            .expect("validated continuation cursor exists");
        assert_eq!(continuation.revision_id, revision_id);
        assert_eq!(
            self.active_cursor_by_revision
                .get(revision_id)
                .map(String::as_str),
            Some(cursor),
            "validated continuation cursor must match its reverse index"
        );
        let continuation = self
            .by_cursor
            .remove(cursor)
            .expect("validated continuation cursor exists");
        let indexed_cursor = self
            .active_cursor_by_revision
            .remove(revision_id)
            .expect("validated continuation owner exists");
        assert_eq!(indexed_cursor, cursor);
        self.assert_matching_lengths();
        continuation
    }

    pub(in crate::runtime) fn remove_revision(
        &mut self,
        revision_id: &str,
    ) -> Option<RuntimeContinuationRecord> {
        self.assert_matching_lengths();
        let cursor = self.active_cursor_by_revision.remove(revision_id)?;
        let continuation = self
            .by_cursor
            .remove(&cursor)
            .expect("indexed continuation cursor exists");
        assert_eq!(continuation.revision_id, revision_id);
        self.assert_matching_lengths();
        Some(continuation)
    }

    pub(in crate::runtime) fn pop_first(&mut self) -> Option<RuntimeContinuationRecord> {
        self.assert_matching_lengths();
        let (cursor, continuation) = self.by_cursor.pop_first()?;
        let indexed_cursor = self
            .active_cursor_by_revision
            .remove(&continuation.revision_id)
            .expect("continuation reverse index exists");
        assert_eq!(indexed_cursor, cursor);
        self.assert_matching_lengths();
        Some(continuation)
    }

    fn assert_matching_lengths(&self) {
        assert_eq!(
            self.by_cursor.len(),
            self.active_cursor_by_revision.len(),
            "continuation forward and reverse indexes must have equal lengths"
        );
    }

    #[cfg(test)]
    pub(in crate::runtime) fn assert_consistent(&self) {
        self.assert_matching_lengths();
        for (cursor, continuation) in &self.by_cursor {
            assert_eq!(
                self.active_cursor_by_revision
                    .get(&continuation.revision_id),
                Some(cursor)
            );
        }
    }

    #[cfg(test)]
    pub(in crate::runtime) fn len(&self) -> usize {
        self.by_cursor.len()
    }

    #[cfg(test)]
    pub(in crate::runtime) fn is_empty(&self) -> bool {
        self.by_cursor.is_empty()
    }

    #[cfg(test)]
    pub(in crate::runtime) fn contains_cursor(&self, cursor: &str) -> bool {
        self.by_cursor.contains_key(cursor)
    }

    pub(in crate::runtime) fn cursor_for_revision(&self, revision_id: &str) -> Option<&str> {
        self.active_cursor_by_revision
            .get(revision_id)
            .map(String::as_str)
    }
}

/// Experimental core-only continuation state. Each chapter is prepared against
/// the immutable publication footnote target index before any page is sealed.
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
    pub(super) local_page_cap: Option<usize>,
    pub(super) chapter_local_target: Option<RuntimeSourceLocator>,
}

impl RuntimeContinuationRecord {
    pub(in crate::runtime) fn new(
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
            local_page_cap: None,
            chapter_local_target: None,
        }
    }

    pub(super) fn is_complete(&self) -> bool {
        self.current.is_none() && self.next_chapter_index == self.chapter_count
    }

    pub(super) fn reached_local_page_cap(&self) -> bool {
        self.local_page_cap
            .is_some_and(|cap| self.published_page_count >= cap)
    }

    pub(super) fn remaining_page_capacity(&self) -> usize {
        self.local_page_cap.map_or(usize::MAX, |cap| {
            cap.saturating_sub(self.published_page_count)
        })
    }

    pub(super) fn rollover_chapter_local_window(&mut self, revision_id: String) {
        debug_assert!(self.local_page_cap.is_some());
        debug_assert!(self.reached_local_page_cap());
        self.revision_id = revision_id;
        self.revision_version = 0;
        self.published_page_count = 0;
    }
}

#[derive(Debug)]
pub(in crate::runtime) struct RuntimeChapterContinuation {
    pub(super) idref: String,
    pub(super) session: RuntimeChapterLayoutSession,
    pub(super) completed_chapter_idrefs: BTreeSet<String>,
    pub(super) unpublished_pages: Vec<LayoutRuntimePage>,
    pub(super) has_published_pages: bool,
    pub(super) chapter_complete: bool,
    pub(super) total_block_count: usize,
    /// This chapter's typed style tables, held until the chapter first
    /// contributes to published work, then moved into the revision.
    pub(super) pending_style_table: Option<crate::runtime::frame::RuntimeChapterStyleTables>,
}

impl RuntimeChapterContinuation {
    pub(in crate::runtime) fn new(
        idref: String,
        session: RuntimeChapterLayoutSession,
        completed_chapter_idrefs: BTreeSet<String>,
        unpublished_pages: Vec<LayoutRuntimePage>,
        has_published_pages: bool,
        pending_style_table: Option<crate::runtime::frame::RuntimeChapterStyleTables>,
    ) -> Self {
        Self {
            idref,
            session,
            completed_chapter_idrefs,
            unpublished_pages,
            has_published_pages,
            chapter_complete: false,
            total_block_count: 0,
            pending_style_table,
        }
    }
}

#[derive(Debug, Default)]
pub(in crate::runtime) struct RuntimeContinuationWork {
    pub(super) batches: Vec<RuntimeChapterPageBatch>,
    /// Typed style tables for chapters whose work is published by this
    /// advance, keyed by idref. Applied to the revision atomically with
    /// the page batches; retired work drops them with the batches.
    pub(super) chapter_style_tables:
        Vec<(String, crate::runtime::frame::RuntimeChapterStyleTables)>,
    pub(super) available_interactions: Vec<RuntimeRevisionInteractions>,
    pub(super) completed_chapter_idrefs: BTreeSet<String>,
    pub(super) processed_top_level_nodes: usize,
    pub(super) complete: bool,
}

#[derive(Debug)]
pub(super) struct RuntimeChapterPageBatch {
    pub(super) idref: String,
    pub(super) block_count: usize,
    pub(super) pages: Vec<LayoutRuntimePage>,
}

impl RuntimeContinuationWork {
    pub(in crate::runtime) fn has_cleanup_owners(&self) -> bool {
        !self.batches.is_empty()
            || !self.available_interactions.is_empty()
            || !self.completed_chapter_idrefs.is_empty()
    }
}
