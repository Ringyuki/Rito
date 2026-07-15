use std::{
    collections::{BTreeMap, BTreeSet},
    num::NonZeroUsize,
    panic::{catch_unwind, AssertUnwindSafe},
};

use serde_json::json;

use super::{
    ChapterPageBatchCleanupStage, ContinuationWorkCleanupStage,
    PendingRuntimeContinuationWorkCleanup,
};
use crate::{
    layout::{LayoutRuntimePage, LineBox, RuntimeBlock, RuntimeChild},
    runtime::{
        cleanup::RuntimeCleanupQueue,
        continuation::{state::RuntimeChapterPageBatch, RuntimeContinuationWork},
        frame::{RuntimeChapterTextIndexSource, RuntimeRevisionInteractions},
        RuntimeChapterTextIndex, RuntimeChapterTextSpan,
    },
};

const DEEP_OWNER_COUNT: usize = 16_384;

#[test]
fn empty_cursor_has_four_exact_units_and_repeated_completion_is_free() {
    let mut cleanup =
        PendingRuntimeContinuationWorkCleanup::new(RuntimeContinuationWork::default());

    assert_eq!(drive_q1(&mut cleanup, 4), 4);
    assert!(!cleanup.advance_one());
}

#[test]
fn empty_page_batch_accounts_for_every_nested_and_owner_boundary() {
    let mut cleanup = PendingRuntimeContinuationWorkCleanup::new(work(
        vec![batch(Vec::new())],
        Vec::new(),
        BTreeSet::new(),
    ));

    assert_one(&mut cleanup);
    assert_eq!(cleanup.stage, ContinuationWorkCleanupStage::Batches);
    assert_eq!(cleanup.batch_stage, ChapterPageBatchCleanupStage::Source);

    assert_one(&mut cleanup);
    assert_eq!(cleanup.batch_stage, ChapterPageBatchCleanupStage::Pages);
    assert!(cleanup
        .active_pages
        .as_ref()
        .is_some_and(|pages| !pages.is_complete()));
    assert!(cleanup.batch_idref.is_some());
    assert!(cleanup.batch_shell.is_some());

    assert_one(&mut cleanup);
    assert!(cleanup
        .active_pages
        .as_ref()
        .is_some_and(|pages| pages.is_complete()));

    assert_one(&mut cleanup);
    assert!(cleanup.active_pages.is_none());
    assert_eq!(cleanup.batch_stage, ChapterPageBatchCleanupStage::Idref);

    assert_one(&mut cleanup);
    assert!(cleanup.batch_idref.is_none());
    assert_eq!(cleanup.batch_stage, ChapterPageBatchCleanupStage::Owner);

    assert_one(&mut cleanup);
    assert!(cleanup.batch_shell.is_none());
    assert_eq!(cleanup.batch_stage, ChapterPageBatchCleanupStage::Source);

    assert_one(&mut cleanup);
    assert_eq!(
        cleanup.stage,
        ContinuationWorkCleanupStage::CompletedChapterIdrefs
    );
    assert_one(&mut cleanup);
    assert_eq!(cleanup.stage, ContinuationWorkCleanupStage::Owner);
    assert_one(&mut cleanup);
    assert!(cleanup.is_complete());
}

#[test]
fn empty_and_non_empty_interactions_have_the_composed_exact_costs() {
    let mut empty = PendingRuntimeContinuationWorkCleanup::new(RuntimeContinuationWork::default());
    assert_eq!(drive_q1(&mut empty, 4), 4);

    let mut non_empty = PendingRuntimeContinuationWorkCleanup::new(work(
        Vec::new(),
        vec![empty_materialized_interactions()],
        BTreeSet::new(),
    ));
    assert_eq!(drive_q1(&mut non_empty, 14), 14);
}

#[test]
fn production_shaped_work_matches_the_full_composed_formula() {
    let mut cleanup = PendingRuntimeContinuationWorkCleanup::new(work(
        vec![batch(Vec::new())],
        vec![materialized_interactions(0)],
        BTreeSet::from(["chapter".to_owned()]),
    ));

    assert_eq!(drive_q1(&mut cleanup, 26), 26);
}

#[test]
fn partial_drop_and_unwind_drain_deep_pages_and_unread_spans() {
    let mut cleanup = PendingRuntimeContinuationWorkCleanup::new(deep_work());
    for _ in 0..128 {
        assert_one(&mut cleanup);
    }
    drop(cleanup);

    let result = catch_unwind(AssertUnwindSafe(|| {
        let mut cleanup = PendingRuntimeContinuationWorkCleanup::new(deep_work());
        for _ in 0..128 {
            assert_one(&mut cleanup);
        }
        panic!("force continuation-work cleanup during unwind");
    }));

    assert!(result.is_err());
}

#[test]
fn empty_work_does_not_admit_a_queue_job() {
    let mut queue = RuntimeCleanupQueue::default();

    queue.enqueue_continuation_work(RuntimeContinuationWork::default());

    assert!(queue.is_empty());
    assert_eq!(queue.job_count(), 0);
}

