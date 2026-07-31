//! Deterministic binary transport for the owned reader protocol.

mod decode;
mod encode;
mod primitives;

#[cfg(test)]
mod tests;

use super::{
    ReaderAdjacentRequestV1, ReaderArtifactRequestV1, ReaderArtifactV1, ReaderBackgroundAdvanceV1,
    ReaderBackgroundHandoffAckV1, ReaderBackgroundHandoffV1, ReaderBackgroundRequestV1,
    ReaderErrorV1, ReaderForegroundHandoffAckV1, ReaderForegroundHandoffV1, ReaderPublicationV1,
    ReaderFootnoteV1, ReaderResourceV1, ReaderSearchRequestV1, ReaderSearchResponseV1,
    ReaderTextRangeGeometryV1, ReaderTextRangeRequestV1,
};

pub const READER_ADJACENT_REQUEST_WIRE_MAGIC_V1: [u8; 8] = *b"RITONAV1";
pub const READER_ARTIFACT_WIRE_MAGIC_V1: [u8; 8] = *b"RITOART1";
// Every message below is decoded by hand in more than one language, and
// nothing in the build makes them agree. Changing a message's field
// layout — adding a field, changing a type, relaxing an invariant —
// means changing every mirror in the same commit:
//
//   * Rust        this module (encode + decode) and its tests
//   * Dart        packages/rito_flutter/lib/src/protocol/
//   * JavaScript  packages/rito-core-wasm/src/reader-v1-*-runtime.js
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
pub const READER_BACKGROUND_ADVANCE_WIRE_MAGIC_V1: [u8; 8] = *b"RITOBGA1";
pub const READER_BACKGROUND_HANDOFF_ACK_WIRE_MAGIC_V1: [u8; 8] = *b"RITOHOA1";
pub const READER_BACKGROUND_HANDOFF_WIRE_MAGIC_V1: [u8; 8] = *b"RITOHOF1";
pub const READER_BACKGROUND_REQUEST_WIRE_MAGIC_V1: [u8; 8] = *b"RITOBGQ1";
pub const READER_FOREGROUND_HANDOFF_ACK_WIRE_MAGIC_V1: [u8; 8] = *b"RITOFGA1";
pub const READER_FOREGROUND_HANDOFF_WIRE_MAGIC_V1: [u8; 8] = *b"RITOFGH1";
pub const READER_PUBLICATION_WIRE_MAGIC_V1: [u8; 8] = *b"RITOPUB1";
pub const READER_REQUEST_WIRE_MAGIC_V1: [u8; 8] = *b"RITOREQ1";
pub const READER_RESOURCE_WIRE_MAGIC_V1: [u8; 8] = *b"RITORES1";
pub const READER_FOOTNOTE_WIRE_MAGIC_V1: [u8; 8] = *b"RITOFTN1";
pub const READER_TEXT_RANGE_REQUEST_WIRE_MAGIC_V1: [u8; 8] = *b"RITOTRQ1";
pub const READER_TEXT_RANGE_REQUEST_WIRE_BYTES_V1: u32 = 72;
pub const READER_TEXT_RANGE_GEOMETRY_WIRE_MAGIC_V1: [u8; 8] = *b"RITOTRG1";
pub const READER_SEARCH_REQUEST_WIRE_MAGIC_V1: [u8; 8] = *b"RITOSRQ1";
pub const READER_SEARCH_RESPONSE_WIRE_MAGIC_V1: [u8; 8] = *b"RITOSRS1";
pub const READER_WIRE_VERSION_V1: u32 = 1;
pub const READER_WIRE_HEADER_BYTES_V1: u32 = 20;
pub const READER_ADJACENT_REQUEST_WIRE_BYTES_V1: u32 = 60;
pub const READER_BACKGROUND_REQUEST_WIRE_BYTES_V1: u32 = 40;
pub const READER_BACKGROUND_ADVANCE_WIRE_PREFIX_BYTES_V1: u32 = 48;
pub const READER_BACKGROUND_HANDOFF_WIRE_BYTES_V1: u32 = 44;
pub const READER_BACKGROUND_HANDOFF_ACK_WIRE_BYTES_V1: u32 = 44;
pub const READER_FOREGROUND_HANDOFF_WIRE_BYTES_V1: u32 = 48;
pub const READER_FOREGROUND_HANDOFF_ACK_WIRE_BYTES_V1: u32 = 48;

pub fn encode_reader_artifact_v1(artifact: &ReaderArtifactV1) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::artifact(artifact)
}

pub fn decode_reader_artifact_v1(bytes: &[u8]) -> Result<ReaderArtifactV1, ReaderErrorV1> {
    decode::artifact(bytes)
}

pub fn encode_reader_artifact_request_v1(
    request: &ReaderArtifactRequestV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::request(request)
}

