pub const NAME: &str = "render";
pub const OWNS: &str = "Platform-neutral display-list and paint command generation";

mod commands;
mod lower;
mod run_paint;

#[cfg(test)]
pub(crate) use commands::test_support;
#[cfg(test)]
pub(crate) use commands::READER_PRIMITIVE_LIST_FORMAT_VERSION;
pub(crate) use commands::{
    contract, display_number, display_rect, encode_reader_primitive_list,
    summarize_display_list_resource_refs, DisplayCommand, DisplayTextCommand,
};
pub(crate) use lower::{lower, ImageSize};
pub(crate) use run_paint::RunPaint;
