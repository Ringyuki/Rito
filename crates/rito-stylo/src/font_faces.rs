use cssparser::{Parser, ParserInput};
use style::{
    context::QuirksMode,
    font_face::Source,
    media_queries::MediaList,
    servo_arc::Arc,
    shared_lock::{SharedRwLock, SharedRwLockReadGuard},
    stylesheets::{
        AllowImportRules, CssRule, DocumentStyleSheet, Origin, Stylesheet, UrlExtraData,
    },
};
use style_traits::ToCss;

use crate::{config::initialize_global_preferences, StyleError, StyleOrigin};

/// Borrowed input for one-shot `@font-face` extraction.
///
/// Unlike [`crate::StylesheetInput`], this type does not copy stylesheet text
/// merely to feed the parser. It is an engine-neutral crate-to-crate contract.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FontFaceStylesheetInputV1<'a> {
    css: &'a str,
    base_url: &'a str,
    origin: StyleOrigin,
}

impl<'a> FontFaceStylesheetInputV1<'a> {
    pub fn new(css: &'a str, base_url: &'a str, origin: StyleOrigin) -> Self {
        Self {
            css,
            base_url,
            origin,
        }
    }

    pub fn author(css: &'a str, base_url: &'a str) -> Self {
        Self::new(css, base_url, StyleOrigin::Author)
    }
}

/// Rito-owned projection of one parsed `@font-face` rule.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FontFaceRuleV1 {
    pub stylesheet_index: usize,
    pub family: String,
    pub src: String,
    pub style: Option<String>,
    pub weight: Option<String>,
}

/// Parses stylesheets with Stylo and projects usable `@font-face` rules in
/// stylesheet/rule/source order.
///
/// The first valid URL source is selected, matching Rito's current embedded
/// font assembly contract. URL resolution remains the caller's responsibility;
/// `src` is the decoded specified value rather than Stylo's resolved URL.
pub fn parse_font_faces_v1(
    stylesheets: &[FontFaceStylesheetInputV1<'_>],
) -> Result<Vec<FontFaceRuleV1>, StyleError> {
    initialize_global_preferences();
    let lock = SharedRwLock::new();
    let mut faces = Vec::new();
    for (stylesheet_index, input) in stylesheets.iter().enumerate() {
        let stylesheet = parse_stylesheet(input, &lock)?;
        let guard = lock.read();
        let contents = stylesheet.0.contents.read_with(&guard);
        let rules = contents.rules.read_with(&guard);
        collect_font_faces(&rules.0, &guard, stylesheet_index, &mut faces);
    }
    Ok(faces)
}

fn parse_stylesheet(
    input: &FontFaceStylesheetInputV1<'_>,
    lock: &SharedRwLock,
) -> Result<DocumentStyleSheet, StyleError> {
    let base_url = url::Url::parse(input.base_url).map_err(|error| StyleError::InvalidUrl {
        kind: "stylesheet",
        value: input.base_url.to_owned(),
        reason: error.to_string(),
    })?;
    let stylesheet = Stylesheet::from_str(
        input.css,
        UrlExtraData::from(base_url),
        Origin::from(input.origin),
        Arc::new(lock.wrap(MediaList::empty())),
        lock.clone(),
        None,
        None,
        QuirksMode::NoQuirks,
        AllowImportRules::No,
    );
    Ok(DocumentStyleSheet(Arc::new(stylesheet)))
}

fn collect_font_faces(
    rules: &[CssRule],
    guard: &SharedRwLockReadGuard,
    stylesheet_index: usize,
    faces: &mut Vec<FontFaceRuleV1>,
) {
    for rule in rules {
        if let CssRule::FontFace(rule) = rule {
            if let Some(face) =
                project_font_face(&rule.read_with(guard).descriptors, stylesheet_index)
            {
                faces.push(face);
            }
        }
        collect_font_faces(rule.children(guard), guard, stylesheet_index, faces);
    }
}

fn project_font_face(
    descriptors: &style::font_face::Descriptors,
    stylesheet_index: usize,
) -> Option<FontFaceRuleV1> {
    let family = descriptors.font_family.as_ref()?.name.to_string();
    let src = descriptors
        .src
        .as_ref()?
        .0
        .iter()
        .find_map(|source| match source {
            Source::Url(source) => specified_url(&source.url),
            Source::Local(_) => None,
        })?;
    Some(FontFaceRuleV1 {
        stylesheet_index,
        family,
        src,
        style: descriptors.font_style.as_ref().map(ToCss::to_css_string),
        weight: descriptors.font_weight.as_ref().map(ToCss::to_css_string),
    })
}

/// Stylo deliberately keeps the original URL field private. Serializing its
/// already-parsed value and decoding that single CSS URL token preserves the
/// specified (unresolved) URL without introducing a second stylesheet parser.
fn specified_url(url: &style::values::specified::url::SpecifiedUrl) -> Option<String> {
    let serialized = url.to_css_string();
    let mut input = ParserInput::new(&serialized);
    let mut parser = Parser::new(&mut input);
    let value = parser.expect_url().ok()?.as_ref().to_owned();
    parser.is_exhausted().then_some(value)
}

#[cfg(test)]
mod tests {
    use super::{parse_font_faces_v1, FontFaceStylesheetInputV1};

    #[test]
    fn parses_typed_faces_and_preserves_stylesheet_rule_order() {
        let stylesheets = [
            FontFaceStylesheetInputV1::author(
                r#"@font-face { font-family: "First"; src: local("First"), url("../Fonts/first.woff2") format("woff2"); font-style: italic; font-weight: 700; }
                   @font-face { font-family: MissingSrc; }"#,
                "https://rito.invalid/OPS/A/main.css",
            ),
            FontFaceStylesheetInputV1::author(
                r#"@font-face { font-family: Second; src: url(second.ttf), url(fallback.ttf); font-weight: 400 700; }"#,
                "https://rito.invalid/OPS/B/extra.css",
            ),
        ];

        let faces = parse_font_faces_v1(&stylesheets).expect("valid stylesheets");

        assert_eq!(faces.len(), 2);
        assert_eq!(faces[0].stylesheet_index, 0);
        assert_eq!(faces[0].family, "First");
        assert_eq!(faces[0].src, "../Fonts/first.woff2");
        assert_eq!(faces[0].style.as_deref(), Some("italic"));
        assert_eq!(faces[0].weight.as_deref(), Some("700"));
        assert_eq!(faces[1].stylesheet_index, 1);
        assert_eq!(faces[1].family, "Second");
        assert_eq!(faces[1].src, "second.ttf");
        assert_eq!(faces[1].weight.as_deref(), Some("400 700"));
    }

    #[test]
    fn decodes_css_escaped_urls_from_stylo_serialization() {
        let stylesheets = [FontFaceStylesheetInputV1::author(
            r#"@font-face { font-family: Escaped; src: url("../Fonts/My\ Font.woff2"); }"#,
            "https://rito.invalid/OPS/main.css",
        )];

        let faces = parse_font_faces_v1(&stylesheets).expect("valid stylesheet");

        assert_eq!(faces[0].src, "../Fonts/My Font.woff2");
    }
}
