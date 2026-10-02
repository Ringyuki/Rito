//! Splitting an EPUB into shards.
//!
//! The skeleton carries every file layout reads (chapters, stylesheets,
//! fonts, navigation) and the intrinsic dimensions of every image, so a
//! reader lays the whole book out from the skeleton alone. Each image and
//! each audio or video file becomes a content shard of its own: images are
//! nearly all of a publication's bytes and only painting needs them.

use std::collections::BTreeMap;

use super::{
    container::{seal_shard, shard_error, ShardHeader},
    payload::{ContentPayload, FileLocation, ShardMedia, SkeletonFile, SkeletonPayload},
    ShardKey, ShardKind, SHARD_KEY_BYTES,
};
use crate::{
    epub::{
        archive::{ArchiveEntryMetadata, EpubArchive, StoredEntry},
        join_epub_href, open_runtime_document, EpubResult, LoadedEpubDocument,
    },
    resources::{detect_image_dimensions, IMAGE_DIMENSION_RULE_REVISION},
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
    /// Content shards by ascending id, one per image, audio or video file
    /// in archive order.
    pub shards: Vec<PackedShard>,
}

struct SourceFile {
    entry: StoredEntry,
    read: Result<Vec<u8>, String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MediaKind {
    Image,
    Other,
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
    let media = media_files(&open_runtime_document(epub)?);

    let mut book_id = [0u8; 16];
    random(&mut book_id);
    let mut files = Vec::with_capacity(sources.len());
    let mut inline_names = Vec::new();
    let mut shards = Vec::new();
    for source in &sources {
        let name = &source.entry.name;
        let location = match (&source.read, media.get(name)) {
            (Err(reason), _) => FileLocation::Unreadable(reason.clone()),
            (Ok(bytes), None) => {
                inline_names.push(name.clone());
                FileLocation::Inline(bytes.clone())
            }
            (Ok(bytes), Some(kind)) => {
                let shard_id = u32::try_from(shards.len() + 1)
                    .map_err(|_| shard_error("too many content shards"))?;
                let payload = ContentPayload {
                    files: vec![(name.clone(), bytes.clone())],
                }
                .encode();
                shards.push(seal(
                    ShardKind::Content,
                    shard_id,
                    book_id,
                    &payload,
                    options,
                    random,
                    vec![name.clone()],
                )?);
                let media = match kind {
                    MediaKind::Image => ShardMedia::Image(detect_image_dimensions(bytes)),
                    MediaKind::Other => ShardMedia::Other,
                };
                FileLocation::Shard { shard_id, media }
            }
        };
        files.push(SkeletonFile {
            path: name.clone(),
            byte_length: source.entry.byte_length,
            listed: source.entry.listed,
            location,
        });
    }
    let skeleton_payload = SkeletonPayload {
        dimension_rule_revision: IMAGE_DIMENSION_RULE_REVISION,
        files,
    };
    let skeleton = seal(
        ShardKind::Skeleton,
        0,
        book_id,
        &skeleton_payload.encode(),
        options,
        random,
        inline_names,
    )?;
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

/// The archive files only painting reads: every image the engine knows
/// (declared or found in the archive) and every audio or video item. A
/// spine document is never one of them, whatever its media type.
fn media_files(document: &LoadedEpubDocument) -> BTreeMap<String, MediaKind> {
    let chapters = document
        .chapters
        .iter()
        .filter(|chapter| !chapter.href.is_empty())
        .filter_map(|chapter| {
            document.resolve_archive_name(&join_epub_href(document.opf_dir(), &chapter.href))
        })
        .collect::<std::collections::BTreeSet<_>>();
    let mut media = BTreeMap::new();
    for name in document.image_archive_names() {
        media.insert(name, MediaKind::Image);
    }
    for item in &document.package.manifest {
        if !(item.media_type.starts_with("audio/") || item.media_type.starts_with("video/")) {
            continue;
        }
        if let Some(name) =
            document.resolve_archive_name(&join_epub_href(document.opf_dir(), &item.href))
        {
            media.entry(name).or_insert(MediaKind::Other);
        }
    }
    media.retain(|name, _| !chapters.contains(name));
    media
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
