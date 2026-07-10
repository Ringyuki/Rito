use std::collections::BTreeMap;

use crate::{
    epub::{EpubError, EpubResult, LoadedChapter, LoadedEpubDocument, PackageDocument, TocEntry},
    layout::{build_spread_slots, collect_anchor_pages, PaginationFlowChapterRange},
};

use super::{
    ResolvedRuntimeLocator, RuntimeActiveChapterPreview, RuntimeChapterNavigation,
    RuntimeLocatorRequest, RuntimeRevision, RuntimeRevisionNavigation, RuntimeSpreadNavigation,
    RuntimeTocTarget, RuntimeTocTargets,
};

pub(super) fn runtime_revision_navigation(
    revision_id: &str,
    document: &LoadedEpubDocument,
    revision: &RuntimeRevision,
) -> RuntimeRevisionNavigation {
    let chapter_map = revision.layout.summary.pagination_flow.chapter_map.clone();
    RuntimeRevisionNavigation {
        revision_id: revision_id.to_owned(),
        page_count: revision.layout.summary.pagination_flow.page_count,
        spread_count: revision
            .layout
            .summary
            .pagination_flow
            .display_list_flow
            .spread_count,
        spreads: runtime_spread_navigation(revision),
        chapters: document
            .chapters
            .iter()
            .map(|chapter| runtime_chapter_navigation(chapter, &chapter_map))
            .collect(),
        chapter_map,
    }
}

fn runtime_spread_navigation(revision: &RuntimeRevision) -> Vec<RuntimeSpreadNavigation> {
    build_spread_slots(
        revision.layout.pages.len(),
        &revision.layout.chapter_start_pages,
        &revision.layout_config,
    )
    .into_iter()
    .map(|spread| {
        let mut page_indexes = vec![spread.left_page_index];
        if let Some(right) = spread.right_page_index {
            page_indexes.push(right);
        }
        RuntimeSpreadNavigation {
            spread_index: spread.index,
            page_indexes,
            left_page_index: spread.left_page_index,
            right_page_index: spread.right_page_index,
        }
    })
    .collect()
}

pub(super) fn active_chapter_preview(
    document: &LoadedEpubDocument,
    revision: &RuntimeRevision,
    spread_index: usize,
) -> Option<RuntimeActiveChapterPreview> {
    if document.chapters.len() <= 1 {
        return None;
    }
    let page_index = runtime_spread_navigation(revision)
        .into_iter()
        .find(|spread| spread.spread_index == spread_index)?
        .left_page_index;
    let chapter_map = &revision.layout.summary.pagination_flow.chapter_map;
    for (chapter_index, chapter) in document.chapters.iter().enumerate() {
        let Some(range) = chapter_map.get(&chapter.idref) else {
            continue;
        };
        if page_index < range.start_page || page_index > range.end_page {
            continue;
        }
        let span = range.end_page.saturating_sub(range.start_page).max(1) as f64;
        let progress =
            ((page_index.saturating_sub(range.start_page)) as f64 / span).clamp(0.0, 1.0);
        return Some(RuntimeActiveChapterPreview {
            chapter_index,
            progress,
        });
    }
    None
}

pub(super) fn runtime_toc_targets(
    revision_id: &str,
    document: &LoadedEpubDocument,
    revision: &RuntimeRevision,
) -> RuntimeTocTargets {
    let mut targets = Vec::new();
    collect_toc_targets(
        &mut targets,
        revision_id,
        &document.package,
        revision,
        &document.package.toc,
    );
    RuntimeTocTargets {
        revision_id: revision_id.to_owned(),
        targets,
    }
}

fn collect_toc_targets(
    targets: &mut Vec<RuntimeTocTarget>,
    revision_id: &str,
    package: &PackageDocument,
    revision: &RuntimeRevision,
    entries: &[TocEntry],
) {
    for entry in entries {
        if let Ok(resolved) = resolve_href_locator(
            revision_id,
            package,
            revision,
            RuntimeLocatorRequest {
                href: entry.href.clone(),
            },
        ) {
            targets.push(RuntimeTocTarget {
                entry: entry.clone(),
                page_index: resolved.page_index,
                spread_index: resolved.spread_index,
            });
        }
        collect_toc_targets(targets, revision_id, package, revision, &entry.children);
    }
}

