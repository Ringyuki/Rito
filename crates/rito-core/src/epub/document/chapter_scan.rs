use std::fmt;

use crate::epub::{archive::EpubArchive, join_epub_href, EpubResult};

use super::{LoadedChapter, LoadedEpubDocument};

/// Reusable archive cursor for cooperative chapter-source scans. It owns an
/// `Arc` handle to the EPUB bytes through `EpubArchive`, so it can survive
/// between host-scheduled quanta without borrowing `LoadedEpubDocument` or
/// copying the publication. The archive is opened lazily because the first
/// runtime chapter is commonly already materialized.
pub(crate) struct ChapterSourceScanSession {
    archive: Option<EpubArchive<'static>>,
    archive_initialized: bool,
}

impl fmt::Debug for ChapterSourceScanSession {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ChapterSourceScanSession")
            .field("archive_initialized", &self.archive_initialized)
            .field("archive_available", &self.archive.is_some())
            .finish()
    }
}

impl ChapterSourceScanSession {
    fn new() -> Self {
        Self {
            archive: None,
            archive_initialized: false,
        }
    }

    fn ensure_archive(&mut self, document: &LoadedEpubDocument) -> EpubResult<()> {
        if self.archive_initialized {
            return Ok(());
        }
        self.archive = document
            .archive_source
            .as_ref()
            .map(|source| EpubArchive::new_shared(source.bytes.clone()))
            .transpose()?;
        self.archive_initialized = true;
        Ok(())
    }

    pub(crate) fn release(&mut self) {
        self.archive = None;
        self.archive_initialized = true;
    }
}

impl LoadedEpubDocument {
    pub(crate) fn chapter_source_scan_session(&self) -> ChapterSourceScanSession {
        ChapterSourceScanSession::new()
    }

    /// Visits one available spine XHTML source without materializing it into
    /// the lazy document state. Unreadable future sources remain deferred to
    /// their normal load path.
    pub(crate) fn visit_available_chapter_source_with_session(
        &self,
        session: &mut ChapterSourceScanSession,
        chapter_index: usize,
        mut visit: impl FnMut(usize, &LoadedChapter, &str),
    ) -> EpubResult<()> {
        let Some(chapter) = self.chapters.get(chapter_index) else {
            return Ok(());
        };
        if chapter.source_loaded {
            visit(chapter_index, chapter, &chapter.xhtml_source);
            return Ok(());
        }
        if chapter.href.is_empty() {
            visit(chapter_index, chapter, "");
            return Ok(());
        }
        session.ensure_archive(self)?;
        let Some(source) = self.archive_source.as_ref() else {
            return Ok(());
        };
        let Some(archive) = session.archive.as_mut() else {
            return Ok(());
        };
        if let Ok(xhtml) = archive.read_text(&join_epub_href(&source.opf_dir, &chapter.href)) {
            visit(chapter_index, chapter, &xhtml);
        }
        Ok(())
    }
}
