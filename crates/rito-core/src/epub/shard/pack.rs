//! Splitting an EPUB into shards.
//!
//! What the skeleton must carry is not listed by hand: the packer opens the
//! publication from a provisional skeleton that holds nothing, and every
//! file the engine's own open path asks for moves into the skeleton until
//! opening asks for nothing more. A change to what opening reads therefore
//! changes the packing with it.

use std::collections::{BTreeMap, BTreeSet};

use super::{
    container::{seal_shard, shard_error, ShardHeader},
    payload::{ContentPayload, FileLocation, SkeletonFile, SkeletonPayload},
    ShardKey, ShardKind, SHARD_KEY_BYTES,
};
use crate::{
    epub::{
        archive::{ArchiveEntryMetadata, EpubArchive, StoredEntry},
        join_epub_href, open_runtime_document_from_shards, EpubResult, LoadedEpubDocument,
    },
    xhtml::{scan_epub_type_attribute_hints, EpubTypeAttributeHint, EPUB_TYPE_HINT_SCAN_REVISION},
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PackOptions {
    /// Seal every shard, the skeleton included, with its own random key.
    pub encrypt: bool,
}

#[derive(Debug, Clone)]
pub struct PackedShard {
    pub shard_id: u32,
    pub bytes: Vec<u8>,
    /// Present exactly when the shard is encrypted.
    pub key: Option<ShardKey>,
    /// The archive paths the shard carries.
    pub files: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct PackedPublication {
    pub book_id: [u8; 16],
    pub skeleton: PackedShard,
    /// Content shards by ascending id: spine chapters first in reading
    /// order, then every other file in archive order.
    pub shards: Vec<PackedShard>,
}

struct SourceFile {
    entry: StoredEntry,
    read: Result<Vec<u8>, String>,
}

/// Splits `epub` into a skeleton and content shards. `random` fills the
/// book id and, when encrypting, every key and nonce; it must be a
/// cryptographically secure source.
pub fn pack_publication(
    epub: &[u8],
    options: PackOptions,
    random: &mut dyn FnMut(&mut [u8]),
) -> EpubResult<PackedPublication> {
    let sources = read_sources(epub)?;
    let inline = skeleton_files(&sources)?;
    let document = provisional_document(&sources, &inline, Vec::new())?;
    let assignment = assign_shards(&sources, &inline, &document);
    let footnote_hints = chapter_footnote_hints(&sources, &document);

    let mut book_id = [0u8; 16];
    random(&mut book_id);
    let skeleton_payload = skeleton_payload(&sources, &inline, &assignment, footnote_hints);
    let skeleton = seal(
        ShardKind::Skeleton,
        0,
        book_id,
        &skeleton_payload.encode(),
        options,
        random,
        inline
            .iter()
            .map(|index| sources[*index].entry.name.clone())
            .collect(),
    )?;
    let mut shards = Vec::new();
    for (shard_id, members) in &assignment.members {
        let files = members
            .iter()
            .map(|index| {
                let source = &sources[*index];
                let bytes = source
                    .read
                    .as_ref()
                    .expect("only readable files are assigned");
                (source.entry.name.clone(), bytes.clone())
            })
            .collect::<Vec<_>>();
        let names = files.iter().map(|(name, _)| name.clone()).collect();
        let payload = ContentPayload { files }.encode();
        shards.push(seal(
            ShardKind::Content,
            *shard_id,
            book_id,
            &payload,
            options,
            random,
            names,
        )?);
    }
    Ok(PackedPublication {
        book_id,
        skeleton,
        shards,
    })
}

fn read_sources(epub: &[u8]) -> EpubResult<Vec<SourceFile>> {
    let mut archive = EpubArchive::new(epub)?;
    let entries = archive.stored_file_entries()?;
    Ok(entries
        .into_iter()
        .map(|entry| {
            let metadata = ArchiveEntryMetadata {
                entry_id: entry.entry_id,
                path: entry.name.clone(),
                byte_length: usize::try_from(entry.byte_length).unwrap_or(usize::MAX),
            };
            let read = archive
                .read_entry_bytes(&metadata)
                .map_err(|error| error.message().to_owned());
            SourceFile { entry, read }
        })
        .collect())
}

/// Grows the skeleton until opening from it reads nothing else.
fn skeleton_files(sources: &[SourceFile]) -> EpubResult<BTreeSet<usize>> {
    let mut inline = BTreeSet::new();
    loop {
        let skeleton = provisional_skeleton(sources, &inline, Vec::new());
        let sealed = seal_plain(ShardKind::Skeleton, 0, &skeleton.encode())?;
        let opened = open_runtime_document_from_shards(&sealed, None);
        let pending = match &opened {
            Ok(document) => document.pending_shards(),
            Err(error) => error.pending_shards().to_vec(),
        };
        let pending = pending
            .into_iter()
            .map(|shard_id| shard_id as usize - 1)
            .filter(|index| !inline.contains(index))
            .collect::<Vec<_>>();
        if pending.is_empty() {
            opened?;
            return Ok(inline);
        }
        inline.extend(pending);
    }
}

/// A skeleton in which every file outside `inline` sits alone in a shard
/// numbered by its archive position.
fn provisional_skeleton(
    sources: &[SourceFile],
    inline: &BTreeSet<usize>,
    footnote_hints: Vec<Vec<EpubTypeAttributeHint>>,
) -> SkeletonPayload {
    let assignment = sources
        .iter()
        .enumerate()
        .map(|(index, _)| (index, index as u32 + 1))
        .collect::<BTreeMap<_, _>>();
    skeleton_payload_with(sources, inline, &assignment, footnote_hints)
}

fn provisional_document(
    sources: &[SourceFile],
    inline: &BTreeSet<usize>,
    footnote_hints: Vec<Vec<EpubTypeAttributeHint>>,
) -> EpubResult<LoadedEpubDocument> {
    let skeleton = provisional_skeleton(sources, inline, footnote_hints);
    open_runtime_document_from_shards(
        &seal_plain(ShardKind::Skeleton, 0, &skeleton.encode())?,
        None,
    )
}

struct ShardAssignment {
    by_file: BTreeMap<usize, u32>,
    members: BTreeMap<u32, Vec<usize>>,
}

/// Each spine chapter gets a shard holding it and the images no other
/// chapter or stylesheet references; every remaining readable file gets a
/// shard of its own.
fn assign_shards(
    sources: &[SourceFile],
    inline: &BTreeSet<usize>,
    document: &LoadedEpubDocument,
) -> ShardAssignment {
    let by_name = sources
        .iter()
        .enumerate()
        .map(|(index, source)| (source.entry.name.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let shardable = |index: &usize| !inline.contains(index) && sources[*index].read.is_ok();
    let chapter_files = chapter_file_indices(document, &by_name)
        .into_iter()
        .filter(|index| shardable(index))
        .collect::<Vec<_>>();
    let exclusive_images = exclusive_chapter_images(sources, &chapter_files, document, &by_name);

    let mut assignment = ShardAssignment {
        by_file: BTreeMap::new(),
        members: BTreeMap::new(),
    };
    let mut next_id = 1u32;
    for chapter in &chapter_files {
        let mut members = vec![*chapter];
        members.extend(
            exclusive_images
                .get(chapter)
                .into_iter()
                .flatten()
                .filter(|index| shardable(index)),
        );
        assignment.place(next_id, members);
        next_id += 1;
    }
    for index in 0..sources.len() {
        if shardable(&index) && !assignment.by_file.contains_key(&index) {
            assignment.place(next_id, vec![index]);
            next_id += 1;
        }
    }
    assignment
}

impl ShardAssignment {
    fn place(&mut self, shard_id: u32, members: Vec<usize>) {
        for index in &members {
            self.by_file.insert(*index, shard_id);
        }
        self.members.insert(shard_id, members);
    }
}

/// Spine chapter files in reading order, each once.
fn chapter_file_indices(
    document: &LoadedEpubDocument,
    by_name: &BTreeMap<&str, usize>,
) -> Vec<usize> {
    let mut seen = BTreeSet::new();
    document
        .chapters
        .iter()
        .filter(|chapter| !chapter.href.is_empty())
        .filter_map(|chapter| {
            let path = join_epub_href(document.opf_dir(), &chapter.href);
            let name = document.resolve_archive_name(&path)?;
            by_name.get(name.as_str()).copied()
        })
        .filter(|index| seen.insert(*index))
        .collect()
}

/// Images referenced by exactly one chapter and by no stylesheet, keyed by
/// that chapter's file.
fn exclusive_chapter_images(
    sources: &[SourceFile],
    chapter_files: &[usize],
    document: &LoadedEpubDocument,
    by_name: &BTreeMap<&str, usize>,
) -> BTreeMap<usize, Vec<usize>> {
    let mut referencing: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
    for chapter in chapter_files {
        let Ok(bytes) = &sources[*chapter].read else {
            continue;
        };
        let text = String::from_utf8_lossy(bytes);
        for path in document.image_paths_referenced_by(&text) {
            if let Some(index) = document
                .resolve_archive_name(&path)
                .and_then(|name| by_name.get(name.as_str()).copied())
            {
                referencing.entry(index).or_default().insert(*chapter);
            }
        }
    }
    let stylesheet_text = document
        .stylesheets
        .iter()
        .map(|sheet| sheet.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let mut exclusive: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (image, chapters) in referencing {
        let file_name = sources[image]
            .entry
            .name
            .rsplit('/')
            .next()
            .unwrap_or_default();
        if chapters.len() != 1 || stylesheet_text.contains(file_name) {
            continue;
        }
        let chapter = *chapters.iter().next().expect("one chapter");
        exclusive.entry(chapter).or_default().push(image);
    }
    exclusive
}

/// The footnote attribute scan of every spine item, exactly as the
/// publication footnote index scans it from a whole archive.
fn chapter_footnote_hints(
    sources: &[SourceFile],
    document: &LoadedEpubDocument,
) -> Vec<Vec<EpubTypeAttributeHint>> {
    let by_name = sources
        .iter()
        .map(|source| (source.entry.name.as_str(), source))
        .collect::<BTreeMap<_, _>>();
    document
        .chapters
        .iter()
        .map(|chapter| {
            if chapter.href.is_empty() {
                return scan_epub_type_attribute_hints("").unwrap_or_default();
            }
            let path = join_epub_href(document.opf_dir(), &chapter.href);
            let text = document
                .resolve_archive_name(&path)
                .and_then(|name| by_name.get(name.as_str()).copied())
                .and_then(|source| source.read.as_ref().ok())
                .and_then(|bytes| String::from_utf8(bytes.clone()).ok());
            match text {
                Some(text) => scan_epub_type_attribute_hints(&text).unwrap_or_default(),
                None => Vec::new(),
            }
        })
        .collect()
}

fn skeleton_payload(
    sources: &[SourceFile],
    inline: &BTreeSet<usize>,
    assignment: &ShardAssignment,
    footnote_hints: Vec<Vec<EpubTypeAttributeHint>>,
) -> SkeletonPayload {
    skeleton_payload_with(sources, inline, &assignment.by_file, footnote_hints)
}

fn skeleton_payload_with(
    sources: &[SourceFile],
    inline: &BTreeSet<usize>,
    shard_of: &BTreeMap<usize, u32>,
    footnote_hints: Vec<Vec<EpubTypeAttributeHint>>,
) -> SkeletonPayload {
    let files = sources
        .iter()
        .enumerate()
        .map(|(index, source)| {
            let location = match &source.read {
                Err(reason) => FileLocation::Unreadable(reason.clone()),
                Ok(bytes) if inline.contains(&index) => FileLocation::Inline(bytes.clone()),
                Ok(_) => FileLocation::Shard(shard_of[&index]),
            };
            SkeletonFile {
                path: source.entry.name.clone(),
                byte_length: source.entry.byte_length,
                listed: source.entry.listed,
                location,
            }
        })
        .collect();
    SkeletonPayload {
        hint_scan_revision: EPUB_TYPE_HINT_SCAN_REVISION,
        files,
        footnote_hints,
    }
}

fn seal_plain(kind: ShardKind, shard_id: u32, payload: &[u8]) -> EpubResult<Vec<u8>> {
    let header = ShardHeader {
        kind,
        encrypted: false,
        compressed: false,
        book_id: [0u8; 16],
        shard_id,
        nonce: [0u8; 24],
    };
    seal_shard(header, payload, None)
}

fn seal(
    kind: ShardKind,
    shard_id: u32,
    book_id: [u8; 16],
    payload: &[u8],
    options: PackOptions,
    random: &mut dyn FnMut(&mut [u8]),
    files: Vec<String>,
) -> EpubResult<PackedShard> {
    let mut nonce = [0u8; 24];
    let key = options.encrypt.then(|| {
        let mut key = [0u8; SHARD_KEY_BYTES];
        random(&mut key);
        random(&mut nonce);
        ShardKey::from_bytes(key)
    });
    if key
        .as_ref()
        .is_some_and(|key| key.as_bytes() == &[0u8; SHARD_KEY_BYTES])
    {
        return Err(shard_error("the random source produced an all-zero key"));
    }
    let header = ShardHeader {
        kind,
        encrypted: key.is_some(),
        compressed: false,
        book_id,
        shard_id,
        nonce,
    };
    let bytes = seal_shard(header, payload, key.as_ref())?;
    Ok(PackedShard {
        shard_id,
        bytes,
        key,
        files,
    })
}
