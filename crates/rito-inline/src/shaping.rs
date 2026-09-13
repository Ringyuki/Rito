//! Font coverage and the shaper's advance domain: which stack face covers
//! a character, the `.notdef` advance, and the 16.16 fixed-point cluster
//! advance the browser's pen steps by.

use crate::*;

/// Whether any face the style's stack (or the registered fallback order)
/// resolves covers `character`. A character nothing covers shapes to a
/// face's `.notdef` advance, while the browser paints it with a system
/// fallback font the engine does not hold — the gate for the host
/// advance probe.
pub(crate) fn stack_covers_character(
    fonts: &mut FontContext,
    registered_families: &[String],
    style: &InlineFormattingStyle,
    character: char,
) -> bool {
    use parley::fontique::{FontStyle, FontWeight, FontWidth, SourceKind};
    use skrifa::MetadataProvider as _;
    let weight = FontWeight::new(style.font.weight.get());
    let stack = style
        .font
        .families
        .as_slice()
        .iter()
        .filter_map(|family| match family {
            rito_style_contract::FontFamily::Named(name) => Some(name.as_str()),
            rito_style_contract::FontFamily::Generic(_) => None,
        });
    for name in stack.chain(registered_families.iter().map(String::as_str)) {
        let Some(family) = fonts.collection.family_by_name(name) else {
            continue;
        };
        let Some(font) = family.match_font(FontWidth::NORMAL, FontStyle::Normal, weight, true)
        else {
            continue;
        };
        let SourceKind::Memory(blob) = font.source().kind() else {
            continue;
        };
        let Ok(font_ref) = skrifa::FontRef::from_index(blob.as_ref(), font.index()) else {
            continue;
        };
        if font_ref.charmap().map(character).is_some() {
            return true;
        }
    }
    false
}

/// The `.notdef` advance, in px at `size`, of the first face the style's
/// stack resolves — the advance shaping gives a character nothing covers
/// (measured: b12's U+2764 shaped to 1593/2048 em, the pinned latin
/// face's glyph 0).
pub(crate) fn stack_notdef_advance_px(
    fonts: &mut FontContext,
    registered_families: &[String],
    style: &InlineFormattingStyle,
    size: f32,
) -> Option<f64> {
    use parley::fontique::{FontStyle, FontWeight, FontWidth, SourceKind};
    use skrifa::MetadataProvider as _;
    let weight = FontWeight::new(style.font.weight.get());
    let stack = style
        .font
        .families
        .as_slice()
        .iter()
        .filter_map(|family| match family {
            rito_style_contract::FontFamily::Named(name) => Some(name.as_str()),
            rito_style_contract::FontFamily::Generic(_) => None,
        });
    for name in stack.chain(registered_families.iter().map(String::as_str)) {
        let Some(family) = fonts.collection.family_by_name(name) else {
            continue;
        };
        let Some(font) = family.match_font(FontWidth::NORMAL, FontStyle::Normal, weight, true)
        else {
            continue;
        };
        let SourceKind::Memory(blob) = font.source().kind() else {
            continue;
        };
        let Ok(font_ref) = skrifa::FontRef::from_index(blob.as_ref(), font.index()) else {
            continue;
        };
        let advance = font_ref
            .glyph_metrics(
                skrifa::instance::Size::new(size),
                skrifa::instance::LocationRef::default(),
            )
            .advance_width(skrifa::GlyphId::new(0));
        return advance.map(f64::from);
    }
    None
}

/// The paragraph's CSS strut height: its specified line-height in px, or
/// `None` for `normal` (where the content envelope wins). Inherited, so
/// the first item's style carries the paragraph value.
/// Maps the computed `text-align` onto Parley's line alignment. The
/// Servo-internal `-moz-*` values behave as their physical counterparts.
/// One cluster's advance in the browser's 16.16 fixed-point pen domain:
/// scale = round(size * 65536), px = trunc(units * scale / upem) / 65536,
/// with author letter-spacing added OUTSIDE the fixed-point round trip
/// (it was folded into the cluster advance after shaping).
pub(crate) fn hb_fixed_cluster_advance<B: parley::style::Brush>(
    current: &parley::layout::Cluster<'_, B>,
    run_letter_spacing: f64,
) -> f64 {
    use skrifa::raw::TableProvider as _;
    let advance = f64::from(current.advance());
    let run = current.run();
    let font = run.font();
    let Ok(font_ref) = skrifa::FontRef::from_index(font.data.as_ref(), font.index) else {
        return advance;
    };
    let Ok(head) = font_ref.head() else {
        return advance;
    };
    let upem = i64::from(head.units_per_em());
    let size = f64::from(run.font_size());
    if upem <= 0 || size <= 0.0 {
        return advance;
    }
    let scale = (size * 65536.0).round() as i64;
    let bare = advance - run_letter_spacing;
    let units = (bare * upem as f64 / size).round() as i64;
    (units * scale / upem) as f64 / 65536.0 + run_letter_spacing
}
