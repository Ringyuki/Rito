use super::super::{
    contract::{
        ReaderBackgroundPaintV1, ReaderBlockPaintV1, ReaderBorderBoxV1, ReaderBorderEdgePaintV1,
        ReaderColorV1, ReaderHorizontalRulePaintV1, ReaderPagePaintV1, ReaderRunBorderEdgeV1,
        ReaderRunPaintV1, ReaderTextShadowV1,
    },
    ReaderDisplayListWireError,
};
use super::primitives::{
    write_finite_f32, write_finite_f64, write_length, write_optional, write_string,
};

pub(super) fn write_page_paint(
    output: &mut Vec<u8>,
    paint: &ReaderPagePaintV1,
) -> Result<(), ReaderDisplayListWireError> {
    write_optional(output, paint.background_color.as_ref(), write_color)
}

pub(super) fn write_block_paint(
    output: &mut Vec<u8>,
    paint: &ReaderBlockPaintV1,
) -> Result<(), ReaderDisplayListWireError> {
    write_optional(output, paint.background.as_ref(), write_background)?;
    write_optional(output, paint.border.as_ref(), |output, border| {
        write_optional(output, border.top.as_ref(), write_border_edge)?;
        write_optional(output, border.right.as_ref(), write_border_edge)?;
        write_optional(output, border.bottom.as_ref(), write_border_edge)?;
        write_optional(output, border.left.as_ref(), write_border_edge)
    })?;
    write_optional(output, paint.radius.as_ref(), |output, radius| {
        output.push(radius.tag());
        write_finite_f64(output, radius.value())
    })?;
    write_length(output, paint.box_shadows.len(), "box shadow")?;
    for shadow in &paint.box_shadows {
        write_finite_f64(output, shadow.offset_x)?;
        write_finite_f64(output, shadow.offset_y)?;
        write_finite_f64(output, shadow.blur)?;
        write_finite_f64(output, shadow.spread)?;
        write_color(output, &shadow.color)?;
        output.push(u8::from(shadow.inset));
    }
    Ok(())
}

fn write_background(
    output: &mut Vec<u8>,
    background: &ReaderBackgroundPaintV1,
) -> Result<(), ReaderDisplayListWireError> {
    write_optional(output, background.color.as_ref(), write_color)?;
    write_optional(output, background.image.as_deref(), |output, image| {
        write_string(output, image)
    })?;
    write_optional(output, background.size.as_ref(), |output, size| {
        output.push(size.tag());
        Ok(())
    })?;
    write_optional(output, background.repeat.as_ref(), |output, repeat| {
        output.push(repeat.tag());
        Ok(())
    })?;
    write_optional(output, background.position.as_ref(), |output, position| {
        output.push(position.x.tag());
        write_finite_f64(output, position.x.value())?;
        output.push(position.y.tag());
        write_finite_f64(output, position.y.value())
    })
}

pub(super) fn write_border_box(
    output: &mut Vec<u8>,
    border_box: &ReaderBorderBoxV1,
) -> Result<(), ReaderDisplayListWireError> {
    write_finite_f64(output, border_box.top_width)?;
    write_finite_f64(output, border_box.right_width)?;
    write_finite_f64(output, border_box.bottom_width)?;
    write_finite_f64(output, border_box.left_width)
}

pub(super) fn write_run_paint(
    output: &mut Vec<u8>,
    paint: &ReaderRunPaintV1,
) -> Result<(), ReaderDisplayListWireError> {
    write_string(output, &paint.font.family)?;
    write_finite_f64(output, paint.font.size_px)?;
    write_finite_f64(output, paint.font.weight)?;
    output.push(paint.font.style.tag());
    write_color(output, &paint.color)?;
    write_optional_f64(output, paint.word_spacing_px)?;
    write_optional_f64(output, paint.letter_spacing_px)?;
    write_optional(output, paint.background_color.as_ref(), write_color)?;
    write_optional_f64(output, paint.background_radius)?;
    write_length(output, paint.text_shadows.len(), "text shadow")?;
    for shadow in &paint.text_shadows {
        write_text_shadow(output, shadow)?;
    }
    write_optional(output, paint.decoration.as_ref(), |output, decoration| {
        output.push(decoration.kind.tag());
        write_finite_f64(output, decoration.y)?;
        write_finite_f64(output, decoration.thickness)?;
        write_color(output, &decoration.color)
    })?;
    write_optional(output, paint.padding.as_ref(), |output, padding| {
        write_finite_f64(output, padding.top)?;
        write_finite_f64(output, padding.right)?;
        write_finite_f64(output, padding.bottom)?;
        write_finite_f64(output, padding.left)
    })?;
    write_optional(output, paint.border.as_ref(), |output, border| {
        write_optional(output, border.top.as_ref(), write_run_border_edge)?;
        write_optional(output, border.bottom.as_ref(), write_run_border_edge)?;
        write_optional(output, border.start.as_ref(), write_run_border_edge)?;
        write_optional(output, border.end.as_ref(), write_run_border_edge)
    })
}

fn write_optional_f64(
    output: &mut Vec<u8>,
    value: Option<f64>,
) -> Result<(), ReaderDisplayListWireError> {
    write_optional(output, value.as_ref(), |output, value| {
        write_finite_f64(output, *value)
    })
}

fn write_text_shadow(
    output: &mut Vec<u8>,
    shadow: &ReaderTextShadowV1,
) -> Result<(), ReaderDisplayListWireError> {
    write_finite_f64(output, shadow.offset_x)?;
    write_finite_f64(output, shadow.offset_y)?;
    write_finite_f64(output, shadow.blur)?;
    write_color(output, &shadow.color)
}

fn write_run_border_edge(
    output: &mut Vec<u8>,
    edge: &ReaderRunBorderEdgeV1,
) -> Result<(), ReaderDisplayListWireError> {
    write_finite_f64(output, edge.width_px)?;
    write_border_edge(output, &edge.paint)
}

fn write_border_edge(
    output: &mut Vec<u8>,
    edge: &ReaderBorderEdgePaintV1,
) -> Result<(), ReaderDisplayListWireError> {
    write_color(output, &edge.color)?;
    output.push(edge.style.tag());
    Ok(())
}

pub(super) fn write_horizontal_rule_paint(
    output: &mut Vec<u8>,
    paint: &ReaderHorizontalRulePaintV1,
) -> Result<(), ReaderDisplayListWireError> {
    write_color(output, &paint.color)?;
    output.push(paint.style.tag());
    Ok(())
}

fn write_color(
    output: &mut Vec<u8>,
    color: &ReaderColorV1,
) -> Result<(), ReaderDisplayListWireError> {
    output.push(color.space.tag());
    for component in color.components {
        write_finite_f32(output, component)?;
    }
    write_finite_f32(output, color.alpha)?;
    output.push(color.none.bits());
    Ok(())
}
