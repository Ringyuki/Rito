//! Opening a publication from shards and supplying content shards later.

use rito_core::epub::shard::ShardKey;

use crate::{WasmRuntimeDocument, WasmRuntimeError};

pub(crate) fn shard_key(key: Option<&[u8]>) -> Result<Option<ShardKey>, WasmRuntimeError> {
    key.map(|bytes| {
        ShardKey::from_slice(bytes).ok_or_else(|| {
            WasmRuntimeError::bad_request(format!("a shard key is 32 bytes, not {}", bytes.len()))
        })
    })
    .transpose()
}

impl WasmRuntimeDocument {
    /// Verifies one content shard against the skeleton and keeps its files;
    /// a shard that is refused is a bad request.
    pub fn supply_shard(
        &mut self,
        shard: &[u8],
        key: Option<&[u8]>,
    ) -> Result<u32, WasmRuntimeError> {
        let key = shard_key(key)?;
        self.document
            .supply_shard(shard, key.as_ref())
            .map_err(|error| WasmRuntimeError::bad_request(error.message()))
    }

    pub fn content_shards_near(&self, href: &str) -> Vec<u32> {
        self.document.content_shards_near(href)
    }
}
