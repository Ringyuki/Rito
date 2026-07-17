use crate::layout::{
    LayoutConfig, TextMeasurementCache, TextMeasurementFontFace, TextMeasurementFonts,
    TextMeasurementMode,
};
use std::collections::BTreeSet;

use self::layout_profile::{
    font_family_advances, font_family_pair_adjustments, generic_serif_advances,
    generic_serif_pair_adjustments,
};
use super::LoadedEpubDocument;

mod layout_profile;
mod sources;

#[cfg(test)]
pub(crate) use sources::{
    font_face_source_cache_metrics, reset_font_face_source_cache_metrics,
    FontFaceSourceCacheMetrics,
};
pub(crate) use sources::{resolve_font_face_sources, ResolvedFontFaceSource};

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

#[derive(Clone, Copy)]
enum PublicationFontMetadata {
    None,
    Families,
    Catalog,
}

struct SelectedPublicationFonts<'a> {
    faces: Vec<TextMeasurementFontFace<'a>>,
    families: BTreeSet<String>,
    catalog: Vec<ShapeablePublicationFontFace>,
}

pub(crate) fn text_measurement_font_assembly_for_layout<'a>(
    document: &'a LoadedEpubDocument,
    layout_config: &LayoutConfig,
    cache: Option<TextMeasurementCache>,
    pinned_faces: Vec<TextMeasurementFontFace<'a>>,
) -> TextMeasurementFontAssembly<'a> {
    match layout_config.text_measurement {
        TextMeasurementMode::FixtureCompatible => empty_font_assembly(),
        TextMeasurementMode::FontAware => {
            let sources = resolve_font_face_sources(document);
            text_measurement_font_assembly_with_cache(
                document,
                &sources,
                layout_config,
                cache.unwrap_or_default(),
                pinned_faces,
                PublicationFontMetadata::Catalog,
            )
        }
    }
}

pub(crate) fn text_measurement_font_assembly_for_layout_with_sources<'a>(
    document: &'a LoadedEpubDocument,
    sources: &[ResolvedFontFaceSource],
    layout_config: &LayoutConfig,
    cache: TextMeasurementCache,
    pinned_faces: Vec<TextMeasurementFontFace<'a>>,
) -> TextMeasurementFontAssembly<'a> {
    match layout_config.text_measurement {
        TextMeasurementMode::FixtureCompatible => empty_font_assembly(),
        TextMeasurementMode::FontAware => text_measurement_font_assembly_with_cache(
            document,
            sources,
            layout_config,
            cache,
            pinned_faces,
            PublicationFontMetadata::Catalog,
        ),
    }
}

pub(crate) fn text_measurement_fonts_for_layout_with_sources<'a>(
    document: &'a LoadedEpubDocument,
    sources: &[ResolvedFontFaceSource],
    layout_config: &LayoutConfig,
    cache: TextMeasurementCache,
    pinned_faces: Vec<TextMeasurementFontFace<'a>>,
) -> TextMeasurementFonts<'a> {
    match layout_config.text_measurement {
        TextMeasurementMode::FixtureCompatible => TextMeasurementFonts::empty(),
        TextMeasurementMode::FontAware => {
            text_measurement_font_assembly_with_cache(
                document,
                sources,
                layout_config,
                cache,
                pinned_faces,
                PublicationFontMetadata::None,
            )
            .fonts
        }
    }
}

pub(crate) fn shapeable_publication_families_for_layout_with_sources<'a>(
    document: &'a LoadedEpubDocument,
    sources: &[ResolvedFontFaceSource],
    layout_config: &LayoutConfig,
    pinned_faces: &[TextMeasurementFontFace<'a>],
) -> BTreeSet<String> {
    match layout_config.text_measurement {
        TextMeasurementMode::FixtureCompatible => BTreeSet::new(),
        TextMeasurementMode::FontAware => {
            select_publication_fonts(
                document,
                sources,
                pinned_faces,
                PublicationFontMetadata::Families,
            )
            .families
        }
    }
}

