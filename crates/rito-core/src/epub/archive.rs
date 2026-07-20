use std::{
    io::{Cursor, Read, Seek, SeekFrom},
    string::FromUtf8Error,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use zip::{result::ZipError, ZipArchive};

use super::{join_zip_path, EpubError, EpubResult};

mod preflight;

use preflight::{entry_limit_error, validate_entry_limits};

pub(crate) struct EpubArchive<'a> {
    zip: ZipArchive<PreflightLockedCursor<'a>>,
}

enum ArchiveBytes<'a> {
    Borrowed(&'a [u8]),
    Shared(Arc<[u8]>),
}

impl AsRef<[u8]> for ArchiveBytes<'_> {
    fn as_ref(&self) -> &[u8] {
        match self {
            Self::Borrowed(bytes) => bytes,
            Self::Shared(bytes) => bytes.as_ref(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ArchiveEntryMetadata {
    pub(crate) entry_id: usize,
    pub(crate) path: String,
    pub(crate) byte_length: usize,
}

impl<'a> EpubArchive<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> EpubResult<Self> {
        Self::from_storage(ArchiveBytes::Borrowed(bytes))
    }

    fn from_storage(bytes: ArchiveBytes<'a>) -> EpubResult<Self> {
        let validated = preflight::validate(bytes.as_ref())?;
        let locked = Arc::new(AtomicBool::new(true));
        let reader = PreflightLockedCursor::new(bytes, validated, locked.clone());
        let zip = ZipArchive::new(reader).map_err(zip_error)?;
        locked.store(false, Ordering::Release);
        if zip.len() != validated.entry_count {
            return Err(EpubError::new("Duplicate decoded EPUB ZIP entry path"));
        }
        Ok(Self { zip })
    }

    pub(crate) fn read_text(&mut self, path: &str) -> EpubResult<String> {
        let bytes = self.read_bytes(path)?;
        String::from_utf8(bytes).map_err(|error| utf8_error(path, error))
    }

    pub(crate) fn read_bytes(&mut self, path: &str) -> EpubResult<Vec<u8>> {
        let entry_index = self.resolve_entry_index(path)?;
        self.read_entry_bytes_at_index(entry_index, path)
    }

    pub(crate) fn read_entry_bytes(&mut self, entry: &ArchiveEntryMetadata) -> EpubResult<Vec<u8>> {
        self.read_entry_bytes_at_index(entry.entry_id, &entry.path)
    }

    pub(crate) fn inspect_bytes<T>(
        &mut self,
        path: &str,
        inspect: impl FnOnce(&mut dyn Read) -> EpubResult<T>,
    ) -> EpubResult<T> {
        let entry_index = self.resolve_entry_index(path)?;
        self.inspect_entry_at_index(entry_index, path, inspect)
    }

    pub(crate) fn inspect_entry<T>(
        &mut self,
        entry: &ArchiveEntryMetadata,
        inspect: impl FnOnce(&mut dyn Read) -> EpubResult<T>,
    ) -> EpubResult<T> {
        self.inspect_entry_at_index(entry.entry_id, &entry.path, inspect)
    }

    fn inspect_entry_at_index<T>(
        &mut self,
        entry_index: usize,
        path: &str,
        inspect: impl FnOnce(&mut dyn Read) -> EpubResult<T>,
    ) -> EpubResult<T> {
        let mut file = self.zip.by_index(entry_index).map_err(|error| {
            EpubError::new(format!("Failed to inspect EPUB entry {path:?}: {error}"))
        })?;
        validate_entry_limits(file.size(), file.compressed_size(), path)?;
        inspect(&mut file)
    }

    fn read_entry_bytes_at_index(&mut self, entry_index: usize, path: &str) -> EpubResult<Vec<u8>> {
        let file = self.zip.by_index(entry_index).map_err(|error| {
            EpubError::new(format!("Failed to read EPUB entry {path:?}: {error}"))
        })?;
        validate_entry_limits(file.size(), file.compressed_size(), path)?;
        let declared_size_u64 = file.size();
        let declared_size = usize::try_from(declared_size_u64)
            .map_err(|_| entry_limit_error(path, "uncompressed byte length"))?;
        let mut bytes = Vec::new();
        bytes.try_reserve_exact(declared_size).map_err(|_| {
            EpubError::new(format!(
                "Failed to reserve memory for EPUB entry {path:?} ({declared_size} bytes)"
            ))
        })?;
        file.take(declared_size_u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| {
                EpubError::new(format!("Failed to read EPUB entry {path:?}: {error}"))
            })?;
        if bytes.len() != declared_size {
            return Err(EpubError::new(format!(
                "EPUB entry {path:?} decoded length does not match its ZIP metadata"
            )));
        }
        Ok(bytes)
    }

    pub(crate) fn entry_size(&mut self, path: &str) -> EpubResult<usize> {
        let entry_index = self.resolve_entry_index(path)?;
        let file = self.zip.by_index(entry_index).map_err(|error| {
            EpubError::new(format!("Failed to read EPUB entry {path:?}: {error}"))
        })?;
        Ok(file.size() as usize)
    }

    pub(crate) fn entry_metadata(&mut self, path: &str) -> EpubResult<ArchiveEntryMetadata> {
        let entry_index = self.resolve_entry_index(path)?;
        self.metadata_at_index(entry_index)?.ok_or_else(|| {
            EpubError::new(format!(
                "EPUB entry is not a safe canonical file path: {path:?}"
            ))
        })
    }

    pub(crate) fn file_entries(&mut self) -> Vec<ArchiveEntryMetadata> {
        (0..self.zip.len())
            .filter_map(|entry_index| self.metadata_at_index(entry_index).ok().flatten())
            .collect()
    }

    fn metadata_at_index(
        &mut self,
        entry_index: usize,
    ) -> EpubResult<Option<ArchiveEntryMetadata>> {
        let file = self.zip.by_index(entry_index).map_err(|error| {
            EpubError::new(format!(
                "Failed to inspect EPUB entry at index {entry_index}: {error}"
            ))
        })?;
        let is_safe_file = !file.is_dir()
            && file.enclosed_name().is_some()
            && is_safe_canonical_entry_path(file.name());
        let path = file.name().to_owned();
        let byte_length = usize::try_from(file.size()).ok();
        drop(file);

        if !is_safe_file || self.zip.index_for_name(&path) != Some(entry_index) {
            return Ok(None);
        }
        let Some(byte_length) = byte_length else {
            return Ok(None);
        };
        Ok(Some(ArchiveEntryMetadata {
            entry_id: entry_index,
            path,
            byte_length,
        }))
    }

    fn resolve_entry_index(&self, path: &str) -> EpubResult<usize> {
        if let Some(index) = self.zip.index_for_name(path) {
            return Ok(index);
        }
        if !path.as_bytes().contains(&b'%') {
            return Err(missing_entry(path));
        }
        let decoded = percent_decode_path(path)?;
        let normalized = join_zip_path("", &decoded);
        self.zip
            .index_for_name(&normalized)
            .ok_or_else(|| missing_entry(path))
    }
}

impl EpubArchive<'static> {
    pub(crate) fn new_shared(bytes: Arc<[u8]>) -> EpubResult<Self> {
        Self::from_storage(ArchiveBytes::Shared(bytes))
    }
}

