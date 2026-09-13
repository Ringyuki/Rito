//! Block-box decoration. Resolves one style's paintable background, borders
//! (with Blink's inset/outset shading and ridge/groove two-tone halves),
//! corner radii, box shadows and transform into the block paint the
//! lowering consumes, together with the border widths the layout style
//! must absorb as padding and the degradations charged on the way.

use super::NodePaint;
use crate::render::contract::{
    ReaderBackgroundPaint, ReaderBackgroundPosition, ReaderBlockBorder, ReaderBlockPaint,
    ReaderBlockRadius, ReaderBorderBox, ReaderBorderEdgePaint, ReaderBorderStyle, ReaderBoxShadow,
    ReaderColor, ReaderLength, ReaderTransform,
};

/// Paint the fragment display-command producer cannot reproduce on a box
/// yet. Borders are checked here for block boxes; inline boxes reject
/// them earlier in their own whitelist.
/// Resolves one block box's paintable decoration, or names the first
/// thing the fragment painter cannot reproduce. `Ok(None)` is an
/// undecorated box; `Ok(Some((paint, widths)))` carries the `paintBlock`
/// payload and the four border widths (top, right, bottom, left) the
/// layout style must absorb as padding so the fragment rect becomes the
/// CSS border box.
pub(super) fn block_box_paint(
    style: &rito_style_contract::InlineFormattingStyle,
) -> (Option<(NodePaint, [f64; 4])>, Vec<String>) {
    use rito_style_contract as c;
    let mut degradations = Vec::new();
    let mut box_shadows = Vec::new();
    for shadow in style.paint.box_shadows.iter() {
        let Ok(color) = crate::style::paint_color(shadow.color.resolve(style.paint.foreground))
        else {
            degradations.push("box-shadow color unresolvable, shadow skipped".to_owned());
            continue;
        };
        box_shadows.push(ReaderBoxShadow {
            offset_x: f64::from(shadow.offset_x.get()),
            offset_y: f64::from(shadow.offset_y.get()),
            blur: f64::from(shadow.blur_radius.get()),
            spread: f64::from(shadow.spread_radius.get()),
            color,
            inset: shadow.inset,
        });
    }
    let background = match style.paint.background {
        c::ComputedColor::Absolute(color) if color.alpha().get() == 0.0 => None,
        c::ComputedColor::Absolute(color) => crate::style::paint_color(color).ok(),
        c::ComputedColor::CurrentColor => crate::style::paint_color(style.paint.foreground).ok(),
    };
    let mut widths = [0.0; 4];
    let mut border = ReaderBlockBorder::default();
    let mut has_border = false;
    let mut bevels = Vec::new();
    for (index, (edge, name)) in [
        (&style.fragment.border.top, "top"),
        (&style.fragment.border.right, "right"),
        (&style.fragment.border.bottom, "bottom"),
        (&style.fragment.border.left, "left"),
    ]
    .into_iter()
    .enumerate()
    {
        let width = f64::from(edge.resolved_width.get());
        if width <= 0.0 || matches!(edge.style, c::BorderStyle::None | c::BorderStyle::Hidden) {
            continue;
        }
        let Ok(color) = crate::style::paint_color(edge.color.resolve(style.paint.foreground))
        else {
            degradations.push(format!("border-{name} color unresolvable, edge skipped"));
            continue;
        };
        let mut color = color;
        let stroke = match edge.style {
            c::BorderStyle::Solid => ReaderBorderStyle::Solid,
            c::BorderStyle::Dashed => ReaderBorderStyle::Dashed,
            c::BorderStyle::Dotted => ReaderBorderStyle::Dotted,
            c::BorderStyle::Double => ReaderBorderStyle::Double,
            c::BorderStyle::Ridge | c::BorderStyle::Groove
                if two_tone_halves(color, edge.style, index).is_some() =>
            {
                let (outer, inner) =
                    two_tone_halves(color, edge.style, index).expect("guard checked");
                color = outer;
                bevels.push((index, inner));
                ReaderBorderStyle::Solid
            }
            c::BorderStyle::Inset | c::BorderStyle::Outset => {
                // Blink's legacy 3D shading (probed matrix, 2026-08-20):
                // the darkened sides (top/left for inset, bottom/right
                // for outset) use Color::Dark() — channels scaled by
                // (V − 0.33)/V — while the lighter sides keep the base
                // color, lightening it only when it lacks 1.75:1
                // contrast against its own dark shade. A currentColor
                // border ignores the text color and shades from #EEEEEE
                // (gray hr rules paint 154/238, red currentColor ones
                // identically).
                let base = if matches!(edge.color, c::ComputedColor::CurrentColor) {
                    ReaderColor::srgb8(0xee, 0xee, 0xee, 1.0)
                } else {
                    color
                };
                let darken = matches!(index, 0 | 3) == matches!(edge.style, c::BorderStyle::Inset);
                color = inset_outset_shade(base, darken).unwrap_or(base);
                ReaderBorderStyle::Solid
            }
            other => {
                degradations.push(format!("border-{name} style {other:?} drawn solid"));
                ReaderBorderStyle::Solid
            }
        };
        widths[index] = width;
        has_border = true;
        let paint = ReaderBorderEdgePaint {
            color,
            style: stroke,
        };
        match index {
            0 => border.top = Some(paint),
            1 => border.right = Some(paint),
            2 => border.bottom = Some(paint),
            _ => border.left = Some(paint),
        }
    }
    // The lowering requires all four widths whenever a border box is
    // present, zero-filled for unpainted edges.
    let border_box = has_border.then(|| ReaderBorderBox {
        top_width: widths[0],
        right_width: widths[1],
        bottom_width: widths[2],
        left_width: widths[3],
    });
    // The background-image cluster travels exactly as the lowering
    // consumes it: cover/contain, tiling and percentage positioning
    // resolve there.
    let background_image = style.paint.background_image.as_ref().and_then(|image| {
        let href = match crate::style::background_publication_href(image.url.as_str()) {
            Ok(href) => href.to_owned(),
            Err(error) => {
                degradations.push(format!("background-image dropped: {error:?}"));
                return None;
            }
        };
        let position_axis = |axis| crate::style::background_position_axis(axis).ok();
        let (x, y) = (
            position_axis(image.position.x),
            position_axis(image.position.y),
        );
        if x.is_none() || y.is_none() {
            degradations.push("background-position calc() treated as 0".to_owned());
        }
        Some((
            href,
            crate::style::background_size(image.size),
            crate::style::background_repeat(image.repeat),
            ReaderBackgroundPosition {
                x: x.unwrap_or(ReaderLength::Percent(0.0)),
                y: y.unwrap_or(ReaderLength::Percent(0.0)),
            },
        ))
    });
    // Corner radii round the background, the border stroke, and the clip
    // the box paints inside. A uniform box rides the single radius;
    // corners that disagree ship as four circular radii in CSS order (a
    // chat bubble rounds one edge only: 0 20px 20px 0), taking each
    // corner's horizontal length. Elliptical or percentage corners
    // inside a non-uniform set flatten to that length and say so.
    let radii = style.fragment.border_radii;
    let corners = [
        radii.top_left,
        radii.top_right,
        radii.bottom_right,
        radii.bottom_left,
    ];
    let uniform = corners
        .iter()
        .all(|corner| *corner == radii.top_left && corner.horizontal == corner.vertical);
    let radius = if uniform {
        match radii.top_left.horizontal.value() {
            c::LengthPercentage::Length(px) if px.get() > 0.0 => {
                Some(ReaderBlockRadius::Px(f64::from(px.get())))
            }
            c::LengthPercentage::Percentage(ratio) if ratio.percent() > 0.0 => {
                Some(ReaderBlockRadius::Percent(f64::from(ratio.percent())))
            }
            c::LengthPercentage::Linear { length, .. } => {
                degradations.push("calc() border-radius: percentage component dropped".to_owned());
                Some(ReaderBlockRadius::Px(f64::from(length.get())))
            }
            _ => None,
        }
    } else {
        let mut lossy = false;
        let mut px_corners = [0.0_f64; 4];
        for (slot, corner) in px_corners.iter_mut().zip(&corners) {
            if corner.horizontal != corner.vertical {
                lossy = true;
            }
            *slot = match corner.horizontal.value() {
                c::LengthPercentage::Length(px) => f64::from(px.get()),
                c::LengthPercentage::Percentage(_) => {
                    lossy = true;
                    0.0
                }
                c::LengthPercentage::Linear { length, .. } => {
                    lossy = true;
                    f64::from(length.get())
                }
            };
        }
        if lossy {
            degradations.push(
                "border-radius: elliptical or percentage corner flattened to its length".to_owned(),
            );
        }
        (px_corners.iter().any(|px| *px > 0.0)).then_some(ReaderBlockRadius::Corners(px_corners))
    };
    let transform = (!style.paint.transform.is_none()).then(|| {
        style
            .paint
            .transform
            .as_slice()
            .iter()
            .map(|operation| match operation {
                c::TransformOperation::Rotate { radians } => ReaderTransform::Rotate {
                    radians: f64::from(radians.get()),
                },
            })
            .collect::<Vec<_>>()
    });
    if background.is_none()
        && background_image.is_none()
        && !has_border
        && transform.is_none()
        && box_shadows.is_empty()
    {
        return (None, degradations);
    }
    let background = (background.is_some() || background_image.is_some()).then(|| {
        let (image, size, repeat, position) = match background_image {
            Some((href, size, repeat, position)) => {
                (Some(href), Some(size), Some(repeat), Some(position))
            }
            None => (None, None, None, None),
        };
        ReaderBackgroundPaint {
            color: background,
            image,
            size,
            repeat,
            position,
        }
    });
    let paint = ReaderBlockPaint {
        background,
        border: has_border.then_some(border),
        radius,
        box_shadows,
    };
    (
        Some((
            NodePaint::Box {
                paint,
                border_box,
                transform,
                bevels,
                segment_horizontal_edges: false,
            },
            widths,
        )),
        degradations,
    )
}

