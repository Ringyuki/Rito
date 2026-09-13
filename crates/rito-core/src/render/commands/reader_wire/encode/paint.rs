use super::super::{
    contract::{ReaderColor, ReaderTextRunPaint, ReaderTextShadow},
    ReaderDisplayListWireError,
};
use super::primitives::{write_finite_f32, write_finite_f64, write_length, write_string};

pub(super) fn write_run_paint(
    output: &mut Vec<u8>,
    paint: &ReaderTextRunPaint,
) -> Result<(), ReaderDisplayListWireError> {
    write_string(output, &paint.font.family)?;
    write_finite_f64(output, paint.font.size_px)?;
    write_finite_f64(output, paint.font.weight)?;
    output.push(paint.font.style.tag());
    write_color(output, &paint.color)?;
    write_length(output, paint.text_shadows.len(), "text shadow")?;
    for shadow in &paint.text_shadows {
        write_text_shadow(output, shadow)?;
    }
    Ok(())
}

fn write_text_shadow(
    output: &mut Vec<u8>,
    shadow: &ReaderTextShadow,
) -> Result<(), ReaderDisplayListWireError> {
    write_finite_f64(output, shadow.offset_x)?;
    write_finite_f64(output, shadow.offset_y)?;
    write_finite_f64(output, shadow.blur)?;
    write_color(output, &shadow.color)
}

pub(super) fn write_color(
    output: &mut Vec<u8>,
    color: &ReaderColor,
) -> Result<(), ReaderDisplayListWireError> {
    output.push(color.space.tag());
    for component in color.components {
        write_finite_f32(output, component)?;
    }
    write_finite_f32(output, color.alpha)?;
    output.push(color.none.bits());
    Ok(())
}
