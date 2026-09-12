use super::super::pinned_font_policy_fixtures::{
    content_epub, face, layout, policy, shared_supported_character, title_font, xml_text,
};
use crate::runtime::{RuntimeDocument, RuntimePinnedFontGenericRole};

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
    let revision = document.create_revision(&layout()).unwrap();
    let frame = document
        .frame_commands_for_tests(&revision.revision_id, 0)
        .unwrap();
    let family = frame.commands.iter().find_map(|command| match command {
        crate::render::DisplayCommand::PaintText(input) => Some(input.paint.font.family.clone()),
        _ => None,
    });
    let expected = format!("{alias}, serif");

    assert_eq!(family.as_deref(), Some(expected.as_str()));
}
