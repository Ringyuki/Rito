use std::cell::OnceCell;

use rito_stylo::{parse_font_faces_v1, FontFaceStylesheetInputV1};

use crate::{layout::TextMeasurementFontFace, resources::hash_bytes};

use super::super::{paths::normalize_href_path, LoadedBinaryResource, LoadedEpubDocument};

#[derive(Debug)]
pub(crate) struct ResolvedFontFaceSource {
    pub(super) family: String,
    pub(super) style: Option<String>,
    pub(super) weight: Option<u16>,
    pub(super) resource_index: usize,
    pub(super) source_order: usize,
    shape_fingerprint: OnceCell<String>,
}

impl ResolvedFontFaceSource {
    pub(super) fn measurement_face<'a>(
        &self,
        resource: &'a LoadedBinaryResource,
    ) -> TextMeasurementFontFace<'a> {
        match resource
            .byte_hash
            .as_deref()
            .and_then(parse_font_fingerprint)
            .or_else(|| {
                self.shape_fingerprint
                    .get()
                    .and_then(|value| parse_font_fingerprint(value))
            }) {
            Some(fingerprint) => TextMeasurementFontFace::new_with_fingerprint(
                self.family.clone(),
                self.style.clone(),
                self.weight,
                resource.bytes.as_slice(),
                fingerprint,
            ),
            None => TextMeasurementFontFace::new(
                self.family.clone(),
                self.style.clone(),
                self.weight,
                resource.bytes.as_slice(),
            ),
        }
    }

    pub(super) fn catalog_fingerprint(&self, bytes: &[u8]) -> String {
        self.shape_fingerprint
            .get_or_init(|| {
                record_catalog_hash();
                hash_bytes(bytes)
            })
            .clone()
    }
}

pub(crate) fn resolve_font_face_sources(
    document: &LoadedEpubDocument,
) -> Vec<ResolvedFontFaceSource> {
    let mut sources = Vec::new();
    let stylesheet_inputs = document
        .stylesheets
        .iter()
        .map(|stylesheet| {
            record_stylesheet_parse();
            FontFaceStylesheetInputV1::author(
                &stylesheet.text,
                "https://rito.invalid/publication.css",
            )
        })
        .collect::<Vec<_>>();
    let Ok(rules) = parse_font_faces_v1(&stylesheet_inputs) else {
        return sources;
    };
    for (source_order, rule) in rules.into_iter().enumerate() {
        let stylesheet = &document.stylesheets[rule.stylesheet_index];
        let Some(href) = resolve_font_face_href(&stylesheet.href, &rule.src) else {
            continue;
        };
        record_resource_resolve();
        let Some(resource_index) = document
            .fonts
            .iter()
            .position(|font| font.href == href || font.href.ends_with(&format!("/{href}")))
        else {
            continue;
        };
        sources.push(ResolvedFontFaceSource {
            family: rule.family,
            style: rule.style,
            weight: rule.weight.as_deref().and_then(parse_font_face_weight),
            resource_index,
            source_order,
            shape_fingerprint: OnceCell::new(),
        });
    }
    sources
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

fn parse_font_fingerprint(value: &str) -> Option<[u8; 8]> {
    if value.len() != 16 {
        return None;
    }
    let mut fingerprint = [0_u8; 8];
    for (index, byte) in fingerprint.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(fingerprint)
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct FontFaceSourceCacheMetrics {
    pub(crate) stylesheet_parse_count: usize,
    pub(crate) resource_resolve_count: usize,
    pub(crate) catalog_hash_count: usize,
}

#[cfg(test)]
thread_local! {
    static FONT_FACE_SOURCE_CACHE_METRICS: std::cell::Cell<FontFaceSourceCacheMetrics> =
        const { std::cell::Cell::new(FontFaceSourceCacheMetrics {
            stylesheet_parse_count: 0,
            resource_resolve_count: 0,
            catalog_hash_count: 0,
        }) };
}

#[cfg(test)]
pub(crate) fn reset_font_face_source_cache_metrics() {
    FONT_FACE_SOURCE_CACHE_METRICS.with(|metrics| metrics.set(Default::default()));
}

#[cfg(test)]
pub(crate) fn font_face_source_cache_metrics() -> FontFaceSourceCacheMetrics {
    FONT_FACE_SOURCE_CACHE_METRICS.with(std::cell::Cell::get)
}

#[cfg(test)]
fn update_test_metrics(update: impl FnOnce(&mut FontFaceSourceCacheMetrics)) {
    FONT_FACE_SOURCE_CACHE_METRICS.with(|metrics| {
        let mut value = metrics.get();
        update(&mut value);
        metrics.set(value);
    });
}

fn record_stylesheet_parse() {
    #[cfg(test)]
    update_test_metrics(|metrics| metrics.stylesheet_parse_count += 1);
}

fn record_resource_resolve() {
    #[cfg(test)]
    update_test_metrics(|metrics| metrics.resource_resolve_count += 1);
}

fn record_catalog_hash() {
    #[cfg(test)]
    update_test_metrics(|metrics| metrics.catalog_hash_count += 1);
}

#[cfg(test)]
mod tests {
    use super::{
        parse_font_face_weight, parse_font_fingerprint, resolve_font_face_href,
        resolve_font_face_sources,
    };
    use crate::epub::{
        LoadedBinaryResource, LoadedEpubDocument, LoadedTextResource, PackageDocument,
        PackageMetadata,
    };

    #[test]
    fn parses_cached_resource_hash_as_font_fingerprint() {
        assert_eq!(
            parse_font_fingerprint("0011223344556677"),
            Some([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77])
        );
        assert_eq!(parse_font_fingerprint("0011"), None);
        assert_eq!(parse_font_fingerprint("00112233445566zz"), None);
    }

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

    #[test]
    fn resolves_multiple_stylesheets_once_and_preserves_global_source_order() {
        let document = LoadedEpubDocument {
            package: PackageDocument {
                metadata: PackageMetadata {
                    title: "Fonts".to_owned(),
                    language: "en".to_owned(),
                    identifier: "fonts".to_owned(),
                    creator: None,
                },
                manifest: Vec::new(),
                spine: Vec::new(),
                toc: Vec::new(),
            },
            stylesheets: vec![
                LoadedTextResource {
                    href: "OPS/A/main.css".to_owned(),
                    text: r#"@font-face { font-family: First; src: url("../Fonts/book.ttf"); }
                        @font-face { font-family: Missing; src: url("missing.ttf"); }"#
                        .to_owned(),
                },
                LoadedTextResource {
                    href: "OPS/B/extra.css".to_owned(),
                    text: r#"@font-face { font-family: Second; src: url("../Fonts/book.ttf"); font-weight: bold; }"#
                        .to_owned(),
                },
            ],
            fonts: vec![LoadedBinaryResource {
                href: "OPS/Fonts/book.ttf".to_owned(),
                media_type: "font/ttf".to_owned(),
                byte_length: 4,
                byte_hash: None,
                bytes: b"font".to_vec(),
                width: None,
                height: None,
                dimensions_loaded: false,
            }],
            images: Vec::new(),
            chapters: Vec::new(),
            archive_source: None,
        };

        let sources = resolve_font_face_sources(&document);

        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].family, "First");
        assert_eq!(sources[0].resource_index, 0);
        assert_eq!(sources[0].source_order, 0);
        assert_eq!(sources[1].family, "Second");
        assert_eq!(sources[1].weight, Some(700));
        assert_eq!(sources[1].resource_index, 0);
        assert_eq!(sources[1].source_order, 2);
    }
}
