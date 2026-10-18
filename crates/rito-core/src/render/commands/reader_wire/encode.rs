use super::{contract::ReaderTextRun, ReaderDisplayListWireError};

mod lowered;
mod paint;
mod primitives;
mod tables;

pub(super) use lowered::encode_primitive_list;
pub(super) use primitives::checked_length;
use primitives::{write_finite_f64, write_optional, write_optional_string, write_rect, write_u64};
use tables::TextTables;

/// A text run's body, shared by the text and ruby primitives: its text,
/// paint and clusters by where they sit in the tables (see `tables`).
fn write_text(
    output: &mut Vec<u8>,
    tables: &mut TextTables,
    input: &ReaderTextRun,
) -> Result<(), ReaderDisplayListWireError> {
    tables.write_text(output, &input.text)?;
    write_rect(output, &input.rect)?;
    tables.write_paint(output, &input.paint)?;
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
    tables.write_clusters(output, &input.clusters)
}
