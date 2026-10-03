//! Family resolution against the face catalog: roles, content language,
//! and the face every cluster names for paint.

use super::*;

fn bundled(file: &str) -> Vec<u8> {
    std::fs::read(format!(
        "{}/../../apps/reader/src/assets/fonts/{file}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("bundled font reads")
}

fn host(file: &str, role: HostFontRole, language: Option<&str>, alias: &str) -> HostFontFace {
    let bytes = bundled(file);
    HostFontFace {
        family: font_family_name(&bytes).expect("a family name"),
        bytes,
        role,
        language: language.map(str::to_owned),
        alias: alias.to_owned(),
    }
}

fn styled(families: Vec<FontFamily>, language: Option<&str>) -> InlineFormattingStyle {
    let mut style = plain_paragraph_style(
        FontFamilies::new(families).expect("a family list"),
        FONT_SIZE,
        0.0,
    );
    style.text_flow.language = language.map(rito_style_contract::LanguageTag::new);
    style
}

/// The alias of the face each cluster of `text` shaped with.
fn faces(context: &ParleyInlineContext, style: &InlineFormattingStyle, text: &str) -> Vec<String> {
    context
        .measure_run(style, text)
        .clusters
        .iter()
        .map(|cluster| context.face_aliases()[cluster.face.0 as usize].clone())
        .collect()
}

/// Two CJK faces of one role tagged for different languages: the bundled
/// Source Han faces stand in for a Japanese and a Chinese face.
fn bilingual_serif() -> ParleyInlineContext {
    ParleyInlineContext::with_faces(vec![
        host("Tinos-Regular.ttf", HostFontRole::Serif, None, "latin"),
        host(
            "SourceHanSansCN-Regular.otf",
            HostFontRole::Serif,
            Some("ja"),
            "japanese",
        ),
        host(
            "SourceHanSerifCN-Regular.otf",
            HostFontRole::Serif,
            Some("zh-hans"),
            "chinese",
        ),
    ])
    .expect("context builds")
}

#[test]
fn the_content_language_picks_among_faces_tagged_for_a_language() {
    let context = bilingual_serif();
    let serif = || vec![FontFamily::Generic(GenericFontFamily::Serif)];
    // The language-neutral face keeps Latin whatever the language; the
    // ideograph goes to the face tagged closest to the content's.
    assert_eq!(
        faces(&context, &styled(serif(), Some("ja")), "A字"),
        ["latin", "japanese"]
    );
    assert_eq!(
        faces(&context, &styled(serif(), Some("zh-cn")), "A字"),
        ["latin", "chinese"]
    );
    // Untagged content keeps the faces in the host's order.
    assert_eq!(
        faces(&context, &styled(serif(), None), "A字"),
        ["latin", "japanese"]
    );
}

#[test]
fn a_generic_resolves_its_role_before_the_fallback_roles() {
    let context = ParleyInlineContext::with_faces(vec![
        host("Tinos-Regular.ttf", HostFontRole::Serif, None, "serif"),
        host("Arimo-Regular.ttf", HostFontRole::SansSerif, None, "sans"),
    ])
    .expect("context builds");
    let generic = |generic| styled(vec![FontFamily::Generic(generic)], None);
    assert_eq!(
        faces(&context, &generic(GenericFontFamily::SansSerif), "A"),
        ["sans"]
    );
    assert_eq!(
        faces(&context, &generic(GenericFontFamily::SystemUi), "A"),
        ["sans"]
    );
    assert_eq!(
        faces(&context, &generic(GenericFontFamily::Serif), "A"),
        ["serif"]
    );
    // No monospace or cursive face: the fallback serves them, serif first.
    assert_eq!(
        faces(&context, &generic(GenericFontFamily::Monospace), "A"),
        ["serif"]
    );
    assert_eq!(
        faces(&context, &generic(GenericFontFamily::Cursive), "A"),
        ["serif"]
    );
}

#[test]
fn a_host_family_answers_to_its_own_name_and_unknown_names_are_recorded() {
    let context = ParleyInlineContext::with_faces(vec![
        host("Tinos-Regular.ttf", HostFontRole::Serif, None, "serif"),
        host("Arimo-Regular.ttf", HostFontRole::SansSerif, None, "sans"),
    ])
    .expect("context builds");
    let named = |name: &str| FontFamily::Named(FontFamilyName::new(name));
    let style = styled(vec![named("No Such Face"), named("ARIMO")], None);
    assert_eq!(faces(&context, &style, "A"), ["sans"]);
    assert_eq!(context.unknown_families(), ["no such face"]);
}

#[test]
fn a_publication_family_shadows_a_host_family_of_the_same_name() {
    let mut context = ParleyInlineContext::with_faces(vec![host(
        "Tinos-Regular.ttf",
        HostFontRole::Serif,
        None,
        "host-tinos",
    )])
    .expect("context builds");
    context
        .register_publication_face(PublicationFontFace {
            family: "Tinos".to_owned(),
            bytes: bundled("Arimo-Regular.ttf"),
            weight: 400,
            italic: false,
            alias: "book-tinos".to_owned(),
        })
        .expect("publication face registers");
    let style = styled(vec![FontFamily::Named(FontFamilyName::new("Tinos"))], None);
    assert_eq!(faces(&context, &style, "A"), ["book-tinos"]);
}
