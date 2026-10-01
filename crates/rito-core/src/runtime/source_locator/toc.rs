//! Where table-of-contents entries sit, and which one a page or a source
//! position reads under. Every host asks these questions through here, so
//! a chapter title or a highlight's chapter is the same on each of them.
//!
//! Entries are addressed by their preorder index over the publication's
//! TOC tree, the identity reader sessions publish as `toc_id`.

use std::cmp::Ordering;

use crate::epub::TocEntry;

use super::super::{RuntimeDocument, RuntimeRevision};
use super::{
    canonicalize_source_locator, matched_by, resolve_canonical_source_locator,
    CanonicalSourceLocator, RuntimeSourceAnchor, RuntimeSourceLocator, RuntimeSourceLocatorError,
    RuntimeSourceLocatorMatchedBy, RuntimeSourceLocatorResolution, RuntimeSourcePoint,
};

/// Every TOC entry's target, canonicalized; `None` for a target outside
/// the publication (an external link, a dead href).
pub(in crate::runtime) struct PreparedTocTargets {
    entries: Vec<Option<CanonicalSourceLocator>>,
}

/// Where an entry's target sits relative to a revision's pages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::runtime) enum TocTargetPosition {
    /// In a chapter before every chapter the revision lays out.
    Before,
    Page(usize),
    /// In a chapter after them, or not laid out yet.
    After,
    /// Outside the publication.
    Unplaced,
}

impl RuntimeDocument {
    /// Canonicalizes every entry's target and indexes the chapters, among
    /// `chapters`, that fragments point into. Only an entry in one of
    /// those chapters is ever placed against a page or a position, so no
    /// other chapter is parsed.
    pub(in crate::runtime) fn prepare_toc_targets(
        &mut self,
        chapters: impl Fn(usize) -> bool,
    ) -> PreparedTocTargets {
        let mut hrefs = Vec::new();
        flatten(&self.document.package.toc, &mut hrefs);
        let mut entries = Vec::with_capacity(hrefs.len());
        for href in hrefs {
            let canonical = canonicalize_source_locator(&self.document, href_locator(href)).ok();
            let indexed = match &canonical {
                Some(target)
                    if chapters(target.chapter_index)
                        && matched_by(&target.locator) != RuntimeSourceLocatorMatchedBy::Href =>
                {
                    self.ensure_source_chapter_index(target.chapter_index)
                        .is_ok()
                }
                _ => true,
            };
            entries.push(canonical.filter(|_| indexed));
        }
        PreparedTocTargets { entries }
    }

    /// The chapters a revision lays out, by spine position.
    pub(in crate::runtime) fn laid_out_chapters(&self, revision: &RuntimeRevision) -> Vec<usize> {
        let known = revision.chapter_engine_session().known_chapters();
        self.document
            .chapters
            .iter()
            .enumerate()
            .filter(|(_, chapter)| known.contains_key(&chapter.idref))
            .map(|(index, _)| index)
            .collect()
    }

    /// Each entry's position against `revision`, in preorder.
    pub(in crate::runtime) fn toc_target_positions_in(
        &self,
        revision_id: &str,
        revision: &RuntimeRevision,
        prepared: &PreparedTocTargets,
    ) -> Vec<TocTargetPosition> {
        let first_laid_out = self.laid_out_chapters(revision).into_iter().min();
        prepared
            .entries
            .iter()
            .map(|entry| match entry {
                None => TocTargetPosition::Unplaced,
                Some(canonical) => {
                    if first_laid_out.is_some_and(|first| canonical.chapter_index < first) {
                        return TocTargetPosition::Before;
                    }
                    let source_index = self.source_chapter_indices.get(&canonical.spine_idref);
                    match resolve_canonical_source_locator(
                        revision_id,
                        revision,
                        canonical.clone(),
                        source_index,
                    ) {
                        RuntimeSourceLocatorResolution::Resolved { page_index, .. } => {
                            TocTargetPosition::Page(page_index)
                        }
                        RuntimeSourceLocatorResolution::Pending { .. } => TocTargetPosition::After,
                    }
                }
            })
            .collect()
    }

