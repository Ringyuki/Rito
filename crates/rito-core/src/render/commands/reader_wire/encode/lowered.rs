//! `RITODL1` format version 2: the device-resolved primitive list.
//!
//! Header: magic, u32 format version, f64 render ratio, u32 primitive
//! count. Every primitive is a u16 opcode followed by its fields; paths are
//! a u32 op count of tagged ops. Colours and run paints share the format-1
//! encodings.

use super::super::{
    ReaderDisplayListWireError, READER_DISPLAY_LIST_MAGIC, READER_PRIMITIVE_LIST_FORMAT_VERSION,
};
use super::{
    paint::write_color,
    primitives::{
        checked_length, write_finite_f64, write_length, write_optional, write_rect, write_string,
        write_u16, write_u32,
    },
    write_text,
};
use crate::render::lower::{
    DevicePath, DevicePoint, DeviceRect, DeviceTransform, Ground, PathOp, Primitive, PrimitiveList,
    TilePlan,
};

pub(in crate::render::commands::reader_wire) fn encode_primitive_list(
    list: &PrimitiveList,
) -> Result<Vec<u8>, ReaderDisplayListWireError> {
    let count = checked_length(list.commands.len(), "primitive")?;
    let mut output = Vec::new();
    output.extend_from_slice(READER_DISPLAY_LIST_MAGIC);
    write_u32(&mut output, READER_PRIMITIVE_LIST_FORMAT_VERSION);
    write_finite_f64(&mut output, list.ratio)?;
    write_u32(&mut output, count);
    for primitive in &list.commands {
        write_primitive(&mut output, primitive)?;
    }
    Ok(output)
}

fn write_primitive(
    output: &mut Vec<u8>,
    primitive: &Primitive,
) -> Result<(), ReaderDisplayListWireError> {
    write_u16(output, primitive.opcode());
    match primitive {
        Primitive::PushState | Primitive::PopState => Ok(()),
        Primitive::Translate { dx, dy } => {
            write_finite_f64(output, *dx)?;
            write_finite_f64(output, *dy)
        }
        Primitive::Opacity { value } => write_finite_f64(output, *value),
        Primitive::Transform { origin, transforms } => {
            write_point(output, *origin)?;
            write_length(output, transforms.len(), "transform")?;
            for transform in transforms {
                output.push(transform.tag());
                match *transform {
                    DeviceTransform::Rotate { radians } => write_finite_f64(output, radians)?,
                    DeviceTransform::Scale { sx, sy } => {
                        write_finite_f64(output, sx)?;
                        write_finite_f64(output, sy)?;
                    }
                    DeviceTransform::Translate { dx, dy } => {
                        write_finite_f64(output, dx)?;
                        write_finite_f64(output, dy)?;
                    }
                }
            }
            Ok(())
        }
        Primitive::ClipPath { path } => write_path(output, path),
        Primitive::FillRect {
            rect,
            color,
            ground,
        } => {
            write_device_rect(output, *rect)?;
            write_color(output, color)?;
            write_ground(output, *ground)
        }
        Primitive::FillPath {
            path,
            rule,
            color,
            ground,
        } => {
            write_path(output, path)?;
            output.push(rule.tag());
            write_color(output, color)?;
            write_ground(output, *ground)
        }
        Primitive::StrokePath {
            path,
            width,
            color,
            cap,
            dash,
        } => {
            write_path(output, path)?;
            write_finite_f64(output, *width)?;
            write_color(output, color)?;
            output.push(cap.tag());
            write_optional(output, dash.as_ref(), |output, dash| {
                write_finite_f64(output, dash.on)?;
                write_finite_f64(output, dash.off)
            })
        }
        Primitive::Shadow {
            shape,
            sigma,
            offset,
            color,
            clip_out,
        } => {
            write_path(output, shape)?;
            write_finite_f64(output, *sigma)?;
            write_point(output, *offset)?;
            write_color(output, color)?;
            write_optional(output, clip_out.as_ref(), write_path)
        }
        Primitive::DrawImage {
            src,
            dest,
            source_rect,
            tiles,
        } => {
            write_string(output, src)?;
            write_device_rect(output, *dest)?;
            write_optional(output, source_rect.as_ref(), write_rect)?;
            write_optional(output, tiles.as_ref(), write_tile_plan)
        }
        Primitive::Text(text) | Primitive::Ruby(text) => write_text(output, text),
    }
}

/// The ground tag, followed by the declared box for a block ground.
fn write_ground(output: &mut Vec<u8>, ground: Ground) -> Result<(), ReaderDisplayListWireError> {
    output.push(ground.tag());
    match ground {
        Ground::Block(rect) => write_device_rect(output, rect),
        Ground::None | Ground::Page => Ok(()),
    }
}

fn write_path(output: &mut Vec<u8>, path: &DevicePath) -> Result<(), ReaderDisplayListWireError> {
    write_length(output, path.ops.len(), "path op")?;
    for op in &path.ops {
        output.push(op.tag());
        match *op {
            PathOp::MoveTo(to) | PathOp::LineTo(to) => write_point(output, to)?,
            PathOp::Arc {
                center,
                rx,
                ry,
                start,
                sweep,
            } => {
                write_point(output, center)?;
                for value in [rx, ry, start, sweep] {
                    write_finite_f64(output, value)?;
                }
            }
            PathOp::Ellipse { center, rx, ry } => {
                write_point(output, center)?;
                write_finite_f64(output, rx)?;
                write_finite_f64(output, ry)?;
            }
            PathOp::Rect(rect) => write_device_rect(output, rect)?,
            PathOp::Close => {}
        }
    }
    Ok(())
}

fn write_tile_plan(
    output: &mut Vec<u8>,
    plan: &TilePlan,
) -> Result<(), ReaderDisplayListWireError> {
    write_point(output, plan.origin)?;
    write_finite_f64(output, plan.step_x)?;
    write_finite_f64(output, plan.step_y)?;
    write_u32(output, plan.columns);
    write_u32(output, plan.rows);
    Ok(())
}

fn write_point(output: &mut Vec<u8>, point: DevicePoint) -> Result<(), ReaderDisplayListWireError> {
    write_finite_f64(output, point.x)?;
    write_finite_f64(output, point.y)
}

fn write_device_rect(
    output: &mut Vec<u8>,
    rect: DeviceRect,
) -> Result<(), ReaderDisplayListWireError> {
    write_finite_f64(output, rect.x)?;
    write_finite_f64(output, rect.y)?;
    write_finite_f64(output, rect.width)?;
    write_finite_f64(output, rect.height)
}
