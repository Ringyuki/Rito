pub const NAME: &str = "render";
pub const OWNS: &str = "Platform-neutral display-list and paint command generation";

mod commands;

pub use commands::{
    DisplayListResourceRefs, PackedDisplayCommandBuffer, PackedDisplayCommandBufferMetadata,
    PackedDisplayCommandRecordStats,
};

pub(crate) use commands::{
    count_display_commands, display_command_values, hash_display_commands, pack_display_commands,
    summarize_display_list_font_families, summarize_display_list_resource_refs, DisplayCommand,
    DisplayTextCommandInput,
};
