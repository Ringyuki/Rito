//! Owned, fixed-width reader-session protocol shared by platform adapters.
//!
//! Browser and native bindings project this contract into their own transport.
//! No platform object or borrowed engine representation crosses this boundary.

mod artifact;
mod convert;
mod publication;
mod publication_info;
mod session;
mod types;
mod wire;

pub use session::ReaderSessionV1;
pub use types::*;
pub use wire::{
    decode_reader_adjacent_request_v1, decode_reader_artifact_request_v1,
    decode_reader_artifact_v1, decode_reader_background_advance_v1,
    decode_reader_background_handoff_ack_v1, decode_reader_background_handoff_v1,
    decode_reader_background_request_v1, decode_reader_foreground_handoff_ack_v1,
    decode_reader_foreground_handoff_v1, decode_reader_footnote_v1,
    decode_reader_text_range_geometry_v1, decode_reader_text_range_request_v1,
    decode_reader_publication_v1, decode_reader_resource_v1,
    encode_reader_adjacent_request_v1, encode_reader_artifact_request_v1,
    encode_reader_artifact_v1, encode_reader_background_advance_v1,
    encode_reader_background_handoff_ack_v1, encode_reader_background_handoff_v1,
    encode_reader_background_request_v1, encode_reader_foreground_handoff_ack_v1,
    encode_reader_foreground_handoff_v1, encode_reader_footnote_v1,
    encode_reader_text_range_geometry_v1, encode_reader_text_range_request_v1,
    encode_reader_publication_v1, encode_reader_resource_v1,
    READER_ADJACENT_REQUEST_WIRE_BYTES_V1, READER_ADJACENT_REQUEST_WIRE_MAGIC_V1,
    READER_ARTIFACT_WIRE_MAGIC_V1, READER_BACKGROUND_ADVANCE_WIRE_MAGIC_V1,
    READER_BACKGROUND_ADVANCE_WIRE_PREFIX_BYTES_V1, READER_BACKGROUND_HANDOFF_ACK_WIRE_BYTES_V1,
    READER_BACKGROUND_HANDOFF_ACK_WIRE_MAGIC_V1, READER_BACKGROUND_HANDOFF_WIRE_BYTES_V1,
    READER_BACKGROUND_HANDOFF_WIRE_MAGIC_V1, READER_BACKGROUND_REQUEST_WIRE_BYTES_V1,
    READER_BACKGROUND_REQUEST_WIRE_MAGIC_V1, READER_FOREGROUND_HANDOFF_ACK_WIRE_BYTES_V1,
    READER_FOREGROUND_HANDOFF_ACK_WIRE_MAGIC_V1, READER_FOREGROUND_HANDOFF_WIRE_BYTES_V1,
    READER_FOOTNOTE_WIRE_MAGIC_V1, READER_FOREGROUND_HANDOFF_WIRE_MAGIC_V1,
    READER_PUBLICATION_WIRE_MAGIC_V1,
    READER_REQUEST_WIRE_MAGIC_V1, READER_RESOURCE_WIRE_MAGIC_V1,
    READER_TEXT_RANGE_GEOMETRY_WIRE_MAGIC_V1, READER_TEXT_RANGE_REQUEST_WIRE_BYTES_V1,
    READER_TEXT_RANGE_REQUEST_WIRE_MAGIC_V1, READER_WIRE_HEADER_BYTES_V1,
    READER_WIRE_VERSION_V1,
};

pub const READER_PROTOCOL_VERSION_V1: u32 = 2;
pub const READER_PUBLICATION_TOC_DEPTH_MAX_V1: u32 = 64;
pub const READER_PUBLICATION_TOC_ITEM_MAX_V1: u32 = 100_000;
pub const READER_PUBLICATION_WIRE_BYTES_MAX_V1: u64 = 16 * 1024 * 1024;

#[cfg(test)]
mod background_tests;
#[cfg(test)]
mod tests;
