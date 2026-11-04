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
//!
//! A `text-combine-upright: all` item is one unit an em down the line
//! (Blink's `LayoutTextCombine`): a box as wide across the line as its
//! primary font's whole-pixel height, over the run's central baseline as
//! that font's text box is, in which the item's text sets as one
//! horizontal string centred across. A string wider than 1.1em takes the
//! face's half-, third- then quarter-width forms, the first that fits, and
//! failing those is scaled to 1.1em about its start, which then sits half
//! the box's spare width in. Its alphabetic baseline lies the font's
//! whole-pixel ascent less half its internal leading below the unit's top.
//! Measured against Chromium's DOM at 16, 17.3 and 18px, after none to
//! three ems of text: a canvas drawing the string there matches pixel for
//! pixel, in the face's own forms, its half-width forms and scaled.

use std::rc::Rc;

use icu_properties::props::{GeneralCategory, VerticalOrientation};
use icu_properties::CodePointMapData;
use rito_fragment::{ClusterOrientation, ClusterPosition, CombinedForms};
use rito_style_contract::{
    InlineFormattingStyle, TextCombineUpright, TextOrientation, WritingMode,
};
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

/// A combined upright unit's cache key: its text and font.
pub(crate) type CombinedKey = (String, rito_style_contract::FontStyle);

/// How a combined upright unit sets its string (see the module docs):
/// where the string starts across from the run's central baseline and
/// its baseline down from the unit's place, its forms and its scale.
#[derive(Clone, Copy, Debug)]
pub(crate) struct CombinedSetting {
    across: f64,
    down: f64,
    scale_x: f64,
    forms: CombinedForms,
}

/// Whether text in `style` sets as combined upright units: a vertical
/// line's `text-combine-upright: all` text.
pub(crate) fn combines_upright(style: &InlineFormattingStyle) -> bool {
    style.bidi.text_combine_upright == TextCombineUpright::All
        && style.bidi.writing_mode != WritingMode::HorizontalTopToBottom
}

/// Whether `character` in `style` shapes top to bottom: upright in a
/// vertical line and not part of a combined upright unit.
pub(crate) fn shapes_top_to_bottom(style: &InlineFormattingStyle, character: char) -> bool {
    style.bidi.writing_mode != WritingMode::HorizontalTopToBottom
        && !combines_upright(style)
        && stands_upright(style.bidi.text_orientation, character)
}

/// The advance a combined upright unit takes down the line: an em on the
/// 1/64 grid, rounded (`ComputedStyle::ComputedFontSizeAsFixed`).
pub(crate) fn combined_advance(style: &InlineFormattingStyle) -> f32 {
    (style.font.size.get() * 64.0).round() / 64.0
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
        if combines_upright(style) {
            // The fragment is one item's text, so one unit.
            let start = clusters.first().map_or(0, |cluster| cluster.byte as usize);
            let end = clusters.last().map_or(start, |last| {
                let last = last.byte as usize;
                text.get(last..)
                    .and_then(|rest| rest.chars().next())
                    .map_or(last, |character| last + character.len_utf8())
            });
            let setting = self.combined_setting(
                style,
                text.get(start..end).unwrap_or_default(),
                ascent,
                descent,
            );
            return (0..clusters.len())
                .map(|index| ClusterOrientation::Combined {
                    across: setting.across,
                    down: setting.down,
                    scale_x: setting.scale_x,
                    forms: setting.forms,
                    continues: index > 0,
                })
                .collect();
        }
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

    /// How the combined upright unit `text` in `style` sets its string,
    /// its primary font `ascent` and `descent` whole pixels (Blink's
    /// `InlineNode::AdjustFontForTextCombineUprightAll` and
    /// `LayoutTextCombine`).
    fn combined_setting(
        &self,
        style: &InlineFormattingStyle,
        text: &str,
        ascent: f64,
        descent: f64,
    ) -> CombinedSetting {
        let key = (text.to_owned(), style.font.clone());
        if let Some(setting) = self.combined_settings.borrow().get(&key) {
            return *setting;
        }
        // The unit lays its text out horizontally, unspaced.
        let mut horizontal = style.clone();
        horizontal.bidi.writing_mode = WritingMode::HorizontalTopToBottom;
        horizontal.bidi.text_combine_upright = TextCombineUpright::None;
        let width = |forms: CombinedForms| {
            self.shaped_run_with(&horizontal, None, false, forms.feature(), text)
                .advance as f32
        };
        let size = style.font.size.get();
        let desired = size * 1.1;
        let content = width(CombinedForms::Proportional);
        let (forms, used, scale_x) = if content == 0.0 || content <= desired {
            (CombinedForms::Proportional, content, None)
        } else {
            [
                CombinedForms::Half,
                CombinedForms::Third,
                CombinedForms::Quarter,
            ]
            .into_iter()
            .map(|forms| (forms, width(forms)))
            .find(|(_, used)| *used <= desired)
            .map_or(
                (
                    CombinedForms::Proportional,
                    content,
                    Some(desired / content),
                ),
                |(forms, used)| (forms, used, None),
            )
        };
        // The box is the font's whole-pixel height across; the string
        // centres in it on the 1/64 grid, or starts half its spare width
        // in once scaled.
        let height = ascent + descent;
        let (_, below) = LineBaseline::Central.split(ascent, descent);
        let inset = match scale_x {
            Some(_) => (height - f64::from(desired)) / 2.0,
            None => {
                let spare = (height * 64.0) as i64 - (f64::from(used) * 64.0).ceil() as i64;
                (spare / 2).max(0) as f64 / 64.0
            }
        };
        let leading = height - f64::from(shaping_font_size(size));
        let setting = CombinedSetting {
            across: below - inset,
            down: layout_unit_trunc(ascent - leading / 2.0),
            scale_x: scale_x.map_or(1.0, f64::from),
            forms,
        };
        self.combined_settings.borrow_mut().insert(key, setting);
        setting
    }
}

/// The stretches of `text` (offsets into it) that stand upright in a
/// vertical line of `orientation`: a grapheme-extending mark keeps the
/// stance of the character before it (Blink's `OrientationIterator`).
pub(crate) fn upright_ranges(
    orientation: TextOrientation,
    text: &str,
) -> Vec<std::ops::Range<usize>> {
    let extending = CodePointMapData::<GeneralCategory>::new();
    let mut ranges: Vec<std::ops::Range<usize>> = Vec::new();
    let mut upright = false;
    for (offset, character) in text.char_indices() {
        let mark = matches!(
            extending.get(character),
            GeneralCategory::NonspacingMark
                | GeneralCategory::EnclosingMark
                | GeneralCategory::SpacingMark
        );
        if offset == 0 || !mark {
            upright = stands_upright(orientation, character);
        }
        if !upright {
            continue;
        }
        let end = offset + character.len_utf8();
        match ranges.last_mut() {
            Some(range) if range.end == offset => range.end = end,
            _ => ranges.push(offset..end),
        }
    }
    ranges
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
