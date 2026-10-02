//! Shard payload layouts. Every integer is little-endian; a string is a
//! `u32` byte length and UTF-8, a byte block is a `u64` length and bytes.
//!
//! Skeleton payload: the image dimension rule revision, then the
//! publication's file table in archive order. A file the skeleton does not
//! carry names its content shard and what kind of file it is; an image also
//! carries the intrinsic dimensions the engine lays it out with.
//! Content payload: the files the shard carries, as path and bytes.

use super::container::shard_error;
use crate::epub::EpubResult;

const LOCATION_INLINE: u8 = 0;
const LOCATION_SHARD: u8 = 1;
const LOCATION_UNREADABLE: u8 = 2;
const MEDIA_OTHER: u8 = 0;
const MEDIA_IMAGE_WITHOUT_DIMENSIONS: u8 = 1;
const MEDIA_IMAGE: u8 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShardMedia {
    /// An image, with the dimensions its header declares (none when the
    /// header names no size the engine reads).
    Image(Option<(u32, u32)>),
    /// A file layout never reads (audio, video).
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FileLocation {
    /// Carried by the skeleton itself.
    Inline(Vec<u8>),
    /// Carried by the content shard with this id.
    Shard { shard_id: u32, media: ShardMedia },
    /// The source archive could not produce this entry; reading it fails
    /// with the archive's own reason.
    Unreadable(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SkeletonFile {
    pub(crate) path: String,
    pub(crate) byte_length: u64,
    /// Whether the archive's file listing reports the entry (a safe,
    /// canonical, non-duplicate path).
    pub(crate) listed: bool,
    pub(crate) location: FileLocation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SkeletonPayload {
    pub(crate) dimension_rule_revision: u32,
    pub(crate) files: Vec<SkeletonFile>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ContentPayload {
    pub(crate) files: Vec<(String, Vec<u8>)>,
}

impl SkeletonPayload {
    pub(crate) fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        put_u32(&mut out, self.dimension_rule_revision);
        put_len(&mut out, self.files.len());
        for file in &self.files {
            put_string(&mut out, &file.path);
            out.extend_from_slice(&file.byte_length.to_le_bytes());
            out.push(u8::from(file.listed));
            match &file.location {
                FileLocation::Inline(bytes) => {
                    out.push(LOCATION_INLINE);
                    put_bytes(&mut out, bytes);
                }
                FileLocation::Shard { shard_id, media } => {
                    out.push(LOCATION_SHARD);
                    put_u32(&mut out, *shard_id);
                    put_media(&mut out, *media);
                }
                FileLocation::Unreadable(reason) => {
                    out.push(LOCATION_UNREADABLE);
                    put_string(&mut out, reason);
                }
            }
        }
        out
    }

    pub(crate) fn decode(bytes: &[u8]) -> EpubResult<Self> {
        let mut reader = PayloadReader::new(bytes);
        let dimension_rule_revision = reader.u32()?;
        let file_count = reader.count()?;
        let mut files = Vec::new();
        for _ in 0..file_count {
            let path = reader.string()?;
            let byte_length = reader.u64()?;
            let listed = reader.flag()?;
            let location = match reader.u8()? {
                LOCATION_INLINE => {
                    let inline = reader.bytes()?.to_vec();
                    if inline.len() as u64 != byte_length {
                        return Err(shard_error(format!(
                            "inline file {path:?} does not match its byte length"
                        )));
                    }
                    FileLocation::Inline(inline)
                }
                LOCATION_SHARD => {
                    let shard_id = reader.u32()?;
                    if shard_id == 0 {
                        return Err(shard_error("a file names the skeleton as its shard"));
                    }
                    FileLocation::Shard {
                        shard_id,
                        media: reader.media()?,
                    }
                }
                LOCATION_UNREADABLE => FileLocation::Unreadable(reader.string()?),
                other => return Err(shard_error(format!("unknown file location {other}"))),
            };
            files.push(SkeletonFile {
                path,
                byte_length,
                listed,
                location,
            });
        }
        reader.finish()?;
        Ok(Self {
            dimension_rule_revision,
            files,
        })
    }
}

impl ContentPayload {
    pub(crate) fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        put_len(&mut out, self.files.len());
        for (path, bytes) in &self.files {
            put_string(&mut out, path);
            put_bytes(&mut out, bytes);
        }
        out
    }

    pub(crate) fn decode(bytes: &[u8]) -> EpubResult<Self> {
        let mut reader = PayloadReader::new(bytes);
        let count = reader.count()?;
        let mut files = Vec::new();
        for _ in 0..count {
            files.push((reader.string()?, reader.bytes()?.to_vec()));
        }
        reader.finish()?;
        Ok(Self { files })
    }
}

fn put_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn put_len(out: &mut Vec<u8>, length: usize) {
    put_u32(
        out,
        u32::try_from(length).expect("shard collections stay below u32::MAX entries"),
    );
}

fn put_string(out: &mut Vec<u8>, value: &str) {
    put_len(out, value.len());
    out.extend_from_slice(value.as_bytes());
}

fn put_bytes(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
    out.extend_from_slice(bytes);
}

fn put_media(out: &mut Vec<u8>, media: ShardMedia) {
    match media {
        ShardMedia::Other => out.push(MEDIA_OTHER),
        ShardMedia::Image(None) => out.push(MEDIA_IMAGE_WITHOUT_DIMENSIONS),
        ShardMedia::Image(Some((width, height))) => {
            out.push(MEDIA_IMAGE);
            put_u32(out, width);
            put_u32(out, height);
        }
    }
}

struct PayloadReader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> PayloadReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, length: usize) -> EpubResult<&'a [u8]> {
        let end = self
            .offset
            .checked_add(length)
            .filter(|end| *end <= self.bytes.len())
            .ok_or_else(|| shard_error("payload ends early"))?;
        let slice = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(slice)
    }

    fn u8(&mut self) -> EpubResult<u8> {
        Ok(self.take(1)?[0])
    }

    fn flag(&mut self) -> EpubResult<bool> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            other => Err(shard_error(format!("invalid flag byte {other}"))),
        }
    }

    fn u32(&mut self) -> EpubResult<u32> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().expect("four bytes"),
        ))
    }

    fn u64(&mut self) -> EpubResult<u64> {
        Ok(u64::from_le_bytes(
            self.take(8)?.try_into().expect("eight bytes"),
        ))
    }

    /// A collection length; each element takes at least one byte, so a
    /// length beyond the remaining bytes is rejected before allocating.
    fn count(&mut self) -> EpubResult<usize> {
        let count = self.u32()? as usize;
        if count > self.bytes.len() - self.offset {
            return Err(shard_error("collection length exceeds the payload"));
        }
        Ok(count)
    }

    fn bytes(&mut self) -> EpubResult<&'a [u8]> {
        let length =
            usize::try_from(self.u64()?).map_err(|_| shard_error("byte block length overflows"))?;
        self.take(length)
    }

    fn string(&mut self) -> EpubResult<String> {
        let length = self.u32()? as usize;
        let bytes = self.take(length)?;
        String::from_utf8(bytes.to_vec()).map_err(|_| shard_error("string is not UTF-8"))
    }

    fn media(&mut self) -> EpubResult<ShardMedia> {
        match self.u8()? {
            MEDIA_OTHER => Ok(ShardMedia::Other),
            MEDIA_IMAGE_WITHOUT_DIMENSIONS => Ok(ShardMedia::Image(None)),
            MEDIA_IMAGE => Ok(ShardMedia::Image(Some((self.u32()?, self.u32()?)))),
            other => Err(shard_error(format!("unknown shard media {other}"))),
        }
    }

    fn finish(self) -> EpubResult<()> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(shard_error("payload has trailing bytes"))
        }
    }
}
