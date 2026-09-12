use crate::{
    epub::PublicationFontFace,
    layout::{LayoutConfig, TextMeasurementMode},
};

use super::{RuntimePinnedFontPolicy, PINNED_FONT_STYLE, PINNED_FONT_WEIGHT};

impl RuntimePinnedFontPolicy {
    pub(crate) fn pinned_faces_for_layout(
        &self,
        layout_config: &LayoutConfig,
    ) -> Vec<PublicationFontFace<'_>> {
        if !self.is_layout_active(layout_config) {
            return Vec::new();
        }
        // Regional face aliases are the browser-visible locale contract in V1.
        // Do not set a rustybuzz run language until Canvas can mirror that
        // choice for the same painted run.
        self.faces
            .iter()
            .map(|face| {
                PublicationFontFace::new(
                    face.summary.family_alias.clone(),
                    Some(PINNED_FONT_STYLE.to_owned()),
                    Some(PINNED_FONT_WEIGHT),
                    &face.bytes,
                )
            })
            .collect()
    }

    fn is_layout_active(&self, layout_config: &LayoutConfig) -> bool {
        !self.is_empty() && layout_config.text_measurement == TextMeasurementMode::FontAware
    }
}
