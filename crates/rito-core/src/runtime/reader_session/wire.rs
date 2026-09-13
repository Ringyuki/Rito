//! Deterministic binary transport for the owned reader protocol.

mod decode;
mod encode;
mod primitives;

#[cfg(test)]
mod tests;

use super::{
    ReaderAdjacentRequest, ReaderArtifact, ReaderArtifactRequest, ReaderBackgroundAdvance,
    ReaderBackgroundHandoff, ReaderBackgroundHandoffAck, ReaderBackgroundRequest, ReaderError,
    ReaderFootnote, ReaderForegroundHandoff, ReaderForegroundHandoffAck, ReaderPublication,
    ReaderResource, ReaderSearchRequest, ReaderSearchResponse, ReaderTextRangeGeometry,
    ReaderTextRangeRequest,
};

pub const READER_ADJACENT_REQUEST_WIRE_MAGIC: [u8; 8] = *b"RITONAV1";
pub const READER_ARTIFACT_WIRE_MAGIC: [u8; 8] = *b"RITOART1";
// Every message below is decoded by hand in more than one language, and
// nothing in the build makes them agree. Changing a message's field
// layout — adding a field, changing a type, relaxing an invariant —
// means changing every mirror in the same commit:
//
//   * Rust        this module (encode + decode) and its tests
//   * Dart        packages/rito_flutter/lib/src/protocol/
//   * JavaScript  packages/rito-core-wasm/src/reader-session-*-runtime.js
//
// Which mirrors exist depends on the message. RITOART1, RITOPUB1,
// RITORES1, RITOBGA1 and the handoffs have all three. RITOFTN1,
// RITOTRQ1/RITOTRG1 and RITOSRQ1/RITOSRS1 are FFI-only today and have
// no JavaScript mirror — if the browser ever consumes one, it gains a
// third mirror and this obligation with it.
//
// The failure mode is silent, because every mirror ships hand-built
// test fixtures that agree with their own decoder. A stale mirror keeps
// passing its own tests while rejecting real bytes at runtime: that is
// exactly how the publication decoder ended up pinned to protocol
// version 1 while the encoder wrote 2, bricking `readPublication` and
// taking the session down with it. `protocol_version_parity_test.dart`
// now guards the version specifically; nothing guards field layout, so
// that part is on the author.
pub const READER_BACKGROUND_ADVANCE_WIRE_MAGIC: [u8; 8] = *b"RITOBGA1";
pub const READER_BACKGROUND_HANDOFF_ACK_WIRE_MAGIC: [u8; 8] = *b"RITOHOA1";
pub const READER_BACKGROUND_HANDOFF_WIRE_MAGIC: [u8; 8] = *b"RITOHOF1";
pub const READER_BACKGROUND_REQUEST_WIRE_MAGIC: [u8; 8] = *b"RITOBGQ1";
pub const READER_FOREGROUND_HANDOFF_ACK_WIRE_MAGIC: [u8; 8] = *b"RITOFGA1";
pub const READER_FOREGROUND_HANDOFF_WIRE_MAGIC: [u8; 8] = *b"RITOFGH1";
pub const READER_PUBLICATION_WIRE_MAGIC: [u8; 8] = *b"RITOPUB1";
pub const READER_REQUEST_WIRE_MAGIC: [u8; 8] = *b"RITOREQ1";
pub const READER_RESOURCE_WIRE_MAGIC: [u8; 8] = *b"RITORES1";
pub const READER_FOOTNOTE_WIRE_MAGIC: [u8; 8] = *b"RITOFTN1";
pub const READER_TEXT_RANGE_REQUEST_WIRE_MAGIC: [u8; 8] = *b"RITOTRQ1";
pub const READER_TEXT_RANGE_REQUEST_WIRE_BYTES: u32 = 72;
pub const READER_TEXT_RANGE_GEOMETRY_WIRE_MAGIC: [u8; 8] = *b"RITOTRG1";
pub const READER_SEARCH_REQUEST_WIRE_MAGIC: [u8; 8] = *b"RITOSRQ1";
pub const READER_SEARCH_RESPONSE_WIRE_MAGIC: [u8; 8] = *b"RITOSRS1";
pub const READER_WIRE_VERSION: u32 = 1;
pub const READER_WIRE_HEADER_BYTES: u32 = 20;
pub const READER_ADJACENT_REQUEST_WIRE_BYTES: u32 = 48;
pub const READER_BACKGROUND_REQUEST_WIRE_BYTES: u32 = 40;
pub const READER_BACKGROUND_ADVANCE_WIRE_PREFIX_BYTES: u32 = 49;
pub const READER_BACKGROUND_HANDOFF_WIRE_BYTES: u32 = 44;
pub const READER_BACKGROUND_HANDOFF_ACK_WIRE_BYTES: u32 = 44;
pub const READER_FOREGROUND_HANDOFF_WIRE_BYTES: u32 = 48;
pub const READER_FOREGROUND_HANDOFF_ACK_WIRE_BYTES: u32 = 48;

pub fn encode_reader_artifact(artifact: &ReaderArtifact) -> Result<Vec<u8>, ReaderError> {
    encode::artifact(artifact)
}

pub fn decode_reader_artifact(bytes: &[u8]) -> Result<ReaderArtifact, ReaderError> {
    decode::artifact(bytes)
}

