//! One inline image: the border layout absorbed as padding painted back
//! out as a block around the raster, the paint rect snapped to whole CSS
//! pixels (a folded SVG viewport keeps its fractional position),
//! `object-fit: contain` letterboxing for a box the author forced off the
//! raster ratio, the two-stage viewBox-then-raster letterbox with the
//! one-pixel clamp-bleed edge slices, and the image command carrying alt
//! text and the enclosing link.

use rito_fragment::{ImageFragment, InlineItem};

use std::collections::BTreeMap;

use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::{FlowItemSource, NodePaint};
use crate::render::{display_rect, DisplayCommand};

use super::snap_css;

#[allow(clippy::too_many_arguments)]
pub(super) fn append_image_command(
    commands: &mut Vec<DisplayCommand>,
    items: &[InlineItem],
    image: &ImageFragment,
    line_x: f64,
    line_y: f64,
    image_border_paints: Option<&BTreeMap<u32, (NodePaint, [f64; 4])>>,
    item_source: Option<&FlowItemSource>,
) -> EpubResult<()> {
    let Some(InlineItem::Image {
        src,
        source,
        intrinsic_width,
        intrinsic_height,
        fit_contain,
        viewport,
        object_fit,
        ..
    }) = items.get(image.item_index as usize)
    else {
        return Err(EpubError::new(format!(
            "image fragment item index {} does not name an image item",
            image.item_index
        )));
    };
    // The image's own border: layout absorbed the widths as padding (the
    // atom's advance spans the flanks, the raster sits inside), and the
    // stroke paints here through the same block-decoration channel a
    // bordered <div> uses — the border box is the raster rect expanded
    // back out by the absorbed widths (b60's cover: two 1px `none solid`
    // flank columns, 850px tall each, were the whole page account).
    if let Some((
        NodePaint::Box {
            paint, border_box, ..
        },
        widths,
    )) = image_border_paints.and_then(|paints| paints.get(source))
    {
        commands.push(DisplayCommand::PaintBlock {
            rect: display_rect(
                line_x + image.rect.x - widths[3],
                line_y + image.rect.y - widths[0],
                image.rect.width + widths[3] + widths[1],
                image.rect.height + widths[0] + widths[2],
            ),
            paint: paint.clone(),
            border_box: *border_box,
        });
    }
    // A folded SVG viewport keeps its resolved box, and the content
    // letterboxes inside it preserving the intrinsic ratio (SVG 2 §8.6,
    // preserveAspectRatio `meet`); only `none` stretches. The layout box
    // is untouched — this is a paint-rect adjustment.
    let mut draw = image.rect;
    if !*fit_contain {
        // Blink pixel-snaps a plain replaced image's paint rect to whole
        // CSS pixels (probed: an <img> at x=22.25 rasters at 22, at 22.5
        // at 23, bit-identical to a canvas draw at the same integers).
        // SVG-folded content is NOT snapped: it paints through the svg's
        // own transform, and the reference renders it at the fractional
        // position.
        let left = snap_css(line_x + draw.x);
        let top = snap_css(line_y + draw.y);
        let right = snap_css(line_x + draw.x + draw.width);
        let bottom = snap_css(line_y + draw.y + draw.height);
        draw = rito_fragment::FragmentRect {
            x: left - line_x,
            y: top - line_y,
            width: right - left,
            height: bottom - top,
        };
        // Computed `object-fit: contain` (the UA stylesheet's reading-
        // system default, see rito-stylo's ua.rs): the raster letterboxes
        // inside the snapped box, exposing the page ground in the gap —
        // no clamp-bleed slivers, those model SVG viewBox clamp
        // addressing. The box itself, its border and its background keep
        // the author's rect. Guard band, judged on the UNSNAPPED layout
        // box (the snap itself shifts a small box's ratio by up to a
        // pixel per axis): an auto-sized box differs from the raster
        // ratio only by LayoutUnit quantization dust, so skipping those
        // keeps every ratio-true image bit-identical to the plain fill
        // it always painted (the pixel-walk zero books stay zero). Only
        // a box the author forced off the raster ratio letterboxes.
        if *object_fit == rito_style_contract::ObjectFit::Contain
            && *intrinsic_width > 0.0
            && *intrinsic_height > 0.0
            && image.rect.width > 0.0
            && image.rect.height > 0.0
            && draw.width > 0.0
            && draw.height > 0.0
        {
            let box_ratio = image.rect.width / image.rect.height;
            let raster_ratio = intrinsic_width / intrinsic_height;
            let skew = (box_ratio / raster_ratio).max(raster_ratio / box_ratio);
            if skew > 1.01 {
                let scale = (draw.width / intrinsic_width).min(draw.height / intrinsic_height);
                let width = intrinsic_width * scale;
                let height = intrinsic_height * scale;
                draw = rito_fragment::FragmentRect {
                    x: draw.x + (draw.width - width) / 2.0,
                    y: draw.y + (draw.height - height) / 2.0,
                    width,
                    height,
                };
            }
        }
    }
    if *fit_contain && *intrinsic_width > 0.0 && *intrinsic_height > 0.0 {
        let contain = |outer: rito_fragment::FragmentRect, ratio_w: f64, ratio_h: f64| {
            let scale = (outer.width / ratio_w).min(outer.height / ratio_h).max(0.0);
            let width = ratio_w * scale;
            let height = ratio_h * scale;
            rito_fragment::FragmentRect {
                x: outer.x + (outer.width - width) / 2.0,
                y: outer.y + (outer.height - height) / 2.0,
                width,
                height,
            }
        };
        // Two-stage placement (SVG 2 §8.6, both `meet`): the viewBox
        // letterboxes into the element rect, then the raster letterboxes
        // inside that content box. Without a viewBox the content box IS
        // the element rect and this collapses to the one-step fit.
        let content = match viewport {
            Some((viewport_width, viewport_height))
                if *viewport_width > 0.0 && *viewport_height > 0.0 =>
            {
                contain(draw, *viewport_width, *viewport_height)
            }
            _ => draw,
        };
        let raster = contain(content, *intrinsic_width, *intrinsic_height);
        // The browser samples the raster with CLAMP addressing across the
        // viewBox CONTENT box: the sliver between the content edge and
        // the raster edge shows the edge texels smeared, not background
        // (measured: a cover whose viewBox out-ratios its JPEG by 0.35px
        // paints one blended edge column per side, uniform down the
        // page). An edge strip stretched across each sliver is exactly
        // that clamp bleed; the element-rect margins outside the content
        // box stay untouched.
        let sliver = |span: f64| span > 1.0 / 64.0;
        // The bleed exists only where a device pixel is PARTIALLY
        // covered by the raster edge: the browser samples with clamp
        // addressing inside that one crossing pixel and shows plain
        // background beyond it (measured: the sub-pixel cover sliver
        // smears one edge column, while b10's 1.19px svg letterbox
        // keeps its whole-row interior background-white — the strip
        // stretched across the full letterbox darkened two full rows
        // per plate against the browser).
        if sliver(raster.x - content.x) {
            let abs_left = line_x + raster.x;
            let abs_right = line_x + raster.x + raster.width;
            let left_start = (line_x + content.x).max(abs_left.floor());
            let right_end = (line_x + content.x + content.width).min(abs_right.ceil());
            for (dest_x, dest_w, src_x) in [
                (left_start, abs_left - left_start, 0.0),
                (abs_right, right_end - abs_right, intrinsic_width - 1.0),
            ] {
                if !sliver(dest_w) {
                    continue;
                }
                commands.push(DisplayCommand::paint_image_slice(
                    src.clone(),
                    display_rect(dest_x, line_y + raster.y, dest_w, raster.height),
                    display_rect(src_x, 0.0, 1.0, *intrinsic_height),
                ));
            }
        }
        if sliver(raster.y - content.y) {
            let abs_top = line_y + raster.y;
            let abs_bottom = line_y + raster.y + raster.height;
            let top_start = (line_y + content.y).max(abs_top.floor());
            let bottom_end = (line_y + content.y + content.height).min(abs_bottom.ceil());
            for (dest_y, dest_h, src_y) in [
                (top_start, abs_top - top_start, 0.0),
                (abs_bottom, bottom_end - abs_bottom, intrinsic_height - 1.0),
            ] {
                if !sliver(dest_h) {
                    continue;
                }
                commands.push(DisplayCommand::paint_image_slice(
                    src.clone(),
                    display_rect(line_x + raster.x, dest_y, raster.width, dest_h),
                    display_rect(0.0, src_y, *intrinsic_width, 1.0),
                ));
            }
        }
        draw = raster;
    }
    // Alt text and the enclosing link ride the command so a host resolves
    // taps (and a decode-failure fallback) against the display list alone.
    commands.push(DisplayCommand::paint_image(
        src.clone(),
        display_rect(line_x + draw.x, line_y + draw.y, draw.width, draw.height),
        item_source.and_then(|source| source.image_alt.clone()),
        item_source.and_then(|source| source.href.clone()),
    ));
    Ok(())
}
