use icu_locale_core::LanguageIdentifier;
use icu_segmenter::{
    options::{WordBreakInvariantOptions, WordBreakOptions},
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
