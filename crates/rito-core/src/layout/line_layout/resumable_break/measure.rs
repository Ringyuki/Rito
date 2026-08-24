use crate::layout::{
    line_break::Utf16Text,
    line_metrics::measure_text_slice_with_fonts,
    text_measure::TextMeasurementFonts,
    text_work::{AtomicTextOperationKind, TextWorkMeter},
};

use super::super::{
    find_range, find_text_slice_end, range_end_inset, range_start_inset, LineContext,
};
use super::{permit_atomic, TextWorkYield};

#[derive(Debug)]
pub(super) struct PendingMeasureSlice {
    end: usize,
    pos: usize,
    width: f64,
}

impl PendingMeasureSlice {
    pub(super) fn new(start: usize, end: usize) -> Self {
        Self {
            end,
            pos: start,
            width: 0.0,
        }
    }

    pub(super) const fn endpoint(&self) -> usize {
        self.end
    }

    pub(super) fn advance(
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
            self.measure_text_range(context, text, fonts, text_work)?;
        }
        Ok(self.width)
    }

    fn measure_text_range(
        &mut self,
        context: &LineContext,
        text: &Utf16Text<'_>,
        fonts: &TextMeasurementFonts<'_>,
        text_work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
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
        self.width += measure_text_slice_with_fonts(text.slice(self.pos, slice_end), style, fonts);
        self.width += range_end_inset(range, style, slice_end);
        self.pos = slice_end;
        Ok(())
    }
}

#[derive(Debug)]
pub(super) struct PendingHyphenatedMeasure {
    end: usize,
    slice: Option<PendingMeasureSlice>,
    base_width: Option<f64>,
}

impl PendingHyphenatedMeasure {
    pub(super) fn new(start: usize, end: usize) -> Self {
        Self {
            end,
            slice: Some(PendingMeasureSlice::new(start, end)),
            base_width: None,
        }
    }

    pub(super) const fn endpoint(&self) -> usize {
        self.end
    }

    pub(super) fn advance(
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
