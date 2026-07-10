use std::{
    io::{Cursor, Read},
    string::FromUtf8Error,
};

use zip::{result::ZipError, ZipArchive};

use super::{EpubError, EpubResult};

pub(crate) struct EpubArchive<'a> {
    zip: ZipArchive<Cursor<&'a [u8]>>,
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
        let mut file = self.zip.by_name(path).map_err(|error| {
            EpubError::new(format!("Failed to read EPUB entry {path:?}: {error}"))
        })?;
        let mut bytes = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut bytes).map_err(|error| {
            EpubError::new(format!("Failed to read EPUB entry {path:?}: {error}"))
        })?;
        Ok(bytes)
    }

    pub(crate) fn entry_size(&mut self, path: &str) -> EpubResult<usize> {
        let file = self.zip.by_name(path).map_err(|error| {
            EpubError::new(format!("Failed to read EPUB entry {path:?}: {error}"))
        })?;
        Ok(file.size() as usize)
    }
}

fn zip_error(error: ZipError) -> EpubError {
    EpubError::new(format!("Invalid EPUB ZIP archive: {error}"))
}

fn utf8_error(path: &str, error: FromUtf8Error) -> EpubError {
    EpubError::new(format!("EPUB entry {path:?} is not valid UTF-8: {error}"))
}
