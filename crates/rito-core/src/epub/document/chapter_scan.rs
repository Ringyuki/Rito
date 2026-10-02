use std::fmt;

use crate::epub::{join_epub_href, reader::PublicationReader, EpubResult};

use super::{LoadedChapter, LoadedEpubDocument};

/// Reusable archive cursor for cooperative chapter-source scans. It owns a
/// handle on the publication's files, so it can survive
/// between host-scheduled quanta without borrowing `LoadedEpubDocument` or
/// copying the publication. The archive is opened lazily because the first
/// runtime chapter is commonly already materialized.
pub(crate) struct ChapterSourceScanSession {
    archive: Option<PublicationReader<'static>>,
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
            .map(|source| source.storage.shared_reader())
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

    /// Whether reading a spine item's source would not wait on a shard.
    pub(crate) fn chapter_source_available(&self, chapter_index: usize) -> bool {
        let (Some(chapter), Some(store)) = (self.chapters.get(chapter_index), self.shard_store())
        else {
            return true;
        };
        chapter.source_loaded
            || chapter.href.is_empty()
            || store.is_available(&join_epub_href(self.opf_dir(), &chapter.href))
    }

    /// The shard holding a spine item's source, when a shard holds it.
    pub(crate) fn chapter_source_shard(&self, chapter_index: usize) -> Option<u32> {
        let chapter = self.chapters.get(chapter_index)?;
        if chapter.href.is_empty() {
            return None;
        }
        self.shard_store()?
            .shard_of(&join_epub_href(self.opf_dir(), &chapter.href))
    }

    /// The footnote attribute scan a shard skeleton carries for a spine
    /// item; `None` for a publication opened from a whole archive.
    pub(crate) fn packed_footnote_hints(
        &self,
        chapter_index: usize,
    ) -> Option<Vec<crate::xhtml::EpubTypeAttributeHint>> {
        self.shard_store()?.footnote_hints(chapter_index)
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
        match archive.read_text(&join_epub_href(&source.opf_dir, &chapter.href)) {
            Ok(xhtml) => visit(chapter_index, chapter, &xhtml),
            // A chapter whose shard has not arrived is not unreadable: the
            // scan must wait for it rather than skip it.
            Err(error) if error.is_pending() => return Err(error),
            Err(_) => {}
        }
        Ok(())
    }
}