#[test]
fn wide_work_remains_one_resumable_regular_job() {
    let mut queue = RuntimeCleanupQueue::default();
    let interactions = (0..DEEP_OWNER_COUNT)
        .map(|_| empty_materialized_interactions())
        .collect();
    queue.enqueue_continuation_work(work(Vec::new(), interactions, BTreeSet::new()));

    let first = queue.advance(NonZeroUsize::new(64).expect("cleanup budget is non-zero"));

    assert_eq!(first.consumed_units, 64);
    assert!(!first.complete);
    assert_eq!(queue.job_count(), 1);
    assert_eq!(queue.pending_frame_owner_count(), 0);

    let remaining = queue.advance(NonZeroUsize::MAX);
    assert_eq!(remaining.consumed_units, 8 + DEEP_OWNER_COUNT * 7 - 64);
    assert!(remaining.complete);
}

#[test]
fn work_cursor_completion_and_queue_job_retirement_are_separate_units() {
    let mut queue = RuntimeCleanupQueue::default();
    queue.enqueue_continuation_work(work(
        Vec::new(),
        Vec::new(),
        BTreeSet::from(["chapter".to_owned()]),
    ));

    let owner = queue.advance(NonZeroUsize::new(5).expect("cleanup budget is non-zero"));
    assert_eq!(owner.consumed_units, 5);
    assert!(!owner.complete);
    assert_eq!(queue.job_count(), 1);
    assert_eq!(queue.pending_frame_owner_count(), 0);

    let retirement = queue.advance(NonZeroUsize::MIN);
    assert_eq!(retirement.consumed_units, 1);
    assert!(retirement.complete);
}

fn drive_q1(cleanup: &mut PendingRuntimeContinuationWorkCleanup, expected: usize) -> usize {
    let mut steps = 0;
    while !cleanup.is_complete() {
        assert!(steps < expected, "continuation work exceeded its bound");
        assert_one(cleanup);
        steps += 1;
    }
    steps
}

fn assert_one(cleanup: &mut PendingRuntimeContinuationWorkCleanup) {
    assert!(cleanup.advance_one());
}

fn work(
    batches: Vec<RuntimeChapterPageBatch>,
    available_interactions: Vec<RuntimeRevisionInteractions>,
    completed_chapter_idrefs: BTreeSet<String>,
) -> RuntimeContinuationWork {
    RuntimeContinuationWork {
        batches,
        available_interactions,
        completed_chapter_idrefs,
        processed_top_level_nodes: 7,
        complete: true,
    }
}

fn batch(pages: Vec<LayoutRuntimePage>) -> RuntimeChapterPageBatch {
    RuntimeChapterPageBatch {
        idref: "chapter".to_owned(),
        block_count: 1,
        pages,
    }
}

fn empty_materialized_interactions() -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        footnotes: BTreeMap::new(),
        chapter_text_indices: RuntimeChapterTextIndexSource::Materialized(BTreeMap::new()),
        completed_chapter_idrefs: BTreeSet::new(),
    }
}

fn materialized_interactions(span_count: usize) -> RuntimeRevisionInteractions {
    RuntimeRevisionInteractions {
        footnotes: BTreeMap::new(),
        chapter_text_indices: RuntimeChapterTextIndexSource::Materialized(BTreeMap::from([(
            "chapter".to_owned(),
            RuntimeChapterTextIndex {
                href: "chapter.xhtml".to_owned(),
                normalized_text: "normalized".to_owned(),
                spans: (0..span_count).map(text_span).collect(),
            },
        )])),
        completed_chapter_idrefs: BTreeSet::new(),
    }
}

fn text_span(index: usize) -> RuntimeChapterTextSpan {
    RuntimeChapterTextSpan {
        node_path: vec![index, index + 1],
        source_start: index,
        source_end: index + 1,
        normalized_start: index,
        normalized_end: index + 1,
    }
}

fn deep_work() -> RuntimeContinuationWork {
    work(
        vec![batch(vec![page(vec![deep_block(DEEP_OWNER_COUNT, None)])])],
        vec![materialized_interactions(DEEP_OWNER_COUNT)],
        BTreeSet::new(),
    )
}

fn page(content: Vec<RuntimeBlock<LineBox>>) -> LayoutRuntimePage {
    LayoutRuntimePage::new(
        0,
        600.0,
        800.0,
        Some(json!({ "backgroundColor": "#fff" })),
        content,
    )
}

fn deep_block(count: usize, deepest_line: Option<LineBox>) -> RuntimeBlock<LineBox> {
    assert!(count > 0);
    let children = deepest_line.map(RuntimeChild::Line).into_iter().collect();
    let mut root = block(children);
    for _ in 1..count {
        root = block(vec![RuntimeChild::Block(Box::new(root))]);
    }
    root
}

fn block(children: Vec<RuntimeChild<LineBox>>) -> RuntimeBlock<LineBox> {
    RuntimeBlock {
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 20.0,
        semantic_tag: Some("p".to_owned()),
        anchor_id: None,
        paint: Some(json!({ "color": "#000" })),
        border_box: None,
        page_break_before: false,
        page_break_after: false,
        orphans: None,
        widows: None,
        children,
    }
}
