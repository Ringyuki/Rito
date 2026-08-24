use std::num::NonZeroUsize;

use super::*;
use crate::{
    layout::LineBreaking,
    runtime::{
        cleanup::RUNTIME_CLEANUP_QUANTUM,
        tests::fixture::{empty_chapter_fixture_epub, layout, multi_chapter_fixture_epub},
    },
};

const LARGE_CONFIG_JOB_UNITS: usize = 263;
const COMPLETED_CHAPTER_JOB_UNITS: usize = 42;
const ORPHANED_FIRST_CHAPTER_WORK_JOB_UNITS: usize = 41;

#[test]
fn completed_chapter_admission_services_its_exact_queue_cost() {
    let mut document =
        RuntimeDocument::open(&empty_chapter_fixture_epub()).expect("empty runtime document opens");
    let mut cleanup_config = layout();
    cleanup_config.generic_serif_advances = (0..256)
        .map(|index| (format!("glyph-{index}"), index as f64))
        .collect();
    document.cleanup_queue.enqueue_layout_config(cleanup_config);
    let mut record = RuntimeContinuationRecord::new(
        "revision".to_owned(),
        "layout".to_owned(),
        layout(),
        LineBreaking::Greedy,
        document.document.chapters.len(),
    );

    let work = document
        .advance_record(&mut record, NonZeroUsize::MIN)
        .expect("empty chapter completes");

    assert!(work.complete);
    assert_eq!(work.batches.len(), 1);
    assert_eq!(work.available_interactions.len(), 1);
    assert_eq!(work.completed_chapter_idrefs.len(), 1);
    let remaining = document.cleanup_queue.advance(NonZeroUsize::MAX);
    assert_eq!(
        remaining.consumed_units,
        LARGE_CONFIG_JOB_UNITS + COMPLETED_CHAPTER_JOB_UNITS - RUNTIME_CLEANUP_QUANTUM
    );
    assert!(remaining.complete);
}

#[test]
fn later_chapter_start_failure_queues_prior_work_as_one_job() {
    let mut document = RuntimeDocument::open(&multi_chapter_fixture_epub())
        .expect("multi-chapter runtime document opens");
    document
        .publication_footnote_index()
        .expect("publication footnotes are cached before failure injection");
    make_chapter_unavailable(&mut document, 1);
    let mut record = RuntimeContinuationRecord::new(
        "revision".to_owned(),
        "layout".to_owned(),
        layout(),
        LineBreaking::Greedy,
        document.document.chapters.len(),
    );

    let result = document.advance_record(
        &mut record,
        NonZeroUsize::new(2).expect("test budget is non-zero"),
    );

    assert!(result.is_err(), "the unavailable second chapter must fail");
    assert_eq!(record.next_chapter_index, 1);
    assert!(record.current.is_none());
    assert_eq!(document.cleanup_queue.job_count(), 1);
    assert_eq!(document.cleanup_queue.pending_frame_owner_count(), 0);
    let remaining = document.cleanup_queue.advance(NonZeroUsize::MAX);
    assert_eq!(
        remaining.consumed_units,
        ORPHANED_FIRST_CHAPTER_WORK_JOB_UNITS
    );
    assert!(remaining.complete);
}

fn make_chapter_unavailable(document: &mut RuntimeDocument, chapter_index: usize) {
    let chapter = &mut document.document.chapters[chapter_index];
    chapter.href = format!("missing-chapter-{chapter_index}.xhtml");
    chapter.xhtml_source.clear();
    chapter.source_loaded = false;
    chapter.image_refs = None;
}
