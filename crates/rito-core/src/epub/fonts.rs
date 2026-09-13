use super::LoadedEpubDocument;

mod face;
mod sources;

pub(crate) use face::parse_font_family_list;
pub(crate) use sources::{resolve_font_face_sources, ResolvedFontFaceSource};

/// One publication `@font-face` binding as the required-face catalog
/// reports it to the host: the declared family with normalized descriptors,
/// the bound resource, and the fingerprint the host verifies the bytes by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PublicationCatalogFace {
    pub(crate) family: String,
    pub(crate) href: String,
    pub(crate) style: String,
    pub(crate) weight: u16,
    pub(crate) shape_fingerprint: String,
    pub(crate) byte_length: usize,
    pub(crate) source_order: usize,
}

/// Every `@font-face` bound face in the publication. The fragment engine
/// registers them all with its own shaper, so the paint side must register
/// them all with the canvas.
pub(crate) fn publication_font_face_catalog(
    document: &LoadedEpubDocument,
    sources: &[ResolvedFontFaceSource],
) -> Vec<PublicationCatalogFace> {
    sources
        .iter()
        .filter_map(|source| {
            let resource = document.fonts.get(source.resource_index())?;
            Some(PublicationCatalogFace {
                family: source.family.clone(),
                href: resource.href.clone(),
                style: face::normalized_font_style(source.style.as_deref()).to_owned(),
                weight: face::normalized_font_weight(source.weight),
                shape_fingerprint: source.catalog_fingerprint(&resource.bytes),
                byte_length: resource.bytes.len(),
                source_order: source.source_order,
            })
        })
        .collect()
}
