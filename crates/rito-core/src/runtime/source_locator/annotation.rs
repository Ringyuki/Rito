//! Annotation targets: the durable highlight anchor every host stores.
//!
//! Building a target and finding it again both happen here, once, so a
//! highlight made on one host reads back identically on every other. The
//! cascade runs over the chapter's canonical text (the raw parsed tree, as
//! source locators use it): the source range, then the quoted text with its
//! context, then the stored offsets, then the proportional position.

use super::super::{RuntimeChapterTextSpan, RuntimeDocument};
use super::{
    canonicalize_source_locator, source_point_offset, RuntimeSourceChapterIndex,
    RuntimeSourceLocator, RuntimeSourceLocatorError, RuntimeSourceLocatorErrorKind,
    RuntimeSourcePoint, RuntimeSourceRange,
};

mod quote;
mod types;

use quote::{best_quote_match, context_end, context_start};
pub use types::*;

const QUOTE_CONTEXT_UNITS: usize = 32;

/// Serializes a target in the canonical byte form hosts persist.
pub fn annotation_target_to_json(target: &AnnotationTarget) -> String {
    serde_json::to_string(target).expect("annotation targets always serialize")
}

/// Parses a persisted target, rejecting unknown fields and other versions.
pub fn annotation_target_from_json(
    json: &str,
) -> Result<AnnotationTarget, RuntimeSourceLocatorError> {
    let target: AnnotationTarget = serde_json::from_str(json).map_err(|error| {
        RuntimeSourceLocatorError::invalid_selector(format!("annotation target: {error}"))
    })?;
    if target.version != ANNOTATION_TARGET_VERSION {
        return Err(RuntimeSourceLocatorError::invalid_selector(format!(
            "annotation target version {} is not {ANNOTATION_TARGET_VERSION}",
            target.version
        )));
    }
    Ok(target)
}

/// One chapter's canonical text, borrowed for one build or resolution.
struct CanonicalChapter<'a> {
    href: &'a str,
    index: &'a RuntimeSourceChapterIndex,
    units: Vec<u16>,
}

impl RuntimeDocument {
    /// Builds the target for a source range, normally a selection's. The
    /// range may run backwards; it may not be empty.
    pub fn create_annotation_target(
        &mut self,
        href: &str,
        source_range: &RuntimeSourceRange,
    ) -> Result<AnnotationTarget, RuntimeSourceLocatorError> {
        let chapter_index = self.annotation_chapter(href)?;
        let chapter = self.canonical_chapter(chapter_index);
        let start = source_point_offset_in(chapter.index, &source_range.start)?;
        let end = source_point_offset_in(chapter.index, &source_range.end)?;
        let (start, end) = (start.min(end), start.max(end));
        if start == end {
            return Err(RuntimeSourceLocatorError::invalid_selector(
                "an annotation target cannot be empty",
            ));
        }
        chapter.target_at(start, end).ok_or_else(|| {
            RuntimeSourceLocatorError::invalid_selector("annotation range splits a character")
        })
    }

    /// Finds a stored target in the chapter as it is now.
    pub fn resolve_annotation_target(
        &mut self,
        target: &AnnotationTarget,
    ) -> Result<AnnotationTargetResolution, RuntimeSourceLocatorError> {
        if target.version != ANNOTATION_TARGET_VERSION {
            return Err(RuntimeSourceLocatorError::invalid_selector(format!(
                "annotation target version {} is not {ANNOTATION_TARGET_VERSION}",
                target.version
            )));
        }
        let chapter_index = match self.annotation_chapter(&target.href) {
            Ok(index) => index,
            Err(error) if error.kind == RuntimeSourceLocatorErrorKind::HrefNotFound => {
                return Ok(AnnotationTargetResolution::Orphaned {
                    reason: AnnotationOrphanReason::HrefNotFound,
                });
            }
            Err(error) => return Err(error),
        };
        Ok(self.canonical_chapter(chapter_index).resolve(target))
    }

    fn annotation_chapter(&mut self, href: &str) -> Result<usize, RuntimeSourceLocatorError> {
        let canonical = canonicalize_source_locator(
            &self.document,
            RuntimeSourceLocator {
                href: href.to_owned(),
                anchor_id: None,
                source_point: None,
                source_range: None,
                progression: None,
            },
        )?;
        self.ensure_source_chapter_index(canonical.chapter_index)?;
        Ok(canonical.chapter_index)
    }

    fn canonical_chapter(&self, chapter_index: usize) -> CanonicalChapter<'_> {
        let chapter = &self.document.chapters[chapter_index];
        let index = self
            .source_chapter_indices
            .get(&chapter.idref)
            .expect("annotation chapter index was ensured");
        CanonicalChapter {
            href: chapter.href.as_str(),
            index,
            units: index.text.normalized_text.encode_utf16().collect(),
        }
    }
}

