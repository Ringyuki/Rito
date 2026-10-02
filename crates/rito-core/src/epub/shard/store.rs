//! The reader-side shard store: the skeleton's file table plus the content
//! shards supplied so far. A read of a file whose shard has not arrived
//! fails as pending and is remembered, so the host can ask which shards
//! the engine is waiting for.

use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    fmt,
    rc::Rc,
};

use super::{
    container::{open_shard, shard_error},
    payload::{ContentPayload, FileLocation, SkeletonPayload},
    ShardKey, ShardKind,
};
use crate::{
    epub::{archive::ArchiveEntryMetadata, EpubError, EpubResult},
    xhtml::{EpubTypeAttributeHint, EPUB_TYPE_HINT_SCAN_REVISION},
};

/// Shared handle: the document and every reader opened over it see the
/// same supplied shards and the same pending set.
#[derive(Clone)]
pub(crate) struct ShardStore(Rc<RefCell<ShardStoreState>>);

struct ShardStoreState {
    book_id: [u8; 16],
    files: Vec<StoredFile>,
    by_path: BTreeMap<String, usize>,
    shard_files: BTreeMap<u32, BTreeSet<usize>>,
    supplied: BTreeSet<u32>,
    pending: BTreeSet<u32>,
    footnote_hints: Vec<Vec<EpubTypeAttributeHint>>,
}

struct StoredFile {
    path: String,
    byte_length: u64,
    listed: bool,
    location: FileLocation,
    bytes: Option<Rc<Vec<u8>>>,
}

impl fmt::Debug for ShardStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let state = self.0.borrow();
        formatter
            .debug_struct("ShardStore")
            .field("files", &state.files.len())
            .field("shards", &state.shard_files.len())
            .field("supplied", &state.supplied)
            .field("pending", &state.pending)
            .finish()
    }
}

impl PartialEq for ShardStore {
    fn eq(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }
}

impl Eq for ShardStore {}

impl ShardStore {
    pub(crate) fn open(skeleton: &[u8], key: Option<&ShardKey>) -> EpubResult<Self> {
        let (header, payload) = open_shard(skeleton, key)?;
        if header.kind != ShardKind::Skeleton {
            return Err(shard_error("a publication opens from its skeleton shard"));
        }
        let payload = SkeletonPayload::decode(&payload)?;
        if payload.hint_scan_revision != EPUB_TYPE_HINT_SCAN_REVISION {
            return Err(shard_error(format!(
                "the shards were packed by an engine whose footnote scan is revision {}, this engine's is {}; pack the publication again",
                payload.hint_scan_revision, EPUB_TYPE_HINT_SCAN_REVISION
            )));
        }
        let mut by_path = BTreeMap::new();
        let mut shard_files: BTreeMap<u32, BTreeSet<usize>> = BTreeMap::new();
        let mut files = Vec::with_capacity(payload.files.len());
        for (index, file) in payload.files.into_iter().enumerate() {
            if by_path.insert(file.path.clone(), index).is_some() {
                return Err(shard_error(format!("duplicate file {:?}", file.path)));
            }
            let bytes = match &file.location {
                FileLocation::Inline(bytes) => Some(Rc::new(bytes.clone())),
                FileLocation::Shard(shard_id) => {
                    shard_files.entry(*shard_id).or_default().insert(index);
                    None
                }
                FileLocation::Unreadable(_) => None,
            };
            files.push(StoredFile {
                path: file.path,
                byte_length: file.byte_length,
                listed: file.listed,
                location: file.location,
                bytes,
            });
        }
        Ok(Self(Rc::new(RefCell::new(ShardStoreState {
            book_id: header.book_id,
            files,
            by_path,
            shard_files,
            supplied: BTreeSet::new(),
            pending: BTreeSet::new(),
            footnote_hints: payload.footnote_hints,
        }))))
    }

    /// Verifies one content shard against the skeleton and keeps its
    /// files. Supplying a shard twice is harmless. Returns its id.
    pub(crate) fn supply(&self, shard: &[u8], key: Option<&ShardKey>) -> EpubResult<u32> {
        let (header, payload) = open_shard(shard, key)?;
        let mut state = self.0.borrow_mut();
        if header.kind != ShardKind::Content {
            return Err(shard_error("only content shards can be supplied"));
        }
        if header.book_id != state.book_id {
            return Err(shard_error(format!(
                "shard {} belongs to another packed publication",
                header.shard_id
            )));
        }
        let Some(expected) = state.shard_files.get(&header.shard_id).cloned() else {
            return Err(shard_error(format!(
                "the skeleton declares no shard {}",
                header.shard_id
            )));
        };
        let payload = ContentPayload::decode(&payload)?;
        let mut received = BTreeMap::new();
        for (path, bytes) in payload.files {
            let index = state
                .by_path
                .get(&path)
                .copied()
                .filter(|index| expected.contains(index))
                .ok_or_else(|| {
                    shard_error(format!(
                        "shard {} carries {path:?}, which the skeleton places elsewhere",
                        header.shard_id
                    ))
                })?;
            if bytes.len() as u64 != state.files[index].byte_length {
                return Err(shard_error(format!(
                    "shard {} carries {path:?} with a length the skeleton does not declare",
                    header.shard_id
                )));
            }
            received.insert(index, bytes);
        }
        if received.len() != expected.len() {
            return Err(shard_error(format!(
                "shard {} does not carry every file the skeleton places in it",
                header.shard_id
            )));
        }
        for (index, bytes) in received {
            state.files[index].bytes = Some(Rc::new(bytes));
        }
        state.supplied.insert(header.shard_id);
        state.pending.remove(&header.shard_id);
        Ok(header.shard_id)
    }

