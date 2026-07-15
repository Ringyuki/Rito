use std::{collections::btree_map, vec};

use crate::runtime::{
    frame::RuntimeChapterTextIndexSource, RuntimeChapterTextIndex, RuntimeChapterTextSpan,
};

type ChapterTextIndexSource = btree_map::IntoIter<String, RuntimeChapterTextIndex>;
type ChapterTextSpanSource = vec::IntoIter<RuntimeChapterTextSpan>;

/// Releases a full-document marker or materialized chapter indices.
///
/// `FullDocument` costs one unit. A materialized source costs exactly
/// `2 + sum(S_i + 6)` units for indices containing `S_i` spans.
#[derive(Debug)]
pub(super) struct PendingRuntimeChapterTextIndexSourceCleanup {
    owner: Option<RuntimeChapterTextIndexSource>,
    entries: Option<ChapterTextIndexSource>,
    active: Option<PendingRuntimeChapterTextIndexCleanup>,
    stage: ChapterTextIndexSourceCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChapterTextIndexSourceCleanupStage {
    Source,
    Entries,
    Complete,
}

impl PendingRuntimeChapterTextIndexSourceCleanup {
    pub(super) fn new(owner: RuntimeChapterTextIndexSource) -> Self {
        Self {
            owner: Some(owner),
            entries: None,
            active: None,
            stage: ChapterTextIndexSourceCleanupStage::Source,
        }
    }

    pub(super) fn is_complete(&self) -> bool {
        self.stage == ChapterTextIndexSourceCleanupStage::Complete
    }

    pub(super) fn advance_one(&mut self) -> bool {
        match self.stage {
            ChapterTextIndexSourceCleanupStage::Source => self.start_source(),
            ChapterTextIndexSourceCleanupStage::Entries => self.advance_entries(),
            ChapterTextIndexSourceCleanupStage::Complete => false,
        }
    }

    fn start_source(&mut self) -> bool {
        let owner = self.owner.take().expect("cleanup owns its chapter source");
        match owner {
            RuntimeChapterTextIndexSource::FullDocument => {
                self.stage = ChapterTextIndexSourceCleanupStage::Complete;
            }
            RuntimeChapterTextIndexSource::Materialized(entries) => {
                self.entries = Some(entries.into_iter());
                self.stage = ChapterTextIndexSourceCleanupStage::Entries;
            }
        }
        true
    }

    fn advance_entries(&mut self) -> bool {
        if let Some(active) = self.active.as_mut() {
            if active.is_complete() {
                self.active = None;
                return true;
            }
            let advanced = active.advance_one();
            debug_assert!(advanced, "incomplete chapter-index cleanup has work");
            return true;
        }

        let entries = self.entries.as_mut().expect("chapter-index source exists");
        if let Some((idref, index)) = entries.next() {
            drop(idref);
            self.active = Some(PendingRuntimeChapterTextIndexCleanup::new(index));
            return true;
        }
        self.entries = None;
        self.stage = ChapterTextIndexSourceCleanupStage::Complete;
        true
    }

    fn drain(&mut self) {
        while self.advance_one() {}
    }
}

impl Drop for PendingRuntimeChapterTextIndexSourceCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}

/// Releases one chapter index in exactly `S + 4` units for `S` spans.
#[derive(Debug)]
struct PendingRuntimeChapterTextIndexCleanup {
    owner: Option<RuntimeChapterTextIndex>,
    spans: Option<ChapterTextSpanSource>,
    normalized_text: Option<String>,
    href: Option<String>,
    stage: ChapterTextIndexCleanupStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChapterTextIndexCleanupStage {
    Source,
    Spans,
    NormalizedText,
    Href,
    Complete,
}

impl PendingRuntimeChapterTextIndexCleanup {
    fn new(owner: RuntimeChapterTextIndex) -> Self {
        Self {
            owner: Some(owner),
            spans: None,
            normalized_text: None,
            href: None,
            stage: ChapterTextIndexCleanupStage::Source,
        }
    }

    fn is_complete(&self) -> bool {
        self.stage == ChapterTextIndexCleanupStage::Complete
    }

    fn advance_one(&mut self) -> bool {
        match self.stage {
            ChapterTextIndexCleanupStage::Source => self.start_source(),
            ChapterTextIndexCleanupStage::Spans => self.release_next_span(),
            ChapterTextIndexCleanupStage::NormalizedText => self.release_normalized_text(),
            ChapterTextIndexCleanupStage::Href => self.release_href(),
            ChapterTextIndexCleanupStage::Complete => false,
        }
    }

    fn start_source(&mut self) -> bool {
        let owner = self.owner.take().expect("cleanup owns its chapter index");
        let RuntimeChapterTextIndex {
            href,
            normalized_text,
            spans,
        } = owner;
        self.spans = Some(spans.into_iter());
        self.normalized_text = Some(normalized_text);
        self.href = Some(href);
        self.stage = ChapterTextIndexCleanupStage::Spans;
        true
    }

    fn release_next_span(&mut self) -> bool {
        let spans = self.spans.as_mut().expect("chapter span source exists");
        if let Some(span) = spans.next() {
            drop(span);
            return true;
        }
        self.spans = None;
        self.stage = ChapterTextIndexCleanupStage::NormalizedText;
        true
    }

    fn release_normalized_text(&mut self) -> bool {
        drop(
            self.normalized_text
                .take()
                .expect("normalized chapter text exists"),
        );
        self.stage = ChapterTextIndexCleanupStage::Href;
        true
    }

    fn release_href(&mut self) -> bool {
        drop(self.href.take().expect("chapter href exists"));
        self.stage = ChapterTextIndexCleanupStage::Complete;
        true
    }

    fn drain(&mut self) {
        while self.advance_one() {}
    }
}

impl Drop for PendingRuntimeChapterTextIndexCleanup {
    fn drop(&mut self) {
        self.drain();
    }
}
