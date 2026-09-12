use std::collections::BTreeMap;

use crate::{
    layout::{LayoutConfig, LineBreaking},
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
    pub(in crate::runtime) fn is_empty(&self) -> bool {
        self.by_cursor.is_empty()
    }
    pub(in crate::runtime) fn cursor_for_revision(&self, revision_id: &str) -> Option<&str> {
        self.active_cursor_by_revision
            .get(revision_id)
            .map(String::as_str)
    }
}

/// The cursor state of a chapter-local revision window: which chapter it
/// paginates, how many pages it has published against its cap, and the
/// exact target it was opened toward.
#[derive(Debug)]
pub(in crate::runtime) struct RuntimeContinuationRecord {
    pub(in crate::runtime) revision_id: String,
    pub(super) revision_version: u32,
    pub(super) layout_key: String,
    pub(super) layout_config: LayoutConfig,
    pub(super) line_breaking: LineBreaking,
    pub(super) next_chapter_index: usize,
    pub(super) chapter_count: usize,
    pub(super) published_page_count: usize,
    pub(super) local_page_cap: Option<usize>,
    pub(super) chapter_local_target: Option<RuntimeSourceLocator>,
}

impl RuntimeContinuationRecord {
    #[cfg(test)]
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
            published_page_count: 0,
            local_page_cap: None,
            chapter_local_target: None,
        }
    }

    pub(super) fn reached_local_page_cap(&self) -> bool {
        self.local_page_cap
            .is_some_and(|cap| self.published_page_count >= cap)
    }

    pub(super) fn rollover_chapter_local_window(&mut self, revision_id: String) {
        debug_assert!(self.local_page_cap.is_some());
        debug_assert!(self.reached_local_page_cap());
        self.revision_id = revision_id;
        self.revision_version = 0;
        self.published_page_count = 0;
    }
}
