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
mod tests;

pub use abi::{
    rito_adopt_background_candidate, rito_adopt_foreground_candidate, rito_advance_background,
    rito_buffer_free, rito_commit_peeked_artifact, rito_dispose, rito_get_text_range_geometry,
    rito_open, rito_open_with_pinned_fonts, rito_peek_adjacent, rito_read_footnote,
    rito_read_publication, rito_read_resource, rito_release_artifact, rito_request_adjacent,
    rito_request_artifact, rito_search,
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
    RITO_STATUS_PANIC, RITO_STATUS_QUEUE_FULL, RITO_STATUS_SESSION_TERMINATED,
    RITO_STATUS_STALE_REQUEST, RITO_STATUS_TARGET_NOT_PUBLISHED, RITO_STATUS_UNSUPPORTED_PROFILE,
};
