use std::{
    collections::{BTreeMap, BTreeSet},
    num::NonZeroUsize,
};

use super::RuntimeCleanupQueue;
use crate::runtime::{
    frame::{RuntimeChapterTextIndexSource, RuntimeRevisionInteractions},
    RuntimeChapterTextIndex, RuntimeChapterTextSpan,
};

const WIDE_OWNER_COUNT: usize = 16_384;

#[test]
fn empty_interactions_vector_does_not_admit_a_job() {
    let mut queue = RuntimeCleanupQueue::default();

    queue.enqueue_revision_interactions(Vec::new());

    assert!(queue.is_empty());
    assert_eq!(queue.job_count(), 0);
}

#[test]
fn one_span_interactions_vector_has_seventeen_exact_queue_units() {
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_revision_interactions(vec![one_span_interactions()]);

    let owner = queue.advance(NonZeroUsize::new(16).expect("cleanup budget is non-zero"));

    assert_eq!(owner.consumed_units, 16);
    assert!(!owner.complete);
    assert_eq!(queue.job_count(), 1);

    let retirement = queue.advance(NonZeroUsize::MIN);
    assert_eq!(retirement.consumed_units, 1);
    assert!(retirement.complete);
}

#[test]
fn wide_interactions_vector_remains_one_resumable_job() {
    let mut queue = RuntimeCleanupQueue::default();
    let interactions = (0..WIDE_OWNER_COUNT)
        .map(|_| empty_materialized_interactions())
        .collect();
    queue.enqueue_revision_interactions(interactions);

    let first = queue.advance(NonZeroUsize::new(64).expect("cleanup budget is non-zero"));

    assert_eq!(first.consumed_units, 64);
    assert!(!first.complete);
    assert_eq!(queue.job_count(), 1);
    let remaining = queue.advance(NonZeroUsize::MAX);
    assert_eq!(remaining.consumed_units, 3 + WIDE_OWNER_COUNT * 7 - 64);
    assert!(remaining.complete);
}

fn empty_materialized_interactions() -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        footnotes: BTreeMap::new(),
        chapter_text_indices: RuntimeChapterTextIndexSource::Materialized(BTreeMap::new()),
        completed_chapter_idrefs: BTreeSet::new(),
    }
}

fn one_span_interactions() -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        footnotes: BTreeMap::new(),
        chapter_text_indices: RuntimeChapterTextIndexSource::Materialized(BTreeMap::from([(
            "chapter".to_owned(),
            RuntimeChapterTextIndex {
                href: "chapter.xhtml".to_owned(),
                normalized_text: "text".to_owned(),
                spans: vec![RuntimeChapterTextSpan {
                    node_path: vec![0],
                    source_start: 0,
                    source_end: 4,
                    normalized_start: 0,
                    normalized_end: 4,
                }],
            },
        )])),
        completed_chapter_idrefs: BTreeSet::new(),
    }
}
