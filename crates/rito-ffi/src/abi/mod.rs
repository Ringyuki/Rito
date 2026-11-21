mod fonts;
mod memory;
mod paper_turn;
mod turn_controller;
mod turn_motion;

pub use fonts::{
    rito_add_host_font_faces, rito_font_catalog, rito_mark_font_family_unavailable,
    rito_remove_host_font_faces, rito_unresolved_font_families,
};
pub(crate) use memory::{copy_bytes, copy_face_descriptors};
pub use memory::{
    rito_adopt_background_candidate, rito_adopt_foreground_candidate, rito_advance_background,
    rito_buffer_free, rito_commit_peeked_artifact, rito_content_shards_near, rito_dispose,
    rito_get_text_range_geometry, rito_open, rito_open_shards_with_pinned_fonts,
    rito_open_with_pinned_fonts, rito_peek_adjacent, rito_peek_spread, rito_read_footnote,
    rito_read_page, rito_read_publication, rito_read_resource, rito_release_artifact,
    rito_request_adjacent, rito_request_artifact, rito_resolve_annotation,
    rito_resolve_exact_source_range, rito_resolve_navigation, rito_resolve_text_interaction,
    rito_search, rito_supply_shard,
};

pub use paper_turn::{
    rito_paper_turn_begin, rito_paper_turn_begins, rito_paper_turn_configure,
    rito_paper_turn_default_motion, rito_paper_turn_eye_height, rito_paper_turn_forget,
    rito_paper_turn_free, rito_paper_turn_lands, rito_paper_turn_lay, rito_paper_turn_layouts,
    rito_paper_turn_new, rito_paper_turn_settle, rito_paper_turn_settle_step,
    rito_paper_turn_sheet, rito_paper_turn_state, rito_paper_turn_travel,
    RITO_PAPER_TURN_BEGUN_NUMBERS, RITO_PAPER_TURN_LAID_NUMBERS, RITO_PAPER_TURN_STATE_NUMBERS,
};
pub use turn_controller::{
    rito_turn_controller_answer_begin, rito_turn_controller_answer_lands,
    rito_turn_controller_command, rito_turn_controller_configure,
    rito_turn_controller_finger_cancel, rito_turn_controller_finger_down,
    rito_turn_controller_finger_move, rito_turn_controller_finger_up, rito_turn_controller_free,
    rito_turn_controller_interrupt, rito_turn_controller_landed, rito_turn_controller_layouts,
    rito_turn_controller_new, rito_turn_controller_overdue, rito_turn_controller_pages,
    rito_turn_controller_play_jump, rito_turn_controller_settle_now, rito_turn_controller_state,
    rito_turn_controller_step, rito_turn_controller_take_action,
};
pub use turn_motion::{
    rito_turn_motion_cancel, rito_turn_motion_carry_on, rito_turn_motion_configure,
    rito_turn_motion_drag, rito_turn_motion_finish, rito_turn_motion_free,
    rito_turn_motion_interrupt, rito_turn_motion_layouts, rito_turn_motion_new,
    rito_turn_motion_release, rito_turn_motion_reset, rito_turn_motion_start_drag,
    rito_turn_motion_state, rito_turn_motion_step, rito_turn_motion_turn,
};

#[cfg(test)]
pub(crate) use memory::copy_owned_buffer_for_test;

use std::ptr;

pub const RITO_ABI_VERSION: u32 = 1;
pub const RITO_PUBLICATION_WIRE_BYTES_MAX: u64 =
    rito_core::runtime::READER_PUBLICATION_WIRE_BYTES_MAX;
pub const RITO_RESOURCE_KIND_IMAGE: u32 = 0;
pub const RITO_RESOURCE_KIND_FONT: u32 = 1;
pub const RITO_RESOURCE_KIND_STYLESHEET: u32 = 2;
pub const RITO_PINNED_FONT_ROLE_SERIF: u32 = 0;
pub const RITO_PINNED_FONT_ROLE_SANS_SERIF: u32 = 1;
pub const RITO_PINNED_FONT_ROLE_MONOSPACE: u32 = 2;

/// One pinned measurement-fallback face crossing the open ABI.
///
/// `sha256_hex` carries the face digest as 64 lowercase hexadecimal
/// bytes. `language_data`/`language_len` are optional (null/0 for the
/// `und` default) and name an ASCII BCP47-style tag. Bytes are copied
/// before `rito_open_with_pinned_fonts` returns; the caller keeps
/// ownership of every pointer.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct RitoPinnedFontFace {
    pub bytes_data: *const u8,
    pub bytes_len: u64,
    pub sha256_hex: [u8; 64],
    pub generic_role: u32,
    pub language_data: *const u8,
    pub language_len: u64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct RitoOwnedBuffer {
    pub data: *mut u8,
    pub len: u64,
    pub capacity: u64,
}

impl RitoOwnedBuffer {
    pub const EMPTY: Self = Self {
        data: ptr::null_mut(),
        len: 0,
        capacity: 0,
    };
}