pub(super) fn spread_index_for_page(revision: &RuntimeRevision, page_index: usize) -> usize {
    build_spread_slots(
        revision.layout.pages.len(),
        &revision.layout.chapter_start_pages,
        &revision.layout_config,
    )
    .into_iter()
    .find(|spread| {
        spread.left_page_index == page_index || spread.right_page_index == Some(page_index)
    })
    .map(|spread| spread.index)
    .unwrap_or(0)
}

pub(super) fn resolve_href_locator(
    revision_id: &str,
    package: &PackageDocument,
    revision: &RuntimeRevision,
    request: RuntimeLocatorRequest,
) -> EpubResult<ResolvedRuntimeLocator> {
    let href = request.href;
    let (href_path, fragment) = split_href_fragment(&href);
    let href_path = href_path
        .filter(|path| !path.is_empty())
        .ok_or_else(|| locator_not_found(&href))?;
    let spine_idref =
        find_spine_idref_for_href(package, href_path).ok_or_else(|| locator_not_found(&href))?;
    let chapter_range = revision
        .layout
        .summary
        .pagination_flow
        .chapter_map
        .get(&spine_idref)
        .ok_or_else(|| locator_not_found(&href))?;
    let page_index = match fragment {
        Some(fragment) => {
            let anchors = collect_anchor_pages(&revision.layout.pages);
            let page_index = anchors
                .get(fragment)
                .copied()
                .ok_or_else(|| locator_not_found(&href))?;
            if page_index < chapter_range.start_page || page_index > chapter_range.end_page {
                return Err(locator_not_found(&href));
            }
            page_index
        }
        None => chapter_range.start_page,
    };
    let fragment = fragment.map(str::to_owned);

    Ok(ResolvedRuntimeLocator {
        revision_id: revision_id.to_owned(),
        href,
        spine_idref,
        page_index,
        spread_index: spread_index_for_page(revision, page_index),
        fragment,
    })
}

fn runtime_chapter_navigation(
    chapter: &LoadedChapter,
    chapter_map: &BTreeMap<String, PaginationFlowChapterRange>,
) -> RuntimeChapterNavigation {
    let range = chapter_map.get(&chapter.idref);
    RuntimeChapterNavigation {
        idref: chapter.idref.clone(),
        href: chapter.href.clone(),
        linear: chapter.linear,
        start_page: range.map(|range| range.start_page),
        end_page: range.map(|range| range.end_page),
        page_count: range.map(|range| range.page_count),
    }
}

fn split_href_fragment(href: &str) -> (Option<&str>, Option<&str>) {
    if let Some(index) = href.find('#') {
        let path = &href[..index];
        let fragment = &href[index + 1..];
        (
            (!path.is_empty()).then_some(path),
            (!fragment.is_empty()).then_some(fragment),
        )
    } else {
        ((!href.is_empty()).then_some(href), None)
    }
}

fn find_spine_idref_for_href(package: &PackageDocument, href: &str) -> Option<String> {
    let mut matches = package
        .spine
        .iter()
        .filter_map(|spine| {
            package
                .manifest_item(&spine.idref)
                .map(|item| (spine.idref.as_str(), item.href.as_str()))
        })
        .filter(|(_, manifest_href)| href_matches(manifest_href, href));
    let first = matches.next()?;
    matches.next().is_none().then(|| first.0.to_owned())
}

fn href_matches(manifest_href: &str, href: &str) -> bool {
    if manifest_href == href {
        return true;
    }
    let normalized = strip_relative_prefix(href);
    manifest_href == normalized || manifest_href.ends_with(&format!("/{normalized}"))
}

fn locator_not_found(href: &str) -> EpubError {
    EpubError::new(format!("locator not found: {href}"))
}

fn strip_relative_prefix(href: &str) -> &str {
    let mut result = href;
    while let Some(rest) = result.strip_prefix("../") {
        result = rest;
    }
    result
}
