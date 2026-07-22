use icu_locale_core::LanguageIdentifier;
use icu_segmenter::{
    options::{WordBreakInvariantOptions, WordBreakOptions, WordType},
    WordSegmenter,
};

use crate::layout::LogicalTextFlow;

pub(super) fn word_bounds(
    flow: &LogicalTextFlow,
    hit_start: u32,
    hit_end: u32,
    language: Option<&str>,
) -> Option<(u32, u32)> {
    let utf16 = flow.text().encode_utf16().collect::<Vec<_>>();
    let boundaries = word_boundaries(&utf16, language);
    let mut boundaries = boundaries.into_iter();
    let mut start = boundaries.next()?;
    for end in boundaries {
        if start <= hit_start && hit_end <= end && start < end {
            return Some((start, end));
        }
        start = end;
    }
    None
}

/// Word bounds around a UTF-16 hit range in plain text, for resolvers
/// that address text by page-artifact offsets rather than a shaped flow.
pub(crate) fn plain_word_bounds(
    text: &str,
    hit_start: u32,
    hit_end: u32,
    language: Option<&str>,
) -> Option<(u32, u32)> {
    let utf16 = text.encode_utf16().collect::<Vec<_>>();
    let boundaries = word_boundaries(&utf16, language);
    let mut boundaries = boundaries.into_iter();
    let mut start = boundaries.next()?;
    for end in boundaries {
        if start <= hit_start && hit_end <= end && start < end {
            return Some((start, end));
        }
        start = end;
    }
    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct WordLikeSegment {
    pub(super) start: u32,
    pub(super) end: u32,
}

pub(super) fn word_like_segments(
    flow: &LogicalTextFlow,
    language: Option<&str>,
) -> Vec<WordLikeSegment> {
    let utf16 = flow.text().encode_utf16().collect::<Vec<_>>();
    if let Some(language) = language.and_then(parse_language) {
        let mut options = WordBreakOptions::default();
        options.content_locale = Some(&language);
        if let Ok(segmenter) = WordSegmenter::try_new_auto(options) {
            return collect_word_like_segments(
                segmenter
                    .as_borrowed()
                    .segment_utf16(&utf16)
                    .iter_with_word_type(),
            );
        }
    }
    collect_word_like_segments(
        WordSegmenter::new_auto(WordBreakInvariantOptions::default())
            .segment_utf16(&utf16)
            .iter_with_word_type(),
    )
}

fn word_boundaries(utf16: &[u16], language: Option<&str>) -> Vec<u32> {
    // Runtime currently retains package language, not element-level `lang`.
    // Invalid or unsupported metadata must preserve invariant segmentation.
    if let Some(language) = language.and_then(parse_language) {
        let mut options = WordBreakOptions::default();
        options.content_locale = Some(&language);
        if let Ok(segmenter) = WordSegmenter::try_new_auto(options) {
            return collect_boundaries(segmenter.as_borrowed().segment_utf16(utf16));
        }
    }
    collect_boundaries(
        WordSegmenter::new_auto(WordBreakInvariantOptions::default()).segment_utf16(utf16),
    )
}

fn parse_language(language: &str) -> Option<LanguageIdentifier> {
    language.parse().ok()
}

fn collect_boundaries(boundaries: impl Iterator<Item = usize>) -> Vec<u32> {
    boundaries
        .filter_map(|boundary| u32::try_from(boundary).ok())
        .collect()
}

fn collect_word_like_segments(
    boundaries: impl Iterator<Item = (usize, WordType)>,
) -> Vec<WordLikeSegment> {
    let boundaries = boundaries.collect::<Vec<_>>();
    boundaries
        .windows(2)
        .filter_map(|pair| {
            let (start, _) = pair[0];
            let (end, word_type) = pair[1];
            if !word_type.is_word_like() {
                return None;
            }
            Some(WordLikeSegment {
                start: u32::try_from(start).ok()?,
                end: u32::try_from(end).ok()?,
            })
        })
        .collect()
}
