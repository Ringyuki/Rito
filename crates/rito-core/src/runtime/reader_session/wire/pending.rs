//! `RITOPSH1`: the shards a failed request waited on. Native hosts receive
//! it in place of an error message when a call returns the resource-pending
//! status; it carries the ascending, distinct shard ids and the message.

use super::{
    primitives::{invalid, Reader, Writer},
    READER_PENDING_SHARDS_WIRE_MAGIC, READER_WIRE_VERSION,
};
use crate::runtime::reader_session::{ReaderError, ReaderErrorKind};

pub(super) fn encode(error: &ReaderError) -> Result<Vec<u8>, ReaderError> {
    if error.kind != ReaderErrorKind::ResourcePending {
        return Err(invalid(
            "only a resource-pending error names pending shards",
        ));
    }
    validate(&error.pending_shards)?;
    let mut writer = Writer::message(READER_PENDING_SHARDS_WIRE_MAGIC, READER_WIRE_VERSION);
    writer.count(error.pending_shards.len(), "pending shards")?;
    for shard_id in &error.pending_shards {
        writer.u32(*shard_id);
    }
    writer.string(&error.message, "pending shards message")?;
    writer.finish_message()
}

pub(super) fn decode(bytes: &[u8]) -> Result<ReaderError, ReaderError> {
    let mut reader = Reader::message(bytes, READER_PENDING_SHARDS_WIRE_MAGIC, READER_WIRE_VERSION)?;
    let pending_shards = reader.collection("pending shards", |reader| reader.u32())?;
    validate(&pending_shards)?;
    let message = reader.string("pending shards message")?;
    reader.finish("pending shards wire message")?;
    Ok(ReaderError {
        kind: ReaderErrorKind::ResourcePending,
        message,
        pending_shards,
    })
}

fn validate(shard_ids: &[u32]) -> Result<(), ReaderError> {
    if shard_ids.is_empty() {
        return Err(invalid("a resource-pending error names at least one shard"));
    }
    if shard_ids.contains(&0) {
        return Err(invalid("shard 0 is the skeleton and is never pending"));
    }
    if shard_ids.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(invalid("pending shards are ascending and distinct"));
    }
    Ok(())
}
