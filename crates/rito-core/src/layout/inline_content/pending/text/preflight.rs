use super::super::transform::{next_word_boundary, ScalarMapping, TransformMode};
use crate::layout::text_work::{TextWorkMeter, TextWorkYield};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PaintPlan {
    IdentityFallback,
    ScalarMapping,
    ContextualLowercase,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct TransformCounts {
    pub(super) logical_bytes: usize,
    pub(super) logical_utf16: usize,
    pub(super) transformed_bytes: usize,
    pub(super) transformed_utf16: usize,
    pub(super) changed: bool,
    pub(super) scalar_boundaries_match: bool,
    pub(super) has_sigma: bool,
}

#[derive(Debug)]
pub(super) struct PendingTransformPreflight {
    byte_cursor: usize,
    scalar: Option<PendingScalar>,
    counts: TransformCounts,
    at_word_boundary: bool,
}

#[derive(Debug)]
struct PendingScalar {
    character: char,
    utf16_units_remaining: usize,
}

impl TransformCounts {
    pub(super) fn paint_plan(self, mode: TransformMode) -> PaintPlan {
        if self.logical_utf16 != self.transformed_utf16 {
            PaintPlan::IdentityFallback
        } else if mode == TransformMode::Lowercase && self.has_sigma {
            PaintPlan::ContextualLowercase
        } else {
            PaintPlan::ScalarMapping
        }
    }

    pub(super) fn painted_bytes(self, plan: PaintPlan) -> usize {
        match plan {
            PaintPlan::IdentityFallback => self.logical_bytes,
            PaintPlan::ScalarMapping | PaintPlan::ContextualLowercase => self.transformed_bytes,
        }
    }

    pub(super) fn painted_utf16(self, plan: PaintPlan) -> usize {
        match plan {
            PaintPlan::IdentityFallback => self.logical_utf16,
            PaintPlan::ScalarMapping | PaintPlan::ContextualLowercase => self.transformed_utf16,
        }
    }

    pub(super) fn effective_changed(self, plan: PaintPlan) -> bool {
        plan != PaintPlan::IdentityFallback && self.changed
    }

    pub(super) fn effective_scalar_boundaries(self, plan: PaintPlan) -> bool {
        plan == PaintPlan::IdentityFallback || self.scalar_boundaries_match
    }
}

impl PendingTransformPreflight {
    pub(super) fn new(byte_start: usize) -> Self {
        Self {
            byte_cursor: byte_start,
            scalar: None,
            counts: TransformCounts {
                scalar_boundaries_match: true,
                ..TransformCounts::default()
            },
            at_word_boundary: true,
        }
    }

    pub(super) fn advance(
        &mut self,
        source: &str,
        mode: TransformMode,
        work: &mut TextWorkMeter,
    ) -> Result<Option<TransformCounts>, TextWorkYield> {
        loop {
            if self.byte_cursor == source.len() {
                debug_assert!(self.scalar.is_none());
                return Ok(Some(self.counts));
            }
            self.prepare_scalar(source);
            let scalar = self.scalar.as_mut().expect("a preflight scalar exists");
            let taken = work.take_utf16_units(scalar.utf16_units_remaining);
            scalar.utf16_units_remaining -= taken;
            if scalar.utf16_units_remaining != 0 {
                return Err(TextWorkYield);
            }
            self.commit_scalar(mode);
        }
    }

    fn prepare_scalar(&mut self, source: &str) {
        if self.scalar.is_some() {
            return;
        }
        let character = source[self.byte_cursor..]
            .chars()
            .next()
            .expect("the preflight cursor precedes source end");
        self.scalar = Some(PendingScalar {
            character,
            utf16_units_remaining: character.len_utf16(),
        });
    }

    fn commit_scalar(&mut self, mode: TransformMode) {
        let character = self
            .scalar
            .take()
            .expect("a fully paid preflight scalar exists")
            .character;
        checked_add(&mut self.byte_cursor, character.len_utf8());
        checked_add(&mut self.counts.logical_bytes, character.len_utf8());
        checked_add(&mut self.counts.logical_utf16, character.len_utf16());
        self.counts.has_sigma |= mode == TransformMode::Lowercase && character == 'Σ';
        self.inspect_mapping(character, mode);
        self.at_word_boundary = next_word_boundary(character);
    }

    fn inspect_mapping(&mut self, character: char, mode: TransformMode) {
        let mut first = None;
        let mut scalar_count = 0;
        for mapped in ScalarMapping::new(mode, character, self.at_word_boundary) {
            first.get_or_insert(mapped);
            checked_add(&mut scalar_count, 1);
            checked_add(&mut self.counts.transformed_bytes, mapped.len_utf8());
            checked_add(&mut self.counts.transformed_utf16, mapped.len_utf16());
        }
        let unchanged = scalar_count == 1 && first == Some(character);
        self.counts.changed |= !unchanged;
        self.counts.scalar_boundaries_match &= scalar_count == 1
            && first.is_some_and(|mapped| mapped.len_utf16() == character.len_utf16());
    }
}

fn checked_add(target: &mut usize, value: usize) {
    *target = target
        .checked_add(value)
        .expect("inline transform sizes must fit in usize");
}
