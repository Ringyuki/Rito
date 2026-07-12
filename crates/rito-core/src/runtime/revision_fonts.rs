use std::collections::BTreeSet;

use crate::{
    epub::{text_measurement_font_assembly_for_layout, ShapeablePublicationFontFace},
    layout::{parse_font_family_list, LayoutConfig},
};

use super::{
    RuntimeDocument, RuntimeRequiredFontFace, RuntimeRequiredFontFaces,
    RUNTIME_REQUIRED_FONT_FACES_SCHEMA_VERSION,
};

impl RuntimeDocument {
    pub(super) fn required_font_face_catalog_for_layout(
        &self,
        layout_config: &LayoutConfig,
    ) -> Option<Vec<RuntimeRequiredFontFace>> {
        if self.pinned_font_policy.is_empty() {
            return None;
        }
        let pinned_faces = self
            .pinned_font_policy
            .measurement_faces_for_layout(layout_config);
        let assembly = text_measurement_font_assembly_for_layout(
            &self.document,
            layout_config,
            Some(self.text_measurement_cache.clone()),
            pinned_faces,
        );
        self.required_font_face_catalog_from_faces(assembly.shapeable_publication_faces)
    }

    pub(super) fn required_font_face_catalog_from_faces(
        &self,
        faces: Vec<ShapeablePublicationFontFace>,
    ) -> Option<Vec<RuntimeRequiredFontFace>> {
        (!self.pinned_font_policy.is_empty()).then(|| {
            faces
                .into_iter()
                .map(|face| RuntimeRequiredFontFace {
                    family: face.family,
                    href: face.href,
                    style: face.style,
                    weight: face.weight,
                    shape_fingerprint: face.shape_fingerprint,
                    byte_length: face.byte_length,
                    source_order: face.source_order,
                })
                .collect()
        })
    }
}

pub(super) fn required_font_faces_for_revision(
    revision_id: &str,
    catalog: &[RuntimeRequiredFontFace],
    layout_font_families: &[String],
) -> RuntimeRequiredFontFaces {
    let used = layout_font_families
        .iter()
        .flat_map(|family| parse_font_family_list(family))
        .map(|family| family.trim().to_ascii_lowercase())
        .collect::<BTreeSet<_>>();
    RuntimeRequiredFontFaces {
        schema_version: RUNTIME_REQUIRED_FONT_FACES_SCHEMA_VERSION,
        revision_id: revision_id.to_owned(),
        faces: catalog
            .iter()
            .filter(|face| used.contains(&face.family.trim().to_ascii_lowercase()))
            .cloned()
            .collect(),
    }
}
