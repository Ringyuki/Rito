//! One reader over a publication's files, whichever form they arrived in:
//! a whole EPUB archive, or a skeleton shard plus the content shards
//! supplied so far. Opening, the table of contents and lazy resource loads
//! all read through it, so both forms are interpreted by the same code.

use std::io::Cursor;

use super::{
    archive::{ArchiveEntryMetadata, EpubArchive},
    shard::ShardStore,
    EpubError, EpubResult,
};

pub(crate) enum PublicationReader<'a> {
    Archive(EpubArchive<'a>),
    Shards(ShardStore),
}

impl PublicationReader<'_> {
    pub(crate) fn read_text(&mut self, path: &str) -> EpubResult<String> {
        match self {
            Self::Archive(archive) => archive.read_text(path),
            Self::Shards(store) => {
                let bytes = store.read_bytes(path)?;
                String::from_utf8(bytes.to_vec()).map_err(|error| {
                    EpubError::new(format!("EPUB entry {path:?} is not valid UTF-8: {error}"))
                })
            }
        }
    }

    pub(crate) fn read_bytes(&mut self, path: &str) -> EpubResult<Vec<u8>> {
        match self {
            Self::Archive(archive) => archive.read_bytes(path),
            Self::Shards(store) => Ok(store.read_bytes(path)?.to_vec()),
        }
    }

    pub(crate) fn read_entry_bytes(&mut self, entry: &ArchiveEntryMetadata) -> EpubResult<Vec<u8>> {
        match self {
            Self::Archive(archive) => archive.read_entry_bytes(entry),
            Self::Shards(store) => Ok(store.read_entry(entry)?.to_vec()),
        }
    }

    pub(crate) fn inspect_bytes<T>(
        &mut self,
        path: &str,
        inspect: impl FnOnce(&mut dyn std::io::Read) -> EpubResult<T>,
    ) -> EpubResult<T> {
        match self {
            Self::Archive(archive) => archive.inspect_bytes(path, inspect),
            Self::Shards(store) => {
                let bytes = store.read_bytes(path)?;
                inspect(&mut Cursor::new(bytes.as_slice()))
            }
        }
    }

    pub(crate) fn inspect_entry<T>(
        &mut self,
        entry: &ArchiveEntryMetadata,
        inspect: impl FnOnce(&mut dyn std::io::Read) -> EpubResult<T>,
    ) -> EpubResult<T> {
        match self {
            Self::Archive(archive) => archive.inspect_entry(entry, inspect),
            Self::Shards(store) => {
                let bytes = store.read_entry(entry)?;
                inspect(&mut Cursor::new(bytes.as_slice()))
            }
        }
    }

    pub(crate) fn entry_size(&mut self, path: &str) -> EpubResult<usize> {
        match self {
            Self::Archive(archive) => archive.entry_size(path),
            Self::Shards(store) => store.entry_size(path),
        }
    }

    pub(crate) fn entry_metadata(&mut self, path: &str) -> EpubResult<ArchiveEntryMetadata> {
        match self {
            Self::Archive(archive) => archive.entry_metadata(path),
            Self::Shards(store) => store.entry_metadata(path),
        }
    }

    pub(crate) fn file_entries(&mut self) -> Vec<ArchiveEntryMetadata> {
        match self {
            Self::Archive(archive) => archive.file_entries(),
            Self::Shards(store) => store.file_entries(),
        }
    }
}

/// Collects the pending reads of a batch so one failure names every shard
/// the batch needs, letting the host fetch them together. Any other error
/// still stops the batch at once.
#[derive(Default)]
pub(crate) struct PendingReads {
    shards: Vec<u32>,
    first_message: Option<String>,
}

impl PendingReads {
    pub(crate) fn absorb<T>(&mut self, result: EpubResult<T>) -> EpubResult<Option<T>> {
        match result {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.is_pending() => {
                self.shards.extend_from_slice(error.pending_shards());
                self.first_message
                    .get_or_insert_with(|| error.message().to_owned());
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    pub(crate) fn finish(self) -> EpubResult<()> {
        match self.first_message {
            None => Ok(()),
            Some(message) => Err(EpubError::shards_pending(self.shards, message)),
        }
    }
}
