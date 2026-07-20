use rito_core::runtime::{
    decode_reader_adjacent_request_v1, decode_reader_artifact_request_v1,
    decode_reader_background_handoff_v1, decode_reader_background_request_v1,
    decode_reader_foreground_handoff_v1, ReaderAdjacentRequestV1, ReaderArtifactRequestV1,
    ReaderBackgroundHandoffV1, ReaderBackgroundRequestV1, ReaderForegroundHandoffV1,
    ReaderResourceKindV1, READER_BACKGROUND_HANDOFF_WIRE_BYTES_V1,
    READER_BACKGROUND_REQUEST_WIRE_BYTES_V1, READER_FOREGROUND_HANDOFF_WIRE_BYTES_V1,
};

use crate::{
    abi::{
        copy_bytes, RITO_RESOURCE_KIND_FONT_V1, RITO_RESOURCE_KIND_IMAGE_V1,
        RITO_RESOURCE_KIND_STYLESHEET_V1,
    },
    error::FfiError,
};

const MAX_EPUB_BYTES: u64 = 512 * 1024 * 1024;
const MAX_REQUEST_BYTES: u64 = 16 * 1024 * 1024;
const MAX_HREF_BYTES: u64 = 16 * 1024 * 1024;

pub(crate) fn publication(source: *const u8, len: u64) -> Result<Vec<u8>, FfiError> {
    if len == 0 {
        return Err(FfiError::invalid("EPUB input must not be empty"));
    }
    copy_bytes(source, len, MAX_EPUB_BYTES, "EPUB input")
}

pub(crate) fn request(source: *const u8, len: u64) -> Result<ReaderArtifactRequestV1, FfiError> {
    if len == 0 {
        return Err(FfiError::invalid("RITOREQ1 input must not be empty"));
    }
    let bytes = copy_bytes(source, len, MAX_REQUEST_BYTES, "RITOREQ1 input")?;
    decode_reader_artifact_request_v1(&bytes).map_err(FfiError::from)
}

pub(crate) fn adjacent_request(
    source: *const u8,
    len: u64,
) -> Result<ReaderAdjacentRequestV1, FfiError> {
    if len == 0 {
        return Err(FfiError::invalid("RITONAV1 input must not be empty"));
    }
    let bytes = copy_bytes(source, len, MAX_REQUEST_BYTES, "RITONAV1 input")?;
    decode_reader_adjacent_request_v1(&bytes).map_err(FfiError::from)
}

pub(crate) fn background_request(
    source: *const u8,
    len: u64,
) -> Result<ReaderBackgroundRequestV1, FfiError> {
    if len == 0 {
        return Err(FfiError::invalid("RITOBGQ1 input must not be empty"));
    }
    let bytes = copy_bytes(
        source,
        len,
        u64::from(READER_BACKGROUND_REQUEST_WIRE_BYTES_V1),
        "RITOBGQ1 input",
    )?;
    decode_reader_background_request_v1(&bytes).map_err(FfiError::from)
}

pub(crate) fn foreground_handoff(
    source: *const u8,
    len: u64,
) -> Result<ReaderForegroundHandoffV1, FfiError> {
    if len == 0 {
        return Err(FfiError::invalid("RITOFGH1 input must not be empty"));
    }
    let bytes = copy_bytes(
        source,
        len,
        u64::from(READER_FOREGROUND_HANDOFF_WIRE_BYTES_V1),
        "RITOFGH1 input",
    )?;
    decode_reader_foreground_handoff_v1(&bytes).map_err(FfiError::from)
}

pub(crate) fn background_handoff(
    source: *const u8,
    len: u64,
) -> Result<ReaderBackgroundHandoffV1, FfiError> {
    if len == 0 {
        return Err(FfiError::invalid("RITOHOF1 input must not be empty"));
    }
    let bytes = copy_bytes(
        source,
        len,
        u64::from(READER_BACKGROUND_HANDOFF_WIRE_BYTES_V1),
        "RITOHOF1 input",
    )?;
    decode_reader_background_handoff_v1(&bytes).map_err(FfiError::from)
}

pub(crate) fn resource_href(source: *const u8, len: u64) -> Result<String, FfiError> {
    if len == 0 {
        return Err(FfiError::invalid("resource href must not be empty"));
    }
    let bytes = copy_bytes(source, len, MAX_HREF_BYTES, "resource href")?;
    String::from_utf8(bytes).map_err(|_| FfiError::invalid("resource href must be valid UTF-8"))
}

pub(crate) fn resource_kind(value: u32) -> Result<ReaderResourceKindV1, FfiError> {
    match value {
        RITO_RESOURCE_KIND_IMAGE_V1 => Ok(ReaderResourceKindV1::Image),
        RITO_RESOURCE_KIND_FONT_V1 => Ok(ReaderResourceKindV1::Font),
        RITO_RESOURCE_KIND_STYLESHEET_V1 => Ok(ReaderResourceKindV1::Stylesheet),
        value => Err(FfiError::invalid(format!("unknown resource kind: {value}"))),
    }
}
