use crate::layout::{
    LayoutConfig, TextMeasurementCache, TextMeasurementFontFace, TextMeasurementFonts,
    TextMeasurementMode,
};

use super::{paths::normalize_href_path, LoadedEpubDocument};

pub(super) fn text_measurement_fonts_from_document(
    document: &LoadedEpubDocument,
) -> TextMeasurementFonts<'_> {
    text_measurement_fonts_from_document_with_cache(document, TextMeasurementCache::default())
}

pub(super) fn text_measurement_fonts_for_layout<'a>(
    document: &'a LoadedEpubDocument,
    layout_config: &LayoutConfig,
    cache: Option<TextMeasurementCache>,
) -> TextMeasurementFonts<'a> {
    match layout_config.text_measurement {
        TextMeasurementMode::FixtureCompatible => TextMeasurementFonts::empty(),
        TextMeasurementMode::FontAware => match cache {
            Some(cache) => text_measurement_fonts_from_document_with_cache(document, cache),
            None => text_measurement_fonts_from_document(document),
        },
    }
}

fn text_measurement_fonts_from_document_with_cache<'a>(
    document: &'a LoadedEpubDocument,
    cache: TextMeasurementCache,
) -> TextMeasurementFonts<'a> {
    let mut faces = Vec::new();
    for stylesheet in &document.stylesheets {
        for rule in crate::css::parse_font_face_rules(&stylesheet.text) {
            let Some(href) = resolve_font_face_href(&stylesheet.href, &rule.src) else {
                continue;
            };
            let Some(resource) = document
                .fonts
                .iter()
                .find(|font| font.href == href || font.href.ends_with(&format!("/{href}")))
            else {
                continue;
            };
            faces.push(TextMeasurementFontFace::new(
                rule.family,
                rule.style,
                rule.weight.as_deref().and_then(parse_font_face_weight),
                resource.bytes.as_slice(),
            ));
        }
    }
    TextMeasurementFonts::new_with_cache(faces, cache)
}

fn resolve_font_face_href(stylesheet_href: &str, src: &str) -> Option<String> {
    let href = src.split(['?', '#']).next()?.trim();
    let lower = href.to_ascii_lowercase();
    if href.is_empty()
        || lower.starts_with("data:")
        || lower.starts_with("http:")
        || lower.starts_with("https:")
    {
        return None;
    }
    let base = stylesheet_href
        .rfind('/')
        .map(|index| &stylesheet_href[..=index])
        .unwrap_or_default();
    Some(normalize_href_path(&format!("{base}{href}")))
}

fn parse_font_face_weight(value: &str) -> Option<u16> {
    match value.trim().to_ascii_lowercase().as_str() {
        "normal" => Some(400),
        "bold" => Some(700),
        value => value.parse::<u16>().ok(),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_font_face_weight, resolve_font_face_href};

    #[test]
    fn resolves_font_face_href_relative_to_stylesheet() {
        assert_eq!(
            resolve_font_face_href("OEBPS/Styles/main.css", "../Fonts/book.otf"),
            Some("OEBPS/Fonts/book.otf".to_owned())
        );
        assert_eq!(
            resolve_font_face_href("style.css", "./fonts/book.ttf#iefix"),
            Some("fonts/book.ttf".to_owned())
        );
    }

    #[test]
    fn rejects_non_publication_font_face_sources() {
        assert_eq!(
            resolve_font_face_href("style.css", "data:font/ttf;base64,AA=="),
            None
        );
        assert_eq!(
            resolve_font_face_href("style.css", "https://example.test/font.ttf"),
            None
        );
        assert_eq!(resolve_font_face_href("style.css", ""), None);
    }

    #[test]
    fn parses_font_face_weight_values() {
        assert_eq!(parse_font_face_weight("normal"), Some(400));
        assert_eq!(parse_font_face_weight("bold"), Some(700));
        assert_eq!(parse_font_face_weight("500"), Some(500));
        assert_eq!(parse_font_face_weight("heavy"), None);
    }
}