/// Blink's inset/outset side shade: `Dark()` for the shadowed sides,
/// the base color for the lit sides unless it lacks 1.75:1 contrast
/// against its own dark shade (then `Light()`: channels scaled by
/// min(1, V + 0.33)/V, black lightening to #545454). Returns `None`
/// for a translucent colour (it stays base).
fn inset_outset_shade(base: ReaderColor, darken: bool) -> Option<ReaderColor> {
    let channels = base.opaque_srgb8()?;
    let value = f64::from(*channels.iter().max().expect("three channels")) / 255.0;
    let dark_scale = if value > 0.0 {
        ((value - 0.33) / value).max(0.0)
    } else {
        0.0
    };
    let dark = channels.map(|component| (f64::from(component) * dark_scale).round() as u8);
    let color = |[red, green, blue]: [u8; 3]| ReaderColor::srgb8(red, green, blue, 1.0);
    if darken {
        return Some(color(dark));
    }
    let linear = |component: u8| {
        let srgb = f64::from(component) / 255.0;
        if srgb <= 0.03928 {
            srgb / 12.92
        } else {
            ((srgb + 0.055) / 1.055).powf(2.4)
        }
    };
    let luminance = |parts: [u8; 3]| {
        0.2126 * linear(parts[0]) + 0.7152 * linear(parts[1]) + 0.0722 * linear(parts[2])
    };
    let (base_luminance, dark_luminance) = (luminance(channels), luminance(dark));
    let (high, low) = if base_luminance >= dark_luminance {
        (base_luminance, dark_luminance)
    } else {
        (dark_luminance, base_luminance)
    };
    if (high + 0.05) / (low + 0.05) >= 1.75 {
        return Some(color(channels));
    }
    if value == 0.0 {
        return Some(ReaderColor::srgb8(0x54, 0x54, 0x54, 1.0));
    }
    let light_scale = (value + 0.33).min(1.0) / value;
    Some(color(channels.map(|component| {
        (f64::from(component) * light_scale).round().min(255.0) as u8
    })))
}

