use std::collections::BTreeMap;

use sha2::{Digest, Sha256};

use crate::epub::{
    is_external_href, join_epub_href, opf_dir, LoadedChapter, LoadedEpubDocument, TocEntry,
};

use super::{
    page_artifact::PageArtifactTarget, source_locator::RuntimeSourceLocatorCanonicalizer,
    RuntimePageTarget, RuntimePageTargetBounds, RuntimePageTargetKind, RuntimePageTargetText,
    RuntimeRevision, RuntimeSourceLocator, RuntimeSourcePoint,
};

#[cfg(test)]
mod tests;

#[derive(Debug)]
pub(super) struct RuntimePageTargetContext {
    canonicalizer: RuntimeSourceLocatorCanonicalizer,
    toc_labels: TocDestinationLabels,
}

impl RuntimePageTargetContext {
    pub(super) fn new(document: &LoadedEpubDocument) -> Self {
        let canonicalizer = RuntimeSourceLocatorCanonicalizer::new(document);
        let toc_labels = TocDestinationLabels::new(document, &canonicalizer);
        Self {
            canonicalizer,
            toc_labels,
        }
    }
}

/// What the classifier decides about one target of a page: what it is,
/// where its link leads and under which key its footnote is held.
pub(super) struct PageTargetClass {
    pub(super) kind: RuntimePageTargetKind,
    pub(super) href: Option<String>,
    pub(super) source_locator: Option<RuntimeSourceLocator>,
    pub(super) target_locator: Option<RuntimeSourceLocator>,
    pub(super) destination_label: Option<String>,
    pub(super) footnote_key: Option<String>,
}

/// The short hash of a page's or a target's text the page targets carry:
/// the first eight bytes of its SHA-256 digest, lowercase hex.
pub(super) fn hash_page_text(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(super) fn runtime_page_targets(
    document: &LoadedEpubDocument,
    context: &RuntimePageTargetContext,
    revision: &RuntimeRevision,
    page_index: usize,
    targets: Vec<PageArtifactTarget>,
) -> Vec<RuntimePageTarget> {
    let classes = classify_page_targets(document, context, revision, page_index, &targets);
    targets
        .into_iter()
        .zip(classes)
        .map(|(target, class)| runtime_page_target(target, class))
        .collect()
}

pub(super) fn classify_page_targets(
    document: &LoadedEpubDocument,
    context: &RuntimePageTargetContext,
    revision: &RuntimeRevision,
    page_index: usize,
    targets: &[PageArtifactTarget],
) -> Vec<PageTargetClass> {
    let chapter = chapter_for_page(document, revision, page_index);
    targets
        .iter()
        .map(|target| classify_page_target(document, context, revision, chapter, target))
        .collect()
}

fn classify_page_target(
    document: &LoadedEpubDocument,
    context: &RuntimePageTargetContext,
    revision: &RuntimeRevision,
    chapter: Option<&LoadedChapter>,
    target: &PageArtifactTarget,
) -> PageTargetClass {
    let source_locator = source_locator(chapter, target);
    let href = target.href.clone();
    let destination = href
        .as_deref()
        .map(|href| canonical_destination(document, context, chapter, href));
    let canonical_href = destination
        .as_ref()
        .map(|destination| destination.href.clone());
    let target_locator = destination.and_then(|target| target.locator);
    let kind = target_kind(
        revision,
        canonical_href.as_deref(),
        target.image_src.as_deref(),
    );
    let footnote_key = if matches!(
        kind,
        RuntimePageTargetKind::Footnote | RuntimePageTargetKind::FootnotePending
    ) {
        canonical_href
    } else {
        None
    };
    let destination_label = (kind == RuntimePageTargetKind::Link)
        .then_some(target_locator.as_ref())
        .flatten()
        .and_then(|locator| context.toc_labels.label(locator))
        .map(str::to_owned);
    PageTargetClass {
        kind,
        href,
        source_locator,
        target_locator,
        destination_label,
        footnote_key,
    }
}

fn runtime_page_target(target: PageArtifactTarget, class: PageTargetClass) -> RuntimePageTarget {
    let label = if target.text.is_empty() {
        target.image_alt.clone().unwrap_or_default()
    } else {
        target.text.clone()
    };
    RuntimePageTarget {
        kind: class.kind,
        bounds: RuntimePageTargetBounds {
            x: target.bounds.x,
            y: target.bounds.y,
            width: target.bounds.width,
            height: target.bounds.height,
        },
        block_index: target.block_index,
        line_index: target.line_index,
        run_index: target.run_index,
        label,
        text: RuntimePageTargetText {
            hash: hash_page_text(&target.text),
            length: target.text_length,
        },
        href: class.href,
        source_locator: class.source_locator,
        target_locator: class.target_locator,
        destination_label: class.destination_label,
        image_src: target.image_src,
        image_alt: target.image_alt,
        footnote_key: class.footnote_key,
    }
}

#[derive(Debug)]
struct TocDestinationLabels {
    by_chapter: BTreeMap<String, Vec<TocDestinationLabel>>,
}

#[derive(Debug)]
struct TocDestinationLabel {
    anchor_id: Option<String>,
    label: String,
}

impl TocDestinationLabels {
    fn new(
        document: &LoadedEpubDocument,
        canonicalizer: &RuntimeSourceLocatorCanonicalizer,
    ) -> Self {
        let mut labels = Self {
            by_chapter: BTreeMap::new(),
        };
        labels.collect(document, canonicalizer, &document.package.toc);
        labels
    }

    fn collect(
        &mut self,
        document: &LoadedEpubDocument,
        canonicalizer: &RuntimeSourceLocatorCanonicalizer,
        entries: &[TocEntry],
    ) {
        for entry in entries {
            if let Ok(locator) = canonicalizer.canonicalize_locator(
                document,
                RuntimeSourceLocator {
                    href: entry.href.clone(),
                    anchor_id: None,
                    source_point: None,
                    source_range: None,
                    progression: None,
                },
            ) {
                self.by_chapter
                    .entry(locator.href)
                    .or_default()
                    .push(TocDestinationLabel {
                        anchor_id: locator.anchor_id,
                        label: entry.label.clone(),
                    });
            }
            self.collect(document, canonicalizer, &entry.children);
        }
    }

    fn label<'a>(&'a self, destination: &RuntimeSourceLocator) -> Option<&'a str> {
        let entries = self.by_chapter.get(destination.href.as_str())?;
        entries
            .iter()
            .find(|entry| entry.anchor_id == destination.anchor_id)
            .or_else(|| entries.iter().find(|entry| entry.anchor_id.is_none()))
            .map(|entry| entry.label.as_str())
    }
}

