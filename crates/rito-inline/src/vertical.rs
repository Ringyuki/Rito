//! How the clusters of a vertical line stand. Under `text-orientation:
//! mixed` a character whose Unicode vertical orientation is anything but
//! rotated stands upright and the rest lie sideways (Blink's
//! `Character::IsUprightInMixedVertical`); `upright` and `sideways` set
//! every character one way.
//!
//! A run's text box hangs from the line's central baseline by its primary
//! font's central ascent, and its text is drawn from the primary font's
//! alphabetic baseline, that font's ascent in from the box's line-over
//! edge. A sideways glyph sits on that baseline. An upright glyph centres
//! on the line its own font's central baseline makes there: its font's
//! ascent less half its height back across from the alphabetic baseline.
//! It hangs from its vertical origin: its horizontal origin half its
//! horizontal advance across from that centre and the face's vertical
//! origin down the line, from the VORG table, else the glyph's top plus its
//! `vmtx` top side bearing, else the face's ascent (Blink's
//! `OpenTypeVerticalData::GetVerticalTranslationsForGlyphs`). Chromium's
//! DOM column and a canvas drawing the glyphs there match pixel for pixel,
//! whichever font is primary.

use std::rc::Rc;

use icu_properties::props::VerticalOrientation;
use icu_properties::CodePointMapData;
use rito_fragment::{ClusterOrientation, ClusterPosition};
use rito_style_contract::{InlineFormattingStyle, TextOrientation};
use skrifa::instance::{LocationRef, Size};
use skrifa::raw::TableProvider as _;
use skrifa::MetadataProvider as _;

use crate::*;

/// An upright glyph's cache key: its face, its character and the size's
/// bits.
pub(crate) type UprightKey = (rito_fragment::FontFaceId, char, u64);

/// Where an upright glyph lies from its font's alphabetic baseline: its
/// centre line across, then half its advance and its vertical origin.
#[derive(Clone, Copy, Debug)]
pub(crate) struct UprightGlyph {
    center: f64,
    half_advance: f64,
    vertical_origin: f64,
}

impl ParleyInlineContext {
    /// How each of `clusters` stands in a vertical line laid out in
    /// `style`, `text` being the text their bytes index.
    pub(crate) fn cluster_orientations(
        &self,
        style: &InlineFormattingStyle,
        clusters: &[ClusterPosition],
        text: &str,
    ) -> Rc<[ClusterOrientation]> {
        let size = f64::from(style.font.size.get());
        // The primary font's alphabetic baseline, across from the run's
        // central baseline: its ascent less its central ascent.
        let (ascent, descent) = self
            .primary_face(style)
            .map_or((0.0, 0.0), |face| face.whole_pixel_extent(size));
        let baseline = ascent - LineBaseline::Central.split(ascent, descent).0;
        clusters
            .iter()
            .map(|cluster| {
                let character = text
                    .get(cluster.byte as usize..)
                    .and_then(|rest| rest.chars().next())
                    .unwrap_or(' ');
                if !stands_upright(style.bidi.text_orientation, character) {
                    return ClusterOrientation::Sideways { baseline };
                }
                let key = (cluster.face, character, size.to_bits());
                let glyph = *self
                    .upright_glyphs
                    .borrow_mut()
                    .entry(key)
                    .or_insert_with(|| {
                        self.catalog
                            .face_font(cluster.face)
                            .and_then(|face| face.upright_glyph(character, size))
                    });
                let glyph = glyph.unwrap_or(UprightGlyph {
                    center: (ascent - descent) / 2.0,
                    half_advance: size / 2.0,
                    vertical_origin: ascent,
                });
                ClusterOrientation::Upright {
                    center: baseline - glyph.center,
                    half_advance: glyph.half_advance,
                    vertical_origin: glyph.vertical_origin,
                }
            })
            .collect()
    }
}

/// Whether `character` stands upright in a vertical line of `orientation`.
fn stands_upright(orientation: TextOrientation, character: char) -> bool {
    match orientation {
        TextOrientation::Upright => true,
        TextOrientation::Sideways => false,
        TextOrientation::Mixed => {
            CodePointMapData::<VerticalOrientation>::new().get(character)
                != VerticalOrientation::Rotated
        }
    }
}

impl Face {
    /// The face's whole-pixel ascent and descent at `size`.
    fn whole_pixel_extent(&self, size: f64) -> (f64, f64) {
        let (ascent, descent, _) = self.rounded(size);
        (ascent, descent)
    }

    /// Where an upright glyph for `character` lies at `size`, from this
    /// face's alphabetic baseline.
    fn upright_glyph(&self, character: char, size: f64) -> Option<UprightGlyph> {
        let font = self.font_ref()?;
        let upem = f64::from(font.head().ok()?.units_per_em());
        if upem <= 0.0 {
            return None;
        }
        let scale = size / upem;
        let (ascent, descent) = self.whole_pixel_extent(size);
        let glyph = font.charmap().map(character)?;
        let metrics = font.glyph_metrics(Size::unscaled(), LocationRef::default());
        let half_advance = f64::from(metrics.advance_width(glyph)?) * scale / 2.0;
        let vertical_origin = if let Ok(vorg) = font.vorg() {
            f64::from(vorg.vertical_origin_y(glyph)) * scale
        } else if let (Ok(vmtx), Some(bounds)) = (font.vmtx(), metrics.bounds(glyph)) {
            (f64::from(bounds.y_max) + f64::from(vmtx.side_bearing(glyph)?)) * scale
        } else {
            ascent
        };
        Some(UprightGlyph {
            center: ascent - (ascent + descent) / 2.0,
            half_advance,
            vertical_origin,
        })
    }
}
