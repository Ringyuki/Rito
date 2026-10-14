//! The reader-side shard store: the skeleton's file table plus the content
//! shards supplied so far. A read of a file whose shard has not arrived
//! fails as pending, naming that shard.

use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    fmt,
    rc::Rc,
};

use super::{
    container::{open_shard, shard_error},
    payload::{ContentPayload, FileLocation, ShardMedia, SkeletonPayload},
    ShardKey, ShardKind,
};
use crate::{
    epub::{archive::ArchiveEntryMetadata, EpubError, EpubResult},
    resources::IMAGE_DIMENSION_RULE_REVISION,
};

/// Shared handle: the document and every reader opened over it see the
/// same supplied shards.
#[derive(Clone)]
pub(crate) struct ShardStore(Rc<RefCell<ShardStoreState>>);

struct ShardStoreState {
    book_id: [u8; 16],
    files: Vec<StoredFile>,
    by_path: BTreeMap<String, usize>,
    shard_files: BTreeMap<u32, BTreeSet<usize>>,
    supplied: BTreeSet<u32>,
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
        if payload.dimension_rule_revision != IMAGE_DIMENSION_RULE_REVISION {
            return Err(shard_error(format!(
                "the shards were packed by an engine whose image dimension rule is revision {}, this engine's is {}; pack the publication again",
                payload.dimension_rule_revision, IMAGE_DIMENSION_RULE_REVISION
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
                FileLocation::Shard { shard_id, .. } => {
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
        Ok(header.shard_id)
    }

    /// The content shard holding `path`, and what kind of file it is.
    pub(crate) fn shard_of(&self, path: &str) -> Option<(u32, ShardMedia)> {
        let state = self.0.borrow();
        let index = state.resolve(path)?;
        match state.files[index].location {
            FileLocation::Shard {
                shard_id, media, ..
            } => Some((shard_id, media)),
            _ => None,
        }
    }

    /// Every content shard ordered by how far its first drawing chapter is
    /// from spine index `chapter`: that chapter, then the next, the
    /// previous, the one after next and so on; shards no chapter draws come
    /// last. Ties keep id order.
    pub(crate) fn content_shards_near(&self, chapter: u32) -> Vec<u32> {
        let state = self.0.borrow();
        let mut ranked = state
            .shard_files
            .iter()
            .map(|(shard_id, files)| {
                let first = files
                    .iter()
                    .filter_map(|index| match state.files[*index].location {
                        FileLocation::Shard { first_chapter, .. } => first_chapter,
                        _ => None,
                    })
                    .min();
                let rank = first.map_or(u64::MAX, |first| {
                    if first >= chapter {
                        2 * u64::from(first - chapter)
                    } else {
                        2 * u64::from(chapter - first) - 1
                    }
                });
                (rank, *shard_id)
            })
            .collect::<Vec<_>>();
        ranked.sort_unstable();
        ranked.into_iter().map(|(_, shard_id)| shard_id).collect()
    }

    pub(crate) fn read_bytes(&self, path: &str) -> EpubResult<Rc<Vec<u8>>> {
        let state = self.0.borrow();
        let index = state.resolve(path).ok_or_else(|| missing_entry(path))?;
        state.read_index(index)
    }

    pub(crate) fn read_entry(&self, entry: &ArchiveEntryMetadata) -> EpubResult<Rc<Vec<u8>>> {
        self.0.borrow().read_index(entry.entry_id)
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

    fn read_index(&self, index: usize) -> EpubResult<Rc<Vec<u8>>> {
        let file = &self.files[index];
        if let Some(bytes) = &file.bytes {
            return Ok(Rc::clone(bytes));
        }
        match &file.location {
            FileLocation::Shard { shard_id, .. } => {
                let shard_id = *shard_id;
                let message = format!(
                    "EPUB entry {:?} is in shard {shard_id}, which has not been supplied",
                    file.path
                );
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
