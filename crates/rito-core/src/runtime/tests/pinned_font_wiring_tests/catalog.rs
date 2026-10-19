use super::super::pinned_font_policy_fixtures::{bundled_font, content_epub, face, layout, policy};
use crate::runtime::{RuntimeDocument, RuntimeFontSource, RuntimePinnedFontGenericRole};

fn open(body: &str, stylesheet: &str, publication: Option<&[u8]>) -> RuntimeDocument {
    let bytes = content_epub("en", body, stylesheet, publication);
    RuntimeDocument::open_with_pinned_font_policy(
        &bytes,
        policy(vec![face(
            bundled_font("Tinos-Regular.ttf"),
            RuntimePinnedFontGenericRole::Serif,
            None,
        )]),
    )
    .unwrap()
}

fn painted_families(document: &mut RuntimeDocument) -> Vec<String> {
    let revision = document.create_revision(&layout()).unwrap();
    document
        .frame_commands_for_tests(&revision.revision_id, 0)
        .unwrap()
        .commands
        .iter()
        .filter_map(|command| match command {
            crate::render::DisplayCommand::PaintText(input) => {
                Some(input.paint.font.family.to_string())
            }
            _ => None,
        })
        .collect()
}

#[test]
fn the_catalog_lists_host_and_publication_families() {
    let stylesheet =
        r#"@font-face { font-family: "Book Face"; font-weight: bold; src: url("book.ttf"); }"#;
    let document = open(
        "<p>A</p>",
        stylesheet,
        Some(&bundled_font("Arimo-Regular.ttf")),
    );
    let catalog = document.font_catalog();
    let summary: Vec<_> = catalog
        .families
        .iter()
        .map(|family| (family.name.as_str(), family.source, family.faces[0].weight))
        .collect();
    assert_eq!(
        summary,
        [
            ("Tinos", RuntimeFontSource::Host, 400),
            ("Book Face", RuntimeFontSource::Publication, 700),
        ]
    );
}

#[test]
fn unresolved_names_are_the_ones_no_family_answers_to() {
    let document = open("<p>A</p>", "", None);
    assert_eq!(
        document.unresolved_font_families(r#""No Such Face", tinos, Georgia, sans-serif"#),
        ["No Such Face", "Georgia"]
    );
}

#[test]
fn a_host_face_added_at_runtime_becomes_nameable_and_relays_out() {
    let body = r#"<p style="font-family: Arimo, serif">A</p>"#;
    let mut document = open(body, "", None);
    let tinos = document.pinned_font_policy_summary().faces[0]
        .family_alias
        .clone();
    let before_key = document.create_revision(&layout()).unwrap().layout_key;
    assert_eq!(
        painted_families(&mut document),
        std::slice::from_ref(&tinos)
    );
    assert_eq!(document.unresolved_font_families("Arimo"), ["Arimo"]);

    let summary = document
        .add_host_font_faces(vec![face(
            bundled_font("Arimo-Regular.ttf"),
            RuntimePinnedFontGenericRole::SansSerif,
            None,
        )])
        .unwrap();
    let arimo = summary.faces[1].family_alias.clone();
    assert!(document.unresolved_font_families("Arimo").is_empty());
    assert_ne!(
        document.create_revision(&layout()).unwrap().layout_key,
        before_key
    );
    assert_eq!(painted_families(&mut document), [arimo]);

    // The same bytes twice are refused; removing the face restores Tinos.
    assert!(document
        .add_host_font_faces(vec![face(
            bundled_font("Arimo-Regular.ttf"),
            RuntimePinnedFontGenericRole::SansSerif,
            None,
        )])
        .is_err());
    let sha = summary.faces[1].sha256.clone();
    document.remove_host_font_faces(&[sha]).unwrap();
    assert_eq!(painted_families(&mut document), [tinos]);
    // The last face cannot go.
    let last = document.pinned_font_policy_summary().faces[0]
        .sha256
        .clone();
    assert!(document.remove_host_font_faces(&[last]).is_err());
}
