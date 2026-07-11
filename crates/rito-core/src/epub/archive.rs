use std::{
    io::{Cursor, Read},
    string::FromUtf8Error,
};

use zip::{result::ZipError, ZipArchive};

use super::{join_zip_path, EpubError, EpubResult};

pub(crate) struct EpubArchive<'a> {
    zip: ZipArchive<Cursor<&'a [u8]>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ArchiveEntryMetadata {
    pub(crate) entry_id: usize,
    pub(crate) path: String,
    pub(crate) byte_length: usize,
}

impl<'a> EpubArchive<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> EpubResult<Self> {
        let reader = Cursor::new(bytes);
        let zip = ZipArchive::new(reader).map_err(zip_error)?;
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

    fn read_entry_bytes_at_index(&mut self, entry_index: usize, path: &str) -> EpubResult<Vec<u8>> {
        let mut file = self.zip.by_index(entry_index).map_err(|error| {
            EpubError::new(format!("Failed to read EPUB entry {path:?}: {error}"))
        })?;
        let mut bytes = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut bytes).map_err(|error| {
            EpubError::new(format!("Failed to read EPUB entry {path:?}: {error}"))
        })?;
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
