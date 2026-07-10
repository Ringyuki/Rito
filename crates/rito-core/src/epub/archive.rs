use std::{
    io::{Cursor, Read},
    string::FromUtf8Error,
};

use zip::{result::ZipError, ZipArchive};

use super::{join_zip_path, EpubError, EpubResult};

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
        let entry_index = self.resolve_entry_index(path)?;
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
mod tests {
    use std::io::{Cursor, Write};

    use zip::{write::FileOptions, ZipWriter};

    use super::EpubArchive;

    #[test]
    fn falls_back_to_percent_decoded_entry_names() {
        let bytes = fixture_zip(&[
            ("Text/Chapter One.xhtml", b"decoded"),
            ("Text/\u{4e2d}.xhtml", b"unicode"),
        ]);
        let mut archive = EpubArchive::new(&bytes).expect("archive opens");

        assert_eq!(
            archive
                .read_bytes("Text/Chapter%20One.xhtml")
                .expect("encoded href resolves"),
            b"decoded"
        );
        assert_eq!(
            archive
                .read_text("Text/%E4%B8%AD.xhtml")
                .expect("encoded Unicode href resolves"),
            "unicode"
        );
        assert_eq!(
            archive
                .entry_size("Text/Chapter%20One.xhtml")
                .expect("encoded href size resolves"),
            b"decoded".len()
        );
    }

    #[test]
    fn prefers_exact_entry_names_before_percent_decoding() {
        let bytes = fixture_zip(&[
            ("Text/Chapter%20One.xhtml", b"literal-long"),
            ("Text/Chapter One.xhtml", b"x"),
            ("Text/malformed%2.xhtml", b"malformed-literal"),
        ]);
        let mut archive = EpubArchive::new(&bytes).expect("archive opens");

        assert_eq!(
            archive
                .read_text("Text/Chapter%20One.xhtml")
                .expect("literal href resolves first"),
            "literal-long"
        );
        assert_eq!(
            archive
                .entry_size("Text/Chapter%20One.xhtml")
                .expect("literal size resolves first"),
            b"literal-long".len()
        );
        assert_eq!(
            archive
                .read_text("Text/malformed%2.xhtml")
                .expect("malformed literal entry still resolves exactly"),
            "malformed-literal"
        );
    }

    #[test]
    fn rejects_malformed_percent_escapes_after_exact_miss() {
        let bytes = fixture_zip(&[("Text/chapter.xhtml", b"chapter")]);
        for path in [
            "Text/missing%2.xhtml",
            "Text/missing%GG.xhtml",
            "Text/missing%FF.xhtml",
            "Text/missing%E4%B8.xhtml",
        ] {
            let mut archive = EpubArchive::new(&bytes).expect("archive opens");
            let error = archive
                .read_bytes(path)
                .expect_err("malformed escape must fail");
            assert!(error.message().contains("Invalid percent escape"));
        }
    }

    #[test]
    fn normalizes_only_percent_decoded_dot_segments() {
        let bytes = fixture_zip(&[
            ("OPS/Chapter.xhtml", b"encoded-dot"),
            ("b.xhtml", b"plain-dot"),
        ]);
        let mut archive = EpubArchive::new(&bytes).expect("archive opens");

        assert_eq!(
            archive
                .read_text("OPS/Text/%2E%2E/Chapter.xhtml")
                .expect("encoded dot segment resolves"),
            "encoded-dot"
        );
        let error = archive
            .read_text("a/../b.xhtml")
            .expect_err("plain missing path must not gain a normalization fallback");
        assert!(error.message().contains("Failed to read EPUB entry"));
    }

    fn fixture_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options: FileOptions<'_, ()> = FileOptions::default();
        for (path, bytes) in entries {
            writer.start_file(path, options).expect("file starts");
            writer.write_all(bytes).expect("file writes");
        }
        writer.finish().expect("zip finalizes").into_inner()
    }
}