impl CanonicalChapter<'_> {
    fn resolve(&self, target: &AnnotationTarget) -> AnnotationTargetResolution {
        if let Some(target) = self.exact(target) {
            return AnnotationTargetResolution::Exact { target };
        }
        if let Some(target) = self.quote(target) {
            return AnnotationTargetResolution::Quote { target };
        }
        if let Some(target) = self.position(target) {
            return AnnotationTargetResolution::Position { target };
        }
        match self.progression(target) {
            Some(target) => AnnotationTargetResolution::Progression { target },
            None => AnnotationTargetResolution::Orphaned {
                reason: AnnotationOrphanReason::EmptyChapter,
            },
        }
    }

    fn exact(&self, target: &AnnotationTarget) -> Option<AnnotationTarget> {
        let start = source_point_offset_in(self.index, &target.source_range.start).ok()?;
        let end = source_point_offset_in(self.index, &target.source_range.end).ok()?;
        if start >= end || self.units.get(start..end)? != utf16(&target.quote.exact) {
            return None;
        }
        self.target_at(start, end)
    }

    fn quote(&self, target: &AnnotationTarget) -> Option<AnnotationTarget> {
        let exact = utf16(&target.quote.exact);
        let start = best_quote_match(
            &self.units,
            &exact,
            &utf16(&target.quote.prefix),
            &utf16(&target.quote.suffix),
        )?;
        self.target_at(start, start + exact.len())
    }

    fn position(&self, target: &AnnotationTarget) -> Option<AnnotationTarget> {
        let AnnotationPosition { start, end, .. } = target.position;
        (start < end && end <= self.units.len())
            .then(|| self.target_at(start, end))
            .flatten()
    }

    /// One character at the stored start, scaled by how the chapter's
    /// length changed. Integer arithmetic, rounding half up, so every host
    /// lands on the same unit.
    fn progression(&self, target: &AnnotationTarget) -> Option<AnnotationTarget> {
        let length = self.units.len();
        if length == 0 {
            return None;
        }
        let stored = target.position.chapter_length.max(1) as u128;
        let scaled = (target.position.start as u128 * length as u128 * 2 + stored) / (2 * stored);
        let mut start = (scaled as usize).min(length - 1);
        if is_low_surrogate(self.units[start]) && start > 0 {
            start -= 1;
        }
        let width = if is_high_surrogate(self.units[start]) && start + 1 < length {
            2
        } else {
            1
        };
        self.target_at(start, start + width)
    }

    /// The canonical target for `start..end`, or `None` when an end splits
    /// a surrogate pair.
    fn target_at(&self, start: usize, end: usize) -> Option<AnnotationTarget> {
        let exact = String::from_utf16(self.units.get(start..end)?).ok()?;
        let prefix_start = context_start(&self.units, start, QUOTE_CONTEXT_UNITS);
        let suffix_end = context_end(&self.units, end, QUOTE_CONTEXT_UNITS);
        Some(AnnotationTarget {
            version: ANNOTATION_TARGET_VERSION,
            href: self.href.to_owned(),
            source_range: RuntimeSourceRange {
                start: start_point(&self.index.text.spans, start)?,
                end: end_point(&self.index.text.spans, end)?,
            },
            quote: AnnotationQuote {
                exact,
                prefix: String::from_utf16(&self.units[prefix_start..start]).ok()?,
                suffix: String::from_utf16(&self.units[end..suffix_end]).ok()?,
            },
            position: AnnotationPosition {
                start,
                end,
                chapter_length: self.units.len(),
            },
        })
    }
}

fn source_point_offset_in(
    index: &RuntimeSourceChapterIndex,
    point: &RuntimeSourcePoint,
) -> Result<usize, RuntimeSourceLocatorError> {
    source_point_offset(index, point).ok_or_else(|| {
        RuntimeSourceLocatorError::invalid_selector(format!(
            "source point is outside the parsed chapter: {:?}:{}",
            point.node_path, point.text_offset
        ))
    })
}

/// A range start sits at the beginning of the text it covers: at a seam
/// between two text nodes it names the later one.
fn start_point(spans: &[RuntimeChapterTextSpan], offset: usize) -> Option<RuntimeSourcePoint> {
    spans
        .iter()
        .find(|span| span.normalized_start <= offset && offset < span.normalized_end)
        .map(|span| point_in(span, offset))
}

/// A range end sits at the end of the text it covers: at a seam between two
/// text nodes it names the earlier one.
fn end_point(spans: &[RuntimeChapterTextSpan], offset: usize) -> Option<RuntimeSourcePoint> {
    spans
        .iter()
        .find(|span| span.normalized_start < offset && offset <= span.normalized_end)
        .map(|span| point_in(span, offset))
}

fn point_in(span: &RuntimeChapterTextSpan, offset: usize) -> RuntimeSourcePoint {
    RuntimeSourcePoint {
        node_path: span.node_path.clone(),
        text_offset: span.source_start + offset - span.normalized_start,
    }
}

fn utf16(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

fn is_high_surrogate(unit: u16) -> bool {
    (0xD800..=0xDBFF).contains(&unit)
}

fn is_low_surrogate(unit: u16) -> bool {
    (0xDC00..=0xDFFF).contains(&unit)
}

#[cfg(test)]
mod tests;
