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
    rito_adopt_background_candidate_v1, rito_adopt_foreground_candidate_v1,
    rito_advance_background_v1, rito_buffer_free_v1, rito_commit_peeked_artifact_v1,
    rito_dispose_v1, rito_open_v1, rito_open_with_pinned_fonts_v1, rito_peek_adjacent_v1,
    rito_get_text_range_geometry_v1, rito_read_footnote_v1, rito_read_publication_v1,
    rito_read_resource_v1,
    rito_release_artifact_v1,
    rito_request_adjacent_v1, rito_request_artifact_v1,
};
pub use abi::{
    RitoOwnedBufferV1, RitoPinnedFontFaceV1, RITO_ABI_VERSION_V1,
    RITO_PINNED_FONT_ROLE_MONOSPACE_V1, RITO_PINNED_FONT_ROLE_SANS_SERIF_V1,
    RITO_PINNED_FONT_ROLE_SERIF_V1, RITO_PUBLICATION_WIRE_BYTES_MAX_V1,
    RITO_RESOURCE_KIND_FONT_V1, RITO_RESOURCE_KIND_IMAGE_V1, RITO_RESOURCE_KIND_STYLESHEET_V1,
};
pub use actor::RITO_ACTOR_MAX_IN_FLIGHT_V1;
pub use error::{
    RITO_STATUS_ADJACENT_PENDING_V1, RITO_STATUS_ALREADY_EXISTS_V1, RITO_STATUS_BUSY_V1,
    RITO_STATUS_ENGINE_ERROR_V1, RITO_STATUS_EXACT_SEEK_PENDING_V1,
    RITO_STATUS_INVALID_ARGUMENT_V1, RITO_STATUS_NOT_FOUND_V1, RITO_STATUS_OK_V1,
    RITO_STATUS_PANIC_V1, RITO_STATUS_QUEUE_FULL_V1, RITO_STATUS_SESSION_TERMINATED_V1,
    RITO_STATUS_STALE_REQUEST_V1, RITO_STATUS_TARGET_NOT_PUBLISHED_V1,
    RITO_STATUS_UNSUPPORTED_PROFILE_V1,
};
