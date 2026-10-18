use super::super::pinned_font_policy_fixtures::{
    bundled_font, content_epub, face, layout, policy, shared_supported_character, title_font,
    xml_text,
};
use crate::runtime::{RuntimeDocument, RuntimePinnedFontGenericRole};

#[test]
fn unknown_and_unshapeable_families_paint_with_the_resolved_face_alias() {
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
    let revision = document.create_revision(&layout()).unwrap();
    let frame = document
        .frame_commands_for_tests(&revision.revision_id, 0)
        .unwrap();
    let family = frame.commands.iter().find_map(|command| match command {
        crate::render::DisplayCommand::PaintText(input) => Some(input.paint.font.family.clone()),
        _ => None,
    });
    // Paint names the one face shaping used, never a family list.
    assert_eq!(family.as_deref(), Some(alias.as_str()));
}

/// The family each painted text run names, in order, with its text.
fn painted_runs(document: &mut RuntimeDocument) -> Vec<(String, String)> {
    let revision = document.create_revision(&layout()).unwrap();
    let frame = document
        .frame_commands_for_tests(&revision.revision_id, 0)
        .unwrap();
    frame
        .commands
        .iter()
        .filter_map(|command| match command {
            crate::render::DisplayCommand::PaintText(input) => {
                Some((input.text.to_string(), input.paint.font.family.to_string()))
            }
            _ => None,
        })
        .collect()
}

fn alias_of(
    document: &RuntimeDocument,
    role: RuntimePinnedFontGenericRole,
    language: &str,
) -> String {
    document
        .pinned_font_policy_summary()
        .faces
        .into_iter()
        .find(|face| face.generic_role == role && face.language == language)
        .expect("the policy holds the face")
        .family_alias
}

fn four_face_policy() -> crate::runtime::RuntimePinnedFontPolicyInput {
    policy(vec![
        face(
            bundled_font("Tinos-Regular.ttf"),
            RuntimePinnedFontGenericRole::Serif,
            None,
        ),
        face(
            bundled_font("SourceHanSerifCN-Regular.otf"),
            RuntimePinnedFontGenericRole::Serif,
            Some("zh-Hans"),
        ),
        face(
            bundled_font("Arimo-Regular.ttf"),
            RuntimePinnedFontGenericRole::SansSerif,
            None,
        ),
        face(
            bundled_font("SourceHanSansCN-Regular.otf"),
            RuntimePinnedFontGenericRole::SansSerif,
            Some("zh-Hans"),
        ),
    ])
}

#[test]
fn a_generic_family_resolves_to_the_faces_of_its_role() {
    let body = r#"<p style="font-family: sans-serif">A</p><p style="font-family: serif">B</p><p style="font-family: monospace">C</p>"#;
    let bytes = content_epub("en", body, "", None);
    let mut document =
        RuntimeDocument::open_with_pinned_font_policy(&bytes, four_face_policy()).unwrap();
    let serif = alias_of(&document, RuntimePinnedFontGenericRole::Serif, "und");
    let sans = alias_of(&document, RuntimePinnedFontGenericRole::SansSerif, "und");
    // With no monospace face the user agent's fallback serves it: serif.
    assert_eq!(
        painted_runs(&mut document),
        vec![
            ("A".to_owned(), sans),
            ("B".to_owned(), serif.clone()),
            ("C".to_owned(), serif),
        ]
    );
}

#[test]
fn ideographs_fall_back_to_the_role_face_for_their_language() {
    let body = r#"<p style="font-family: sans-serif">A中</p>"#;
    let bytes = content_epub("zh-CN", body, "", None);
    let mut document =
        RuntimeDocument::open_with_pinned_font_policy(&bytes, four_face_policy()).unwrap();
    let latin = alias_of(&document, RuntimePinnedFontGenericRole::SansSerif, "und");
    let cjk = alias_of(
        &document,
        RuntimePinnedFontGenericRole::SansSerif,
        "zh-hans",
    );
    // The language-neutral face keeps the Latin letter; the ideograph
    // falls to the sans face tagged for Chinese, never the serif one.
    assert_eq!(
        painted_runs(&mut document),
        vec![("A".to_owned(), latin), ("中".to_owned(), cjk)]
    );
}

#[test]
fn a_publication_family_shadows_a_host_family_of_the_same_name() {
    let body = r#"<p style="font-family: Tinos">A</p><p style="font-family: Arimo">B</p>"#;
    let stylesheet = r#"@font-face { font-family: "Tinos"; src: url("book.ttf"); }"#;
    let publication = bundled_font("Arimo-Regular.ttf");
    let bytes = content_epub("en", body, stylesheet, Some(&publication));
    let mut document =
        RuntimeDocument::open_with_pinned_font_policy(&bytes, four_face_policy()).unwrap();
    let runs = painted_runs(&mut document);
    // "Tinos" names the book's own face (registered under its file's
    // alias); "Arimo" names the host face of that name.
    assert!(runs[0].1.starts_with("__RitoFace_"), "{runs:?}");
    assert_eq!(
        runs[1].1,
        alias_of(&document, RuntimePinnedFontGenericRole::SansSerif, "und")
    );
}
