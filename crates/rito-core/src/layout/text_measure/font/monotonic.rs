use super::{nonnegative, TextMeasurementFonts};
use crate::layout::{
    text_measure::TextMeasurementStyle,
    text_work::{TextWorkMeter, TextWorkYield},
};

mod setup;

#[cfg(test)]
mod tests;

use setup::{FontSetupResult, PendingFontSetup};

/// Resumable counterpart to
/// [`TextMeasurementFonts::has_monotonic_prefix_widths`].
///
/// Font-family parsing, valid-face discovery, face-family comparison, and the
/// subsequent text traversal are all metered. The eager method remains an
/// independent oracle for equivalence tests.
#[derive(Debug)]
pub(crate) struct PendingMonotonicPrefixWidthCheck {
    font_size: f64,
    monospace: bool,
    previous: Option<char>,
    monotonic: bool,
    font_profile_id: u64,
    setup: PendingFontSetup,
}

impl PendingMonotonicPrefixWidthCheck {
    pub(crate) fn new(fonts: &TextMeasurementFonts<'_>, style: TextMeasurementStyle) -> Self {
        let monotonic = nonnegative(style.font_size)
            && nonnegative(style.letter_spacing)
            && nonnegative(style.word_spacing);
        let setup = if monotonic {
            style
                .font_family
                .map_or_else(PendingFontSetup::complete, PendingFontSetup::new)
        } else {
            PendingFontSetup::complete()
        };
        Self {
            font_size: style.font_size,
            monospace: false,
            previous: None,
            monotonic,
            font_profile_id: fonts.layout_profile_id(),
            setup,
        }
    }

    pub(crate) fn advance_setup(
        &mut self,
        fonts: &TextMeasurementFonts<'_>,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        self.require_font_profile(fonts);
        while self.monotonic && !self.setup.is_complete() {
            match self.setup.advance(fonts, work)? {
                FontSetupResult::Pending => {}
                FontSetupResult::Complete { monospace } => self.monospace = monospace,
                FontSetupResult::MatchingFace => self.monotonic = false,
            }
        }
        Ok(())
    }

    pub(crate) fn push(&mut self, fonts: &TextMeasurementFonts<'_>, character: char) {
        self.require_font_profile(fonts);
        assert!(
            self.setup.is_complete(),
            "monotonic text cannot be checked before font setup completes"
        );
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

    fn require_font_profile(&self, fonts: &TextMeasurementFonts<'_>) {
        assert_eq!(
            fonts.layout_profile_id(),
            self.font_profile_id,
            "a pending monotonic check must resume with the same font profile"
        );
    }
}
