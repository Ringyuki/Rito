//! Publication shards: an EPUB split so a reader can open it from a small
//! skeleton and receive images one at a time, never holding the whole
//! archive.
//!
//! The skeleton shard (id 0) carries every file layout reads (chapters,
//! stylesheets, fonts, navigation) and the table of every archive file;
//! each image, audio or video file sits in a content shard of its own, and
//! the table records each image's intrinsic dimensions. A reader therefore
//! lays the whole book out from the skeleton alone and fetches an image
//! only to paint it. Each shard is deflated when that makes it smaller, and
//! can then be sealed with per-shard XChaCha20-Poly1305 keys; the header is
//! authenticated, binding every shard to its packed book and its id.

mod container;
mod pack;
mod payload;
mod store;

#[cfg(test)]
mod tests;

pub use pack::{pack_publication, PackOptions, PackedPublication, PackedShard};
pub(crate) use payload::ShardMedia;
pub(crate) use store::ShardStore;

pub const SHARD_MAGIC: &[u8; 8] = b"RITOSHD1";
pub const SHARD_FORMAT_VERSION: u32 = 3;
pub const SHARD_KEY_BYTES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShardKind {
    Skeleton,
    Content,
}

/// A 256-bit shard key.
#[derive(Clone, PartialEq, Eq)]
pub struct ShardKey([u8; SHARD_KEY_BYTES]);

impl ShardKey {
    pub const fn from_bytes(bytes: [u8; SHARD_KEY_BYTES]) -> Self {
        Self(bytes)
    }

    /// A key from a byte slice, which must be exactly 32 bytes long.
    pub fn from_slice(bytes: &[u8]) -> Option<Self> {
        bytes.try_into().ok().map(Self)
    }

    pub const fn as_bytes(&self) -> &[u8; SHARD_KEY_BYTES] {
        &self.0
    }
}

impl std::fmt::Debug for ShardKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ShardKey(..)")
    }
}
