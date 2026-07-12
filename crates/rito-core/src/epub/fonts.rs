use crate::layout::{
    LayoutConfig, TextMeasurementCache, TextMeasurementFontFace, TextMeasurementFonts,
    TextMeasurementMode,
};
use crate::resources::hash_bytes;
use std::collections::{BTreeMap, BTreeSet};

use super::{paths::normalize_href_path, LoadedEpubDocument};

pub(crate) struct TextMeasurementFontAssembly<'a> {
    pub(crate) fonts: TextMeasurementFonts<'a>,
    pub(crate) shapeable_publication_families: BTreeSet<String>,
    pub(crate) shapeable_publication_faces: Vec<ShapeablePublicationFontFace>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ShapeablePublicationFontFace {
    pub(crate) family: String,
    pub(crate) href: String,
    pub(crate) style: String,
    pub(crate) weight: u16,
    pub(crate) shape_fingerprint: String,
    pub(crate) byte_length: usize,
    pub(crate) source_order: usize,
}

pub(crate) fn text_measurement_font_assembly_for_layout<'a>(
    document: &'a LoadedEpubDocument,
    layout_config: &LayoutConfig,
    cache: Option<TextMeasurementCache>,
    pinned_faces: Vec<TextMeasurementFontFace<'a>>,
) -> TextMeasurementFontAssembly<'a> {
    match layout_config.text_measurement {
        TextMeasurementMode::FixtureCompatible => TextMeasurementFontAssembly {
            fonts: TextMeasurementFonts::empty(),
            shapeable_publication_families: BTreeSet::new(),
            shapeable_publication_faces: Vec::new(),
        },
        TextMeasurementMode::FontAware => match cache {
            Some(cache) => text_measurement_font_assembly_with_cache(
                document,
                layout_config,
                cache,
                pinned_faces,
            ),
            None => text_measurement_font_assembly_with_cache(
                document,
                layout_config,
                TextMeasurementCache::default(),
                pinned_faces,
            ),
        },
    }
}

fn text_measurement_font_assembly_with_cache<'a>(
    document: &'a LoadedEpubDocument,
    layout_config: &LayoutConfig,
    cache: TextMeasurementCache,
    pinned_faces: Vec<TextMeasurementFontFace<'a>>,
) -> TextMeasurementFontAssembly<'a> {
    let pinned_active = !pinned_faces.is_empty();
    let pinned_aliases = pinned_faces
        .iter()
        .map(|face| normalize_family_name(&face.family))
        .collect::<BTreeSet<_>>();
    let mut faces = Vec::new();
    let mut shapeable_publication_families = BTreeSet::new();
    let mut shapeable_publication_faces = Vec::new();
    let mut source_order = 0;
    for stylesheet in &document.stylesheets {
        for rule in crate::css::parse_font_face_rules(&stylesheet.text) {
            let rule_source_order = source_order;
            source_order += 1;
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
            let weight = rule.weight.as_deref().and_then(parse_font_face_weight);
            let face = match resource
                .byte_hash
                .as_deref()
                .and_then(parse_font_fingerprint)
            {
                Some(fingerprint) => TextMeasurementFontFace::new_with_fingerprint(
                    rule.family,
                    rule.style,
                    weight,
                    resource.bytes.as_slice(),
                    fingerprint,
                ),
                None => TextMeasurementFontFace::new(
                    rule.family,
                    rule.style,
                    weight,
                    resource.bytes.as_slice(),
                ),
            };
            let family = normalize_family_name(&face.family);
            if pinned_active && pinned_aliases.contains(&family) {
                continue;
            }
            if pinned_active && !face.is_static_shapeable() {
                continue;
            }
            if face.is_shapeable() {
                shapeable_publication_families.insert(family);
                if pinned_active {
                    shapeable_publication_faces.push(ShapeablePublicationFontFace {
                        family: face.family.clone(),
                        href: resource.href.clone(),
                        style: face.normalized_style().to_owned(),
                        weight: face.normalized_weight(),
                        shape_fingerprint: hash_bytes(&resource.bytes),
                        byte_length: resource.bytes.len(),
                        source_order: rule_source_order,
                    });
                }
            } else if pinned_active {
                continue;
            }
            faces.push(face);
        }
    }
    // Publication faces retain author priority, but an alias owned by the
    // document-lifetime pinned policy is never eligible as a publication face.
    // This is family-wide rather than score-based, so italic/bold declarations
    // cannot outrank the v1 normal/400 pinned face under the same alias.
    faces.extend(pinned_faces);
    TextMeasurementFontAssembly {
        fonts: TextMeasurementFonts::new_with_cache(
            faces,
            cache,
            generic_serif_advances(layout_config),
            font_family_advances(layout_config),
            generic_serif_pair_adjustments(layout_config),
            font_family_pair_adjustments(layout_config),
        ),
        shapeable_publication_families,
        shapeable_publication_faces,
    }
}

