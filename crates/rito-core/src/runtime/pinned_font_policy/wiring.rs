use crate::{
    layout::{LayoutConfig, TextMeasurementFontFace, TextMeasurementMode},
    style::{FontFallbackFace, FontFallbackPolicy, FontGenericRole},
};

use super::{
    RuntimePinnedFontGenericRole, RuntimePinnedFontPolicy, PINNED_FONT_STYLE, PINNED_FONT_WEIGHT,
};

impl RuntimePinnedFontPolicy {
    pub(crate) fn measurement_faces_for_layout(
        &self,
        layout_config: &LayoutConfig,
    ) -> Vec<TextMeasurementFontFace<'_>> {
        if !self.is_layout_active(layout_config) {
            return Vec::new();
        }
        // Regional face aliases are the browser-visible locale contract in V1.
        // Do not set a rustybuzz run language until Canvas can mirror that
        // choice for the same painted run.
        self.faces
            .iter()
            .map(|face| {
                let mut fingerprint = [0_u8; 8];
                fingerprint.copy_from_slice(&face.sha256_bytes[..8]);
                TextMeasurementFontFace::new_with_fingerprint(
                    face.summary.family_alias.clone(),
                    Some(PINNED_FONT_STYLE.to_owned()),
                    Some(PINNED_FONT_WEIGHT),
                    &face.bytes,
                    fingerprint,
                )
            })
            .collect()
    }

    pub(crate) fn family_fallbacks_for_layout<'a>(
        &'a self,
        layout_config: &LayoutConfig,
        package_language: &'a str,
    ) -> Option<FontFallbackPolicy<'a>> {
        self.is_layout_active(layout_config)
            .then(|| FontFallbackPolicy {
                faces: self
                    .faces
                    .iter()
                    .map(|face| FontFallbackFace {
                        alias: &face.summary.family_alias,
                        role: style_role(face.summary.generic_role),
                        language: &face.summary.language,
                    })
                    .collect(),
                package_language,
            })
    }

    fn is_layout_active(&self, layout_config: &LayoutConfig) -> bool {
        !self.is_empty() && layout_config.text_measurement == TextMeasurementMode::FontAware
    }
}

fn style_role(role: RuntimePinnedFontGenericRole) -> FontGenericRole {
    match role {
        RuntimePinnedFontGenericRole::Serif => FontGenericRole::Serif,
        RuntimePinnedFontGenericRole::SansSerif => FontGenericRole::SansSerif,
        RuntimePinnedFontGenericRole::Monospace => FontGenericRole::Monospace,
    }
}