    /// The entry a source position reads under, decided on the source
    /// alone: the last entry, in TOC order, whose target is at or before
    /// the position. Layout plays no part, so the answer never depends on
    /// a host's page geometry.
    pub fn toc_entry_at_source_position(
        &mut self,
        href: &str,
        point: &RuntimeSourcePoint,
    ) -> Result<Option<usize>, RuntimeSourceLocatorError> {
        let position = canonicalize_source_locator(&self.document, href_locator(href.to_owned()))?;
        let chapter = position.chapter_index;
        let prepared = self.prepare_toc_targets(|index| index == chapter);
        let mut active = None;
        for (index, entry) in prepared.entries.iter().enumerate() {
            let Some(target) = entry else { continue };
            let at_or_before = match target.chapter_index.cmp(&position.chapter_index) {
                Ordering::Less => true,
                Ordering::Greater => false,
                Ordering::Equal => self.toc_target_order(target, point) != Ordering::Greater,
            };
            if at_or_before {
                active = Some(index);
            }
        }
        Ok(active)
    }

    /// Orders a target against a point in the same chapter.
    fn toc_target_order(
        &self,
        target: &CanonicalSourceLocator,
        point: &RuntimeSourcePoint,
    ) -> Ordering {
        let Some(anchor) = target.locator.anchor_id.as_ref() else {
            return Ordering::Less;
        };
        let Some(anchor) = self
            .source_chapter_indices
            .get(&target.spine_idref)
            .and_then(|index| index.anchors.get(anchor))
        else {
            return Ordering::Less;
        };
        match anchor {
            RuntimeSourceAnchor::ChapterStart => Ordering::Less,
            RuntimeSourceAnchor::Point(anchor) => source_point_order(anchor, point),
            RuntimeSourceAnchor::ChapterEnd => Ordering::Greater,
        }
    }

    /// Orders two source positions in reading order: by spine position,
    /// then by place in the chapter's source tree, then by offset.
    pub fn compare_source_positions(
        &self,
        first: (&str, &RuntimeSourcePoint),
        second: (&str, &RuntimeSourcePoint),
    ) -> Result<Ordering, RuntimeSourceLocatorError> {
        let chapter = |href: &str| {
            canonicalize_source_locator(&self.document, href_locator(href.to_owned()))
                .map(|canonical| canonical.chapter_index)
        };
        Ok(chapter(first.0)?
            .cmp(&chapter(second.0)?)
            .then_with(|| source_point_order(first.1, second.1)))
    }
}

/// The entry `page_index` reads under: the last entry, in TOC order, whose
/// target sits at or before the page.
pub(in crate::runtime) fn active_toc_entry(
    positions: &[TocTargetPosition],
    page_index: usize,
) -> Option<usize> {
    positions.iter().rposition(|position| match position {
        TocTargetPosition::Before => true,
        TocTargetPosition::Page(page) => *page <= page_index,
        TocTargetPosition::After | TocTargetPosition::Unplaced => false,
    })
}

/// [`active_toc_entry`] for every page of a revision, in one sweep.
pub(in crate::runtime) fn active_toc_entries_by_page(
    positions: &[TocTargetPosition],
    page_count: usize,
) -> Vec<Option<usize>> {
    let mut latest_at_page: Vec<Option<usize>> = vec![None; page_count];
    let mut before = None;
    for (index, position) in positions.iter().enumerate() {
        match position {
            TocTargetPosition::Before => before = Some(index),
            TocTargetPosition::Page(page) if *page < page_count => {
                latest_at_page[*page] = Some(index);
            }
            _ => {}
        }
    }
    let mut active = before;
    latest_at_page
        .into_iter()
        .map(|latest| {
            active = active.max(latest);
            active
        })
        .collect()
}

/// Source-tree order inside one chapter: node paths are child-index paths
/// from the chapter root, so their lexicographic order is document order.
pub(in crate::runtime) fn source_point_order(
    first: &RuntimeSourcePoint,
    second: &RuntimeSourcePoint,
) -> Ordering {
    first
        .node_path
        .cmp(&second.node_path)
        .then(first.text_offset.cmp(&second.text_offset))
}

fn href_locator(href: String) -> RuntimeSourceLocator {
    RuntimeSourceLocator {
        href,
        anchor_id: None,
        source_point: None,
        source_range: None,
        progression: None,
    }
}

fn flatten(entries: &[TocEntry], hrefs: &mut Vec<String>) {
    for entry in entries {
        hrefs.push(entry.href.clone());
        flatten(&entry.children, hrefs);
    }
}

#[cfg(test)]
mod tests;
