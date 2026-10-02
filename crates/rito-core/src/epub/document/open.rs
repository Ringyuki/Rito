use crate::resources::{
    detect_image_dimensions, hash_bytes, is_font_media_type, is_image_media_type,
};
use std::{collections::BTreeMap, sync::Arc};

use super::super::{
    archive::{self, ArchiveEntryMetadata},
    join_epub_href, opf_dir, parser,
    reader::PublicationReader,
    shard::{ShardKey, ShardStore},
    toc, EpubError, EpubResult, PackageDocument,
};
use super::{
    LoadedArchiveSource, LoadedBinaryResource, LoadedChapter, LoadedEpubDocument,
    LoadedTextResource, PublicationStorage,
};

mod archive_images;

use archive_images::append_archive_image_resources;

pub fn open_document(bytes: &[u8]) -> EpubResult<LoadedEpubDocument> {
    open_document_with_chapter_loading(bytes, ChapterLoading::Eager)
}

pub fn open_runtime_document(bytes: &[u8]) -> EpubResult<LoadedEpubDocument> {
    open_runtime_document_owned(bytes.to_vec())
}

pub fn open_runtime_document_owned(bytes: Vec<u8>) -> EpubResult<LoadedEpubDocument> {
    open_document_with_chapter_loading_owned(bytes, ChapterLoading::FirstChapterOnly)
}

/// Opens a publication from its skeleton shard. No chapter is read here:
/// each one loads from its content shard when it is first needed.
pub fn open_runtime_document_from_shards(
    skeleton: &[u8],
    key: Option<&ShardKey>,
) -> EpubResult<LoadedEpubDocument> {
    let store = ShardStore::open(skeleton, key)?;
    let mut reader = PublicationReader::Shards(store.clone());
    let opened = open_from_reader(&mut reader, ChapterLoading::Deferred)?;
    Ok(opened.into_document(PublicationStorage::Shards(store)))
}

#[derive(Clone, Copy)]
pub(crate) enum ChapterLoading {
    Eager,
    FirstChapterOnly,
    Deferred,
}

#[derive(Clone, Copy)]
enum BinaryResourceLoading {
    Eager,
    Indexed,
}

fn open_document_with_chapter_loading(
    bytes: &[u8],
    chapter_loading: ChapterLoading,
) -> EpubResult<LoadedEpubDocument> {
    open_document_with_chapter_loading_owned(bytes.to_vec(), chapter_loading)
}

fn open_document_with_chapter_loading_owned(
    bytes: Vec<u8>,
    chapter_loading: ChapterLoading,
) -> EpubResult<LoadedEpubDocument> {
    let mut reader = PublicationReader::Archive(archive::EpubArchive::new(&bytes)?);
    let opened = open_from_reader(&mut reader, chapter_loading)?;
    drop(reader);
    Ok(opened.into_document(PublicationStorage::Archive(Arc::new(bytes))))
}

/// Everything opening reads, before the files' storage is attached.
pub(crate) struct OpenedPublication {
    package: PackageDocument,
    opf_dir: String,
    stylesheets: Vec<LoadedTextResource>,
    fonts: Vec<LoadedBinaryResource>,
    images: Vec<LoadedBinaryResource>,
    archive_image_entries: BTreeMap<String, ArchiveEntryMetadata>,
    chapters: Vec<LoadedChapter>,
}

impl OpenedPublication {
    fn into_document(self, storage: PublicationStorage) -> LoadedEpubDocument {
        LoadedEpubDocument {
            package: self.package,
            stylesheets: self.stylesheets,
            fonts: self.fonts,
            images: self.images,
            chapters: self.chapters,
            archive_source: Some(LoadedArchiveSource {
                storage,
                opf_dir: self.opf_dir,
                archive_image_entries: self.archive_image_entries,
            }),
        }
    }
}