/// Restricts `zip` metadata construction to the central-directory and local
/// header reads admitted by the bounded raw preflight. The zip crate otherwise
/// falls back to an earlier footer after a selected directory fails; that would
/// let it allocate an index using an unchecked entry count. Once construction
/// succeeds, normal entry reads are unrestricted.
struct PreflightLockedCursor<'a> {
    cursor: Cursor<ArchiveBytes<'a>>,
    validated: preflight::ValidatedArchive,
    locked: Arc<AtomicBool>,
    central_parse_started: bool,
}

impl<'a> PreflightLockedCursor<'a> {
    fn new(
        bytes: ArchiveBytes<'a>,
        validated: preflight::ValidatedArchive,
        locked: Arc<AtomicBool>,
    ) -> Self {
        Self {
            cursor: Cursor::new(bytes),
            validated,
            locked,
            central_parse_started: false,
        }
    }
}

impl Read for PreflightLockedCursor<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let start = usize::try_from(self.cursor.position()).unwrap_or(usize::MAX);
        let read = self.cursor.read(buffer)?;
        if !self.locked.load(Ordering::Acquire) {
            return Ok(read);
        }
        if !self.central_parse_started
            && start == self.validated.central_directory_start
            && read >= 46
        {
            self.central_parse_started = true;
        }
        if self.central_parse_started && !self.is_allowed_metadata_read(start, read) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "ZIP parser attempted to leave the preflight-validated metadata",
            ));
        }
        if !self.central_parse_started {
            let source = self.cursor.get_ref().as_ref();
            mask_unvalidated_signatures(
                source,
                &mut buffer[..read],
                start,
                0x0201_4b50_u32.to_le_bytes(),
                self.validated.central_directory_start,
            );
            mask_unvalidated_signatures(
                source,
                &mut buffer[..read],
                start,
                0x0605_4b50_u32.to_le_bytes(),
                self.validated.eocd_offset,
            );
            mask_unvalidated_signatures(
                source,
                &mut buffer[..read],
                start,
                0x0606_4b50_u32.to_le_bytes(),
                self.validated.zip64_record_offset.unwrap_or(usize::MAX),
            );
        }
        Ok(read)
    }
}

