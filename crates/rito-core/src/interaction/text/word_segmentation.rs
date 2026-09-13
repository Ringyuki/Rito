use icu_locale_core::LanguageIdentifier;
use icu_segmenter::{
    options::{WordBreakInvariantOptions, WordBreakOptions},
    WordSegmenter,
};

/// All word-segmentation boundaries of plain text as UTF-16 offsets
/// (starts with 0, ends with the text length), for movement resolvers.
pub(crate) fn plain_word_boundaries(text: &str, language: Option<&str>) -> Vec<u32> {
    let utf16 = text.encode_utf16().collect::<Vec<_>>();
    word_boundaries(&utf16, language)
}

/// Word bounds around a UTF-16 hit range in plain text, for resolvers
/// that address text by page-artifact offsets.
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

#[cfg(test)]
mod tests {
    use super::{plain_word_boundaries, plain_word_bounds};

    #[test]
    fn plain_word_bounds_find_the_word_around_a_hit() {
        assert_eq!(
            plain_word_bounds("hello world", 7, 7, Some("en")),
            Some((6, 11))
        );
        assert_eq!(plain_word_bounds("hello world", 0, 5, None), Some((0, 5)));
        assert_eq!(plain_word_bounds("", 0, 0, None), None);
    }

    #[test]
    fn invalid_language_tags_fall_back_to_invariant_segmentation() {
        assert_eq!(
            plain_word_boundaries("ab cd", Some("not a tag")),
            plain_word_boundaries("ab cd", None)
        );
    }
}
