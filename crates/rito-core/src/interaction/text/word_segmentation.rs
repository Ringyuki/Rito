use icu_locale_core::LanguageIdentifier;
use icu_segmenter::{
    options::{WordBreakInvariantOptions, WordBreakOptions, WordType},
    WordSegmenter,
};

/// All word-segmentation boundaries of plain text as UTF-16 offsets
/// (starts with 0, ends with the text length), for movement resolvers.
pub(crate) fn plain_word_boundaries(text: &str, language: Option<&str>) -> Vec<u32> {
    plain_word_edges(text, language)
        .into_iter()
        .map(|(edge, _)| edge)
        .collect()
}

/// The word-segmentation boundaries of plain text as UTF-16 offsets, each
/// with whether the segment ending there is word-like (letters, numbers,
/// ideographs) rather than spaces or punctuation.
pub(crate) fn plain_word_edges(text: &str, language: Option<&str>) -> Vec<(u32, bool)> {
    let utf16 = text.encode_utf16().collect::<Vec<_>>();
    word_edges(&utf16, language)
}

/// Which of the two segments meeting at a word boundary a caret there
/// takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WordSide {
    /// The segment ending at the caret.
    Before,
    /// The segment starting at the caret.
    After,
}

/// The word-segmentation segment around UTF-16 offset `caret` of plain
/// text: the one it sits inside, or on a boundary the one on `side` (none
/// past either end of the text).
pub(crate) fn plain_word_around(
    text: &str,
    caret: u32,
    side: WordSide,
    language: Option<&str>,
) -> Option<(u32, u32)> {
    plain_word_boundaries(text, language)
        .windows(2)
        .map(|pair| (pair[0], pair[1]))
        .find(|&(start, end)| match side {
            WordSide::Before => start < caret && caret <= end,
            WordSide::After => start <= caret && caret < end,
        })
}

fn word_edges(utf16: &[u16], language: Option<&str>) -> Vec<(u32, bool)> {
    // Runtime currently retains package language, not element-level `lang`.
    // Invalid or unsupported metadata must preserve invariant segmentation.
    if let Some(language) = language.and_then(parse_language) {
        let mut options = WordBreakOptions::default();
        options.content_locale = Some(&language);
        if let Ok(segmenter) = WordSegmenter::try_new_auto(options) {
            return collect_edges(
                segmenter
                    .as_borrowed()
                    .segment_utf16(utf16)
                    .iter_with_word_type(),
            );
        }
    }
    collect_edges(
        WordSegmenter::new_auto(WordBreakInvariantOptions::default())
            .segment_utf16(utf16)
            .iter_with_word_type(),
    )
}

fn parse_language(language: &str) -> Option<LanguageIdentifier> {
    language.parse().ok()
}

fn collect_edges(edges: impl Iterator<Item = (usize, WordType)>) -> Vec<(u32, bool)> {
    edges
        .filter_map(|(edge, word)| Some((u32::try_from(edge).ok()?, word.is_word_like())))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{plain_word_around, plain_word_boundaries, WordSide};

    #[test]
    fn a_caret_takes_the_word_it_sits_in_or_the_one_on_its_side() {
        for side in [WordSide::Before, WordSide::After] {
            assert_eq!(
                plain_word_around("hello world", 8, side, Some("en")),
                Some((6, 11))
            );
        }
        assert_eq!(
            plain_word_around("hello world", 6, WordSide::After, None),
            Some((6, 11))
        );
        assert_eq!(
            plain_word_around("hello world", 6, WordSide::Before, None),
            Some((5, 6))
        );
        assert_eq!(
            plain_word_around("hello world", 11, WordSide::After, None),
            None
        );
        assert_eq!(plain_word_around("", 0, WordSide::After, None), None);
    }

    #[test]
    fn invalid_language_tags_fall_back_to_invariant_segmentation() {
        assert_eq!(
            plain_word_boundaries("ab cd", Some("not a tag")),
            plain_word_boundaries("ab cd", None)
        );
    }
}
