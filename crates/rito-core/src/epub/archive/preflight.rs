use std::collections::HashSet;

use super::{EpubError, EpubResult};

const END_OF_CENTRAL_DIRECTORY_SIGNATURE: u32 = 0x0605_4b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE: u32 = 0x0606_4b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE: u32 = 0x0706_4b50;
const CENTRAL_DIRECTORY_ENTRY_SIGNATURE: u32 = 0x0201_4b50;
const END_OF_CENTRAL_DIRECTORY_BYTES: usize = 22;
const MAX_ZIP_COMMENT_BYTES: usize = u16::MAX as usize;
const CENTRAL_DIRECTORY_ENTRY_HEADER_BYTES: usize = 46;
const ZIP64_SENTINEL_U16: u16 = u16::MAX;
const ZIP64_SENTINEL_U32: u32 = u32::MAX;

pub(super) const MAX_ARCHIVE_BYTES: usize = 512 * 1024 * 1024;
pub(super) const MAX_ARCHIVE_ENTRIES: usize = 10_000;
pub(super) const MAX_ENTRY_UNCOMPRESSED_BYTES: u64 = 128 * 1024 * 1024;
pub(super) const MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 512 * 1024 * 1024;
pub(super) const MAX_COMPRESSION_RATIO: u64 = 200;

pub(super) fn validate(bytes: &[u8]) -> EpubResult<ValidatedArchive> {
    if bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(archive_limit_error(
            "archive byte length",
            MAX_ARCHIVE_BYTES,
        ));
    }
    let directory = find_central_directory(bytes)?;
    let entry_count = usize::try_from(directory.entry_count)
        .map_err(|_| archive_limit_error("entry count", MAX_ARCHIVE_ENTRIES))?;
    if entry_count > MAX_ARCHIVE_ENTRIES {
        return Err(archive_limit_error("entry count", MAX_ARCHIVE_ENTRIES));
    }
    if directory.offset > directory.footer_offset {
        return Err(invalid_central_directory());
    }
    let central_directory_end = validate_central_directory_entries(
        bytes,
        directory.offset,
        directory.footer_offset,
        entry_count,
    )?;
    reject_embedded_footer_signatures(bytes, directory.offset, central_directory_end)?;
    Ok(ValidatedArchive {
        entry_count,
        central_directory_start: directory.offset,
        central_directory_end,
        eocd_offset: directory.eocd_offset,
        zip64_record_offset: directory.zip64_record_offset,
    })
}

