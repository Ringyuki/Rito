use super::{contract::ReaderTextRun, ReaderDisplayListWireError};

mod lowered;
mod paint;
mod primitives;

pub(super) use lowered::encode_primitive_list;
use paint::write_run_paint;
pub(super) use primitives::checked_length;
use primitives::{
    write_finite_f64, write_length, write_optional, write_optional_string, write_rect,
    write_string, write_u32, write_u64,
};

/// A text run's body, shared by the text and ruby primitives.
fn write_text(
    output: &mut Vec<u8>,
    input: &ReaderTextRun,
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
    )?;
    write_length(output, input.clusters.len(), "cluster")?;
    for cluster in &input.clusters {
        write_u32(output, cluster.byte);
        write_finite_f64(output, cluster.x)?;
        write_finite_f64(output, cluster.y)?;
    }
    Ok(())
}
