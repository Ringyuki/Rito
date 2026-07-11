use std::collections::BTreeSet;

use crate::{
    resources::{detect_image_dimensions, hash_bytes, resolve_resource_href_index},
    xhtml::{parse_xhtml, DocumentNode},
};

use super::{archive, join_epub_href, EpubError, EpubResult, PackageDocument};

mod archive_source;
mod chapter_scan;
mod open;

use archive_source::{ArchiveResourceKind, LoadedArchiveSource};

pub use open::{open_document, open_runtime_document, open_runtime_document_owned};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedTextResource {
    pub href: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedBinaryResource {
    pub href: String,
    pub media_type: String,
    pub byte_length: usize,
    pub byte_hash: Option<String>,
    pub bytes: Vec<u8>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub dimensions_loaded: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedChapter {
    pub idref: String,
    pub href: String,
    pub linear: bool,
    pub xhtml_source: String,
    pub source_loaded: bool,
    pub image_refs: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedEpubDocument {
    pub package: PackageDocument,
    pub stylesheets: Vec<LoadedTextResource>,
    pub fonts: Vec<LoadedBinaryResource>,
    pub images: Vec<LoadedBinaryResource>,
    pub chapters: Vec<LoadedChapter>,
    pub archive_source: Option<LoadedArchiveSource>,
}

impl LoadedEpubDocument {
    pub fn read_chapter(&self, idref: &str) -> Option<&str> {
        self.chapters
            .iter()
            .find(|chapter| chapter.idref == idref)
            .map(|chapter| chapter.xhtml_source.as_str())
    }

    pub fn ensure_chapter_loaded(&mut self, index: usize) -> EpubResult<()> {
        self.ensure_chapter_range_loaded(index, 1)
    }

    pub fn ensure_chapter_range_loaded(&mut self, start: usize, count: usize) -> EpubResult<()> {
        if start >= self.chapters.len() {
            return Ok(());
        }
        let end = start.saturating_add(count).min(self.chapters.len());
        if self.chapters[start..end]
            .iter()
            .all(|chapter| chapter.source_loaded)
        {
            return Ok(());
        }
        let Some(source) = self.archive_source.as_ref() else {
            return Ok(());
        };
        let mut archive = archive::EpubArchive::new(&source.bytes)?;
        for chapter in &mut self.chapters[start..end] {
            if chapter.source_loaded {
                continue;
            }
            if chapter.href.is_empty() {
                chapter.xhtml_source.clear();
            } else {
                chapter.xhtml_source =
                    archive.read_text(&join_epub_href(&source.opf_dir, &chapter.href))?;
            }
            chapter.source_loaded = true;
            chapter.image_refs = None;
        }
        Ok(())
    }

    pub fn ensure_all_chapters_loaded(&mut self) -> EpubResult<()> {
        self.ensure_chapter_range_loaded(0, self.chapters.len())
    }

    pub fn ensure_all_fonts_loaded(&mut self) -> EpubResult<()> {
        if self.fonts.iter().all(|resource| !resource.bytes.is_empty()) {
            return Ok(());
        }
        let Some(source) = self.archive_source.as_ref() else {
            for index in 0..self.fonts.len() {
                self.ensure_font_loaded(index)?;
            }
            return Ok(());
        };
        let mut archive = archive::EpubArchive::new(&source.bytes)?;
        for resource in &mut self.fonts {
            if !resource.bytes.is_empty() {
                continue;
            }
            let bytes = source.read_bytes_with_archive(
                &mut archive,
                &resource.href,
                ArchiveResourceKind::Font,
            )?;
            resource.byte_length = bytes.len();
            resource.byte_hash = Some(hash_bytes(&bytes));
            resource.bytes = bytes;
        }
        Ok(())
    }

    pub fn ensure_chapter_image_dimensions_loaded(
        &mut self,
        start: usize,
        count: usize,
    ) -> EpubResult<()> {
        let refs = self.collect_chapter_image_refs(start, count);
        self.ensure_image_dimensions_loaded_for_refs(&refs)?;
        Ok(())
    }

    pub fn read_font_bytes(&mut self, href: &str) -> EpubResult<Option<Vec<u8>>> {
        read_binary_resource_bytes(
            self.archive_source.as_ref(),
            &mut self.fonts,
            href,
            ArchiveResourceKind::Font,
        )
    }

    pub fn read_image_bytes(&mut self, href: &str) -> EpubResult<Option<Vec<u8>>> {
        read_binary_resource_bytes(
            self.archive_source.as_ref(),
            &mut self.images,
            href,
            ArchiveResourceKind::Image,
        )
    }

    pub fn stylesheet(&self, href: &str) -> Option<&str> {
        self.stylesheets
            .iter()
            .find(|resource| resource.href == href)
            .map(|resource| resource.text.as_str())
    }

    pub fn font(&self, href: &str) -> Option<&[u8]> {
        self.fonts
            .iter()
            .find(|resource| resource.href == href)
            .map(|resource| resource.bytes.as_slice())
    }

    pub fn image(&self, href: &str) -> Option<&[u8]> {
        self.images
            .iter()
            .find(|resource| resource.href == href)
            .map(|resource| resource.bytes.as_slice())
    }

    fn ensure_font_loaded(&mut self, index: usize) -> EpubResult<()> {
        if self
            .fonts
            .get(index)
            .is_some_and(|resource| !resource.bytes.is_empty())
        {
            return Ok(());
        }
        let Some(href) = self.fonts.get(index).map(|resource| resource.href.clone()) else {
            return Ok(());
        };
        let bytes = self.read_archive_bytes(&href, ArchiveResourceKind::Font)?;
        if let Some(resource) = self.fonts.get_mut(index) {
            resource.byte_length = bytes.len();
            resource.byte_hash = Some(hash_bytes(&bytes));
            resource.bytes = bytes;
        }
        Ok(())
    }

    pub(crate) fn ensure_image_dimensions_loaded(&mut self, href: &str) -> EpubResult<()> {
        let Some(index) = find_resource_index(&self.images, href) else {
            return Ok(());
        };
        if self
            .images
            .get(index)
            .is_some_and(|resource| resource.dimensions_loaded)
        {
            return Ok(());
        }
        if !self.images[index].bytes.is_empty() {
            let dimensions = detect_image_dimensions(&self.images[index].bytes);
            set_image_dimensions(&mut self.images[index], dimensions);
            return Ok(());
        }
        let Some(resource_href) = self.images.get(index).map(|resource| resource.href.clone())
        else {
            return Ok(());
        };
        let bytes = self.read_archive_bytes(&resource_href, ArchiveResourceKind::Image)?;
        let dimensions = detect_image_dimensions(&bytes);
        if let Some(resource) = self.images.get_mut(index) {
            set_image_dimensions(resource, dimensions);
            resource.byte_length = bytes.len();
            resource.byte_hash = Some(hash_bytes(&bytes));
            resource.bytes = bytes;
        }
        Ok(())
    }

    fn collect_chapter_image_refs(&mut self, start: usize, count: usize) -> Vec<String> {
        if start >= self.chapters.len() {
            return Vec::new();
        }
        let end = start.saturating_add(count).min(self.chapters.len());
        let mut refs = BTreeSet::new();
        for chapter in &mut self.chapters[start..end] {
            for href in cached_chapter_image_refs(chapter) {
                refs.insert(href.clone());
            }
        }
        refs.into_iter().collect()
    }

    fn ensure_image_dimensions_loaded_for_refs(&mut self, refs: &[String]) -> EpubResult<()> {
        let needs_archive = refs.iter().any(|href| {
            find_resource_index(&self.images, href).is_some_and(|index| {
                !self.images[index].dimensions_loaded && self.images[index].bytes.is_empty()
            })
        });
        if !needs_archive {
            for href in refs {
                self.ensure_image_dimensions_loaded(href)?;
            }
            return Ok(());
        }
        let Some(source) = self.archive_source.as_ref() else {
            for href in refs {
                self.ensure_image_dimensions_loaded(href)?;
            }
            return Ok(());
        };
        let mut archive = archive::EpubArchive::new(&source.bytes)?;
        for href in refs {
            ensure_image_dimensions_loaded_with_archive(
                &mut self.images,
                source,
                &mut archive,
                href,
            )?;
        }
        Ok(())
    }

    fn read_archive_bytes(
        &self,
        href: &str,
        resource_kind: ArchiveResourceKind,
    ) -> EpubResult<Vec<u8>> {
        let Some(source) = self.archive_source.as_ref() else {
            return Err(EpubError::new(format!(
                "resource bytes are not loaded: {href}"
            )));
        };
        source.read_bytes(href, resource_kind)
    }
}

fn read_binary_resource_bytes(
    source: Option<&LoadedArchiveSource>,
    resources: &mut [LoadedBinaryResource],
    href: &str,
    resource_kind: ArchiveResourceKind,
) -> EpubResult<Option<Vec<u8>>> {
    let Some(index) = find_resource_index(resources, href) else {
        return Ok(None);
    };
    if !resources[index].bytes.is_empty() {
        return Ok(Some(resources[index].bytes.clone()));
    }
    let resource_href = resources[index].href.clone();
    let Some(source) = source else {
        return Err(EpubError::new(format!(
            "resource bytes are not loaded: {resource_href}"
        )));
    };
    let bytes = source.read_bytes(&resource_href, resource_kind)?;
    resources[index].byte_length = bytes.len();
    resources[index].byte_hash = Some(hash_bytes(&bytes));
    resources[index].bytes = bytes.clone();
    Ok(Some(bytes))
}

fn cached_chapter_image_refs(chapter: &mut LoadedChapter) -> &[String] {
    if chapter.image_refs.is_none() {
        chapter.image_refs = Some(collect_chapter_image_refs(chapter));
    }
    chapter.image_refs.as_deref().unwrap_or(&[])
}

fn collect_chapter_image_refs(chapter: &LoadedChapter) -> Vec<String> {
    if chapter.xhtml_source.is_empty() {
        return Vec::new();
    }
    // This is a speculative preload pass. The formal prepare pass owns XHTML
    // diagnostics and preserves malformed chapters as warnings with empty nodes.
    let Ok(parsed) = parse_xhtml(&chapter.xhtml_source) else {
        return Vec::new();
    };
    let mut refs = BTreeSet::new();
    for node in &parsed.nodes {
        collect_image_refs(node, &mut refs);
    }
    refs.into_iter().collect()
}

fn ensure_image_dimensions_loaded_with_archive(
    images: &mut [LoadedBinaryResource],
    source: &LoadedArchiveSource,
    archive: &mut archive::EpubArchive<'_>,
    href: &str,
) -> EpubResult<()> {
    let Some(index) = find_resource_index(images, href) else {
        return Ok(());
    };
    if images[index].dimensions_loaded {
        return Ok(());
    }
    if !images[index].bytes.is_empty() {
        let dimensions = detect_image_dimensions(&images[index].bytes);
        set_image_dimensions(&mut images[index], dimensions);
        return Ok(());
    }
    let bytes =
        source.read_bytes_with_archive(archive, &images[index].href, ArchiveResourceKind::Image)?;
    let dimensions = detect_image_dimensions(&bytes);
    set_image_dimensions(&mut images[index], dimensions);
    images[index].byte_length = bytes.len();
    images[index].byte_hash = Some(hash_bytes(&bytes));
    images[index].bytes = bytes;
    Ok(())
}

fn set_image_dimensions(resource: &mut LoadedBinaryResource, dimensions: Option<(u32, u32)>) {
    resource.width = dimensions.map(|(width, _)| width);
    resource.height = dimensions.map(|(_, height)| height);
    resource.dimensions_loaded = true;
}

fn collect_image_refs(node: &DocumentNode, refs: &mut BTreeSet<String>) {
    match node {
        DocumentNode::Image(image) => {
            refs.insert(image.src.clone());
        }
        DocumentNode::Block(element) | DocumentNode::Inline(element) => {
            for child in &element.children {
                collect_image_refs(child, refs);
            }
        }
        DocumentNode::Text(_) => {}
    }
}

fn find_resource_index(resources: &[LoadedBinaryResource], href: &str) -> Option<usize> {
    resolve_resource_href_index(resources, href, |resource| resource.href.as_str())
}

#[cfg(test)]
mod tests;