fn text_measurement_font_assembly_with_cache<'a>(
    document: &'a LoadedEpubDocument,
    sources: &[ResolvedFontFaceSource],
    layout_config: &LayoutConfig,
    cache: TextMeasurementCache,
    pinned_faces: Vec<TextMeasurementFontFace<'a>>,
    metadata: PublicationFontMetadata,
) -> TextMeasurementFontAssembly<'a> {
    let mut selected = select_publication_fonts(document, sources, &pinned_faces, metadata);
    selected.faces.extend(pinned_faces);
    TextMeasurementFontAssembly {
        fonts: TextMeasurementFonts::new_with_cache_and_vertical_metrics(
            selected.faces,
            cache,
            generic_serif_advances(layout_config),
            font_family_advances(layout_config),
            generic_serif_pair_adjustments(layout_config),
            font_family_pair_adjustments(layout_config),
            layout_config.font_vertical_metrics.clone(),
        ),
        shapeable_publication_families: selected.families,
        shapeable_publication_faces: selected.catalog,
    }
}

fn select_publication_fonts<'a>(
    document: &'a LoadedEpubDocument,
    sources: &[ResolvedFontFaceSource],
    pinned_faces: &[TextMeasurementFontFace<'a>],
    metadata: PublicationFontMetadata,
) -> SelectedPublicationFonts<'a> {
    let pinned_active = !pinned_faces.is_empty();
    let pinned_aliases = pinned_faces
        .iter()
        .map(|face| normalize_family_name(&face.family))
        .collect::<BTreeSet<_>>();
    let mut faces = Vec::new();
    let mut families = BTreeSet::new();
    let mut catalog = Vec::new();
    for source in sources {
        let Some((resource, face, family)) =
            selectable_publication_face(document, source, pinned_active, &pinned_aliases)
        else {
            continue;
        };
        if face.is_shapeable() {
            if matches!(
                metadata,
                PublicationFontMetadata::Families | PublicationFontMetadata::Catalog
            ) {
                families.insert(family);
            }
            if pinned_active && matches!(metadata, PublicationFontMetadata::Catalog) {
                catalog.push(shapeable_catalog_face(source, resource, &face));
            }
        } else if pinned_active {
            continue;
        }
        faces.push(face);
    }
    SelectedPublicationFonts {
        faces,
        families,
        catalog,
    }
}

fn selectable_publication_face<'a>(
    document: &'a LoadedEpubDocument,
    source: &ResolvedFontFaceSource,
    pinned_active: bool,
    pinned_aliases: &BTreeSet<String>,
) -> Option<(
    &'a crate::epub::LoadedBinaryResource,
    TextMeasurementFontFace<'a>,
    String,
)> {
    let resource = document.fonts.get(source.resource_index)?;
    let face = source.measurement_face(resource);
    let family = normalize_family_name(&face.family);
    if pinned_active && (pinned_aliases.contains(&family) || !face.is_static_shapeable()) {
        return None;
    }
    Some((resource, face, family))
}

fn shapeable_catalog_face(
    source: &ResolvedFontFaceSource,
    resource: &crate::epub::LoadedBinaryResource,
    face: &TextMeasurementFontFace<'_>,
) -> ShapeablePublicationFontFace {
    ShapeablePublicationFontFace {
        family: face.family.clone(),
        href: resource.href.clone(),
        style: face.normalized_style().to_owned(),
        weight: face.normalized_weight(),
        shape_fingerprint: source.catalog_fingerprint(&resource.bytes),
        byte_length: resource.bytes.len(),
        source_order: source.source_order,
    }
}

fn empty_font_assembly<'a>() -> TextMeasurementFontAssembly<'a> {
    TextMeasurementFontAssembly {
        fonts: TextMeasurementFonts::empty(),
        shapeable_publication_families: BTreeSet::new(),
        shapeable_publication_faces: Vec::new(),
    }
}

fn normalize_family_name(family: &str) -> String {
    family.trim().to_ascii_lowercase()
}