    /// Shards a read has needed and not received, ascending.
    pub(crate) fn pending_shards(&self) -> Vec<u32> {
        self.0.borrow().pending.iter().copied().collect()
    }

    /// Whether reading `path` would not wait on a shard.
    pub(crate) fn is_available(&self, path: &str) -> bool {
        let state = self.0.borrow();
        state.resolve(path).is_none_or(|index| {
            let file = &state.files[index];
            file.bytes.is_some() || !matches!(file.location, FileLocation::Shard(_))
        })
    }

    /// The shard holding `path`, when a content shard holds it.
    pub(crate) fn shard_of(&self, path: &str) -> Option<u32> {
        let state = self.0.borrow();
        let index = state.resolve(path)?;
        match state.files[index].location {
            FileLocation::Shard(shard_id) => Some(shard_id),
            _ => None,
        }
    }

    pub(crate) fn footnote_hints(
        &self,
        chapter_index: usize,
    ) -> Option<Vec<EpubTypeAttributeHint>> {
        self.0.borrow().footnote_hints.get(chapter_index).cloned()
    }

    pub(crate) fn read_bytes(&self, path: &str) -> EpubResult<Rc<Vec<u8>>> {
        let mut state = self.0.borrow_mut();
        let index = state.resolve(path).ok_or_else(|| missing_entry(path))?;
        state.read_index(index)
    }

    pub(crate) fn read_entry(&self, entry: &ArchiveEntryMetadata) -> EpubResult<Rc<Vec<u8>>> {
        self.0.borrow_mut().read_index(entry.entry_id)
    }

    pub(crate) fn entry_size(&self, path: &str) -> EpubResult<usize> {
        let state = self.0.borrow();
        let index = state.resolve(path).ok_or_else(|| missing_entry(path))?;
        usize::try_from(state.files[index].byte_length)
            .map_err(|_| EpubError::new(format!("EPUB entry {path:?} is too large")))
    }

    pub(crate) fn entry_metadata(&self, path: &str) -> EpubResult<ArchiveEntryMetadata> {
        let state = self.0.borrow();
        let index = state.resolve(path).ok_or_else(|| missing_entry(path))?;
        state.metadata(index).ok_or_else(|| {
            EpubError::new(format!(
                "EPUB entry is not a safe canonical file path: {path:?}"
            ))
        })
    }

    pub(crate) fn file_entries(&self) -> Vec<ArchiveEntryMetadata> {
        let state = self.0.borrow();
        (0..state.files.len())
            .filter_map(|index| state.metadata(index))
            .collect()
    }

    /// The archive name `path` resolves to.
    pub(crate) fn resolve_name(&self, path: &str) -> Option<String> {
        let state = self.0.borrow();
        state
            .resolve(path)
            .map(|index| state.files[index].path.clone())
    }
}

impl ShardStoreState {
    fn resolve(&self, path: &str) -> Option<usize> {
        if let Some(index) = self.by_path.get(path) {
            return Some(*index);
        }
        let normalized = crate::epub::archive::decoded_entry_path(path)?;
        self.by_path.get(&normalized).copied()
    }

    fn read_index(&mut self, index: usize) -> EpubResult<Rc<Vec<u8>>> {
        let file = &self.files[index];
        if let Some(bytes) = &file.bytes {
            return Ok(Rc::clone(bytes));
        }
        match &file.location {
            FileLocation::Shard(shard_id) => {
                let shard_id = *shard_id;
                let message = format!(
                    "EPUB entry {:?} is in shard {shard_id}, which has not been supplied",
                    file.path
                );
                self.pending.insert(shard_id);
                Err(EpubError::shards_pending(vec![shard_id], message))
            }
            FileLocation::Unreadable(reason) => Err(EpubError::new(reason.clone())),
            FileLocation::Inline(_) => unreachable!("inline files keep their bytes"),
        }
    }

    fn metadata(&self, index: usize) -> Option<ArchiveEntryMetadata> {
        let file = self.files.get(index)?;
        if !file.listed {
            return None;
        }
        Some(ArchiveEntryMetadata {
            entry_id: index,
            path: file.path.clone(),
            byte_length: usize::try_from(file.byte_length).ok()?,
        })
    }
}

fn missing_entry(path: &str) -> EpubError {
    crate::epub::archive::missing_entry(path)
}
