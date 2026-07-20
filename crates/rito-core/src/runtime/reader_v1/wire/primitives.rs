mod reader;
mod writer;

pub(crate) use reader::Reader;
pub(crate) use writer::Writer;

use super::super::{ReaderErrorKindV1, ReaderErrorV1, READER_EXTERNAL_ID_MAX_V1};

pub(super) const MAX_WIRE_BYTES: u64 = 256 * 1024 * 1024;
pub(super) const MAX_STRING_BYTES: u32 = 16 * 1024 * 1024;
pub(super) const MAX_COLLECTION_ITEMS: u32 = 1_000_000;
pub(super) const MAX_SEMANTIC_DEPTH: u32 = 64;

pub(super) fn invalid(message: impl Into<String>) -> ReaderErrorV1 {
    ReaderErrorV1::new(ReaderErrorKindV1::InvalidWire, message)
}

pub(super) fn overflow(field: &str) -> ReaderErrorV1 {
    ReaderErrorV1::new(
        ReaderErrorKindV1::NumericOverflow,
        format!("{field} exceeds protocol v1 limits"),
    )
}

pub(super) fn external_id(value: u64, field: &str) -> Result<u64, ReaderErrorV1> {
    if (1..=READER_EXTERNAL_ID_MAX_V1).contains(&value) {
        return Ok(value);
    }
    Err(invalid(format!(
        "{field} must be within 1..={READER_EXTERNAL_ID_MAX_V1}"
    )))
}