/// Splits a ridge/groove edge into its two measured Blink tones: one half
/// keeps the border color, the other is Blink's `Color::Dark()` — every
/// channel scaled by `(V - 0.33) / V` where `V` is the largest channel
/// (steelblue `#4682b4` darkens to `#254560`, `#cc2200` to `#781400`,
/// both probed channel-exact). Ridge raises the box: top/left edges keep
/// the base tone outside and darken inside; bottom/right mirror. Groove
/// is ridge inverted. Returns `(outer, inner)` in border-box edge order,
/// or `None` for a translucent border, which degrades to solid instead.
fn two_tone_halves(
    base: ReaderColor,
    style: rito_style_contract::BorderStyle,
    edge_index: usize,
) -> Option<(ReaderColor, ReaderColor)> {
    use rito_style_contract::BorderStyle;
    let channels = base.opaque_srgb8()?;
    let value = f64::from(*channels.iter().max().expect("three channels")) / 255.0;
    let scale = if value > 0.0 {
        ((value - 0.33) / value).max(0.0)
    } else {
        0.0
    };
    let [red, green, blue] = channels.map(|component| (f64::from(component) * scale).round() as u8);
    let dark = ReaderColor::srgb8(red, green, blue, 1.0);
    // Edge indices: 0 top, 1 right, 2 bottom, 3 left.
    let raised_outside = matches!(edge_index, 0 | 3) == matches!(style, BorderStyle::Ridge);
    Some(if raised_outside {
        (base, dark)
    } else {
        (dark, base)
    })
}
