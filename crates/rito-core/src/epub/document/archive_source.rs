use std::collections::BTreeMap;

use crate::epub::{
    archive::{ArchiveEntryMetadata, EpubArchive},
    join_epub_href, EpubResult,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedArchiveSource {
    pub(super) bytes: Vec<u8>,
    pub(super) opf_dir: String,
    pub(super) archive_image_entries: BTreeMap<String, ArchiveEntryMetadata>,
}

#[derive(Clone, Copy)]
pub(super) enum ArchiveResourceKind {
    Font,
    Image,
}

impl LoadedArchiveSource {
    pub(super) fn read_bytes(
        &self,
        href: &str,
        resource_kind: ArchiveResourceKind,
    ) -> EpubResult<Vec<u8>> {
        let mut archive = EpubArchive::new(&self.bytes)?;
        self.read_bytes_with_archive(&mut archive, href, resource_kind)
    }

    pub(super) fn read_bytes_with_archive(
        &self,
        archive: &mut EpubArchive<'_>,
        href: &str,
        resource_kind: ArchiveResourceKind,
    ) -> EpubResult<Vec<u8>> {
        if matches!(resource_kind, ArchiveResourceKind::Image) {
            if let Some(entry) = self.archive_image_entries.get(href) {
                return archive.read_entry_bytes(entry);
            }
        }
        archive.read_bytes(&join_epub_href(&self.opf_dir, href))
    }
}