impl PreflightLockedCursor<'_> {
    fn is_allowed_metadata_read(&self, start: usize, length: usize) -> bool {
        let Some(end) = start.checked_add(length) else {
            return false;
        };
        let central = start >= self.validated.central_directory_start
            && end <= self.validated.central_directory_end;
        let fixed_local_header = length <= 30 && end <= self.validated.central_directory_start;
        central || fixed_local_header
    }
}

impl Seek for PreflightLockedCursor<'_> {
    fn seek(&mut self, position: SeekFrom) -> std::io::Result<u64> {
        self.cursor.seek(position)
    }
}

fn mask_unvalidated_signatures(
    source: &[u8],
    buffer: &mut [u8],
    absolute_start: usize,
    signature: [u8; 4],
    accepted_offset: usize,
) {
    for (index, byte) in buffer.iter_mut().enumerate() {
        let Some(offset) = absolute_start.checked_add(index) else {
            continue;
        };
        if offset == accepted_offset {
            continue;
        }
        if source.get(offset..offset.saturating_add(4)) == Some(signature.as_slice()) {
            *byte = 0;
        }
    }
}

fn is_safe_canonical_entry_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.chars().any(char::is_control)
        && join_zip_path("", path) == path
}

fn percent_decode_path(path: &str) -> EpubResult<String> {
    let source = path.as_bytes();
    let mut decoded = Vec::with_capacity(source.len());
    let mut index = 0;
    while index < source.len() {
        if source[index] != b'%' {
            decoded.push(source[index]);
            index += 1;
            continue;
        }
        let Some(high) = source.get(index + 1).copied().and_then(hex_value) else {
            return Err(invalid_percent_escape(path));
        };
        let Some(low) = source.get(index + 2).copied().and_then(hex_value) else {
            return Err(invalid_percent_escape(path));
        };
        decoded.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(decoded).map_err(|_| invalid_percent_escape(path))
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn invalid_percent_escape(path: &str) -> EpubError {
    EpubError::new(format!(
        "Invalid percent escape in EPUB entry path: {path:?}"
    ))
}

fn missing_entry(path: &str) -> EpubError {
    EpubError::new(format!(
        "Failed to read EPUB entry {path:?}: {}",
        ZipError::FileNotFound
    ))
}

fn zip_error(error: ZipError) -> EpubError {
    EpubError::new(format!("Invalid EPUB ZIP archive: {error}"))
}

fn utf8_error(path: &str, error: FromUtf8Error) -> EpubError {
    EpubError::new(format!("EPUB entry {path:?} is not valid UTF-8: {error}"))
}

#[cfg(test)]
mod tests;
