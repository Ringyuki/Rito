use std::collections::BTreeMap;

use crate::{
    css::CssSummary,
    interaction::{
        discover_footnote_targets, extract_footnotes_for_targets, FootnoteFilterChapter,
        FootnoteTargetSet, InteractionSummary,
    },
    resources::PublicationResources,
    style::StylesheetRuleMap,
    xhtml::{parse_xhtml, ChapterSource, ParseResult, XhtmlSummary},
};

use super::{LoadedChapter, LoadedEpubDocument};

#[derive(Debug, Clone)]
pub(crate) struct PreparedLoadedDocumentBase {
    pub(crate) resources: PublicationResources,
    pub(crate) css: CssSummary,
    pub(crate) stylesheet_rules: StylesheetRuleMap,
}

#[derive(Debug, Clone)]
pub(crate) struct PreparedLoadedDocument {
    pub(crate) resources: PublicationResources,
    pub(crate) css: CssSummary,
    pub(crate) stylesheet_rules: StylesheetRuleMap,
    pub(crate) chapters: Vec<ParsedLoadedChapterSource>,
    pub(crate) filtered_footnote_nodes: BTreeMap<String, Vec<crate::xhtml::DocumentNode>>,
    pub(crate) xhtml: XhtmlSummary,
    pub(crate) interaction: InteractionSummary,
}

#[derive(Debug, Clone)]
pub(crate) struct ParsedLoadedChapterSource {
    pub(crate) source: ChapterSource,
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
    let css = crate::css::summarize_stylesheet_texts(
        document
            .stylesheets
            .iter()
            .map(|resource| (resource.href.as_str(), resource.text.as_str())),
    );
    let stylesheet_rules = crate::style::stylesheet_rules_from_texts(
        document
            .stylesheets
            .iter()
            .map(|resource| (resource.href.as_str(), resource.text.as_str())),
    );
    PreparedLoadedDocumentBase {
        resources,
        css,
        stylesheet_rules,
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
        css: base.css.clone(),
        stylesheet_rules: base.stylesheet_rules.clone(),
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
    let parsed =
        parse_xhtml(&chapter.xhtml_source).unwrap_or_else(|error| crate::xhtml::ParseResult {
            nodes: Vec::new(),
            warnings: vec![error],
            body_attributes: None,
            stylesheet_hrefs: None,
            embedded_stylesheets: None,
        });
    let source = ChapterSource {
        idref: chapter.idref.clone(),
        href: chapter.href.clone(),
        linear: chapter.linear,
        text_length: utf16_len(&chapter.xhtml_source),
        text_hash: short_sha256(chapter.xhtml_source.as_bytes()),
    };

    ParsedLoadedChapterSource { source, parsed }
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
