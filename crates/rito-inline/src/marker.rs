//! Outside list markers: the disc geometry and the marker font metrics
//! the browser derives them from.

use crate::*;

/// Whether the font the style resolves for `character` carries the
/// OpenType `halt` feature. Resolution mirrors CSS font matching: the
/// first stack family whose matched face covers the character wins, and
/// the registered families (the engine's installed fallback order) stand
/// in for script fallback. An unresolvable character trims nothing.
/// Disc geometry for a `display: list-item` inline flow, if its layout
/// style asks for one: `(diameter, flow-relative left edge, vertical
/// center rise above the first baseline)`.
///
/// Measured against pinned Chromium (marker probes, 2026-07-28, two faces
/// × four sizes): diameter = ascent / 3 of the item's primary face (the
/// first face its family stack resolves for a Latin sample — the same
/// face Blink's marker uses), the disc's right edge sits Chromium's 7px
/// marker padding before the content edge, and its vertical center rides
/// half the x-height above the baseline. Only the plain filled disc is
/// modeled; other marker styles keep the documented plain-block
/// degradation.
pub(crate) fn list_marker_geometry(
    fonts: &mut FontContext,
    registered_families: &[String],
    tree: &FormattingTree,
    node: FormattingNodeId,
) -> Option<(f64, f64, f64)> {
    let styles = tree.styles()?;
    let layout_style = styles.layout.style(tree.node(node).style).ok()?;
    if !layout_style.display.is_list_item
        || layout_style.list_style_type != rito_style_contract::ListMarkerStyle::Disc
    {
        return None;
    }
    let FormattingNodeContent::InlineFlow { items } = &tree.node(node).content else {
        return None;
    };
    let style_id = match tree.strut_style(node) {
        Some(style) => style,
        None => match items.first() {
            Some(InlineItem::Text { style, .. })
            | Some(InlineItem::Image { style, .. })
            | Some(InlineItem::InlineBlock { style, .. })
            | Some(InlineItem::EmptyBox { style, .. }) => *style,
            None => return None,
        },
    };
    let style = styles.inline.style(style_id).ok()?;
    let size = f64::from(style.font.size.get());
    let (ascent, x_height) = resolved_marker_font_metrics(fonts, registered_families, style)
        .unwrap_or((size * 0.9, size * 0.5));
    let diameter = ascent / 3.0;
    // Pixel-measured: the disc's RIGHT edge sits one diameter plus the 7px
    // marker padding before the content edge (left = content − 7 − 2d).
    Some((diameter, -(7.0 + 2.0 * diameter), x_height / 2.0))
}

/// Ascent and x-height (CSS px at the style's size) of the first face the
/// style's family stack resolves for a Latin sample — the face a browser
/// marker inherits.
pub(crate) fn resolved_marker_font_metrics(
    fonts: &mut FontContext,
    registered_families: &[String],
    style: &InlineFormattingStyle,
) -> Option<(f64, f64)> {
    use parley::fontique::{FontStyle, FontWeight, FontWidth, SourceKind};
    use skrifa::MetadataProvider as _;
    let weight = FontWeight::new(style.font.weight.get());
    let size = style.font.size.get();
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
        if font_ref.charmap().map('x').is_none() {
            continue;
        }
        let metrics = font_ref.metrics(
            skrifa::instance::Size::new(size),
            skrifa::instance::LocationRef::default(),
        );
        let x_height = metrics
            .x_height
            .map(f64::from)
            .unwrap_or(f64::from(size) * 0.5);
        return Some((f64::from(metrics.ascent), x_height));
    }
    None
}
