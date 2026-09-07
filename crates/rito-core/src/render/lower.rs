//! Lowering of the typed reader display list to device-resolved paint
//! primitives.
//!
//! The display list describes boxes and runs in CSS pixels with their paint
//! still symbolic: a border edge is a style and a colour, a block background
//! a colour over a box. Lowering resolves that description onto the device
//! grid the host rasterizes on — every coordinate scaled by the render ratio
//! (device pixels per CSS pixel), every raster rule the browser applies to a
//! box edge applied here — and hands the renderer fills, paths, clips, images
//! and text runs it blits without measuring or snapping anything itself.
//!
//! Text runs pass through with their numbers scaled to device pixels; the
//! renderer still places glyphs until the text laws move here.

use std::{error::Error, fmt};

use super::commands::{
    adapt_reader_display_list_v1,
    contract::{
        ReaderDisplayCommandV1, ReaderDisplayListV1, ReaderLengthV1, ReaderSizeV1,
        ReaderTransformV1,
    },
    DisplayCommand, ReaderDisplayListWireError,
};

mod block;
mod border;
mod json;
#[cfg(test)]
mod parity;
mod path;
mod primitive;
mod scale;
#[cfg(test)]
mod tests;

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
    Adapt(ReaderDisplayListWireError),
}

impl fmt::Display for LowerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRatio => {
                formatter.write_str("render ratio is not a finite positive number")
            }
            Self::Adapt(error) => write!(formatter, "display list is not lowerable: {error}"),
        }
    }
}

impl Error for LowerError {}

/// Lowers the JSON-shaped display provider's commands: adapts them to the
/// typed contract first, then resolves them at `ratio`.
pub(crate) fn lower_display_commands(
    commands: &[DisplayCommand],
    ratio: f64,
    images: &dyn Fn(&str) -> Option<ImageSize>,
) -> Result<PrimitiveList, LowerError> {
    let typed = adapt_reader_display_list_v1(commands).map_err(LowerError::Adapt)?;
    lower(&typed, ratio, images)
}

/// Resolves a typed display list at `ratio` device pixels per CSS pixel;
/// `images` answers a background image's intrinsic size by href (an image
/// it cannot size is not painted, exactly as a renderer skips a bitmap it
/// never decoded).
pub(crate) fn lower(
    display_list: &ReaderDisplayListV1,
    ratio: f64,
    images: &dyn Fn(&str) -> Option<ImageSize>,
) -> Result<PrimitiveList, LowerError> {
    if !ratio.is_finite() || ratio <= 0.0 {
        return Err(LowerError::InvalidRatio);
    }
    let mut commands = Vec::with_capacity(display_list.commands.len());
    for command in &display_list.commands {
        lower_command(command, ratio, images, &mut commands);
    }
    Ok(PrimitiveList { ratio, commands })
}

fn lower_command(
    command: &ReaderDisplayCommandV1,
    ratio: f64,
    images: &dyn Fn(&str) -> Option<ImageSize>,
    out: &mut Vec<Primitive>,
) {
    match command {
        ReaderDisplayCommandV1::PushState => out.push(Primitive::PushState),
        ReaderDisplayCommandV1::PopState => out.push(Primitive::PopState),
        ReaderDisplayCommandV1::Translate { dx, dy } => out.push(Primitive::Translate {
            dx: dx * ratio,
            dy: dy * ratio,
        }),
        ReaderDisplayCommandV1::Opacity { value } => {
            out.push(Primitive::Opacity { value: *value });
        }
        ReaderDisplayCommandV1::Transform {
            origin,
            box_size,
            transforms,
        } => out.push(Primitive::Transform {
            origin: DevicePoint::scaled(origin, ratio),
            transforms: transforms
                .iter()
                .map(|transform| lower_transform(transform, box_size, ratio))
                .collect(),
        }),
        ReaderDisplayCommandV1::ClipRect { rect, radius } => {
            let (rx, ry) =
                radius.map_or((0.0, 0.0), |radius| (radius.rx * ratio, radius.ry * ratio));
            out.push(Primitive::ClipPath {
                path: path::rounded_rect(DeviceRect::scaled(rect, ratio), rx, ry),
            });
        }
        ReaderDisplayCommandV1::PaintPage { rect, paint } => {
            if let Some(color) = paint.background_color {
                out.push(Primitive::FillRect {
                    rect: DeviceRect::scaled(rect, ratio),
                    color,
                    ground: Ground::Page,
                });
            }
        }
        ReaderDisplayCommandV1::PaintBlock {
            rect,
            paint,
            border_box,
        } => block::lower_block(rect, paint, border_box.as_ref(), ratio, images, out),
        ReaderDisplayCommandV1::PaintText(text) => {
            out.push(Primitive::Text(scale::text_command(text, ratio)));
        }
        ReaderDisplayCommandV1::PaintRuby(text) => {
            out.push(Primitive::Ruby(scale::text_command(text, ratio)));
        }
        ReaderDisplayCommandV1::PaintImage {
            src,
            rect,
            source_rect,
            ..
        } => out.push(Primitive::DrawImage {
            src: src.clone(),
            dest: DeviceRect::scaled(rect, ratio),
            source_rect: *source_rect,
            tiles: None,
        }),
        ReaderDisplayCommandV1::PaintHorizontalRule { rect, paint } => {
            border::lower_horizontal_rule(DeviceRect::scaled(rect, ratio), paint, out);
        }
    }
}

/// A transform's translate lengths resolve here: pixels scale to the
/// device, percentages resolve against the device box, so the renderer
/// never sees a percentage.
fn lower_transform(
    transform: &ReaderTransformV1,
    box_size: &ReaderSizeV1,
    ratio: f64,
) -> DeviceTransform {
    match *transform {
        ReaderTransformV1::Rotate { radians } => DeviceTransform::Rotate { radians },
        ReaderTransformV1::Scale { sx, sy } => DeviceTransform::Scale { sx, sy },
        ReaderTransformV1::Translate { x, y } => DeviceTransform::Translate {
            dx: resolve_length(x, box_size.width * ratio, ratio),
            dy: resolve_length(y, box_size.height * ratio, ratio),
        },
    }
}

fn resolve_length(length: ReaderLengthV1, basis: f64, ratio: f64) -> f64 {
    match length {
        ReaderLengthV1::Px(value) => value * ratio,
        ReaderLengthV1::Percent(value) => value / 100.0 * basis,
    }
}
