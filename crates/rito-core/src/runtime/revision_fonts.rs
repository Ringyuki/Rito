use std::collections::BTreeSet;

use crate::epub::{
    parse_font_family_list, publication_font_face_catalog, resolve_font_face_sources,
    ResolvedFontFaceSource,
};

use super::{
    RuntimeDocument, RuntimeRequiredFontFace, RuntimeRequiredFontFaces,
    RUNTIME_REQUIRED_FONT_FACES_SCHEMA_VERSION,
};

impl RuntimeDocument {
    /// The publication faces a revision asks the host to register: every
    /// `@font-face` binding, because the fragment engine shapes with them
    /// all. `None` without a pinned font policy, where the host does not
    /// paint from the engine's faces.
    pub(super) fn required_font_face_catalog(&self) -> Option<Vec<RuntimeRequiredFontFace>> {
        (!self.pinned_font_policy.is_empty()).then(|| {
            publication_font_face_catalog(&self.document, self.resolved_font_face_sources())
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

    pub(super) fn resolved_font_face_sources(&self) -> &[ResolvedFontFaceSource] {
        self.font_face_sources
            .get_or_init(|| resolve_font_face_sources(&self.document))
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