pub(crate) fn open_from_reader(
    archive: &mut PublicationReader<'_>,
    chapter_loading: ChapterLoading,
) -> EpubResult<OpenedPublication> {
    let container_xml = archive.read_text(super::super::CONTAINER_PATH)?;
    let rootfile_path = join_epub_href("", &parser::parse_container(&container_xml)?);
    let opf_xml = archive.read_text(&rootfile_path)?;
    let mut package = parser::parse_package_document(&opf_xml)?;
    let opf_dir = opf_dir(&rootfile_path);

    package.toc = toc::load_toc(archive, &package, opf_dir);
    let stylesheets = load_text_resources(archive, &package, opf_dir);
    let binary_loading = match chapter_loading {
        ChapterLoading::Eager => BinaryResourceLoading::Eager,
        ChapterLoading::FirstChapterOnly | ChapterLoading::Deferred => {
            BinaryResourceLoading::Indexed
        }
    };
    let fonts = load_binary_resources(
        archive,
        &package,
        opf_dir,
        is_font_media_type,
        false,
        binary_loading,
    );
    let mut images = load_binary_resources(
        archive,
        &package,
        opf_dir,
        is_image_media_type,
        true,
        binary_loading,
    );
    let archive_image_entries =
        append_archive_image_resources(archive, &package, opf_dir, binary_loading, &mut images);
    let chapters = load_chapters(archive, &package, opf_dir, chapter_loading)?;
    Ok(OpenedPublication {
        opf_dir: opf_dir.to_owned(),
        package,
        stylesheets,
        fonts,
        images,
        archive_image_entries,
        chapters,
    })
}

// Real-world OPFs can retain stale ancillary manifest entries. Keep the spine
// strict, but skip unreadable styles, fonts, and images so content still opens.
fn load_text_resources(
    archive: &mut PublicationReader<'_>,
    package: &PackageDocument,
    opf_dir: &str,
) -> Vec<LoadedTextResource> {
    package
        .manifest
        .iter()
        .filter(|item| item.media_type == "text/css")
        .filter_map(|item| {
            let text = archive
                .read_text(&join_epub_href(opf_dir, &item.href))
                .ok()?;
            Some(LoadedTextResource {
                href: item.href.clone(),
                text,
            })
        })
        .collect()
}

fn load_binary_resources(
    archive: &mut PublicationReader<'_>,
    package: &PackageDocument,
    opf_dir: &str,
    matches_media_type: impl Fn(&str) -> bool,
    include_dimensions: bool,
    loading: BinaryResourceLoading,
) -> Vec<LoadedBinaryResource> {
    package
        .manifest
        .iter()
        .filter(|item| matches_media_type(&item.media_type))
        .filter_map(|item| {
            let path = join_epub_href(opf_dir, &item.href);
            let bytes = match loading {
                BinaryResourceLoading::Eager => archive.read_bytes(&path).ok()?,
                BinaryResourceLoading::Indexed => Vec::new(),
            };
            let byte_length = if bytes.is_empty() {
                archive.entry_size(&path).ok()?
            } else {
                bytes.len()
            };
            let byte_hash = (!bytes.is_empty()).then(|| hash_bytes(&bytes));
            let dimensions = include_dimensions
                .then(|| detect_image_dimensions(&bytes))
                .flatten();
            Some(LoadedBinaryResource {
                href: item.href.clone(),
                media_type: item.media_type.clone(),
                byte_length,
                byte_hash,
                bytes,
                width: dimensions.map(|(width, _)| width),
                height: dimensions.map(|(_, height)| height),
                dimensions_loaded: !include_dimensions || dimensions.is_some(),
            })
        })
        .collect()
}

fn load_chapters(
    archive: &mut PublicationReader<'_>,
    package: &PackageDocument,
    opf_dir: &str,
    chapter_loading: ChapterLoading,
) -> EpubResult<Vec<LoadedChapter>> {
    package
        .spine
        .iter()
        .enumerate()
        .map(|(index, spine)| {
            let href = package
                .manifest_item(&spine.idref)
                .map(|item| item.href.clone())
                .ok_or_else(|| {
                    EpubError::new(format!(
                        "spine idref is missing from manifest: {}",
                        spine.idref
                    ))
                })?;
            let should_load = match chapter_loading {
                ChapterLoading::Eager => true,
                ChapterLoading::FirstChapterOnly => index == 0,
                ChapterLoading::Deferred => false,
            };
            let xhtml_source = if !should_load {
                String::new()
            } else {
                archive.read_text(&join_epub_href(opf_dir, &href))?
            };
            Ok(LoadedChapter {
                idref: spine.idref.clone(),
                href,
                linear: spine.linear,
                xhtml_source,
                source_loaded: should_load,
                image_refs: None,
            })
        })
        .collect()
}
