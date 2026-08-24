use std::collections::{BTreeMap, BTreeSet};

use crate::layout::{
    line_break::{
        find_word_break_with_offsets, line_break_offsets,
        try_adjust_break_position_with_offsets_until, Utf16Text,
    },
    line_prefix::try_find_fitting_prefix,
    text_measure::TextMeasurementFonts,
    text_work::{AtomicTextOperationKind, TextWorkMeter, TextWorkPermitResult, TextWorkYield},
};

mod hyphenation;
mod measure;

use hyphenation::{PendingAsciiHyphenation, PendingHyphenationAdvance};
use measure::{PendingHyphenatedMeasure, PendingMeasureSlice};

use super::{LineBreakPosition, LineContext};

#[cfg(test)]
use crate::layout::line_prefix::record_prefix_probe;

#[derive(Debug, Default)]
pub(super) struct PendingBreakSession {
    prefix_widths: BTreeMap<usize, f64>,
    pending_prefix: Option<PendingMeasureSlice>,
    hyphen_widths: BTreeMap<usize, f64>,
    pending_hyphen: Option<PendingHyphenatedMeasure>,
    ascii_hyphenation: Option<PendingAsciiHyphenation>,
}

impl PendingBreakSession {
    pub(super) fn new() -> Self {
        Self::default()
    }

    pub(super) fn advance(
        &mut self,
        context: &LineContext,
        start: usize,
        end: usize,
        max_width: f64,
        fonts: &TextMeasurementFonts<'_>,
        text_work: &mut TextWorkMeter,
    ) -> Result<LineBreakPosition, TextWorkYield> {
        let text = &context.text;
        let fitting = try_find_fitting_prefix(
            text,
            start,
            end,
            max_width,
            context.monotonic_prefix_widths,
            &mut |slice_end| self.prefix_width(context, text, start, slice_end, fonts, text_work),
        )?;
        if fitting.position >= end {
            return Ok(LineBreakPosition {
                position: end,
                hyphenated: false,
            });
        }

        let break_offsets = ensure_break_offsets(context, text, text_work)?;
        let word_break = find_word_break_with_offsets(start, fitting.position, break_offsets);
        if word_break == fitting.position {
            let hyphen_break = self.ascii_hyphenation(
                context,
                start,
                fitting.position,
                max_width,
                fonts,
                text_work,
            )?;
            if let Some(hyphen_break) = hyphen_break {
                let position = try_adjust_break_position_with_offsets_until(
                    start,
                    end,
                    hyphen_break,
                    max_width,
                    &mut |slice_end| {
                        self.prefix_width(context, text, start, slice_end, fonts, text_work)
                    },
                    break_offsets,
                    fitting.forward_end,
                )?;
                return Ok(LineBreakPosition {
                    position,
                    hyphenated: position == hyphen_break,
                });
            }
        }

        let position = try_adjust_break_position_with_offsets_until(
            start,
            end,
            word_break,
            max_width,
            &mut |slice_end| self.prefix_width(context, text, start, slice_end, fonts, text_work),
            break_offsets,
            fitting.forward_end,
        )?;
        Ok(LineBreakPosition {
            position,
            hyphenated: false,
        })
    }

    fn ascii_hyphenation(
        &mut self,
        context: &LineContext,
        line_start: usize,
        fit_pos: usize,
        max_width: f64,
        fonts: &TextMeasurementFonts<'_>,
        text_work: &mut TextWorkMeter,
    ) -> Result<Option<usize>, TextWorkYield> {
        let mut pending = self
            .ascii_hyphenation
            .take()
            .unwrap_or_else(|| PendingAsciiHyphenation::new(line_start, fit_pos));
        pending.require_request(line_start, fit_pos);
        loop {
            let advance = match pending.advance(&context.text, text_work) {
                Ok(advance) => advance,
                Err(error) => {
                    self.ascii_hyphenation = Some(pending);
                    return Err(error);
                }
            };
            match advance {
                PendingHyphenationAdvance::Complete(result) => {
                    self.ascii_hyphenation = Some(pending);
                    return Ok(result);
                }
                PendingHyphenationAdvance::Candidate(candidate) => {
                    let fits = match self.hyphen_candidate_fits(
                        context, line_start, candidate, max_width, fonts, text_work,
                    ) {
                        Ok(fits) => fits,
                        Err(error) => {
                            self.ascii_hyphenation = Some(pending);
                            return Err(error);
                        }
                    };
                    pending.resolve_candidate(candidate, fits);
                }
            }
        }
    }

    fn prefix_width(
        &mut self,
        context: &LineContext,
        text: &Utf16Text<'_>,
        start: usize,
        end: usize,
        fonts: &TextMeasurementFonts<'_>,
        text_work: &mut TextWorkMeter,
    ) -> Result<f64, TextWorkYield> {
        if let Some(width) = self.prefix_widths.get(&end) {
            return Ok(*width);
        }
        if self.pending_prefix.is_none() {
            #[cfg(test)]
            record_prefix_probe(start, end);
            self.pending_prefix = Some(PendingMeasureSlice::new(start, end));
        }
        let pending = self
            .pending_prefix
            .as_mut()
            .expect("the prefix measurement is pending");
        assert_eq!(
            pending.endpoint(),
            end,
            "prefix replay changed its endpoint"
        );
        let width = pending.advance(context, text, fonts, text_work)?;
        self.pending_prefix = None;
        self.prefix_widths.insert(end, width);
        Ok(width)
    }

    fn hyphen_candidate_fits(
        &mut self,
        context: &LineContext,
        start: usize,
        end: usize,
        max_width: f64,
        fonts: &TextMeasurementFonts<'_>,
        text_work: &mut TextWorkMeter,
    ) -> Result<bool, TextWorkYield> {
        let text = &context.text;
        if let Some(width) = self.hyphen_widths.get(&end) {
            return Ok(*width <= max_width);
        }
        if self.pending_hyphen.is_none() {
            self.pending_hyphen = Some(PendingHyphenatedMeasure::new(start, end));
        }
        let pending = self
            .pending_hyphen
            .as_mut()
            .expect("the hyphen measurement is pending");
        assert_eq!(
            pending.endpoint(),
            end,
            "hyphen replay changed its endpoint"
        );
        let width = pending.advance(context, text, fonts, text_work)?;
        self.pending_hyphen = None;
        self.hyphen_widths.insert(end, width);
        Ok(width <= max_width)
    }
}

fn ensure_break_offsets<'a>(
    context: &'a LineContext,
    text: &Utf16Text<'_>,
    text_work: &mut TextWorkMeter,
) -> Result<&'a BTreeSet<usize>, TextWorkYield> {
    if context.break_offsets.get().is_none() {
        permit_atomic(text_work, AtomicTextOperationKind::LineBreakScan, text.len)?;
    }
    Ok(context
        .break_offsets
        .get_or_init(|| line_break_offsets(text, &context.line_break_options)))
}

fn permit_atomic(
    text_work: &mut TextWorkMeter,
    kind: AtomicTextOperationKind,
    utf16_units: usize,
) -> Result<(), TextWorkYield> {
    match text_work.try_permit_atomic(kind, utf16_units) {
        TextWorkPermitResult::Permit { .. } => Ok(()),
        TextWorkPermitResult::Yield => Err(TextWorkYield),
    }
}
