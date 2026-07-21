use super::fixture::{fixture_epub, layout};
use crate::runtime::{
    RuntimeDocument, RuntimeRevisionAccessErrorKind, RuntimeRevisionHandle,
    RUNTIME_FRAGMENT_SHADOW_PROVIDER_STUB_BLOCK, RUNTIME_FRAGMENT_SHADOW_SCHEMA_VERSION,
};

#[test]
fn shadow_report_is_deterministic_and_replay_verified() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document.create_revision(&layout()).expect("revision");
    let handle = RuntimeRevisionHandle::from(&revision);

    let first = document
        .fragment_shadow_report_at(&handle, RUNTIME_FRAGMENT_SHADOW_PROVIDER_STUB_BLOCK)
        .expect("first shadow run");
    let second = document
        .fragment_shadow_report_at(&handle, RUNTIME_FRAGMENT_SHADOW_PROVIDER_STUB_BLOCK)
        .expect("second shadow run");
    assert_eq!(first.value, second.value);

    let report = first.value;
    assert_eq!(
        report.schema_version,
        RUNTIME_FRAGMENT_SHADOW_SCHEMA_VERSION
    );
    assert_eq!(
        report.engine_provider,
        RUNTIME_FRAGMENT_SHADOW_PROVIDER_STUB_BLOCK
    );
    assert!(report.is_complete);
    assert!(report.shadowed_page_count > 0);
    assert_eq!(report.shadowed_page_count, report.known_page_count);
    assert!(report.shadowed_block_count > 0);
    // Blocks the production engine placed on one page must also fit the
    // fragment model's fragmentainer for that page.
    assert_eq!(report.fitting_page_count, report.shadowed_page_count);
    assert!(report.overflowing_page_indexes.is_empty());
    assert_eq!(report.overflowing_page_omitted_count, 0);
    assert!(report.replay_verified);
    assert!(report.serialized_artifact_bytes > 0);
    assert_eq!(report.artifact_digest.len(), 16);
}

#[test]
fn unknown_engine_provider_fails_closed() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document.create_revision(&layout()).expect("revision");
    let handle = RuntimeRevisionHandle::from(&revision);

    let error = document
        .fragment_shadow_report_at(&handle, "servo-block")
        .expect_err("unknown provider is rejected");
    assert_eq!(error.kind, RuntimeRevisionAccessErrorKind::OperationFailed);
    assert!(error
        .message
        .contains("unknown fragment engine provider: servo-block"));
}

#[test]
fn shadow_run_leaves_production_authority_untouched() {
    let mut document = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = document.create_revision(&layout()).expect("revision");
    let handle = RuntimeRevisionHandle::from(&revision);

    let summary_before = document
        .get_revision_summary_at(&handle)
        .expect("summary before");
    let frame_before = document.get_frame_at(&handle, 0).expect("frame before");
    document
        .fragment_shadow_report_at(&handle, RUNTIME_FRAGMENT_SHADOW_PROVIDER_STUB_BLOCK)
        .expect("shadow run");
    let summary_after = document
        .get_revision_summary_at(&handle)
        .expect("summary after");
    let frame_after = document.get_frame_at(&handle, 0).expect("frame after");
    assert_eq!(summary_before, summary_after);
    assert_eq!(frame_before, frame_after);
}

#[test]
fn forged_revision_handle_is_rejected() {
    let mut seeded = RuntimeDocument::open(&fixture_epub()).expect("document opens");
    let revision = seeded.create_revision(&layout()).expect("revision");
    let handle = RuntimeRevisionHandle::from(&revision);

    let fresh = RuntimeDocument::open(&fixture_epub()).expect("fresh document opens");
    let error = fresh
        .fragment_shadow_report_at(&handle, RUNTIME_FRAGMENT_SHADOW_PROVIDER_STUB_BLOCK)
        .expect_err("handle from another document is rejected");
    assert_eq!(error.kind, RuntimeRevisionAccessErrorKind::UnknownRevision);
}