pub(super) fn chapter_for_page<'a>(
    document: &'a LoadedEpubDocument,
    revision: &RuntimeRevision,
    page_index: usize,
) -> Option<&'a LoadedChapter> {
    let session = revision.chapter_engine_session();
    document.chapters.iter().find(|chapter| {
        session
            .known_chapter(&chapter.idref)
            .is_some_and(|range| page_index >= range.start_page && page_index <= range.end_page)
    })
}

fn source_locator(
    chapter: Option<&LoadedChapter>,
    target: &PageArtifactTarget,
) -> Option<RuntimeSourceLocator> {
    let chapter = chapter?;
    let node_path = target.source_path.clone()?;
    // Loaded chapter hrefs already use the canonical manifest identity, so
    // click-source locators do not need to rebuild the publication href index
    // for every visible text run.
    Some(RuntimeSourceLocator {
        href: chapter.href.clone(),
        anchor_id: None,
        source_point: Some(RuntimeSourcePoint {
            node_path,
            text_offset: target.source_text_offset.unwrap_or(0),
        }),
        source_range: None,
        progression: None,
    })
}

fn target_kind(
    revision: &RuntimeRevision,
    href: Option<&str>,
    image_src: Option<&str>,
) -> RuntimePageTargetKind {
    if href.is_some_and(|href| revision.interactions.contains_footnote(href)) {
        RuntimePageTargetKind::Footnote
    } else if href.is_some_and(|href| revision.interactions.pending_footnote_keys.contains(href)) {
        RuntimePageTargetKind::FootnotePending
    } else if href.is_some() {
        RuntimePageTargetKind::Link
    } else if image_src.is_some() {
        RuntimePageTargetKind::Image
    } else {
        RuntimePageTargetKind::Text
    }
}

struct CanonicalDestination {
    href: String,
    locator: Option<RuntimeSourceLocator>,
}

fn canonical_destination(
    document: &LoadedEpubDocument,
    context: &RuntimePageTargetContext,
    chapter: Option<&LoadedChapter>,
    href: &str,
) -> CanonicalDestination {
    if is_external_href(href) {
        return CanonicalDestination {
            href: href.to_owned(),
            locator: None,
        };
    }
    let contextual_href = contextual_internal_href(chapter, href);
    let locator = context
        .canonicalizer
        .canonicalize_locator(
            document,
            RuntimeSourceLocator {
                href: contextual_href.clone(),
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: None,
            },
        )
        .ok();
    let canonical_href = locator
        .as_ref()
        .map(canonical_locator_href)
        .unwrap_or(contextual_href);
    CanonicalDestination {
        href: canonical_href,
        locator,
    }
}

fn contextual_internal_href(chapter: Option<&LoadedChapter>, href: &str) -> String {
    let Some(chapter) = chapter else {
        return href.to_owned();
    };
    let fragment = href
        .find('#')
        .map(|index| &href[index..])
        .unwrap_or_default();
    let path = join_epub_href(opf_dir(&chapter.href), href);
    let path = if path.is_empty() {
        chapter.href.clone()
    } else {
        path
    };
    format!("{path}{fragment}")
}

fn canonical_locator_href(locator: &RuntimeSourceLocator) -> String {
    locator
        .anchor_id
        .as_ref()
        .map(|anchor| format!("{}#{anchor}", locator.href))
        .unwrap_or_else(|| locator.href.clone())
}
