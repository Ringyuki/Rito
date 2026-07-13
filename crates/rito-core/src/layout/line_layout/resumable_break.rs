use std::collections::{BTreeMap, BTreeSet};

use crate::layout::{
    line_break::{
        find_word_break_with_offsets, line_break_offsets,
        try_adjust_break_position_with_offsets_until, try_ascii_hyphenation_with, Utf16Text,
    },
    line_metrics::measure_text_slice_with_fonts,
    line_prefix::try_find_fitting_prefix,
    text_measure::TextMeasurementFonts,
    text_work::{AtomicTextOperationKind, TextWorkMeter, TextWorkPermitResult},
};

use super::{
    find_range, find_text_slice_end, range_end_inset, range_start_inset, LineBreakPosition,
    LineContext,
};

#[cfg(test)]
use crate::layout::line_prefix::record_prefix_probe;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct TextWorkYield;

#[derive(Debug, Default)]
pub(super) struct PendingBreakSession {
    prefix_widths: BTreeMap<usize, f64>,
    pending_prefix: Option<PendingMeasureSlice>,
    hyphen_widths: BTreeMap<usize, f64>,
    pending_hyphen: Option<PendingHyphenatedMeasure>,
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
            let hyphen_break = try_ascii_hyphenation_with(
                text,
                start,
                fitting.position,
                &context.line_break_options,
                &mut |candidate| {
                    self.hyphen_candidate_fits(
                        context, start, candidate, max_width, fonts, text_work,
                    )
                },
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
        assert_eq!(pending.end, end, "prefix replay changed its endpoint");
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
        assert_eq!(pending.end, end, "hyphen replay changed its endpoint");
        let width = pending.advance(context, text, fonts, text_work)?;
        self.pending_hyphen = None;
        self.hyphen_widths.insert(end, width);
        Ok(width <= max_width)
    }
}

#[derive(Debug)]
struct PendingMeasureSlice {
    end: usize,
    pos: usize,
    width: f64,
}

impl PendingMeasureSlice {
    fn new(start: usize, end: usize) -> Self {
        Self {
            end,
            pos: start,
            width: 0.0,
        }
    }

    fn advance(
        &mut self,
        context: &LineContext,
        text: &Utf16Text<'_>,
        fonts: &TextMeasurementFonts<'_>,
        text_work: &mut TextWorkMeter,
    ) -> Result<f64, TextWorkYield> {
        while self.pos < self.end {
            if let Some(atom) = context.atoms.get(&self.pos) {
                if text_work.take_utf16_units(1) != 1 {
                    return Err(TextWorkYield);
                }
                self.width += atom.width;
                self.pos += 1;
                continue;
            }

            let range = find_range(&context.ranges, self.pos);
            let range_end = range
                .map(|range| range.end.min(self.end))
                .unwrap_or(self.end);
            let slice_end = find_text_slice_end(context, self.pos, range_end);
            assert!(slice_end > self.pos, "text measurement must advance");
            let style = range
                .map(|range| &range.style)
                .unwrap_or(&context.base_style);
            permit_atomic(
                text_work,
                AtomicTextOperationKind::Measure,
                slice_end.saturating_sub(self.pos),
            )?;
            self.width += range_start_inset(range, style, self.pos);
            self.width +=
                measure_text_slice_with_fonts(text.slice(self.pos, slice_end), style, fonts);
            self.width += range_end_inset(range, style, slice_end);
            self.pos = slice_end;
        }
        Ok(self.width)
    }
}

#[derive(Debug)]
struct PendingHyphenatedMeasure {
    end: usize,
    slice: Option<PendingMeasureSlice>,
    base_width: Option<f64>,
}

impl PendingHyphenatedMeasure {
    fn new(start: usize, end: usize) -> Self {
        Self {
            end,
            slice: Some(PendingMeasureSlice::new(start, end)),
            base_width: None,
        }
    }

    fn advance(
        &mut self,
        context: &LineContext,
        text: &Utf16Text<'_>,
        fonts: &TextMeasurementFonts<'_>,
        text_work: &mut TextWorkMeter,
    ) -> Result<f64, TextWorkYield> {
        if self.base_width.is_none() {
            let width = self
                .slice
                .as_mut()
                .expect("the hyphen base slice is pending")
                .advance(context, text, fonts, text_work)?;
            self.base_width = Some(width);
            self.slice = None;
        }
        permit_atomic(text_work, AtomicTextOperationKind::Measure, 1)?;
        let hyphen = measure_text_slice_with_fonts("-", &context.base_style, fonts);
        Ok(self.base_width.expect("the hyphen base width is complete") + hyphen)
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
