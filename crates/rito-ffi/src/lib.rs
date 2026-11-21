//! Stable native boundary for the owned reader protocol.
//!
//! A session's core state is created and used on one dedicated actor thread.
//! Native callers only exchange fixed-width values and owned byte buffers.

#![deny(unsafe_op_in_unsafe_fn)]

mod abi;
mod actor;
mod error;
mod input;
mod registry;

#[cfg(test)]
mod font_tests;
#[cfg(test)]
mod layout_tests;
#[cfg(test)]
mod paper_turn_tests;
#[cfg(test)]
mod shard_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod turn_controller_tests;
#[cfg(test)]
mod turn_motion_tests;

pub use abi::{
    rito_add_host_font_faces, rito_font_catalog, rito_mark_font_family_unavailable,
    rito_remove_host_font_faces, rito_unresolved_font_families,
};
pub use abi::{
    rito_adopt_background_candidate, rito_adopt_foreground_candidate, rito_advance_background,
    rito_buffer_free, rito_commit_peeked_artifact, rito_content_shards_near, rito_dispose,
    rito_get_text_range_geometry, rito_open, rito_open_shards_with_pinned_fonts,
    rito_open_with_pinned_fonts, rito_peek_adjacent, rito_peek_spread, rito_read_footnote,
    rito_read_page, rito_read_publication, rito_read_resource, rito_release_artifact,
    rito_request_adjacent, rito_request_artifact, rito_resolve_annotation,
    rito_resolve_exact_source_range, rito_resolve_navigation, rito_resolve_text_interaction,
    rito_search, rito_supply_shard,
};
pub use abi::{
    rito_paper_turn_begin, rito_paper_turn_begins, rito_paper_turn_configure,
    rito_paper_turn_default_motion, rito_paper_turn_eye_height, rito_paper_turn_forget,
    rito_paper_turn_free, rito_paper_turn_lands, rito_paper_turn_lay, rito_paper_turn_layouts,
    rito_paper_turn_new, rito_paper_turn_settle, rito_paper_turn_settle_step,
    rito_paper_turn_sheet, rito_paper_turn_state, rito_paper_turn_travel,
    RITO_PAPER_TURN_BEGUN_NUMBERS, RITO_PAPER_TURN_LAID_NUMBERS, RITO_PAPER_TURN_STATE_NUMBERS,
};
pub use abi::{
    rito_turn_controller_answer_begin, rito_turn_controller_answer_lands,
    rito_turn_controller_command, rito_turn_controller_configure,
    rito_turn_controller_finger_cancel, rito_turn_controller_finger_down,
    rito_turn_controller_finger_move, rito_turn_controller_finger_up, rito_turn_controller_free,
    rito_turn_controller_interrupt, rito_turn_controller_landed, rito_turn_controller_layouts,
    rito_turn_controller_new, rito_turn_controller_overdue, rito_turn_controller_pages,
    rito_turn_controller_play_jump, rito_turn_controller_settle_now, rito_turn_controller_state,
    rito_turn_controller_step, rito_turn_controller_take_action,
};
pub use abi::{
    rito_turn_motion_cancel, rito_turn_motion_carry_on, rito_turn_motion_configure,
    rito_turn_motion_drag, rito_turn_motion_finish, rito_turn_motion_free,
    rito_turn_motion_interrupt, rito_turn_motion_layouts, rito_turn_motion_new,
    rito_turn_motion_release, rito_turn_motion_reset, rito_turn_motion_start_drag,
    rito_turn_motion_state, rito_turn_motion_step, rito_turn_motion_turn,
};
pub use abi::{
    RitoOwnedBuffer, RitoPinnedFontFace, RITO_ABI_VERSION, RITO_PINNED_FONT_ROLE_MONOSPACE,
    RITO_PINNED_FONT_ROLE_SANS_SERIF, RITO_PINNED_FONT_ROLE_SERIF, RITO_PUBLICATION_WIRE_BYTES_MAX,
    RITO_RESOURCE_KIND_FONT, RITO_RESOURCE_KIND_IMAGE, RITO_RESOURCE_KIND_STYLESHEET,
};
pub use actor::RITO_ACTOR_MAX_IN_FLIGHT;
pub use error::{
    RITO_STATUS_ADJACENT_PENDING, RITO_STATUS_ALREADY_EXISTS, RITO_STATUS_BUSY,
    RITO_STATUS_ENGINE_ERROR, RITO_STATUS_INVALID_ARGUMENT, RITO_STATUS_NOT_FOUND, RITO_STATUS_OK,
    RITO_STATUS_PANIC, RITO_STATUS_QUEUE_FULL, RITO_STATUS_RESOURCE_PENDING,
    RITO_STATUS_SESSION_TERMINATED, RITO_STATUS_STALE_REQUEST, RITO_STATUS_TARGET_NOT_PUBLISHED,
    RITO_STATUS_UNSUPPORTED_PROFILE,
};
