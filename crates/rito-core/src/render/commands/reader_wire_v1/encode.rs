use super::{
    contract::{
        ReaderDisplayCommandV1, ReaderDisplayListV1, ReaderTextCommandV1, ReaderTransformV1,
    },
    ReaderDisplayListWireError, READER_DISPLAY_LIST_FORMAT_VERSION, READER_DISPLAY_LIST_MAGIC,
};

mod paint;
mod primitives;

use paint::{
    write_block_paint, write_border_box, write_horizontal_rule_paint, write_page_paint,
    write_run_paint,
};
pub(super) use primitives::checked_length;
use primitives::{
    write_finite_f64, write_length, write_optional, write_optional_string, write_rect,
    write_string, write_u16, write_u32, write_u64,
};

pub(super) fn encode(
    display_list: &ReaderDisplayListV1,
) -> Result<Vec<u8>, ReaderDisplayListWireError> {
    let command_count = checked_length(display_list.commands.len(), "display command")?;
    let mut output = Vec::new();
    output.extend_from_slice(READER_DISPLAY_LIST_MAGIC);
    write_u32(&mut output, READER_DISPLAY_LIST_FORMAT_VERSION);
    write_u32(&mut output, command_count);
    for command in &display_list.commands {
        write_command(&mut output, command)?;
    }
    Ok(output)
}

fn write_command(
    output: &mut Vec<u8>,
    command: &ReaderDisplayCommandV1,
) -> Result<(), ReaderDisplayListWireError> {
    write_u16(output, command.opcode());
    match command {
        ReaderDisplayCommandV1::PushState | ReaderDisplayCommandV1::PopState => Ok(()),
        ReaderDisplayCommandV1::Translate { dx, dy } => {
            write_finite_f64(output, *dx)?;
            write_finite_f64(output, *dy)
        }
        ReaderDisplayCommandV1::Opacity { value } => write_finite_f64(output, *value),
        ReaderDisplayCommandV1::Transform {
            origin,
            box_size,
            transforms,
        } => {
            write_finite_f64(output, origin.x)?;
            write_finite_f64(output, origin.y)?;
            write_finite_f64(output, box_size.width)?;
            write_finite_f64(output, box_size.height)?;
            write_length(output, transforms.len(), "transform")?;
            for transform in transforms {
                write_transform(output, transform)?;
            }
            Ok(())
        }
        ReaderDisplayCommandV1::ClipRect { rect, radius } => {
            write_rect(output, rect)?;
            write_optional(output, radius.as_ref(), |output, radius| {
                write_finite_f64(output, radius.rx)?;
                write_finite_f64(output, radius.ry)
            })
        }
        ReaderDisplayCommandV1::PaintPage { rect, paint } => {
            write_rect(output, rect)?;
            write_page_paint(output, paint)
        }
        ReaderDisplayCommandV1::PaintBlock {
            rect,
            paint,
            border_box,
        } => {
            write_rect(output, rect)?;
            write_block_paint(output, paint)?;
            write_optional(output, border_box.as_ref(), write_border_box)
        }
        ReaderDisplayCommandV1::PaintText(input) | ReaderDisplayCommandV1::PaintRuby(input) => {
            write_text(output, input)
        }
        ReaderDisplayCommandV1::PaintImage {
            src,
            rect,
            alt,
            href,
        } => {
            write_string(output, src)?;
            write_rect(output, rect)?;
            write_optional_string(output, alt.as_deref())?;
            write_optional_string(output, href.as_deref())
        }
        ReaderDisplayCommandV1::PaintHorizontalRule { rect, paint } => {
            write_rect(output, rect)?;
            write_horizontal_rule_paint(output, paint)
        }
    }
}

fn write_transform(
    output: &mut Vec<u8>,
    transform: &ReaderTransformV1,
) -> Result<(), ReaderDisplayListWireError> {
    output.push(transform.tag());
    match *transform {
        ReaderTransformV1::Rotate { radians } => write_finite_f64(output, radians),
        ReaderTransformV1::Scale { sx, sy } => {
            write_finite_f64(output, sx)?;
            write_finite_f64(output, sy)
        }
        ReaderTransformV1::Translate { x, y } => {
            output.push(x.tag());
            write_finite_f64(output, x.value())?;
            output.push(y.tag());
            write_finite_f64(output, y.value())
        }
    }
}

fn write_text(
    output: &mut Vec<u8>,
    input: &ReaderTextCommandV1,
) -> Result<(), ReaderDisplayListWireError> {
    write_string(output, &input.text)?;
    write_rect(output, &input.rect)?;
    write_run_paint(output, &input.paint)?;
    write_optional(output, input.line_height_px.as_ref(), |output, value| {
        write_finite_f64(output, *value)
    })?;
    write_optional_string(output, input.href.as_deref())?;
    write_optional_string(output, input.source_text.as_deref())?;
    write_optional(
        output,
        input.source_text_offset.as_ref(),
        |output, value| {
            write_u64(output, *value);
            Ok(())
        },
    )
}