pub fn decode_reader_artifact_request_v1(
    bytes: &[u8],
) -> Result<ReaderArtifactRequestV1, ReaderErrorV1> {
    decode::request(bytes)
}

pub fn encode_reader_adjacent_request_v1(
    request: &ReaderAdjacentRequestV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::adjacent_request(request)
}

pub fn decode_reader_adjacent_request_v1(
    bytes: &[u8],
) -> Result<ReaderAdjacentRequestV1, ReaderErrorV1> {
    decode::adjacent_request(bytes)
}

pub fn encode_reader_foreground_handoff_v1(
    handoff: &ReaderForegroundHandoffV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::foreground_handoff(handoff)
}

pub fn decode_reader_foreground_handoff_v1(
    bytes: &[u8],
) -> Result<ReaderForegroundHandoffV1, ReaderErrorV1> {
    decode::foreground_handoff(bytes)
}

pub fn encode_reader_foreground_handoff_ack_v1(
    ack: &ReaderForegroundHandoffAckV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::foreground_handoff_ack(ack)
}

pub fn decode_reader_foreground_handoff_ack_v1(
    bytes: &[u8],
) -> Result<ReaderForegroundHandoffAckV1, ReaderErrorV1> {
    decode::foreground_handoff_ack(bytes)
}

pub fn encode_reader_background_request_v1(
    request: &ReaderBackgroundRequestV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::background_request(request)
}

pub fn decode_reader_background_request_v1(
    bytes: &[u8],
) -> Result<ReaderBackgroundRequestV1, ReaderErrorV1> {
    decode::background_request(bytes)
}

pub fn encode_reader_background_advance_v1(
    advance: &ReaderBackgroundAdvanceV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::background_advance(advance)
}

pub fn decode_reader_background_advance_v1(
    bytes: &[u8],
) -> Result<ReaderBackgroundAdvanceV1, ReaderErrorV1> {
    decode::background_advance(bytes)
}

pub fn encode_reader_background_handoff_v1(
    handoff: &ReaderBackgroundHandoffV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::background_handoff(handoff)
}

pub fn decode_reader_background_handoff_v1(
    bytes: &[u8],
) -> Result<ReaderBackgroundHandoffV1, ReaderErrorV1> {
    decode::background_handoff(bytes)
}

pub fn encode_reader_background_handoff_ack_v1(
    ack: &ReaderBackgroundHandoffAckV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::background_handoff_ack(ack)
}

pub fn decode_reader_background_handoff_ack_v1(
    bytes: &[u8],
) -> Result<ReaderBackgroundHandoffAckV1, ReaderErrorV1> {
    decode::background_handoff_ack(bytes)
}

pub fn encode_reader_publication_v1(
    publication: &ReaderPublicationV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::publication(publication)
}

pub fn decode_reader_publication_v1(bytes: &[u8]) -> Result<ReaderPublicationV1, ReaderErrorV1> {
    decode::publication(bytes)
}

pub fn encode_reader_resource_v1(resource: &ReaderResourceV1) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::resource(resource)
}

pub fn decode_reader_resource_v1(bytes: &[u8]) -> Result<ReaderResourceV1, ReaderErrorV1> {
    decode::resource(bytes)
}

pub fn encode_reader_footnote_v1(footnote: &ReaderFootnoteV1) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::footnote(footnote)
}

pub fn decode_reader_footnote_v1(bytes: &[u8]) -> Result<ReaderFootnoteV1, ReaderErrorV1> {
    decode::footnote(bytes)
}

pub fn encode_reader_search_request_v1(
    request: &ReaderSearchRequestV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::search_request(request)
}

pub fn decode_reader_search_request_v1(
    bytes: &[u8],
) -> Result<ReaderSearchRequestV1, ReaderErrorV1> {
    decode::search_request(bytes)
}

pub fn encode_reader_search_response_v1(
    response: &ReaderSearchResponseV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::search_response(response)
}

pub fn decode_reader_search_response_v1(
    bytes: &[u8],
) -> Result<ReaderSearchResponseV1, ReaderErrorV1> {
    decode::search_response(bytes)
}

pub fn encode_reader_text_range_request_v1(
    request: &ReaderTextRangeRequestV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::text_range_request(request)
}

pub fn decode_reader_text_range_request_v1(
    bytes: &[u8],
) -> Result<ReaderTextRangeRequestV1, ReaderErrorV1> {
    decode::text_range_request(bytes)
}

pub fn encode_reader_text_range_geometry_v1(
    geometry: &ReaderTextRangeGeometryV1,
) -> Result<Vec<u8>, ReaderErrorV1> {
    encode::text_range_geometry(geometry)
}

pub fn decode_reader_text_range_geometry_v1(
    bytes: &[u8],
) -> Result<ReaderTextRangeGeometryV1, ReaderErrorV1> {
    decode::text_range_geometry(bytes)
}
