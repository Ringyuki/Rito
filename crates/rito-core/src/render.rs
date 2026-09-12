pub const NAME: &str = "render";
pub const OWNS: &str = "Platform-neutral display-list and paint command generation";

mod commands;
mod lower;
mod run_paint;

#[cfg(test)]
pub(crate) use commands::display_command_values;
pub(crate) use commands::{
    count_display_commands, encode_reader_primitive_list_v1, hash_display_commands,
    summarize_display_list_font_families, summarize_display_list_resource_refs, DisplayCommand,
    DisplayTextCommandInput, ReaderEncodedDisplayListV1,
};
pub(crate) use lower::{lower_display_commands, ImageSize};
pub(crate) use run_paint::{
    BorderEdgePaint, BorderLineStyle, FontPaint, FontPaintStyle, MeasurePaint, RunBorder,
    RunBorderEdge, RunDecoration, RunDecorationKind, RunPaint, RunPaintData, RunSpacing,
    TextShadowPaint,
};
