use crate::layout::{LayoutConfig, TextMeasurementFontFace, TextMeasurementMode};
use std::collections::BTreeSet;

use super::LoadedEpubDocument;

mod sources;

pub(crate) use sources::{resolve_font_face_sources, ResolvedFontFaceSource};

/// The publication faces a pinned layout can shape, as the required-face
/// catalog reports them to the host.
pub(crate) struct TextMeasurementFontAssembly {
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
    pinned_faces: Vec<TextMeasurementFontFace<'a>>,
) -> TextMeasurementFontAssembly {
    match layout_config.text_measurement {
        TextMeasurementMode::FixtureCompatible => empty_font_assembly(),
        TextMeasurementMode::FontAware => {
            let sources = resolve_font_face_sources(document);
            text_measurement_font_assembly(document, &sources, pinned_faces)
        }
    }
}

pub(crate) fn text_measurement_font_assembly_for_layout_with_sources<'a>(
    document: &'a LoadedEpubDocument,
    sources: &[ResolvedFontFaceSource],
    layout_config: &LayoutConfig,
    pinned_faces: Vec<TextMeasurementFontFace<'a>>,
) -> TextMeasurementFontAssembly {
    match layout_config.text_measurement {
        TextMeasurementMode::FixtureCompatible => empty_font_assembly(),
        TextMeasurementMode::FontAware => {
            text_measurement_font_assembly(document, sources, pinned_faces)
        }
    }
}

fn text_measurement_font_assembly<'a>(
    document: &'a LoadedEpubDocument,
    sources: &[ResolvedFontFaceSource],
    pinned_faces: Vec<TextMeasurementFontFace<'a>>,
) -> TextMeasurementFontAssembly {
    TextMeasurementFontAssembly {
        shapeable_publication_faces: select_publication_fonts(document, sources, &pinned_faces),
    }
}

fn select_publication_fonts<'a>(
    document: &'a LoadedEpubDocument,
    sources: &[ResolvedFontFaceSource],
    pinned_faces: &[TextMeasurementFontFace<'a>],
) -> Vec<ShapeablePublicationFontFace> {
    let pinned_active = !pinned_faces.is_empty();
    if !pinned_active {
        return Vec::new();
    }
    let pinned_aliases = pinned_faces
        .iter()
        .map(|face| normalize_family_name(&face.family))
        .collect::<BTreeSet<_>>();
    sources
        .iter()
        .filter_map(|source| {
            let (resource, face) = selectable_publication_face(document, source, &pinned_aliases)?;
            face.is_shapeable()
                .then(|| shapeable_catalog_face(source, resource, &face))
        })
        .collect()
}

/// A publication face the pinned policy admits: not aliased by a pinned
/// face, and statically shapeable.
fn selectable_publication_face<'a>(
    document: &'a LoadedEpubDocument,
    source: &ResolvedFontFaceSource,
    pinned_aliases: &BTreeSet<String>,
) -> Option<(
    &'a crate::epub::LoadedBinaryResource,
    TextMeasurementFontFace<'a>,
)> {
    let resource = document.fonts.get(source.resource_index)?;
    let face = source.measurement_face(resource);
    let family = normalize_family_name(&face.family);
    if pinned_aliases.contains(&family) || !face.is_static_shapeable() {
        return None;
    }
    Some((resource, face))
}

/// Every `@font-face` bound face in the publication, regardless of host
/// measurement support — the fragment engine registers them all with its
/// own shaper, so the paint side must register them all with the canvas.
pub(crate) fn publication_font_face_catalog(
    document: &crate::epub::LoadedEpubDocument,
    sources: &[ResolvedFontFaceSource],
) -> Vec<ShapeablePublicationFontFace> {
    sources
        .iter()
        .filter_map(|source| {
            let resource = document.fonts.get(source.resource_index())?;
            let face = source.measurement_face(resource);
            Some(shapeable_catalog_face(source, resource, &face))
        })
        .collect()
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

fn empty_font_assembly() -> TextMeasurementFontAssembly {
    TextMeasurementFontAssembly {
        shapeable_publication_faces: Vec::new(),
    }
}

fn normalize_family_name(family: &str) -> String {
    family.trim().to_ascii_lowercase()
}