pub fn encode_reader_artifact_request(
    request: &ReaderArtifactRequest,
) -> Result<Vec<u8>, ReaderError> {
    encode::request(request)
}

pub fn decode_reader_artifact_request(bytes: &[u8]) -> Result<ReaderArtifactRequest, ReaderError> {
    decode::request(bytes)
}

pub fn encode_reader_adjacent_request(
    request: &ReaderAdjacentRequest,
) -> Result<Vec<u8>, ReaderError> {
    encode::adjacent_request(request)
}

pub fn decode_reader_adjacent_request(bytes: &[u8]) -> Result<ReaderAdjacentRequest, ReaderError> {
    decode::adjacent_request(bytes)
}

pub fn encode_reader_foreground_handoff(
    handoff: &ReaderForegroundHandoff,
) -> Result<Vec<u8>, ReaderError> {
    encode::foreground_handoff(handoff)
}

pub fn decode_reader_foreground_handoff(
    bytes: &[u8],
) -> Result<ReaderForegroundHandoff, ReaderError> {
    decode::foreground_handoff(bytes)
}

pub fn encode_reader_foreground_handoff_ack(
    ack: &ReaderForegroundHandoffAck,
) -> Result<Vec<u8>, ReaderError> {
    encode::foreground_handoff_ack(ack)
}

pub fn decode_reader_foreground_handoff_ack(
    bytes: &[u8],
) -> Result<ReaderForegroundHandoffAck, ReaderError> {
    decode::foreground_handoff_ack(bytes)
}

pub fn encode_reader_background_request(
    request: &ReaderBackgroundRequest,
) -> Result<Vec<u8>, ReaderError> {
    encode::background_request(request)
}

pub fn decode_reader_background_request(
    bytes: &[u8],
) -> Result<ReaderBackgroundRequest, ReaderError> {
    decode::background_request(bytes)
}

pub fn encode_reader_background_advance(
    advance: &ReaderBackgroundAdvance,
) -> Result<Vec<u8>, ReaderError> {
    encode::background_advance(advance)
}

pub fn decode_reader_background_advance(
    bytes: &[u8],
) -> Result<ReaderBackgroundAdvance, ReaderError> {
    decode::background_advance(bytes)
}

pub fn encode_reader_background_handoff(
    handoff: &ReaderBackgroundHandoff,
) -> Result<Vec<u8>, ReaderError> {
    encode::background_handoff(handoff)
}

pub fn decode_reader_background_handoff(
    bytes: &[u8],
) -> Result<ReaderBackgroundHandoff, ReaderError> {
    decode::background_handoff(bytes)
}

pub fn encode_reader_background_handoff_ack(
    ack: &ReaderBackgroundHandoffAck,
) -> Result<Vec<u8>, ReaderError> {
    encode::background_handoff_ack(ack)
}

pub fn decode_reader_background_handoff_ack(
    bytes: &[u8],
) -> Result<ReaderBackgroundHandoffAck, ReaderError> {
    decode::background_handoff_ack(bytes)
}

pub fn encode_reader_publication(publication: &ReaderPublication) -> Result<Vec<u8>, ReaderError> {
    encode::publication(publication)
}

pub fn decode_reader_publication(bytes: &[u8]) -> Result<ReaderPublication, ReaderError> {
    decode::publication(bytes)
}

pub fn encode_reader_resource(resource: &ReaderResource) -> Result<Vec<u8>, ReaderError> {
    encode::resource(resource)
}

pub fn decode_reader_resource(bytes: &[u8]) -> Result<ReaderResource, ReaderError> {
    decode::resource(bytes)
}

pub fn encode_reader_footnote(footnote: &ReaderFootnote) -> Result<Vec<u8>, ReaderError> {
    encode::footnote(footnote)
}

pub fn decode_reader_footnote(bytes: &[u8]) -> Result<ReaderFootnote, ReaderError> {
    decode::footnote(bytes)
}

pub fn encode_reader_search_request(request: &ReaderSearchRequest) -> Result<Vec<u8>, ReaderError> {
    encode::search_request(request)
}

pub fn decode_reader_search_request(bytes: &[u8]) -> Result<ReaderSearchRequest, ReaderError> {
    decode::search_request(bytes)
}

pub fn encode_reader_search_response(
    response: &ReaderSearchResponse,
) -> Result<Vec<u8>, ReaderError> {
    encode::search_response(response)
}

pub fn decode_reader_search_response(bytes: &[u8]) -> Result<ReaderSearchResponse, ReaderError> {
    decode::search_response(bytes)
}

pub fn encode_reader_text_range_request(
    request: &ReaderTextRangeRequest,
) -> Result<Vec<u8>, ReaderError> {
    encode::text_range_request(request)
}

pub fn decode_reader_text_range_request(
    bytes: &[u8],
) -> Result<ReaderTextRangeRequest, ReaderError> {
    decode::text_range_request(bytes)
}

pub fn encode_reader_text_range_geometry(
    geometry: &ReaderTextRangeGeometry,
) -> Result<Vec<u8>, ReaderError> {
    encode::text_range_geometry(geometry)
}

pub fn decode_reader_text_range_geometry(
    bytes: &[u8],
) -> Result<ReaderTextRangeGeometry, ReaderError> {
    decode::text_range_geometry(bytes)
}
