//! Whether the reader can read a publication, decided without laying it
//! out. The check opens the archive the way the reader does, then makes
//! every read and source check that laying the whole book out makes before
//! the cascade: every chapter, the size of every image a chapter draws,
//! every font the package lists, and each chapter's stylesheet selection
//! and `style` attributes. The cascade and layout depend on the reading
//! device's fonts and page size, so they are not run.

use super::{
    check_chapter_style_sources, is_external_href, join_epub_href, open_runtime_document,
    parsed_loaded_chapter_source, prepare_loaded_document_base, EpubResult, LoadedEpubDocument,
    ParsedLoadedChapterSource,
};
use crate::resources::{is_font_media_type, is_image_media_type};

/// A file the reader shows degraded instead of failing the book.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationProblem {
    /// The file's path in the archive.
    pub path: String,
    pub message: String,
}

/// Checks `epub` as described in the module documentation. An error is the
/// one the reader fails with; otherwise the result lists the files the
/// reader shows degraded, in package order.
pub fn check_publication(epub: &[u8]) -> EpubResult<Vec<PublicationProblem>> {
    let mut document = open_runtime_document(epub)?;
    document.ensure_all_chapters_loaded()?;
    document.ensure_chapter_image_dimensions_loaded(0, document.chapters.len())?;
    document.ensure_all_fonts_loaded()?;
    let ledger = prepare_loaded_document_base(&document).stylesheet_ledger;
    let chapters = document
        .chapters
        .iter()
        .map(parsed_loaded_chapter_source)
        .collect::<Vec<_>>();
    for chapter in &chapters {
        check_chapter_style_sources(&ledger, chapter)?;
    }
    let mut problems = missing_resources(&document);
    problems.extend(
        chapters
            .iter()
            .filter_map(|chapter| empty_chapter(&document, chapter)),
    );
    Ok(problems)
}

/// Stylesheets, fonts and images the package lists that opening skipped
/// because the archive has no readable file for them: the book shows
/// without that style, in a fallback face, or with a broken image.
fn missing_resources(document: &LoadedEpubDocument) -> Vec<PublicationProblem> {
    document
        .package
        .manifest
        .iter()
        .filter(|item| !is_external_href(&item.href))
        .filter(|item| {
            let opened = if item.media_type == "text/css" {
                document.stylesheet(&item.href).is_some()
            } else if is_font_media_type(&item.media_type) {
                document.fonts.iter().any(|font| font.href == item.href)
            } else if is_image_media_type(&item.media_type) {
                document.images.iter().any(|image| image.href == item.href)
            } else {
                true
            };
            !opened
        })
        .map(|item| PublicationProblem {
            path: join_epub_href(document.opf_dir(), &item.href),
            message: "listed in the package but not readable from the archive".to_owned(),
        })
        .collect()
}

/// A chapter whose XHTML does not parse, which the reader shows with no
/// content.
fn empty_chapter(
    document: &LoadedEpubDocument,
    chapter: &ParsedLoadedChapterSource,
) -> Option<PublicationProblem> {
    if chapter.source_arena.is_some() || chapter.source.href.is_empty() {
        return None;
    }
    let reason = chapter.parsed.warnings.first()?;
    Some(PublicationProblem {
        path: join_epub_href(document.opf_dir(), &chapter.source.href),
        message: format!("shows no content: {reason}"),
    })
}

#[cfg(test)]
mod tests;
