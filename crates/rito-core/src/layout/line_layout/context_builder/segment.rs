use std::collections::BTreeMap;

use super::{finish_text_range, require_unit, LineAtom, LineStyleRange};
use crate::layout::{
    inline_segment::{AtomSegment, InlineSegment, TextSegment},
    line_break::OwnedUtf16TextBuilder,
    text_measure::{PendingMonotonicPrefixWidthCheck, TextMeasurementFonts, TextMeasurementStyle},
    text_work::{TextWorkMeter, TextWorkYield},
};

#[derive(Debug)]
pub(super) enum PendingContextSegment {
    Text(PendingTextSegment),
    Atom(PendingAtomSegment),
}

impl PendingContextSegment {
    pub(super) fn new(
        segment: InlineSegment,
        start: usize,
        monotonic: &mut bool,
        fonts: &TextMeasurementFonts<'_>,
    ) -> Self {
        match segment {
            InlineSegment::Text(segment) => {
                Self::Text(PendingTextSegment::new(segment, start, monotonic, fonts))
            }
            InlineSegment::Atom(segment) => {
                *monotonic &= super::super::nonnegative(segment.width);
                Self::Atom(PendingAtomSegment::new(segment))
            }
        }
    }

    pub(super) fn advance(
        &mut self,
        output: &mut OwnedUtf16TextBuilder,
        work: &mut TextWorkMeter,
        fonts: &TextMeasurementFonts<'_>,
        monotonic: &mut bool,
    ) -> Result<bool, TextWorkYield> {
        match self {
            Self::Text(segment) => segment.advance(output, work, fonts, monotonic),
            Self::Atom(segment) => segment.advance(output, work),
        }
    }

    pub(super) fn finish(
        self,
        end: usize,
        ranges: &mut Vec<LineStyleRange>,
        atoms: &mut BTreeMap<usize, LineAtom>,
    ) {
        match self {
            Self::Text(segment) => {
                if let Some(range) = finish_text_range(segment.segment, segment.start, end) {
                    ranges.push(range);
                }
            }
            Self::Atom(segment) => {
                let start = end
                    .checked_sub(1)
                    .expect("assembled atom occupies one unit");
                // The atom and its synthetic range both own the JSON style;
                // this metadata clone is intentionally an indivisible residual.
                let range_style = segment.segment.style.clone();
                atoms.insert(start, line_atom(segment.segment));
                ranges.push(atom_range(start, range_style));
            }
        }
    }
}

#[derive(Debug)]
pub(super) struct PendingTextSegment {
    segment: TextSegment,
    start: usize,
    byte_index: usize,
    scalar_units_remaining: usize,
    finish_paid: bool,
    monotonic: Option<Box<PendingMonotonicPrefixWidthCheck>>,
}

impl PendingTextSegment {
    fn new(
        segment: TextSegment,
        start: usize,
        monotonic: &mut bool,
        fonts: &TextMeasurementFonts<'_>,
    ) -> Self {
        let style_is_monotonic = super::super::monotonic_measure_style(&segment.style)
            && segment
                .inline_margin_left
                .is_none_or(super::super::nonnegative)
            && segment
                .inline_margin_right
                .is_none_or(super::super::nonnegative);
        *monotonic &= style_is_monotonic;
        let check = (*monotonic).then(|| {
            Box::new(PendingMonotonicPrefixWidthCheck::new(
                fonts,
                TextMeasurementStyle::from_style(&segment.style),
            ))
        });
        *monotonic &= check.as_ref().is_none_or(|check| check.is_monotonic());
        Self {
            segment,
            start,
            byte_index: 0,
            scalar_units_remaining: 0,
            finish_paid: false,
            monotonic: (*monotonic).then_some(check).flatten(),
        }
    }

    fn advance(
        &mut self,
        output: &mut OwnedUtf16TextBuilder,
        work: &mut TextWorkMeter,
        fonts: &TextMeasurementFonts<'_>,
        monotonic: &mut bool,
    ) -> Result<bool, TextWorkYield> {
        if let Some(check) = self.monotonic.as_mut() {
            check.advance_setup(fonts, work)?;
            *monotonic &= check.is_monotonic();
            if !*monotonic {
                self.monotonic = None;
            }
        }
        let Some(character) = self.segment.text[self.byte_index..].chars().next() else {
            if !self.finish_paid {
                require_unit(work)?;
                self.finish_paid = true;
            }
            return Ok(true);
        };
        self.pay_scalar(character, work)?;
        output.push(character);
        self.byte_index = self
            .byte_index
            .checked_add(character.len_utf8())
            .expect("preflighted text byte length must fit in usize");
        *monotonic &= character.len_utf16() == 1;
        if let Some(check) = self.monotonic.as_mut() {
            check.push(fonts, character);
            *monotonic &= check.is_monotonic();
            if !*monotonic {
                self.monotonic = None;
            }
        }
        Ok(false)
    }

    fn pay_scalar(
        &mut self,
        character: char,
        work: &mut TextWorkMeter,
    ) -> Result<(), TextWorkYield> {
        if self.scalar_units_remaining == 0 {
            self.scalar_units_remaining = character.len_utf16();
        }
        let taken = work.take_utf16_units(self.scalar_units_remaining);
        self.scalar_units_remaining -= taken;
        if self.scalar_units_remaining == 0 {
            Ok(())
        } else {
            Err(TextWorkYield)
        }
    }
}

#[derive(Debug)]
pub(super) struct PendingAtomSegment {
    segment: AtomSegment,
    scalar_paid: bool,
    finish_paid: bool,
}

impl PendingAtomSegment {
    fn new(segment: AtomSegment) -> Self {
        Self {
            segment,
            scalar_paid: false,
            finish_paid: false,
        }
    }

    fn advance(
        &mut self,
        output: &mut OwnedUtf16TextBuilder,
        work: &mut TextWorkMeter,
    ) -> Result<bool, TextWorkYield> {
        if !self.scalar_paid {
            require_unit(work)?;
            output.push('\u{fffc}');
            self.scalar_paid = true;
            return Ok(false);
        }
        if !self.finish_paid {
            require_unit(work)?;
            self.finish_paid = true;
        }
        Ok(true)
    }
}

fn line_atom(segment: AtomSegment) -> LineAtom {
    LineAtom {
        width: segment.width,
        height: segment.height,
        style: segment.style,
        image_src: segment.image_src,
        alt: segment.alt,
        href: segment.href,
    }
}

fn atom_range(start: usize, style: serde_json::Map<String, serde_json::Value>) -> LineStyleRange {
    LineStyleRange {
        start,
        end: start
            .checked_add(1)
            .expect("preflighted atom offset must fit in usize"),
        style,
        href: None,
        source_path: None,
        source_text: None,
        source_text_offset: None,
        ruby_annotation: None,
        inline_margin_left: None,
        inline_margin_right: None,
        border_start: false,
        border_end: false,
        text_mapping: crate::layout::text_mapping::RunTextMapping::synthetic(),
    }
}
