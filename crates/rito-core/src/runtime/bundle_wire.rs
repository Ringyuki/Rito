mod decode;
mod encode;

#[cfg(test)]
mod tests;

use serde_json::Value;

use crate::epub::{EpubError, EpubResult};

pub use decode::decode_runtime_bundle;
pub use encode::encode_runtime_bundle;

pub const RUNTIME_BUNDLE_MAGIC: &[u8; 8] = b"RITORB1\0";
pub const RUNTIME_BUNDLE_MAGIC_TEXT: &str = "RITORB1";
pub const RUNTIME_BUNDLE_VERSION: u32 = 1;
pub const RUNTIME_BUNDLE_HEADER_BYTES: usize = 56;

pub(crate) const TAG_NULL: u8 = 0;
pub(crate) const TAG_FALSE: u8 = 1;
pub(crate) const TAG_TRUE: u8 = 2;
pub(crate) const TAG_I64: u8 = 3;
pub(crate) const TAG_U64: u8 = 4;
pub(crate) const TAG_F64: u8 = 5;
pub(crate) const TAG_STRING: u8 = 6;
pub(crate) const TAG_ARRAY: u8 = 7;
pub(crate) const TAG_OBJECT: u8 = 8;
pub(crate) const JS_NUMBER_MAX_SAFE_INTEGER: u64 = (1_u64 << 53) - 1;

#[derive(Debug, Clone, PartialEq)]
pub struct DecodedRuntimeBundle {
    pub protocol_version: u32,
    pub string_count: usize,
    pub value_count: usize,
    pub byte_length: usize,
    pub checksum: u64,
    pub payload: Value,
}

pub(crate) fn checked_u32(value: usize, label: &str) -> EpubResult<u32> {
    u32::try_from(value).map_err(|_| wire_error(format!("{label} exceeds u32")))
}

pub(crate) fn usize_from_u32(value: u32) -> usize {
    value as usize
}

pub(crate) fn checked_end(
    offset: usize,
    length: usize,
    limit: usize,
    label: &str,
) -> EpubResult<usize> {
    let end = offset
        .checked_add(length)
        .ok_or_else(|| wire_error(format!("{label} range overflows")))?;
    if end > limit {
        return Err(wire_error(format!("{label} range exceeds payload length")));
    }
    Ok(end)
}

pub(crate) fn read_u32(bytes: &[u8], offset: usize, label: &str) -> EpubResult<u32> {
    read_u32_bounded(bytes, offset, bytes.len(), label)
}

pub(crate) fn read_u64(bytes: &[u8], offset: usize, label: &str) -> EpubResult<u64> {
    read_u64_bounded(bytes, offset, bytes.len(), label)
}

pub(crate) fn read_u32_bounded(
    bytes: &[u8],
    offset: usize,
    end: usize,
    label: &str,
) -> EpubResult<u32> {
    let next = checked_end(offset, 4, end, label)?;
    Ok(u32::from_le_bytes(
        bytes[offset..next].try_into().expect("slice length"),
    ))
}

pub(crate) fn read_u64_bounded(
    bytes: &[u8],
    offset: usize,
    end: usize,
    label: &str,
) -> EpubResult<u64> {
    let next = checked_end(offset, 8, end, label)?;
    Ok(u64::from_le_bytes(
        bytes[offset..next].try_into().expect("slice length"),
    ))
}

pub(crate) fn write_u32(bytes: &mut Vec<u8>, value: u32) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

pub(crate) fn write_u32_at(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

pub(crate) fn write_u64_at(bytes: &mut [u8], offset: usize, value: u64) {
    bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

pub(crate) fn runtime_bundle_checksum(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

pub(crate) fn validate_safe_i64(value: i64) -> EpubResult<i64> {
    let max = JS_NUMBER_MAX_SAFE_INTEGER as i64;
    if !(-max..=max).contains(&value) {
        return Err(wire_error(format!(
            "RITORB1 i64 is outside the JS Number safe integer range: {value}"
        )));
    }
    Ok(value)
}

pub(crate) fn validate_safe_u64(value: u64) -> EpubResult<u64> {
    if value > JS_NUMBER_MAX_SAFE_INTEGER {
        return Err(wire_error(format!(
            "RITORB1 u64 is outside the JS Number safe integer range: {value}"
        )));
    }
    Ok(value)
}

pub(crate) fn wire_error(message: impl Into<String>) -> EpubError {
    EpubError::new(message.into())
}
