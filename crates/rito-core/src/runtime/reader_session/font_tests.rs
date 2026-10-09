use crate::runtime::{
    tests::{
        fixture::source_locator_fixture_epub,
        pinned_font_policy_fixtures::{content_epub, title_font},
    },
    RuntimeFontSource, RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole,
};

use super::{
    tests::{adopt_initial, open_test_session, request},
    ReaderResourceKind,
};

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

#[test]
fn a_face_the_host_cannot_paint_stops_shaping_from_the_next_request() {
    let bytes = content_epub(
        "zh-CN",
        r#"<div class="embedded"><p><span>关于我</span></p></div>"#,
        r#"@font-face { font-family: embedded; src: url(book.ttf); } .embedded { font-family: embedded; }"#,
        Some(&title_font()),
    );
    let mut session = open_test_session(303, bytes).expect("reader session opens");
    let first = session
        .request_artifact(request(303, 1, ""))
        .expect("first artifact");
    adopt_initial(&mut session, 303, first.artifact_id);
    let face = first
        .fonts
        .iter()
        .find(|font| !font.href.starts_with("rito-host-font:"))
        .expect("the page paints with the book's own face")
        .clone();

    session
        .mark_font_families_unavailable(std::slice::from_ref(&face.family))
        .expect("the family is marked");

    // The page on screen keeps its layout and still answers for it.
    session
        .read_resource(first.artifact_id, ReaderResourceKind::Font, &face.href)
        .expect("a published artifact still reads the face it lists");
    let again = session
        .request_artifact(request(303, 2, ""))
        .expect("second artifact");
    assert_ne!(again.revision_id, first.revision_id);
    assert!(
        again.fonts.iter().all(|font| font.family != face.family),
        "the next layout does not shape with the face: {:?}",
        again.fonts
    );
    assert_eq!(session.exact_cache_hit_count(), 0);
}