fn normalize_family_name(family: &str) -> String {
    family.trim().to_ascii_lowercase()
}

fn font_family_pair_adjustments(
    layout_config: &LayoutConfig,
) -> BTreeMap<String, BTreeMap<(char, char), f64>> {
    layout_config
        .font_family_pair_adjustments
        .iter()
        .map(|(family, adjustments)| {
            (
                family.trim().to_ascii_lowercase(),
                adjustments
                    .iter()
                    .filter_map(|(text, adjustment)| valid_pair_adjustment(text, *adjustment))
                    .collect(),
            )
        })
        .filter(
            |(family, adjustments): &(String, BTreeMap<(char, char), f64>)| {
                !family.is_empty() && !adjustments.is_empty()
            },
        )
        .collect()
}

fn generic_serif_pair_adjustments(layout_config: &LayoutConfig) -> BTreeMap<(char, char), f64> {
    layout_config
        .generic_serif_pair_adjustments
        .iter()
        .filter_map(|(text, adjustment)| valid_pair_adjustment(text, *adjustment))
        .collect()
}

fn valid_pair_adjustment(text: &str, adjustment: f64) -> Option<((char, char), f64)> {
    let mut characters = text.chars();
    let left = characters.next()?;
    let right = characters.next()?;
    (characters.next().is_none() && adjustment.is_finite()).then_some(((left, right), adjustment))
}

fn font_family_advances(layout_config: &LayoutConfig) -> BTreeMap<String, BTreeMap<char, f64>> {
    layout_config
        .font_family_advances
        .iter()
        .map(|(family, advances)| {
            (
                family.trim().to_ascii_lowercase(),
                advances
                    .iter()
                    .filter_map(|(text, advance)| valid_character_advance(text, *advance))
                    .collect(),
            )
        })
        .filter(|(family, advances): &(String, BTreeMap<char, f64>)| {
            !family.is_empty() && !advances.is_empty()
        })
        .collect()
}

fn valid_character_advance(text: &str, advance: f64) -> Option<(char, f64)> {
    let mut characters = text.chars();
    let character = characters.next()?;
    (characters.next().is_none() && advance.is_finite() && advance > 0.0)
        .then_some((character, advance))
}

fn generic_serif_advances(layout_config: &LayoutConfig) -> BTreeMap<char, f64> {
    layout_config
        .generic_serif_advances
        .iter()
        .filter_map(|(text, advance)| valid_character_advance(text, *advance))
        .collect()
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
mod tests {
    use super::{
        parse_font_face_weight, parse_font_fingerprint, resolve_font_face_href,
        valid_pair_adjustment,
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
    fn validates_host_pair_adjustment_keys_and_values() {
        assert_eq!(
            valid_pair_adjustment("：「", -0.5),
            Some((('：', '「'), -0.5))
        );
        assert_eq!(valid_pair_adjustment("：", -0.5), None);
        assert_eq!(valid_pair_adjustment("：「」", -0.5), None);
        assert_eq!(valid_pair_adjustment("：「", f64::NAN), None);
    }
}
