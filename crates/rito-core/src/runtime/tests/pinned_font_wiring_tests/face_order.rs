use super::super::pinned_font_policy_fixtures::{
    content_epub, face, font_aware_layout, illustration_font, policy, sha256_hex,
    shared_supported_character, title_font, xml_text,
};
use crate::runtime::{RuntimeDocument, RuntimePinnedFontGenericRole, RuntimeRevisionHandle};

#[test]
fn author_font_face_wins_before_the_pinned_fallback_for_a_shared_glyph() {
    let author_font = illustration_font();
    let pinned_font = title_font();
    let character = shared_supported_character(&author_font, &pinned_font);
    let body = format!(
        r#"<p style="font-family: Author, serif">{}</p>"#,
        xml_text(character)
    );
    let stylesheet = r#"@font-face { font-family: "Author"; src: url("book.ttf"); font-style: normal; font-weight: 400; }"#;
    let bytes = content_epub("en", &body, stylesheet, Some(&author_font));
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &bytes,
        policy(vec![face(
            pinned_font,
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .unwrap();
    let revision = document.create_revision(&font_aware_layout()).unwrap();
    let diagnostic = diagnostic(&document, &revision);

    assert_eq!(diagnostic.exact_text_runs, 1);
    assert_eq!(
        diagnostic
            .single_font_fingerprints
            .get(&sha256_hex(&author_font)[..16]),
        Some(&1)
    );
}

#[test]
fn pinned_face_wins_an_alias_collision_with_a_publication_font_face() {
    let pinned_font = title_font();
    let publication_font = illustration_font();
    let character = shared_supported_character(&pinned_font, &publication_font);
    let pinned_hash = sha256_hex(&pinned_font);
    let pinned_alias = format!("__RitoPinned_{pinned_hash}");
    let colliding_family = pinned_alias.to_ascii_uppercase();
    let stylesheet = format!(
        r#"@font-face {{ font-family: "{colliding_family}"; src: url("book.ttf"); font-style: italic; font-weight: 700; }}"#
    );
    let body = format!(
        r#"<p style="font-family: {colliding_family}, serif; font-style: italic; font-weight: 700">{}</p>"#,
        xml_text(character)
    );
    let bytes = content_epub("en", &body, &stylesheet, Some(&publication_font));
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &bytes,
        policy(vec![face(
            pinned_font,
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .unwrap();
    let revision = document.create_revision(&font_aware_layout()).unwrap();
    let diagnostic = diagnostic(&document, &revision);
    let frame = document.get_frame(&revision.revision_id, 0).unwrap();
    let family = frame
        .commands
        .iter()
        .find(|command| command["kind"] == "paintText")
        .and_then(|command| command["paint"]["font"]["family"].as_str());
    let expected_family = format!("{pinned_alias}, serif");

    assert_eq!(diagnostic.exact_text_runs, 1);
    assert_eq!(family, Some(expected_family.as_str()));
    assert_eq!(
        diagnostic.single_font_fingerprints.get(&pinned_hash[..16]),
        Some(&1)
    );
    assert!(!diagnostic
        .single_font_fingerprints
        .contains_key(&sha256_hex(&publication_font)[..16]));
    assert!(document
        .revision_bundle(&revision.revision_id, false)
        .unwrap()
        .required_font_faces
        .unwrap()
        .faces
        .is_empty());
}

#[test]
fn host_and_unshapeable_publication_families_are_removed_from_paint() {
    let pinned_font = title_font();
    let character = shared_supported_character(&pinned_font, &pinned_font);
    let body = format!(
        r#"<p style="font-family: HostOnly, Broken, serif">{}</p>"#,
        xml_text(character)
    );
    let stylesheet = r#"@font-face { font-family: "Broken"; src: url("book.ttf"); }"#;
    let invalid_publication_font = b"not-a-shapeable-font".to_vec();
    let bytes = content_epub("en", &body, stylesheet, Some(&invalid_publication_font));
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &bytes,
        policy(vec![face(
            pinned_font,
            RuntimePinnedFontGenericRole::Serif,
            Some("en"),
        )]),
    )
    .unwrap();
    let alias = document.pinned_font_policy_summary().faces[0]
        .family_alias
        .clone();
    let revision = document.create_revision(&font_aware_layout()).unwrap();
    let frame = document.get_frame(&revision.revision_id, 0).unwrap();
    let family = frame
        .commands
        .iter()
        .find(|command| command["kind"] == "paintText")
        .and_then(|command| command["paint"]["font"]["family"].as_str());
    let expected = format!("{alias}, serif");

    assert_eq!(family, Some(expected.as_str()));
}

fn diagnostic(
    document: &RuntimeDocument,
    revision: &crate::runtime::RuntimeRevisionSummary,
) -> crate::runtime::RuntimeShapeProvenanceDiagnostic {
    document
        .shape_provenance_diagnostic_at(&RuntimeRevisionHandle::from(revision))
        .unwrap()
        .value
}

#[test]
fn a_pinned_role_only_serves_runs_that_ask_for_that_generic() {
    // The contract hosts get this wrong on: the role is a filter, not a
    // label. A book whose text resolves to `serif` gets nothing from a
    // face pinned as sans-serif, and the symptom is silent — the run
    // simply falls through to whatever the platform supplies, which is
    // the one outcome pinning exists to prevent.
    let font = title_font();
    let character = shared_supported_character(&font, &font);
    let body = format!(
        r#"<p style="font-family: serif">{}</p>"#,
        xml_text(character)
    );
    let bytes = content_epub("en", &body, "", None);

    for (role, expects_alias) in [
        (RuntimePinnedFontGenericRole::Serif, true),
        (RuntimePinnedFontGenericRole::SansSerif, false),
    ] {
        let mut document = RuntimeDocument::open_with_pinned_font_policy(
            &bytes,
            policy(vec![face(font.clone(), role, None)]),
        )
        .expect("document opens");
        let alias = document.pinned_font_policy_summary().faces[0]
            .family_alias
            .clone();
        let revision = document
            .create_revision(&font_aware_layout())
            .expect("revision");
        let frame = document
            .get_frame(&revision.revision_id, 0)
            .expect("frame publishes");
        let families = frame
            .commands
            .iter()
            .filter(|command| command["kind"] == "paintText")
            .filter_map(|command| command["paint"]["font"]["family"].as_str())
            .collect::<Vec<_>>();
        assert!(!families.is_empty(), "{role:?}: the fixture paints text");
        for family in families {
            assert_eq!(
                family.contains(&alias),
                expects_alias,
                "{role:?}: serif run resolved to {family:?}"
            );
        }
    }
}
