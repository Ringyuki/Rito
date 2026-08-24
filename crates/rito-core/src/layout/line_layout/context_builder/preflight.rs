use crate::layout::{
    inline_segment::InlineSegment,
    text_work::{TextWorkMeter, TextWorkYield},
};

use super::require_unit;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ContextCounts {
    pub(super) text_bytes: usize,
    pub(super) utf16_len: usize,
    pub(super) range_count: usize,
    pub(super) atom_count: usize,
    pub(super) newline_count: usize,
    pub(super) has_non_whitespace: bool,
    pub(super) has_newline: bool,
    pub(super) all_text_bmp: bool,
}

impl Default for ContextCounts {
    fn default() -> Self {
        Self {
            text_bytes: 0,
            utf16_len: 0,
            range_count: 0,
            atom_count: 0,
            newline_count: 0,
            has_non_whitespace: false,
            has_newline: false,
            all_text_bmp: true,
        }
    }
}

#[derive(Debug, Default)]
pub(super) struct PendingContextPreflight {
    segment_index: usize,
    segment_started: bool,
    byte_index: usize,
    scalar_units_remaining: usize,
    counts: ContextCounts,
}

impl PendingContextPreflight {
    pub(super) fn new() -> Self {
        Self::default()
    }

    pub(super) fn advance(
        &mut self,
        segments: &[InlineSegment],
        work: &mut TextWorkMeter,
    ) -> Result<Option<ContextCounts>, TextWorkYield> {
        loop {
            let Some(segment) = segments.get(self.segment_index) else {
                return Ok(Some(self.counts));
            };
            if !self.segment_started {
                require_unit(work)?;
                self.segment_started = true;
            }
            match segment {
                InlineSegment::Text(text) => {
                    if self.advance_text(&text.text, work)? {
                        checked_add(
                            &mut self.counts.range_count,
                            usize::from(!text.text.is_empty()),
                        );
                        self.finish_segment();
                    }
                }
                InlineSegment::Atom(_) => {
                    if self.advance_atom(work)? {
                        self.finish_segment();
                    }
                }
            }
        }
    }

    fn advance_text(
        &mut self,
        text: &str,
        work: &mut TextWorkMeter,
    ) -> Result<bool, TextWorkYield> {
        let Some(character) = text[self.byte_index..].chars().next() else {
            return Ok(true);
        };
        self.pay_scalar(character, work)?;
        checked_add(&mut self.byte_index, character.len_utf8());
        checked_add(&mut self.counts.text_bytes, character.len_utf8());
        checked_add(&mut self.counts.utf16_len, character.len_utf16());
        checked_add(
            &mut self.counts.newline_count,
            usize::from(character == '\n'),
        );
        self.counts.has_non_whitespace |= !character.is_whitespace();
        self.counts.has_newline |= character == '\n';
        self.counts.all_text_bmp &= character.len_utf16() == 1;
        Ok(false)
    }

    fn advance_atom(&mut self, work: &mut TextWorkMeter) -> Result<bool, TextWorkYield> {
        self.pay_scalar('\u{fffc}', work)?;
        checked_add(&mut self.counts.text_bytes, '\u{fffc}'.len_utf8());
        checked_add(&mut self.counts.utf16_len, 1);
        checked_add(&mut self.counts.range_count, 1);
        checked_add(&mut self.counts.atom_count, 1);
        self.counts.has_non_whitespace = true;
        Ok(true)
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

    fn finish_segment(&mut self) {
        checked_add(&mut self.segment_index, 1);
        self.segment_started = false;
        self.byte_index = 0;
        debug_assert_eq!(self.scalar_units_remaining, 0);
    }
}

fn checked_add(target: &mut usize, value: usize) {
    *target = target
        .checked_add(value)
        .expect("owned inline context sizes must fit in usize");
}
