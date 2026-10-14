use std::{collections::BTreeMap, sync::Arc};

use crate::epub::{
    archive::{ArchiveEntryMetadata, EpubArchive},
    join_epub_href,
    reader::PublicationReader,
    shard::ShardStore,
    EpubResult,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedArchiveSource {
    pub(super) storage: PublicationStorage,
    pub(super) opf_dir: String,
    pub(super) archive_image_entries: BTreeMap<String, ArchiveEntryMetadata>,
}

/// Where the publication's files live for the document's lifetime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PublicationStorage {
    /// The whole EPUB archive, shared with every archive cursor opened over
    /// it. `Arc<Vec<u8>>` takes ownership of the caller's buffer by moving
    /// it; `Arc<[u8]>` would allocate a second buffer and copy the archive
    /// into it, and in WASM that second allocation raises the heap
    /// high-water mark for the rest of the session.
    Archive(Arc<Vec<u8>>),
    /// A skeleton shard and the content shards supplied so far.
    Shards(ShardStore),
}

impl PublicationStorage {
    pub(crate) fn reader(&self) -> EpubResult<PublicationReader<'_>> {
        Ok(match self {
            Self::Archive(bytes) => PublicationReader::Archive(EpubArchive::new(bytes)?),
            Self::Shards(store) => PublicationReader::Shards(store.clone()),
        })
    }

    /// A reader that owns its handle on the files, so it can outlive the
    /// borrow of the document it came from.
    pub(crate) fn shared_reader(&self) -> EpubResult<PublicationReader<'static>> {
        Ok(match self {
            Self::Archive(bytes) => {
                PublicationReader::Archive(EpubArchive::new_shared(Arc::clone(bytes))?)
            }
            Self::Shards(store) => PublicationReader::Shards(store.clone()),
        })
    }

    pub(crate) fn shards(&self) -> Option<&ShardStore> {
        match self {
            Self::Archive(_) => None,
            Self::Shards(store) => Some(store),
        }
    }
}

#[derive(Clone, Copy)]
pub(super) enum ArchiveResourceKind {
    Font,
    Image,
}

impl LoadedArchiveSource {
    pub(super) fn reader(&self) -> EpubResult<PublicationReader<'_>> {
        self.storage.reader()
    }

    pub(super) fn read_bytes(
        &self,
        href: &str,
        resource_kind: ArchiveResourceKind,
    ) -> EpubResult<Vec<u8>> {
        let mut reader = self.reader()?;
        self.read_bytes_with_archive(&mut reader, href, resource_kind)
    }

    pub(super) fn read_bytes_with_archive(
        &self,
        archive: &mut PublicationReader<'_>,
        href: &str,
        resource_kind: ArchiveResourceKind,
    ) -> EpubResult<Vec<u8>> {
        if matches!(resource_kind, ArchiveResourceKind::Image) {
            if let Some(entry) = self.archive_image_entries.get(href) {
                return archive.read_entry_bytes(entry);
            }
        }
        archive.read_bytes(&join_epub_href(&self.opf_dir, href))
    }

    pub(super) fn inspect_with_archive<T>(
        &self,
        archive: &mut PublicationReader<'_>,
        href: &str,
        resource_kind: ArchiveResourceKind,
        inspect: impl FnOnce(&mut dyn std::io::Read) -> EpubResult<T>,
    ) -> EpubResult<T> {
        if matches!(resource_kind, ArchiveResourceKind::Image) {
            if let Some(entry) = self.archive_image_entries.get(href) {
                return archive.inspect_entry(entry, inspect);
            }
        }
        archive.inspect_bytes(&join_epub_href(&self.opf_dir, href), inspect)
    }
}
