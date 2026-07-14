use super::{nonnegative, parse_font_family_list, TextMeasurementFonts};
use crate::layout::text_measure::TextMeasurementStyle;

/// Scalar-by-scalar counterpart to
/// [`TextMeasurementFonts::has_monotonic_prefix_widths`].
///
/// Construction still performs indivisible style-family parsing and font-face
/// selection. Once constructed, every text scalar is checked separately by
/// `push`, so callers can meter the traversal that dominates long runs.
#[derive(Debug)]
pub(crate) struct PendingMonotonicPrefixWidthCheck {
    font_size: f64,
    monospace: bool,
    previous: Option<char>,
    monotonic: bool,
}

impl PendingMonotonicPrefixWidthCheck {
    pub(crate) fn new(fonts: &TextMeasurementFonts<'_>, style: &TextMeasurementStyle) -> Self {
        let monotonic = nonnegative(style.font_size)
            && nonnegative(style.letter_spacing)
            && nonnegative(style.word_spacing)
            && fonts.matching_faces(style).is_empty();
        let monospace = monotonic
            && style
                .font_family
                .as_deref()
                .map(parse_font_family_list)
                .unwrap_or_default()
                .iter()
                .any(|family| family.eq_ignore_ascii_case("monospace"));
        Self {
            font_size: style.font_size,
            monospace,
            previous: None,
            monotonic,
        }
    }

    pub(crate) fn push(&mut self, fonts: &TextMeasurementFonts<'_>, character: char) {
        if !self.monotonic {
            return;
        }
        let width = fonts.fallback_character_width(character, self.font_size, self.monospace, None);
        let adjustment = self
            .previous
            .map(|left| {
                fonts.fallback_pair_adjustment(
                    left,
                    character,
                    self.font_size,
                    self.monospace,
                    None,
                )
            })
            .unwrap_or(0.0);
        self.previous = Some(character);
        self.monotonic = nonnegative(width) && nonnegative(width + adjustment);
    }

    pub(crate) const fn is_monotonic(&self) -> bool {
        self.monotonic
    }
}
