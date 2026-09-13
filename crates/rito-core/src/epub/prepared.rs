use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::Arc;

use rito_source::SourceArena;

use crate::{
    interaction::{
        discover_footnote_targets, extract_footnotes_for_targets, FootnoteFilterChapter,
        FootnoteTargetSet, InteractionSummary,
    },
    resources::PublicationResources,
    xhtml::{parse_xhtml_with_source, ChapterSource, ParseResult},
};

use super::{LoadedChapter, LoadedEpubDocument};

#[derive(Debug, Clone)]
pub(crate) struct PreparedLoadedDocumentBase {
    pub(crate) resources: PublicationResources,
    pub(crate) stylesheet_ledger: StylesheetSourceLedger,
}

#[derive(Debug, Clone)]
pub(crate) struct PreparedLoadedDocument {
    pub(crate) stylesheet_ledger: StylesheetSourceLedger,
    /// One handle per spine chapter, shared with the runtime's parsed
    /// chapter cache: a chapter is parsed once and both stores point at
    /// the same tree.
    pub(crate) chapters: Vec<Rc<ParsedLoadedChapterSource>>,
    pub(crate) filtered_footnote_nodes: BTreeMap<String, Vec<crate::xhtml::DocumentNode>>,
    pub(crate) interaction: InteractionSummary,
}

#[derive(Debug, Clone)]
pub(crate) struct RawStylesheetSource {
    href: Arc<str>,
    text: Arc<str>,
}

impl RawStylesheetSource {
    pub(crate) fn href(&self) -> &str {
        &self.href
    }

    pub(crate) fn text(&self) -> &str {
        &self.text
    }
}

/// The publication's raw CSS sources, shared by every prepared chapter.
#[derive(Debug, Clone)]
pub(crate) struct StylesheetSourceLedger {
    sources: Arc<[RawStylesheetSource]>,
}

impl StylesheetSourceLedger {
    fn from_document(document: &LoadedEpubDocument) -> Self {
        let sources = document
            .stylesheets
            .iter()
            .map(|resource| RawStylesheetSource {
                href: Arc::from(resource.href.as_str()),
                text: Arc::from(resource.text.as_str()),
            })
            .collect::<Vec<_>>();
        Self {
            sources: Arc::from(sources),
        }
    }

