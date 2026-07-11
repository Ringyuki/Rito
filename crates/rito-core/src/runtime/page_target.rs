use crate::{
    epub::{join_epub_href, opf_dir, LoadedChapter, LoadedEpubDocument},
    layout::LayoutHitTarget,
};

use super::{
    source_locator::canonical_runtime_source_locator, RuntimePageTarget, RuntimePageTargetBounds,
    RuntimePageTargetKind, RuntimePageTargetText, RuntimeRevision, RuntimeSourceLocator,
    RuntimeSourcePoint,
};

pub(super) fn runtime_page_targets(
    document: &LoadedEpubDocument,
    revision: &RuntimeRevision,
    page_index: usize,
    targets: Vec<LayoutHitTarget>,
) -> Vec<RuntimePageTarget> {
    let chapter = chapter_for_page(document, revision, page_index);
    targets
        .into_iter()
        .map(|target| runtime_page_target(document, revision, chapter, target))
        .collect()
}

fn runtime_page_target(
    document: &LoadedEpubDocument,
    revision: &RuntimeRevision,
    chapter: Option<&LoadedChapter>,
    target: LayoutHitTarget,
) -> RuntimePageTarget {
    let source_locator = source_locator(chapter, &target);
    let href = target.href.clone();
    let destination = href
        .as_deref()
        .map(|href| canonical_destination(document, chapter, href));
    let canonical_href = destination
        .as_ref()
        .map(|destination| destination.href.clone());
    let target_locator = destination.and_then(|target| target.locator);
    let kind = target_kind(
        revision,
        canonical_href.as_deref(),
        target.image_src.as_deref(),
    );
    let footnote_key = if kind == RuntimePageTargetKind::Footnote {
        canonical_href
    } else {
        None
    };
    let bounds = target.rounded_bounds();
    let label = if target.text.is_empty() {
        target.image_alt.clone().unwrap_or_default()
    } else {
        target.text.clone()
    };

    RuntimePageTarget {
        kind,
        bounds: RuntimePageTargetBounds {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
        },
        block_index: target.block_index,
        line_index: target.line_index,
        run_index: target.run_index,
        label,
        text: RuntimePageTargetText {
            hash: target.text_hash(),
            length: target.text_length(),
        },
        href,
        source_locator,
        target_locator,
        image_src: target.image_src,
        image_alt: target.image_alt,
        footnote_key,
    }
}

fn chapter_for_page<'a>(
    document: &'a LoadedEpubDocument,
    revision: &RuntimeRevision,
    page_index: usize,
) -> Option<&'a LoadedChapter> {
    document.chapters.iter().find(|chapter| {
        revision
            .layout
            .summary
            .pagination_flow
            .chapter_map
            .get(&chapter.idref)
            .is_some_and(|range| page_index >= range.start_page && page_index <= range.end_page)
    })
}

fn source_locator(
    chapter: Option<&LoadedChapter>,
    target: &LayoutHitTarget,
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
    if href.is_some_and(|href| revision.interactions.footnotes.contains_key(href)) {
        RuntimePageTargetKind::Footnote
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
    let locator = canonical_runtime_source_locator(
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

fn is_external_href(href: &str) -> bool {
    if href.starts_with("//") {
        return true;
    }
    let path_end = href.find(['?', '#']).unwrap_or(href.len());
    let path = &href[..path_end];
    path.find(':').is_some_and(|colon| {
        colon > 0
            && path[..colon].chars().enumerate().all(|(index, character)| {
                character.is_ascii_alphabetic()
                    || (index > 0
                        && (character.is_ascii_digit() || matches!(character, '+' | '-' | '.')))
            })
    })
}

#[cfg(test)]
mod tests {
    use super::is_external_href;

    #[test]
    fn distinguishes_external_and_epub_relative_hrefs() {
        assert!(is_external_href("https://example.com/note#one"));
        assert!(is_external_href("mailto:reader@example.com"));
        assert!(is_external_href("//example.com/note"));
        assert!(!is_external_href("chapter.xhtml#one"));
        assert!(!is_external_href("../Text/chapter.xhtml#one"));
        assert!(!is_external_href("#one"));
    }
}
