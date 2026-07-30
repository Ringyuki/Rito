use rito_core::runtime::{
    decode_reader_adjacent_request_v1, decode_reader_artifact_request_v1,
    decode_reader_background_handoff_v1, decode_reader_background_request_v1,
    decode_reader_foreground_handoff_v1, ReaderAdjacentRequestV1, ReaderArtifactRequestV1,
    ReaderBackgroundHandoffV1, ReaderBackgroundRequestV1, ReaderForegroundHandoffV1,
    ReaderResourceKindV1, RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole,
    RuntimePinnedFontLanguageTag, RuntimePinnedFontPolicyInput,
    READER_BACKGROUND_HANDOFF_WIRE_BYTES_V1, READER_BACKGROUND_REQUEST_WIRE_BYTES_V1,
    READER_FOREGROUND_HANDOFF_WIRE_BYTES_V1,
};

use crate::{
    abi::{
        copy_bytes, RitoPinnedFontFaceV1, RITO_PINNED_FONT_ROLE_MONOSPACE_V1,
        RITO_PINNED_FONT_ROLE_SANS_SERIF_V1, RITO_PINNED_FONT_ROLE_SERIF_V1,
        RITO_RESOURCE_KIND_FONT_V1, RITO_RESOURCE_KIND_IMAGE_V1, RITO_RESOURCE_KIND_STYLESHEET_V1,
    },
    error::FfiError,
};

const MAX_EPUB_BYTES: u64 = 512 * 1024 * 1024;
const MAX_REQUEST_BYTES: u64 = 16 * 1024 * 1024;
const MAX_HREF_BYTES: u64 = 16 * 1024 * 1024;
const MAX_PINNED_FONT_FACES: u32 = 16;
const MAX_PINNED_FONT_FACE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_PINNED_FONT_LANGUAGE_BYTES: u64 = 63;

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

pub(crate) fn footnote_key(source: *const u8, len: u64) -> Result<String, FfiError> {
    if len == 0 {
        return Err(FfiError::invalid("footnote key must not be empty"));
    }
    let bytes = copy_bytes(source, len, MAX_HREF_BYTES, "footnote key")?;
    String::from_utf8(bytes).map_err(|_| FfiError::invalid("footnote key must be valid UTF-8"))
}

pub(crate) fn resource_kind(value: u32) -> Result<ReaderResourceKindV1, FfiError> {
    match value {
        RITO_RESOURCE_KIND_IMAGE_V1 => Ok(ReaderResourceKindV1::Image),
        RITO_RESOURCE_KIND_FONT_V1 => Ok(ReaderResourceKindV1::Font),
        RITO_RESOURCE_KIND_STYLESHEET_V1 => Ok(ReaderResourceKindV1::Stylesheet),
        value => Err(FfiError::invalid(format!("unknown resource kind: {value}"))),
    }
}

/// Copies and validates the pinned-font face array crossing
/// `rito_open_with_pinned_fonts_v1`. Byte-level face validation
/// (SHA-256 match, shapeability) stays in the runtime policy
/// constructor; this only enforces ABI shape and limits.
pub(crate) fn pinned_font_policy(
    faces: *const RitoPinnedFontFaceV1,
    face_count: u32,
) -> Result<RuntimePinnedFontPolicyInput, FfiError> {
    if face_count == 0 {
        return Err(FfiError::invalid(
            "pinned font policy must contain at least one face",
        ));
    }
    if face_count > MAX_PINNED_FONT_FACES {
        return Err(FfiError::invalid(format!(
            "pinned font policy exceeds the {MAX_PINNED_FONT_FACES}-face ABI limit"
        )));
    }
    let faces = crate::abi::copy_face_descriptors(faces, face_count)?;
    let mut inputs = Vec::with_capacity(faces.len());
    for (index, face) in faces.iter().enumerate() {
        let bytes = copy_bytes(
            face.bytes_data,
            face.bytes_len,
            MAX_PINNED_FONT_FACE_BYTES,
            "pinned font face bytes",
        )?;
        if bytes.is_empty() {
            return Err(FfiError::invalid(format!(
                "pinned font face {index} bytes must not be empty"
            )));
        }
        let expected_sha256 = std::str::from_utf8(&face.sha256_hex)
            .ok()
            .filter(|digest| digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .map(str::to_ascii_lowercase)
            .ok_or_else(|| {
                FfiError::invalid(format!(
                    "pinned font face {index} SHA-256 must contain 64 hexadecimal digits"
                ))
            })?;
        let generic_role = match face.generic_role {
            RITO_PINNED_FONT_ROLE_SERIF_V1 => RuntimePinnedFontGenericRole::Serif,
            RITO_PINNED_FONT_ROLE_SANS_SERIF_V1 => RuntimePinnedFontGenericRole::SansSerif,
            RITO_PINNED_FONT_ROLE_MONOSPACE_V1 => RuntimePinnedFontGenericRole::Monospace,
            other => {
                return Err(FfiError::invalid(format!(
                    "pinned font face {index} has an unknown generic role: {other}"
                )))
            }
        };
        let language = if face.language_data.is_null() && face.language_len == 0 {
            None
        } else {
            let language = copy_bytes(
                face.language_data,
                face.language_len,
                MAX_PINNED_FONT_LANGUAGE_BYTES,
                "pinned font face language",
            )?;
            let language = String::from_utf8(language).map_err(|_| {
                FfiError::invalid(format!("pinned font face {index} language must be UTF-8"))
            })?;
            Some(
                RuntimePinnedFontLanguageTag::parse(&language)
                    .map_err(|error| FfiError::invalid(error.to_string()))?,
            )
        };
        inputs.push(RuntimePinnedFontFaceInput {
            bytes,
            expected_sha256,
            generic_role,
            language,
        });
    }
    Ok(RuntimePinnedFontPolicyInput { faces: inputs })
}
