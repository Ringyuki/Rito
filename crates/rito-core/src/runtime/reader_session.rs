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

pub use session::ReaderSession;
pub use types::*;
pub use wire::{
    decode_reader_adjacent_request, decode_reader_artifact, decode_reader_artifact_request,
    decode_reader_background_advance, decode_reader_background_handoff,
    decode_reader_background_handoff_ack, decode_reader_background_request, decode_reader_footnote,
    decode_reader_foreground_handoff, decode_reader_foreground_handoff_ack,
    decode_reader_publication, decode_reader_resource, decode_reader_search_request,
    decode_reader_search_response, decode_reader_text_range_geometry,
    decode_reader_text_range_request, encode_reader_adjacent_request, encode_reader_artifact,
    encode_reader_artifact_request, encode_reader_background_advance,
    encode_reader_background_handoff, encode_reader_background_handoff_ack,
    encode_reader_background_request, encode_reader_footnote, encode_reader_foreground_handoff,
    encode_reader_foreground_handoff_ack, encode_reader_publication, encode_reader_resource,
    encode_reader_search_request, encode_reader_search_response, encode_reader_text_range_geometry,
    encode_reader_text_range_request, READER_ADJACENT_REQUEST_WIRE_BYTES,
    READER_ADJACENT_REQUEST_WIRE_MAGIC, READER_ARTIFACT_WIRE_MAGIC,
    READER_BACKGROUND_ADVANCE_WIRE_MAGIC, READER_BACKGROUND_ADVANCE_WIRE_PREFIX_BYTES,
    READER_BACKGROUND_HANDOFF_ACK_WIRE_BYTES, READER_BACKGROUND_HANDOFF_ACK_WIRE_MAGIC,
    READER_BACKGROUND_HANDOFF_WIRE_BYTES, READER_BACKGROUND_HANDOFF_WIRE_MAGIC,
    READER_BACKGROUND_REQUEST_WIRE_BYTES, READER_BACKGROUND_REQUEST_WIRE_MAGIC,
    READER_FOOTNOTE_WIRE_MAGIC, READER_FOREGROUND_HANDOFF_ACK_WIRE_BYTES,
    READER_FOREGROUND_HANDOFF_ACK_WIRE_MAGIC, READER_FOREGROUND_HANDOFF_WIRE_BYTES,
    READER_FOREGROUND_HANDOFF_WIRE_MAGIC, READER_PUBLICATION_WIRE_MAGIC, READER_REQUEST_WIRE_MAGIC,
    READER_RESOURCE_WIRE_MAGIC, READER_SEARCH_REQUEST_WIRE_MAGIC,
    READER_SEARCH_RESPONSE_WIRE_MAGIC, READER_TEXT_RANGE_GEOMETRY_WIRE_MAGIC,
    READER_TEXT_RANGE_REQUEST_WIRE_BYTES, READER_TEXT_RANGE_REQUEST_WIRE_MAGIC,
    READER_WIRE_HEADER_BYTES, READER_WIRE_VERSION,
};

pub const READER_PROTOCOL_VERSION: u32 = 5;
pub const READER_PUBLICATION_TOC_DEPTH_MAX: u32 = 64;
pub const READER_PUBLICATION_TOC_ITEM_MAX: u32 = 100_000;
pub const READER_PUBLICATION_WIRE_BYTES_MAX: u64 = 16 * 1024 * 1024;

#[cfg(test)]
mod background_tests;
#[cfg(test)]
mod tests;
