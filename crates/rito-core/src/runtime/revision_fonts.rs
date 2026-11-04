use crate::epub::{
    publication_font_face_catalog, resolve_font_face_sources, ResolvedFontFaceSource,
};

use super::{RuntimeDocument, RuntimeRequiredFontFace};

impl RuntimeDocument {
    /// The faces a revision asks the host to register for paint: every
    /// publication `@font-face` binding and every pinned face, each under
    /// the alias paint names it by. `None` without a pinned font policy,
    /// where there is no fragment engine to paint.
    pub(super) fn required_font_face_catalog(&self) -> Option<Vec<RuntimeRequiredFontFace>> {
        (!self.pinned_font_policy.is_empty()).then(|| {
            let mut faces: Vec<_> =
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
                        features: Vec::new(),
                    })
                    .collect();
            let first_host_order = faces
                .iter()
                .map(|face| face.source_order + 1)
                .max()
                .unwrap_or_default();
            faces.extend(self.pinned_font_policy.required_faces(first_host_order));
            // Every face also paints in its vertical forms and in the
            // narrower forms a combined upright string compresses into; an
            // artifact lists a variant only where its display list draws
            // with it.
            let mut variants: Vec<_> = faces
                .iter()
                .map(|face| RuntimeRequiredFontFace {
                    family: crate::fragment_paint::vertical_forms_family(&face.family),
                    features: vec![("vert".to_owned(), 1)],
                    ..face.clone()
                })
                .collect();
            for forms in [
                rito_fragment::CombinedForms::Half,
                rito_fragment::CombinedForms::Third,
                rito_fragment::CombinedForms::Quarter,
            ] {
                let feature = forms.feature().unwrap_or_default();
                variants.extend(faces.iter().map(|face| RuntimeRequiredFontFace {
                    family: crate::fragment_paint::combined_forms_family(forms, &face.family),
                    features: vec![(feature.to_owned(), 1)],
                    ..face.clone()
                }));
            }
            faces.extend(variants);
            faces
        })
    }

    pub(super) fn resolved_font_face_sources(&self) -> &[ResolvedFontFaceSource] {
        self.font_face_sources
            .get_or_init(|| resolve_font_face_sources(&self.document))
    }
}
