use crate::epub::{archive::EpubArchive, join_epub_href, EpubResult};

use super::{LoadedChapter, LoadedEpubDocument};

impl LoadedEpubDocument {
    /// Visits every available spine XHTML source without materializing it into
    /// the lazy document state. Unloaded sources are borrowed from a local
    /// archive reader and discarded immediately after the callback returns;
    /// unreadable future sources remain deferred to their normal load path.
    pub(crate) fn visit_available_chapter_sources(
        &self,
        mut visit: impl FnMut(&LoadedChapter, &str),
    ) -> EpubResult<()> {
        let mut archive = self
            .archive_source
            .as_ref()
            .map(|source| EpubArchive::new(&source.bytes))
            .transpose()?;
        for chapter in &self.chapters {
            if chapter.source_loaded {
                visit(chapter, &chapter.xhtml_source);
                continue;
            }
            if chapter.href.is_empty() {
                visit(chapter, "");
                continue;
            }
            let Some(source) = self.archive_source.as_ref() else {
                continue;
            };
            let Some(archive) = archive.as_mut() else {
                continue;
            };
            if let Ok(xhtml) = archive.read_text(&join_epub_href(&source.opf_dir, &chapter.href)) {
                visit(chapter, &xhtml);
            }
        }
        Ok(())
    }
}
