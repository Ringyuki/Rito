use crate::runtime::{
    tests::fixture::source_locator_fixture_epub, RuntimeFontSource, RuntimePinnedFontFaceInput,
    RuntimePinnedFontGenericRole,
};

use super::tests::{adopt_initial, open_test_session, request};

fn arimo() -> RuntimePinnedFontFaceInput {
    use sha2::{Digest, Sha256};
    let bytes = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/reader/src/assets/fonts/Arimo-Regular.ttf"
    ))
    .expect("bundled font reads");
    let expected_sha256 = Sha256::digest(&bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    RuntimePinnedFontFaceInput {
        bytes,
        expected_sha256,
        generic_role: RuntimePinnedFontGenericRole::SansSerif,
        language: None,
    }
}

#[test]
fn a_face_added_mid_session_lays_the_next_request_out_again() {
    let mut session =
        open_test_session(301, source_locator_fixture_epub()).expect("reader session opens");
    let first = session
        .request_artifact(request(301, 1, "chapter.xhtml#point-47"))
        .expect("first artifact");
    adopt_initial(&mut session, 301, first.artifact_id);
    assert!(!session.unresolved_font_families("Arimo").is_empty());

    session
        .add_host_font_faces(vec![arimo()])
        .expect("face adds");
    assert!(session.unresolved_font_families("Arimo").is_empty());
    assert!(session
        .font_catalog()
        .families
        .iter()
        .any(|family| family.name == "Arimo" && family.source == RuntimeFontSource::Host));

    // The same target at the same layout config is not served from the
    // revision laid out before the face existed.
    let again = session
        .request_artifact(request(301, 2, "chapter.xhtml#point-47"))
        .expect("second artifact");
    assert_ne!(again.revision_id, first.revision_id);
    assert_eq!(session.exact_cache_hit_count(), 0);
}

#[test]
fn a_bad_face_is_an_invalid_request_and_changes_nothing() {
    let mut session =
        open_test_session(302, source_locator_fixture_epub()).expect("reader session opens");
    let before = session.font_catalog();
    let mut broken = arimo();
    broken.bytes.truncate(64);
    let error = session
        .add_host_font_faces(vec![broken])
        .expect_err("truncated bytes are refused");
    assert_eq!(error.kind, super::ReaderErrorKind::InvalidRequest);
    assert_eq!(session.font_catalog(), before);
}
