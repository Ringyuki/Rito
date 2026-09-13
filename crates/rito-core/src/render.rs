pub const NAME: &str = "render";
pub const OWNS: &str = "Platform-neutral display-list and paint command generation";

mod commands;
mod lower;
mod run_paint;

#[cfg(test)]
pub(crate) use commands::test_support;
pub(crate) use commands::{
    contract, count_display_commands, display_number, display_rect, encode_reader_primitive_list,
    hash_display_commands, summarize_display_list_font_families,
    summarize_display_list_resource_refs, DisplayCommand, DisplayTextCommand,
    ReaderEncodedDisplayList,
};
pub(crate) use lower::{lower, ImageSize};
pub(crate) use run_paint::RunPaint;
