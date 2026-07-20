use std::collections::BTreeMap;
use std::sync::Arc;
#[cfg(feature = "legacy-css-diagnostics")]
use std::sync::OnceLock;

use rito_source::SourceArena;

#[cfg(feature = "legacy-css-diagnostics")]
use crate::{css::CssSummary, style::StylesheetRuleMap};
use crate::{
    interaction::{
        discover_footnote_targets, extract_footnotes_for_targets, FootnoteFilterChapter,
        FootnoteTargetSet, InteractionSummary,
    },
    resources::PublicationResources,
    xhtml::{parse_xhtml_with_source, ChapterSource, ParseResult, XhtmlSummary},
};

use super::{LoadedChapter, LoadedEpubDocument};

#[derive(Debug, Clone)]
pub(crate) struct PreparedLoadedDocumentBase {
    pub(crate) resources: PublicationResources,
    pub(crate) stylesheet_ledger: StylesheetSourceLedger,
}

#[derive(Debug, Clone)]
pub(crate) struct PreparedLoadedDocument {
    pub(crate) resources: PublicationResources,
    pub(crate) stylesheet_ledger: StylesheetSourceLedger,
    pub(crate) chapters: Vec<ParsedLoadedChapterSource>,
    pub(crate) filtered_footnote_nodes: BTreeMap<String, Vec<crate::xhtml::DocumentNode>>,
    pub(crate) xhtml: XhtmlSummary,
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

#[cfg(feature = "legacy-css-diagnostics")]
#[derive(Debug, Clone)]
pub(crate) struct LegacyStylesheetArtifacts {
    css: CssSummary,
    stylesheet_rules: StylesheetRuleMap,
}

#[cfg(feature = "legacy-css-diagnostics")]
impl LegacyStylesheetArtifacts {
    pub(crate) fn css(&self) -> &CssSummary {
        &self.css
    }

    pub(crate) fn stylesheet_rules(&self) -> &StylesheetRuleMap {
        &self.stylesheet_rules
    }
}

/// Raw publication CSS plus a single shared compatibility cache.
///
/// Creating or cloning this ledger never invokes the legacy CSS parser. The
/// compatibility artifacts are initialized only when a style backend chooses
/// the legacy fallback explicitly.
#[derive(Debug, Clone)]
pub(crate) struct StylesheetSourceLedger {
    sources: Arc<[RawStylesheetSource]>,
    #[cfg(feature = "legacy-css-diagnostics")]
    legacy: Arc<OnceLock<LegacyStylesheetArtifacts>>,
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
            #[cfg(feature = "legacy-css-diagnostics")]
            legacy: Arc::new(OnceLock::new()),
        }
    }

    pub(crate) fn sources(&self) -> &[RawStylesheetSource] {
        &self.sources
    }

    #[cfg(feature = "legacy-css-diagnostics")]
    pub(crate) fn legacy_artifacts(&self) -> &LegacyStylesheetArtifacts {
        self.legacy.get_or_init(|| {
            #[cfg(feature = "bench-internals")]
            let _probe_timer = crate::layout::bounded_work_probe::start_timing(
                crate::layout::bounded_work_probe::ContinuationTimingStage::PreparedBase,
            );
            LegacyStylesheetArtifacts {
                css: crate::css::summarize_stylesheet_texts(
                    self.sources
                        .iter()
                        .map(|source| (source.href(), source.text())),
                ),
                stylesheet_rules: crate::style::stylesheet_rules_from_texts(
                    self.sources
                        .iter()
                        .map(|source| (source.href(), source.text())),
                ),
            }
        })
    }

    #[cfg(test)]
    pub(crate) fn legacy_artifacts_if_initialized(&self) -> Option<()> {
        #[cfg(feature = "legacy-css-diagnostics")]
        {
            self.legacy.get().map(|_| ())
        }
        #[cfg(not(feature = "legacy-css-diagnostics"))]
        {
            None
        }
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

pub(crate) fn prepare_loaded_document(document: &LoadedEpubDocument) -> PreparedLoadedDocument {
    prepare_loaded_document_with_chapters(
        document,
        parsed_loaded_chapter_sources_from_document(document),
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
    chapters: Vec<ParsedLoadedChapterSource>,
) -> PreparedLoadedDocument {
    let inputs = footnote_inputs(&chapters);
    let targets = discover_footnote_targets(&inputs);
    prepare_loaded_document_with_base_and_footnote_targets(base, chapters, &targets)
}

pub(crate) fn prepare_loaded_document_with_base_and_footnote_targets(
    base: &PreparedLoadedDocumentBase,
    chapters: Vec<ParsedLoadedChapterSource>,
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
    let xhtml = crate::xhtml::summarize_parsed_chapters(chapters.iter().map(|chapter| {
        (
            chapter.source.idref.clone(),
            chapter.source.href.clone(),
            chapter.parsed.clone(),
        )
    }));
    let interaction = crate::interaction::summarize_interaction_with_footnotes(
        chapters.iter().map(|chapter| chapter.source.idref.clone()),
        extraction.footnotes,
    );
    PreparedLoadedDocument {
        resources: base.resources.clone(),
        stylesheet_ledger: base.stylesheet_ledger.clone(),
        chapters,
        filtered_footnote_nodes,
        xhtml,
        interaction,
    }
}

fn footnote_inputs(chapters: &[ParsedLoadedChapterSource]) -> Vec<FootnoteFilterChapter<'_>> {
    chapters
        .iter()
        .map(|chapter| FootnoteFilterChapter {
            idref: &chapter.source.idref,
            href: &chapter.source.href,
            nodes: &chapter.parsed.nodes,
        })
        .collect()
}

pub(crate) fn parsed_loaded_chapter_sources_from_document(
    document: &LoadedEpubDocument,
) -> Vec<ParsedLoadedChapterSource> {
    parsed_loaded_chapter_sources(document.chapters.iter())
}

pub(crate) fn parsed_loaded_chapter_source(chapter: &LoadedChapter) -> ParsedLoadedChapterSource {
    parse_loaded_chapter_source(chapter)
}

fn prepare_loaded_document_with_chapters(
    document: &LoadedEpubDocument,
    chapters: Vec<ParsedLoadedChapterSource>,
) -> PreparedLoadedDocument {
    let base = prepare_loaded_document_base(document);
    prepare_loaded_document_with_base(&base, chapters)
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

fn parsed_loaded_chapter_sources<'a>(
    chapters: impl IntoIterator<Item = &'a LoadedChapter>,
) -> Vec<ParsedLoadedChapterSource> {
    chapters
        .into_iter()
        .map(parse_loaded_chapter_source)
        .collect()
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
