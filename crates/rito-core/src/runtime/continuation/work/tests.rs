use std::num::NonZeroUsize;

use super::*;
use crate::{
    layout::LineBreaking,
    runtime::{
        cleanup::RUNTIME_CLEANUP_QUANTUM,
        tests::fixture::{empty_chapter_fixture_epub, layout},
    },
};

const LARGE_CONFIG_JOB_UNITS: usize = 263;
const COMPLETED_CHAPTER_JOB_UNITS: usize = 42;

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
