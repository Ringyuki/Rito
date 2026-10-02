//! Publication shards: an EPUB split so a reader can open it from a small
//! skeleton and receive chapters one at a time, never holding the whole
//! archive.
//!
//! The skeleton shard (id 0) carries what opening reads (container, package
//! document, navigation, stylesheets), the table of every archive file with
//! the shard that holds it, and each chapter's footnote attribute scan. Each
//! content shard carries one chapter with the images only it uses, or one
//! shared file. Shards can be sealed with per-shard XChaCha20-Poly1305 keys;
//! the header is authenticated, binding every shard to its packed book and
//! its id.

mod container;
mod pack;
mod payload;
mod store;

#[cfg(test)]
mod tests;

pub use pack::{pack_publication, PackOptions, PackedPublication, PackedShard};
pub(crate) use store::ShardStore;

pub const SHARD_MAGIC: &[u8; 8] = b"RITOSHD1";
pub const SHARD_FORMAT_VERSION: u32 = 1;
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
