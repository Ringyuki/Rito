//! Lowering of the typed reader display list to device-resolved paint
//! primitives.
//!
//! The display list describes boxes and runs in CSS pixels with their paint
//! still symbolic: a border edge is a style and a colour, a block background
//! a colour over a box. Lowering resolves that description — every raster
//! rule the browser applies to a box edge applied here — and hands the
//! renderer fills, paths, clips, images and text runs it blits without
//! measuring or snapping anything itself.
//!
//! The rules run in CSS pixels, whatever the render ratio (device pixels
//! per CSS pixel): the browser rounds box edges and border widths to whole
//! CSS pixels and only then maps them through the device scale, so a 2×
//! screen shows every 1× edge doubled, never re-rounded on the finer grid
//! (a phase sweep of fractional box tops at 1.5×, 2× and 3× lands each
//! edge on ratio × round(top), and a 0.4px, 0.75px or 1.5px border on one
//! CSS row × ratio). The finished list is scaled by the ratio in one pass.
//! Only a glyph baseline rounds on the device grid, and that happens in
//! the engine's paint walk before the commands arrive here.
//!
//! Text runs pass through in CSS pixels: a renderer draws them under
//! `scale(ratio)`, because glyph rasterization follows the CSS font size
//! (synthetic bold widens with the requested size, glyphs sit on a 1/64
//! CSS-pixel grid) and drawing the device size on the device grid rasters
//! different ink. A run's inline box — background band, border edges —
//! and its decoration line lower to primitives around the run; the
//! renderer still places glyphs until the text laws move here.

use std::{error::Error, fmt};

use super::commands::{
    contract::{ReaderLength, ReaderSize, ReaderTransform},
    DisplayCommand,
};

mod block;
mod border;
#[cfg(test)]
mod json;
mod path;
mod primitive;
mod scale;
#[cfg(test)]
mod tests;
mod text;

pub(crate) use primitive::{
    DashPattern, DevicePath, DevicePoint, DeviceRect, DeviceTransform, FillRule, Ground, PathOp,
    Primitive, PrimitiveList, StrokeCap, TilePlan,
};

/// An image's intrinsic size in CSS pixels, as the publication's resource
/// table records it; background images size and tile against it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ImageSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LowerError {
    /// The render ratio must be a finite, positive count of device pixels
    /// per CSS pixel.
    InvalidRatio,
}

impl fmt::Display for LowerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRatio => {
                formatter.write_str("render ratio is not a finite positive number")
            }
        }
    }
}

impl Error for LowerError {}

/// Resolves a display list at `ratio` device pixels per CSS pixel;
/// `images` answers a background image's intrinsic size by href (an image
/// it cannot size is not painted, exactly as a renderer skips a bitmap it
/// never decoded). A non-finite value in a command reaches the encoder,
/// which refuses the primitive carrying it.
pub(crate) fn lower(
    display_list: &[DisplayCommand],
    ratio: f64,
    images: &dyn Fn(&str) -> Option<ImageSize>,
) -> Result<PrimitiveList, LowerError> {
    if !ratio.is_finite() || ratio <= 0.0 {
        return Err(LowerError::InvalidRatio);
    }
    let mut commands = Vec::with_capacity(display_list.len());
    for command in display_list {
        lower_command(command, images, &mut commands);
    }
    for primitive in &mut commands {
        scale::primitive(primitive, ratio);
    }
    Ok(PrimitiveList { ratio, commands })
}

/// Resolves one command in CSS pixels.
fn lower_command(
    command: &DisplayCommand,
    images: &dyn Fn(&str) -> Option<ImageSize>,
    out: &mut Vec<Primitive>,
) {
    match command {
        DisplayCommand::PushState => out.push(Primitive::PushState),
        DisplayCommand::PopState => out.push(Primitive::PopState),
        DisplayCommand::Translate { dx, dy } => {
            out.push(Primitive::Translate { dx: *dx, dy: *dy });
        }
        DisplayCommand::Opacity { value } => {
            out.push(Primitive::Opacity { value: *value });
        }
        DisplayCommand::Transform {
            origin,
            box_size,
            transforms,
        } => out.push(Primitive::Transform {
            origin: origin.into(),
            transforms: transforms
                .iter()
                .map(|transform| lower_transform(transform, box_size))
                .collect(),
        }),
        DisplayCommand::ClipRect { rect, radius } => {
            let (rx, ry) = radius.map_or((0.0, 0.0), |radius| (radius.rx, radius.ry));
            out.push(Primitive::ClipPath {
                path: path::rounded_rect(rect.into(), rx, ry),
            });
        }
        DisplayCommand::PaintPage { rect, paint } => {
            if let Some(color) = paint.background_color {
                out.push(Primitive::FillRect {
                    rect: rect.into(),
                    color,
                    ground: Ground::Page,
                });
            }
        }
        DisplayCommand::PaintBlock {
            rect,
            paint,
            border_box,
        } => block::lower_block(rect.into(), paint, border_box.as_ref(), images, out),
        DisplayCommand::PaintText(text) => text::lower_text(text, out),
        DisplayCommand::PaintRuby(text) => text::lower_ruby(text, out),
        DisplayCommand::PaintImage {
            src,
            rect,
            source_rect,
            ..
        } => out.push(Primitive::DrawImage {
            src: src.clone(),
            dest: rect.into(),
            source_rect: *source_rect,
            tiles: None,
        }),
        DisplayCommand::PaintHorizontalRule { rect, paint } => {
            border::lower_horizontal_rule(rect.into(), paint, out);
        }
    }
}

/// A transform's translate lengths resolve here: percentages resolve
/// against the box, so the renderer never sees a percentage.
fn lower_transform(transform: &ReaderTransform, box_size: &ReaderSize) -> DeviceTransform {
    match *transform {
        ReaderTransform::Rotate { radians } => DeviceTransform::Rotate { radians },
        ReaderTransform::Scale { sx, sy } => DeviceTransform::Scale { sx, sy },
        ReaderTransform::Translate { x, y } => DeviceTransform::Translate {
            dx: resolve_length(x, box_size.width),
            dy: resolve_length(y, box_size.height),
        },
    }
}

fn resolve_length(length: ReaderLength, basis: f64) -> f64 {
    match length {
        ReaderLength::Px(value) => value,
        ReaderLength::Percent(value) => value / 100.0 * basis,
    }
}
