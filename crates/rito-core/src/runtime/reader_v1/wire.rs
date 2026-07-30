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
    ReaderFootnoteV1, ReaderResourceV1,
};

pub const READER_ADJACENT_REQUEST_WIRE_MAGIC_V1: [u8; 8] = *b"RITONAV1";
pub const READER_ARTIFACT_WIRE_MAGIC_V1: [u8; 8] = *b"RITOART1";
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
