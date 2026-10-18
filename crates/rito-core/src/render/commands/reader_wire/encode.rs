use super::{contract::ReaderTextRun, ReaderDisplayListWireError};

mod lowered;
mod paint;
mod primitives;

pub(super) use lowered::encode_primitive_list;
use paint::write_run_paint;
pub(super) use primitives::checked_length;
use primitives::{
    write_finite_f32, write_finite_f64, write_length, write_optional, write_optional_string,
    write_rect, write_string, write_u32, write_u64,
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
    // Every cluster, the joined ones included: a pen that blits clusters
    // places each, a pen that draws strings starts one at each cluster
    // that does not join.
    write_length(output, input.clusters.len(), "cluster")?;
    for cluster in input.clusters.iter() {
        write_u32(output, cluster.byte);
        write_finite_f32(output, cluster.x as f32)?;
        write_finite_f32(output, cluster.y as f32)?;
        output.push(u8::from(cluster.joins));
    }
    Ok(())
}