pub(super) fn validate_entry_limits(
    uncompressed: u64,
    compressed: u64,
    path: &str,
) -> EpubResult<()> {
    if uncompressed > MAX_ENTRY_UNCOMPRESSED_BYTES {
        return Err(entry_limit_error(path, "uncompressed byte length"));
    }
    if uncompressed > 0
        && (compressed == 0 || uncompressed > compressed.saturating_mul(MAX_COMPRESSION_RATIO))
    {
        return Err(entry_limit_error(path, "compression ratio"));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
struct CentralDirectory {
    entry_count: u64,
    offset: usize,
    footer_offset: usize,
    eocd_offset: usize,
    zip64_record_offset: Option<usize>,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct ValidatedArchive {
    pub(super) entry_count: usize,
    pub(super) central_directory_start: usize,
    pub(super) central_directory_end: usize,
    pub(super) eocd_offset: usize,
    pub(super) zip64_record_offset: Option<usize>,
}

fn find_central_directory(bytes: &[u8]) -> EpubResult<CentralDirectory> {
    let eocd_offset = find_end_of_central_directory(bytes)
        .ok_or_else(|| EpubError::new("Invalid EPUB ZIP end of central directory"))?;
    let disk = read_u16(bytes, eocd_offset + 4);
    let central_directory_disk = read_u16(bytes, eocd_offset + 6);
    let disk_entry_count = read_u16(bytes, eocd_offset + 8);
    let entry_count = read_u16(bytes, eocd_offset + 10);
    if disk != 0 || central_directory_disk != 0 || disk_entry_count != entry_count {
        return Err(EpubError::new(
            "Multi-disk EPUB ZIP archives are unsupported",
        ));
    }
    let stored_offset = read_u32(bytes, eocd_offset + 16);
    let is_zip64 = entry_count == ZIP64_SENTINEL_U16 || stored_offset == ZIP64_SENTINEL_U32;
    if !is_zip64 && u64::from(entry_count) > MAX_ARCHIVE_ENTRIES as u64 {
        return Err(archive_limit_error("entry count", MAX_ARCHIVE_ENTRIES));
    }
    let (entry_count, offset, footer_offset) = if is_zip64 {
        read_zip64_central_directory(bytes, eocd_offset)?
    } else {
        let stored_offset = usize::try_from(stored_offset)
            .map_err(|_| EpubError::new("Invalid EPUB ZIP central directory offset"))?;
        (
            u64::from(entry_count),
            shifted_central_directory_offset(bytes, stored_offset)?,
            None,
        )
    };
    if entry_count > MAX_ARCHIVE_ENTRIES as u64 {
        return Err(archive_limit_error("entry count", MAX_ARCHIVE_ENTRIES));
    }
    Ok(CentralDirectory {
        entry_count,
        offset,
        footer_offset: footer_offset.unwrap_or(eocd_offset),
        eocd_offset,
        zip64_record_offset: footer_offset,
    })
}

fn find_end_of_central_directory(bytes: &[u8]) -> Option<usize> {
    let last = bytes.len().checked_sub(END_OF_CENTRAL_DIRECTORY_BYTES)?;
    let first = bytes
        .len()
        .saturating_sub(END_OF_CENTRAL_DIRECTORY_BYTES + MAX_ZIP_COMMENT_BYTES);
    if let Some(exact) = (first..=last).rev().find(|&offset| {
        read_u32(bytes, offset) == END_OF_CENTRAL_DIRECTORY_SIGNATURE
            && end_of_central_directory_end(bytes, offset) == Some(bytes.len())
    }) {
        return Some(exact);
    }
    // Real books saved from HTTP uploads keep a transport trailer (for example
    // a multipart form boundary) after the footer comment. Accept exactly one
    // in-bounds footer; a second parseable candidate cannot deterministically
    // own the archive, so that stays fail-closed.
    let mut in_bounds = (first..=last).rev().filter(|&offset| {
        read_u32(bytes, offset) == END_OF_CENTRAL_DIRECTORY_SIGNATURE
            && end_of_central_directory_end(bytes, offset).is_some_and(|end| end <= bytes.len())
    });
    let selected = in_bounds.next()?;
    if in_bounds.next().is_some() {
        return None;
    }
    Some(selected)
}

fn end_of_central_directory_end(bytes: &[u8], offset: usize) -> Option<usize> {
    offset
        .checked_add(END_OF_CENTRAL_DIRECTORY_BYTES)
        .and_then(|end| end.checked_add(usize::from(read_u16(bytes, offset + 20))))
}

fn read_zip64_central_directory(
    bytes: &[u8],
    eocd_offset: usize,
) -> EpubResult<(u64, usize, Option<usize>)> {
    let locator = eocd_offset
        .checked_sub(20)
        .ok_or_else(|| EpubError::new("Invalid EPUB ZIP64 central directory locator"))?;
    if read_u32(bytes, locator) != ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE
        || read_u32(bytes, locator + 4) != 0
        || read_u32(bytes, locator + 16) != 1
    {
        return Err(EpubError::new(
            "Invalid EPUB ZIP64 central directory locator",
        ));
    }
    let stored_record_offset = usize::try_from(read_u64(bytes, locator + 8))
        .map_err(|_| EpubError::new("Invalid EPUB ZIP64 central directory offset"))?;
    let last = stored_record_offset.saturating_add(65_536).min(locator);
    let mut resolved = None;
    for record_offset in stored_record_offset..=last {
        let Some(record) = read_zip64_record(bytes, record_offset, locator)? else {
            continue;
        };
        if resolved.is_some() {
            return Err(EpubError::new(
                "Ambiguous EPUB ZIP64 end of central directory",
            ));
        }
        let shift = record_offset - stored_record_offset;
        let directory_offset = usize::try_from(record.central_directory_offset)
            .ok()
            .and_then(|offset| offset.checked_add(shift))
            .ok_or_else(|| EpubError::new("Invalid EPUB ZIP64 central directory offset"))?;
        resolved = Some((record.entry_count, directory_offset, Some(record_offset)));
    }
    resolved.ok_or_else(|| EpubError::new("Invalid EPUB ZIP64 central directory"))
}

#[derive(Debug, Clone, Copy)]
struct Zip64Record {
    entry_count: u64,
    central_directory_offset: u64,
}

fn read_zip64_record(
    bytes: &[u8],
    record_offset: usize,
    locator_offset: usize,
) -> EpubResult<Option<Zip64Record>> {
    if record_offset
        .checked_add(56)
        .is_none_or(|end| end > locator_offset || end > bytes.len())
        || read_u32(bytes, record_offset) != ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE
    {
        return Ok(None);
    }
    let record_size = match usize::try_from(read_u64(bytes, record_offset + 4)) {
        Ok(size) if size >= 44 => size,
        _ => return Ok(None),
    };
    let record_end = record_offset
        .checked_add(12)
        .and_then(|end| end.checked_add(record_size));
    if record_end != Some(locator_offset) {
        return Ok(None);
    }
    if read_u32(bytes, record_offset + 16) != 0 || read_u32(bytes, record_offset + 20) != 0 {
        return Err(EpubError::new(
            "Multi-disk EPUB ZIP64 archives are unsupported",
        ));
    }
    let disk_entry_count = read_u64(bytes, record_offset + 24);
    let entry_count = read_u64(bytes, record_offset + 32);
    if disk_entry_count != entry_count {
        return Err(EpubError::new("Invalid EPUB ZIP64 central directory"));
    }
    Ok(Some(Zip64Record {
        entry_count,
        central_directory_offset: read_u64(bytes, record_offset + 48),
    }))
}

fn shifted_central_directory_offset(bytes: &[u8], stored: usize) -> EpubResult<usize> {
    if stored.checked_add(4).is_some_and(|end| end <= bytes.len())
        && read_u32(bytes, stored) == CENTRAL_DIRECTORY_ENTRY_SIGNATURE
    {
        return Ok(stored);
    }
    let first = stored
        .checked_add(1)
        .ok_or_else(|| EpubError::new("Invalid EPUB ZIP central directory offset"))?;
    let last = stored
        .saturating_add(65_536)
        .min(bytes.len().saturating_sub(4));
    (first..=last)
        .find(|&offset| read_u32(bytes, offset) == CENTRAL_DIRECTORY_ENTRY_SIGNATURE)
        .ok_or_else(|| EpubError::new("Invalid EPUB ZIP central directory offset"))
}

fn validate_central_directory_entries(
    bytes: &[u8],
    mut position: usize,
    footer_offset: usize,
    entry_count: usize,
) -> EpubResult<usize> {
    let mut paths = HashSet::with_capacity(entry_count);
    let mut total_uncompressed = 0_u64;
    for _ in 0..entry_count {
        let header_end = position
            .checked_add(CENTRAL_DIRECTORY_ENTRY_HEADER_BYTES)
            .ok_or_else(invalid_central_directory)?;
        if header_end > bytes.len()
            || read_u32(bytes, position) != CENTRAL_DIRECTORY_ENTRY_SIGNATURE
        {
            return Err(invalid_central_directory());
        }
        let filename_length = usize::from(read_u16(bytes, position + 28));
        let extra_length = usize::from(read_u16(bytes, position + 30));
        let comment_length = usize::from(read_u16(bytes, position + 32));
        let filename_end = header_end
            .checked_add(filename_length)
            .ok_or_else(invalid_central_directory)?;
        let extra_end = filename_end
            .checked_add(extra_length)
            .ok_or_else(invalid_central_directory)?;
        let next = extra_end
            .checked_add(comment_length)
            .ok_or_else(invalid_central_directory)?;
        if next > footer_offset || next > bytes.len() {
            return Err(invalid_central_directory());
        }
        let filename = &bytes[header_end..filename_end];
        if !paths.insert(filename) {
            return Err(EpubError::new(format!(
                "Duplicate EPUB ZIP entry path: {:?}",
                String::from_utf8_lossy(filename)
            )));
        }
        let (uncompressed, compressed) =
            central_directory_sizes(bytes, position, &bytes[filename_end..extra_end])?;
        let path = String::from_utf8_lossy(filename);
        validate_entry_limits(uncompressed, compressed, &path)?;
        total_uncompressed = total_uncompressed
            .checked_add(uncompressed)
            .ok_or_else(|| {
                archive_limit_error(
                    "total uncompressed byte length",
                    MAX_TOTAL_UNCOMPRESSED_BYTES,
                )
            })?;
        if total_uncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES {
            return Err(archive_limit_error(
                "total uncompressed byte length",
                MAX_TOTAL_UNCOMPRESSED_BYTES,
            ));
        }
        position = next;
    }
    Ok(position)
}

fn reject_embedded_footer_signatures(bytes: &[u8], start: usize, end: usize) -> EpubResult<()> {
    let directory = bytes
        .get(start..end)
        .ok_or_else(invalid_central_directory)?;
    if directory
        .windows(4)
        .any(|window| window == END_OF_CENTRAL_DIRECTORY_SIGNATURE.to_le_bytes())
    {
        return Err(EpubError::new(
            "Ambiguous EPUB ZIP footer signature in central directory",
        ));
    }
    Ok(())
}

fn central_directory_sizes(bytes: &[u8], position: usize, extra: &[u8]) -> EpubResult<(u64, u64)> {
    let compressed = read_u32(bytes, position + 20);
    let uncompressed = read_u32(bytes, position + 24);
    if compressed != ZIP64_SENTINEL_U32 && uncompressed != ZIP64_SENTINEL_U32 {
        return Ok((u64::from(uncompressed), u64::from(compressed)));
    }
    let mut position = 0_usize;
    while position
        .checked_add(4)
        .is_some_and(|end| end <= extra.len())
    {
        let field_id = read_u16(extra, position);
        let field_length = usize::from(read_u16(extra, position + 2));
        let field_start = position + 4;
        let field_end = field_start
            .checked_add(field_length)
            .ok_or_else(invalid_zip64_extra)?;
        if field_end > extra.len() {
            return Err(invalid_zip64_extra());
        }
        if field_id == 0x0001 {
            return read_zip64_sizes(&extra[field_start..field_end], uncompressed, compressed);
        }
        position = field_end;
    }
    Err(invalid_zip64_extra())
}

fn read_zip64_sizes(extra: &[u8], uncompressed: u32, compressed: u32) -> EpubResult<(u64, u64)> {
    let mut position = 0_usize;
    let uncompressed = if uncompressed == ZIP64_SENTINEL_U32 {
        let value = read_checked_u64(extra, position)?;
        position += 8;
        value
    } else {
        u64::from(uncompressed)
    };
    let compressed = if compressed == ZIP64_SENTINEL_U32 {
        read_checked_u64(extra, position)?
    } else {
        u64::from(compressed)
    };
    Ok((uncompressed, compressed))
}

fn read_checked_u64(bytes: &[u8], offset: usize) -> EpubResult<u64> {
    if offset.checked_add(8).is_none_or(|end| end > bytes.len()) {
        return Err(invalid_zip64_extra());
    }
    Ok(read_u64(bytes, offset))
}

fn read_u16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn read_u64(bytes: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7],
    ])
}

fn archive_limit_error(field: &str, limit: impl std::fmt::Display) -> EpubError {
    EpubError::new(format!(
        "EPUB ZIP {field} exceeds the safety limit ({limit})"
    ))
}

pub(super) fn entry_limit_error(path: &str, field: &str) -> EpubError {
    EpubError::new(format!(
        "EPUB entry {path:?} {field} exceeds the safety limit"
    ))
}

fn invalid_central_directory() -> EpubError {
    EpubError::new("Invalid or truncated EPUB ZIP central directory")
}

fn invalid_zip64_extra() -> EpubError {
    EpubError::new("Invalid EPUB ZIP64 extended size field")
}