    pub(crate) fn sources(&self) -> &[RawStylesheetSource] {
        &self.sources
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ParsedLoadedChapterSource {
    pub(crate) source: ChapterSource,
    /// Canonical source topology for `parsed` node identities. Invalid XHTML
    /// retains the existing empty-parse fallback and therefore has no arena.
    pub(crate) source_arena: Option<Arc<SourceArena>>,
    pub(crate) parsed: ParseResult,
}

#[cfg(test)]
pub(crate) fn prepare_loaded_document(document: &LoadedEpubDocument) -> PreparedLoadedDocument {
    let base = prepare_loaded_document_base(document);
    prepare_loaded_document_with_base(
        &base,
        document
            .chapters
            .iter()
            .map(|chapter| Rc::new(parse_loaded_chapter_source(chapter)))
            .collect(),
    )
}

pub(crate) fn prepare_loaded_document_base(
    document: &LoadedEpubDocument,
) -> PreparedLoadedDocumentBase {
    let resources = loaded_document_resources(document);
    PreparedLoadedDocumentBase {
        resources,
        stylesheet_ledger: StylesheetSourceLedger::from_document(document),
    }
}

pub(crate) fn prepare_loaded_document_with_base(
    base: &PreparedLoadedDocumentBase,
    chapters: Vec<Rc<ParsedLoadedChapterSource>>,
) -> PreparedLoadedDocument {
    let inputs = footnote_inputs(&chapters);
    let targets = discover_footnote_targets(&inputs);
    prepare_loaded_document_with_base_and_footnote_targets(base, chapters, &targets)
}

pub(crate) fn prepare_loaded_document_with_base_and_footnote_targets(
    base: &PreparedLoadedDocumentBase,
    chapters: Vec<Rc<ParsedLoadedChapterSource>>,
    targets: &FootnoteTargetSet,
) -> PreparedLoadedDocument {
    debug_assert!(chapters.iter().all(|chapter| {
        chapter.parsed.body_source_node_id.is_none() || chapter.source_arena.is_some()
    }));
    let footnote_inputs = chapters
        .iter()
        .map(|chapter| FootnoteFilterChapter {
            idref: &chapter.source.idref,
            href: &chapter.source.href,
            nodes: &chapter.parsed.nodes,
        })
        .collect::<Vec<_>>();
    let extraction = extract_footnotes_for_targets(&footnote_inputs, targets);
    let mut filtered_footnote_nodes = extraction.filtered_chapters;
    filtered_footnote_nodes.retain(|idref, nodes| {
        chapters
            .iter()
            .find(|chapter| chapter.source.idref == *idref)
            .is_some_and(|chapter| chapter.parsed.nodes != *nodes)
    });
    let interaction = crate::interaction::summarize_interaction_with_footnotes(
        chapters.iter().map(|chapter| chapter.source.idref.clone()),
        extraction.footnotes,
    );
    PreparedLoadedDocument {
        stylesheet_ledger: base.stylesheet_ledger.clone(),
        chapters,
        filtered_footnote_nodes,
        interaction,
    }
}

fn footnote_inputs(chapters: &[Rc<ParsedLoadedChapterSource>]) -> Vec<FootnoteFilterChapter<'_>> {
    chapters
        .iter()
        .map(|chapter| FootnoteFilterChapter {
            idref: &chapter.source.idref,
            href: &chapter.source.href,
            nodes: &chapter.parsed.nodes,
        })
        .collect()
}

pub(crate) fn parsed_loaded_chapter_source(chapter: &LoadedChapter) -> ParsedLoadedChapterSource {
    parse_loaded_chapter_source(chapter)
}

pub(crate) fn loaded_document_resources(document: &LoadedEpubDocument) -> PublicationResources {
    let mut resources = crate::resources::summarize_loaded_publication_resources(
        document
            .stylesheets
            .iter()
            .map(|resource| (resource.href.as_str(), resource.text.as_str())),
        [],
        [],
    );
    resources.fonts = document
        .fonts
        .iter()
        .map(|resource| {
            crate::resources::binary_summary_from_metadata(
                &resource.href,
                resource.byte_length,
                resource.byte_hash.clone(),
                None,
                None,
            )
        })
        .collect();
    resources.images = document
        .images
        .iter()
        .map(|resource| {
            crate::resources::binary_summary_from_metadata(
                &resource.href,
                resource.byte_length,
                resource.byte_hash.clone(),
                resource.width,
                resource.height,
            )
        })
        .collect();
    crate::resources::sort_publication_resources(&mut resources);
    resources
}

fn parse_loaded_chapter_source(chapter: &LoadedChapter) -> ParsedLoadedChapterSource {
    let (source_arena, parsed) = match parse_xhtml_with_source(&chapter.xhtml_source) {
        Ok(parsed_source) => (Some(parsed_source.source_arena), parsed_source.parsed),
        Err(error) => (
            None,
            crate::xhtml::ParseResult {
                nodes: Vec::new(),
                warnings: vec![error],
                body_attributes: None,
                body_source_node_id: None,
                stylesheet_hrefs: None,
                embedded_stylesheets: None,
                author_stylesheets: Vec::new(),
            },
        ),
    };
    let source = ChapterSource {
        idref: chapter.idref.clone(),
        href: chapter.href.clone(),
        linear: chapter.linear,
        text_length: utf16_len(&chapter.xhtml_source),
        text_hash: short_sha256(chapter.xhtml_source.as_bytes()),
    };

    ParsedLoadedChapterSource {
        source,
        source_arena,
        parsed,
    }
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn short_sha256(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};

    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests;
